// Teams bağlantısı: Microsoft Graph üzerinden Teams sohbetlerini ve kanal gönderilerini OKUR (yazma yoktur).
//
// Kimlik: kullanıcı, Microsoft'un Graph Explorer aracından aldığı erişim anahtarını (access token) Bağlantılar > Teams
// bölümüne yapıştırır. Uygulama kaydı gerekmez; anahtar kuruluşun ayarına göre bir saat ile bir gün arasında geçerlidir
// ve süresi dolunca yenisi yapıştırılır.
//
// Güvenlik:
//   - Anahtar YALNIZCA bu sürecin belleğinde tutulur: diske, ayar dosyalarına, kayıtlara (log) yazılmaz; arayüze ve
//     yapay zekâya geri verilmez. Atölye kapanınca silinir.
//   - Mesajlar kişisel ya da gizli bilgi içerebilir; bu yüzden araçlar yalnızca yerel LLM oturumlarına sunulur
//     (bkz. atlassian.js configFromEnv). Araç sunucusu Graph'e kendisi gitmez: isteği buraya iletir (teams-client.js)
//     ve bunu yalnızca yerel LLM oturumlarına verilen iç anahtarla (gate.secret) yapabilir.
//   - Yalnızca graph.microsoft.com adresine, yalnızca GET isteği yapılır.
import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { errorSummary, htmlToText } from './atlassian.js';
import { parseProxy } from './proxy.js';

const GRAPH = 'https://graph.microsoft.com';
const GRAPH_AUDIENCES = ['https://graph.microsoft.com', '00000003-0000-0000-c000-000000000000'];

/** Araç sunucusunun bu sürece ulaştığı iç kapı: adres sunucu açılırken yazılır, anahtar her çalışmada yeniden üretilir */
export const gate = { origin: '', secret: crypto.randomBytes(24).toString('hex') };

const empty = () => ({ token: '', exp: 0, scopes: [], me: '' });
let state = empty();

const fail = (code) => Object.assign(new Error(code), { code });

/** Yapıştırılan metinden anahtar: { token, exp (ms; bilinmiyorsa 0), scopes, me (kullanıcının dizin kimliği) } */
export function parseToken(raw) {
  const token = String(raw || '').trim().replace(/^authorization\s*:\s*/i, '').replace(/^bearer\s+/i, '').replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
  if (!token) throw fail('no-token');
  if (token.length < 20 || !/^[\w.~+/=-]+$/.test(token)) throw fail('bad-token');
  let claims = null;
  const parts = token.split('.');
  if (parts.length === 3) {
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { /* çözülemeyen anahtar olduğu gibi denenir */ }
  }
  if (!claims || typeof claims !== 'object') return { token, exp: 0, scopes: [], me: '' };
  const aud = String(claims.aud || '').replace(/\/+$/, '');
  if (aud && !GRAPH_AUDIENCES.includes(aud)) throw fail('wrong-audience');
  const exp = Number(claims.exp) > 0 ? Number(claims.exp) * 1000 : 0;
  if (exp && exp <= Date.now()) throw fail('expired');
  return { token, exp, scopes: String(claims.scp || '').split(/\s+/).filter(Boolean), me: typeof claims.oid === 'string' ? claims.oid : '' };
}

export function setToken(raw) {
  state = parseToken(raw);
  chatQuery = 0;
  return status();
}

export function clearToken() {
  state = empty();
}

/** Arayüze giden durum: anahtarın kendisi asla geri gönderilmez */
export function status() {
  const left = state.exp ? Math.floor((state.exp - Date.now()) / 60_000) : null;
  return {
    hasToken: Boolean(state.token),
    expired: Boolean(state.token && state.exp && state.exp <= Date.now()),
    minutesLeft: state.token ? left : null,
    scopes: state.scopes,
  };
}

// ---------- Microsoft Graph'e istek ----------
let systemCaAdded = false;
/** Kurumsal ağların TLS sertifikaları genelde yalnızca işletim sisteminin deposundadır */
function trustSystemCertificates() {
  if (systemCaAdded) return;
  systemCaAdded = true;
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
  } catch { /* eski Node */ }
}

/** İnternete çıkış proxy'si: Bağlantılar > Proxy'deki ayar, yoksa bilgisayarın genel proxy ayarı */
export function proxyFor(env = process.env) {
  return parseProxy(env.COPILOT_PROXY) || parseProxy(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
}

/** Proxy üzerinden HTTPS GET: önce CONNECT ile tünel açılır, TLS tünelin içinde kurulur */
export function getViaProxy(proxy, url, headers, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const target = `${u.hostname}:${u.port || 443}`;
    let settled = false;
    const done = (err, value) => { if (settled) return; settled = true; if (err) { socket.destroy(); reject(err); } else resolve(value); };
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    socket.setTimeout(timeoutMs, () => done(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })));
    socket.once('error', (err) => done(err));
    socket.once('connect', () => {
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
    });
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      if (head.indexOf('\r\n\r\n') < 0) return;
      socket.off('data', onData);
      const code = /^HTTP\/\d\.\d (\d{3})/.exec(head.toString('latin1'))?.[1];
      if (code !== '200') return done(Object.assign(new Error(`proxy bağlantıyı reddetti (HTTP ${code || '?'})`), { code: code === '407' ? 'PROXY_AUTH' : 'PROXY_REFUSED' }));
      socket.setTimeout(0);
      const req = https.request({
        host: u.hostname, path: `${u.pathname}${u.search}`, method: 'GET', headers, agent: false,
        createConnection: () => tls.connect({ socket, servername: u.hostname }),
      }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => done(null, { status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => done(err));
      });
      req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })));
      req.on('error', (err) => done(err));
      req.end();
    };
    socket.on('data', onData);
  });
}

async function defaultTransport(url, headers) {
  trustSystemCertificates();
  const proxy = proxyFor();
  if (proxy) return getViaProxy(proxy, url, headers);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000), redirect: 'error' });
  return { status: res.status, text: await res.text() };
}

let transport = defaultTransport;
/** Testler için: Graph'e gitmeden sahte cevap veren taşıyıcı. (url, headers) -> { status, text } */
export function setTransport(fn) {
  transport = fn || defaultTransport;
}

const NEW_TOKEN = 'Bağlantılar > Teams bölümünden yeni bir anahtar yapıştırın (Graph Explorer > Access token).';

async function graph(pathOrUrl, need = '') {
  if (!state.token) throw new Error(`Teams erişim anahtarı girilmemiş. ${NEW_TOKEN}`);
  if (state.exp && state.exp <= Date.now()) throw new Error(`Teams erişim anahtarının süresi doldu. ${NEW_TOKEN}`);
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}/v1.0${pathOrUrl}`;
  if (new URL(url).origin !== GRAPH) throw new Error('Yalnızca Microsoft Graph adresine istek yapılır');
  let res;
  try {
    res = await transport(url, { authorization: `Bearer ${state.token}`, accept: 'application/json' });
  } catch (err) {
    throw new Error(`Microsoft Graph'e ulaşılamadı (${err.cause?.code || err.code || err.message}). İnternete proxy üzerinden çıkılıyorsa Bağlantılar > Proxy ayarını kontrol edin.`);
  }
  if (res.status >= 200 && res.status < 300) {
    try { return res.text ? JSON.parse(res.text) : {}; } catch { throw new Error('Microsoft Graph beklenmeyen bir cevap döndürdü'); }
  }
  const detail = errorSummary(res.text);
  const text = res.status === 401 ? `Teams erişim anahtarı kabul edilmedi ya da süresi doldu. ${NEW_TOKEN}`
    : res.status === 403 ? `Bu işlem için anahtarın izni yok${need ? ` (gereken izin: ${need})` : ''}. Graph Explorer'da "Modify permissions" sekmesinden izne onay verip yeni anahtarı yapıştırın; yönetici onayı isteniyorsa bu işlem kullanılamaz.`
      : res.status === 404 ? 'Bulunamadı (kimlik yanlış olabilir)'
        : res.status === 429 ? 'Microsoft çok fazla istek geldiğini bildirdi; biraz sonra yeniden deneyin.'
          : `Microsoft Graph HTTP ${res.status}${detail ? ` (${detail})` : ''}`;
  throw Object.assign(new Error(text), { status: res.status });
}

// ---------- Biçimlendirme ----------
const enc = encodeURIComponent;
const clamp = (n, def, max) => Math.min(Math.max(Math.floor(Number(n)) || def, 1), max);
const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s, max) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max)}…` : t; };
const lower = (s) => String(s || '').toLocaleLowerCase('tr');

/** Tarih, bilgisayarın saat diliminde: 2026-11-21 14:05 */
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const sender = (m) => m?.from?.user?.displayName || m?.from?.application?.displayName || '?';

/** Mesajın düz metni; sistem olayları (üye eklendi vb.) için null */
export function messageText(m) {
  if (m.deletedDateTime || m.isDeleted) return '(silinmiş mesaj)';
  if (m.messageType && m.messageType !== 'message') return null;
  const raw = String(m.body?.content || '');
  let text = m.body?.contentType === 'html'
    ? htmlToText(raw.replace(/<attachment[^>]*>\s*<\/attachment>/gi, '').replace(/<img[^>]*>/gi, ' [görsel] ').replace(/<at(\s[^>]*)?>/gi, '@'))
    : raw.trim();
  const files = (m.attachments || []).map((a) => a?.name).filter(Boolean);
  if (files.length) text += `${text ? ' ' : ''}[ek: ${files.join(', ')}]`;
  return text || '(boş mesaj)';
}

const TYPE = { oneOnOne: 'birebir', group: 'grup', meeting: 'toplantı' };
function chatName(c) {
  if (c.topic) return c.topic;
  const others = (c.members || []).filter((m) => !state.me || m.userId !== state.me).map((m) => m.displayName).filter(Boolean);
  if (others.length) return `${others.slice(0, 4).join(', ')}${others.length > 4 ? ` +${others.length - 4}` : ''}`;
  return c.chatType === 'meeting' ? 'Toplantı sohbeti' : '(adsız sohbet)';
}
const chatMatches = (c, q) => lower(c.topic).includes(q) || (c.members || []).some((m) => lower(m.displayName).includes(q));

// Sohbet listesi sorgusu: Graph bazı kiracılarda genişletme (expand) birleşimlerini kabul etmeyebilir; çalışan ilk biçim hatırlanır
const CHAT_QUERIES = [
  '&$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc',
  '&$expand=members&$orderby=lastMessagePreview/createdDateTime%20desc',
  '&$expand=members',
  '',
];
let chatQuery = 0;

/** En fazla `max` sohbet (sayfa sayfa); `keep` verilirse yalnızca uyanlar sayılır */
async function fetchChats(max, keep = null, maxPages = 1) {
  let page;
  for (;;) {
    try { page = await graph(`/me/chats?$top=50${CHAT_QUERIES[chatQuery]}`, 'Chat.Read'); break; } catch (err) {
      if (err.status !== 400 || chatQuery >= CHAT_QUERIES.length - 1) throw err;
      chatQuery += 1;
    }
  }
  const out = [];
  for (let n = 1; ; n += 1) {
    for (const c of page.value || []) if (!keep || keep(c)) out.push(c);
    if (out.length >= max || n >= maxPages || !page['@odata.nextLink']) break;
    page = await graph(page['@odata.nextLink'], 'Chat.Read');
  }
  return out.slice(0, max);
}

const chatLine = (c) => {
  const last = c.lastMessagePreview;
  const preview = last ? messageText(last) : null;
  const tail = last && preview !== null ? ` | son: ${when(last.createdDateTime)} ${sender(last)}: ${oneLine(preview, 120)}` : '';
  return `${c.id} | ${TYPE[c.chatType] || c.chatType || '?'} | ${chatName(c)}${tail}`;
};

const looksLikeChatId = (s) => /^19:[^\s]+@[\w.]+$/.test(s);

export const operations = {
  async whoami() {
    const me = await graph('/me?$select=displayName,id', 'User.Read');
    if (me.id && !state.me) state.me = me.id;
    return me.displayName || 'Teams';
  },

  async listChats({ query, limit } = {}) {
    const q = lower(String(query || '').trim());
    const max = clamp(limit, 20, 50);
    // Arama sohbet adında ve kişi adlarında, bu bilgisayarda yapılır: son 200 sohbete bakılır
    const chats = q ? await fetchChats(max, (c) => chatMatches(c, q), 4) : await fetchChats(max);
    if (!chats.length) return q ? `"${query}" ile eşleşen sohbet bulunamadı (son 200 sohbete bakıldı).` : 'Sohbet bulunamadı.';
    return `kimlik | tür | ad ya da kişiler | son mesaj\n${chats.map(chatLine).join('\n')}`;
  },

  async getMessages({ chat, limit, before } = {}) {
    let id = String(chat || '').trim();
    let title = '';
    if (!looksLikeChatId(id)) {
      const q = lower(id);
      const found = await fetchChats(6, (c) => chatMatches(c, q), 4);
      if (!found.length) throw new Error(`"${chat}" ile eşleşen sohbet bulunamadı. teams_list_chats ile sohbetlere bakın.`);
      if (found.length > 1) return `"${chat}" birden çok sohbetle eşleşti. İstediğinizin kimliğiyle (ilk sütun) yeniden çağırın:\n${found.map(chatLine).join('\n')}`;
      id = found[0].id;
      title = chatName(found[0]);
    }
    const max = clamp(limit, 30, 200);
    let filter = '';
    if (before) {
      const d = new Date(String(before));
      if (Number.isNaN(d.getTime())) throw new Error('"before" geçerli bir tarih olmalı (ör. 2026-11-21 ya da 2026-11-21T09:00:00Z)');
      filter = `&$filter=createdDateTime%20lt%20${d.toISOString()}`;
    }
    let page = await graph(`/me/chats/${enc(id)}/messages?$top=${Math.min(max, 50)}&$orderby=createdDateTime%20desc${filter}`, 'Chat.Read');
    const items = [];
    for (;;) {
      items.push(...(page.value || []));
      if (items.length >= max || !page['@odata.nextLink']) break;
      page = await graph(page['@odata.nextLink'], 'Chat.Read');
    }
    const more = items.length > max || Boolean(page['@odata.nextLink']);
    const shown = items.slice(0, max);
    const lines = shown.map((m) => { const t = messageText(m); return t === null ? null : `[${when(m.createdDateTime)}] ${sender(m)}: ${oneLine(t, 4000)}`; }).filter(Boolean).reverse();
    if (!lines.length) return 'Bu sohbette (bu aralıkta) mesaj yok.';
    const oldest = shown.at(-1)?.createdDateTime;
    return [
      `${title ? `Sohbet: ${title}\n` : ''}${lines.length} mesaj (eskiden yeniye):`,
      ...lines,
      more && oldest ? `(Daha eski mesajlar var; onlar için before="${oldest}" ile yeniden çağırın.)` : null,
    ].filter(Boolean).join('\n').slice(0, 60_000);
  },

  async listChannels({ query } = {}) {
    const q = lower(String(query || '').trim());
    const teams = ((await graph('/me/joinedTeams?$select=id,displayName', 'Team.ReadBasic.All')).value || []).filter((t) => !q || lower(t.displayName).includes(q));
    if (!teams.length) return q ? `"${query}" ile eşleşen ekip bulunamadı.` : 'Üyesi olduğunuz ekip bulunamadı.';
    const out = [];
    for (const t of teams.slice(0, 15)) {
      out.push(`Ekip: ${t.displayName} | ekip kimliği: ${t.id}`);
      try {
        const channels = (await graph(`/teams/${enc(t.id)}/channels?$select=id,displayName`, 'Channel.ReadBasic.All')).value || [];
        for (const c of channels) out.push(`  - ${c.displayName} | kanal kimliği: ${c.id}`);
      } catch (err) {
        out.push(`  (kanallar okunamadı: ${err.message})`);
        if (err.status === 401 || err.status === 403) break; // sonraki ekiplerde de aynı olur
      }
    }
    if (teams.length > 15) out.push(`(${teams.length - 15} ekip daha var; "query" ile daraltın.)`);
    return out.join('\n');
  },

  async getChannelMessages({ team, channel, limit } = {}) {
    const max = clamp(limit, 10, 50);
    const page = await graph(`/teams/${enc(String(team).trim())}/channels/${enc(String(channel).trim())}/messages?$top=${max}&$expand=replies`, 'ChannelMessage.Read.All ya da Group.Read.All');
    const out = [];
    for (const m of page.value || []) {
      const t = messageText(m);
      if (t === null) continue;
      out.push(`[${when(m.createdDateTime)}] ${sender(m)}${m.subject ? ` (${oneLine(m.subject, 120)})` : ''}: ${oneLine(t, 4000)}`);
      const replies = (m.replies || []).slice().sort((a, b) => String(a.createdDateTime).localeCompare(String(b.createdDateTime)));
      for (const r of replies.slice(-20)) {
        const rt = messageText(r);
        if (rt !== null) out.push(`    ↳ [${when(r.createdDateTime)}] ${sender(r)}: ${oneLine(rt, 2000)}`);
      }
      if (replies.length > 20) out.push(`    (${replies.length - 20} eski yanıt gösterilmedi)`);
    }
    if (!out.length) return 'Bu kanalda gönderi yok.';
    return `Son gönderiler (en son hareket edenden eskiye), yanıtlarıyla:\n${out.join('\n')}`.slice(0, 60_000);
  },
};

/** Arayüzdeki "Sına": { ok, user } ya da { ok: false, error, code: Graph'in durum kodu (varsa) } */
export async function test() {
  try { return { ok: true, user: await operations.whoami() }; } catch (err) { return { ok: false, error: err.message, ...(err.status ? { code: err.status } : {}) }; }
}

const TOOL_OPS = ['listChats', 'getMessages', 'listChannels', 'getChannelMessages'];
const sameSecret = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(`Bearer ${gate.secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** İç kapı: araç sunucusundan gelen istek. { status, body } döndürür (bkz. server.js /ic/teams) */
export async function gateRequest(authorization, body) {
  if (!sameSecret(authorization)) return { status: 401, body: { error: 'yetkisiz' } };
  const op = String(body?.op || '');
  if (!TOOL_OPS.includes(op)) return { status: 400, body: { error: `Bilinmeyen işlem: ${op}` } };
  try {
    return { status: 200, body: { text: String(await operations[op](body?.args && typeof body.args === 'object' ? body.args : {})) } };
  } catch (err) {
    return { status: 200, body: { error: err.message } };
  }
}
