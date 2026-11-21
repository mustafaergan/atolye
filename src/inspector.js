// Masaüstü uygulamasının içindeki sayfanın ağ trafiğini izler (yalnızca okuma): hangi servis çağrıldı, ne cevap döndü.
// Chromium tabanlı uygulamalar "uzaktan hata ayıklama" kapısıyla (Chrome DevTools Protocol) başlatılabiliyorsa çalışır;
// Atölye uygulamayı bu kapıyla başlatır ve yalnızca bu bilgisayardan (127.0.0.1) bağlanır. Uygulama kapıyı açmıyorsa
// izleme yapılamaz ve bu açıkça bildirilir. Yalnızca sayfanın yaptığı istekler görülür; uygulamanın sayfa dışındaki
// (ör. telefon/çağrı tarafındaki) bağlantıları görülmez.
//
// Saklanan: son istekler (yöntem, adres, durum, tür, süre), gönderilen gövde ve metin cevapların başı. Başlıklar (çerez,
// yetki anahtarı) saklanmaz; parola, PIN, kart ve anahtar alanları gizlenir. Hiçbir şey diske yazılmaz.
import http from 'node:http';
import { WebSocket } from 'ws';

const MAX_ENTRIES = 400;
const MAX_BODY = 20_000;
const MAX_POST = 10_000;
const BODY_TYPES = new Set(['XHR', 'Fetch', 'Document', 'EventSource', 'Other']);
const TEXTUAL = /json|text|xml|javascript|x-www-form-urlencoded|html/i;
const SECRET = '(?:pass(?:word)?|parola|sifre|şifre|pin|cvv|cvc|cvv2|card_?(?:number|no)|kart_?(?:no|numarasi)|pan|token|access_token|refresh_token|id_token|secret|authorization|api_?key)';

/** Gövdedeki parola, PIN, kart ve anahtar alanlarını gizler (JSON ve form biçimi) */
export function mask(text) {
  return String(text ?? '')
    .replace(new RegExp(`("${SECRET}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[0-9]+)`, 'gi'), '$1"***"')
    .replace(new RegExp(`((?:^|[&?;\\s])${SECRET}=)[^&\\s]*`, 'gi'), '$1***');
}

const getJson = (port, path) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path, agent: false, timeout: 3000 }, (res) => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { raw += c; });
    res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (err) { reject(err); } });
  });
  req.on('timeout', () => req.destroy(new Error('zaman aşımı')));
  req.on('error', reject);
});

let state = null; // { port, pages: Map<targetId, { ws, title, url }>, entries: [], byId: Map, timer, stopped, seq, attachedOnce }

/** İzlemeyi durdurur ve kayıtları siler */
export function stop() {
  if (!state) return;
  state.stopped = true;
  clearTimeout(state.timer);
  for (const p of state.pages.values()) { try { p.ws.close(); } catch { /* zaten kapalı */ } }
  state = null;
}

function send(page, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = (page.seq += 1);
    page.pending.set(id, { resolve, reject });
    try { page.ws.send(JSON.stringify({ id, method, params })); } catch (err) { page.pending.delete(id); reject(err); }
    setTimeout(() => { if (page.pending.delete(id)) reject(new Error('zaman aşımı')); }, 5000).unref?.();
  });
}

function record(st, entry) {
  st.entries.push(entry);
  st.byId.set(entry.key, entry);
  while (st.entries.length > MAX_ENTRIES) st.byId.delete(st.entries.shift().key);
}

function onEvent(st, page, m) {
  const p = m.params || {};
  const key = `${page.id}:${p.requestId}`;
  if (m.method === 'Network.requestWillBeSent') {
    const r = p.request || {};
    if (/^(data|blob|chrome|devtools|about):/i.test(r.url || '')) return;
    record(st, { key, n: (st.seq += 1), at: Date.now(), method: r.method || 'GET', url: String(r.url || ''), type: p.type || '', status: null, mime: '', post: r.postData ? mask(String(r.postData).slice(0, MAX_POST)) : '', body: '', failed: '', ms: null, started: p.timestamp });
  } else if (m.method === 'Network.responseReceived') {
    const e = st.byId.get(key);
    if (!e) return;
    e.status = p.response?.status ?? null;
    e.mime = String(p.response?.mimeType || '');
    if (p.type) e.type = p.type;
  } else if (m.method === 'Network.loadingFinished') {
    const e = st.byId.get(key);
    if (!e) return;
    if (e.started && p.timestamp) e.ms = Math.max(0, Math.round((p.timestamp - e.started) * 1000));
    // Yalnızca servis çağrılarının (XHR / fetch / belge) metin cevapları alınır; görsel, betik ve biçem dosyaları alınmaz
    if (BODY_TYPES.has(e.type) && TEXTUAL.test(e.mime) && !/javascript|css/i.test(e.mime)) {
      send(page, 'Network.getResponseBody', { requestId: p.requestId })
        .then((r) => { e.body = mask(String(r.base64Encoded ? Buffer.from(r.body || '', 'base64').toString('utf8') : r.body || '').slice(0, MAX_BODY)); })
        .catch(() => { /* cevap artık bellekte değil */ });
    }
  } else if (m.method === 'Network.loadingFailed') {
    const e = st.byId.get(key);
    if (e) e.failed = String(p.errorText || 'hata');
  }
}

function attachPage(st, target) {
  const url = String(target.webSocketDebuggerUrl || '');
  // Yalnızca bu bilgisayardaki, bu kapıdaki hedefe bağlanılır
  if (!new RegExp(`^ws://(127\\.0\\.0\\.1|localhost):${st.port}/`).test(url)) return;
  const page = { id: target.id, title: target.title || '', url: target.url || '', ws: new WebSocket(url, { perMessageDeflate: false }), seq: 0, pending: new Map() };
  st.pages.set(target.id, page);
  page.ws.on('open', () => { st.attachedOnce = true; send(page, 'Network.enable', { maxPostDataSize: MAX_POST }).catch(() => {}); });
  page.ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.id && page.pending.has(m.id)) { const w = page.pending.get(m.id); page.pending.delete(m.id); if (m.error) w.reject(new Error(m.error.message || 'hata')); else w.resolve(m.result || {}); return; }
    if (m.method && !st.stopped) onEvent(st, page, m);
  });
  const drop = () => { if (st.pages.get(target.id) === page) st.pages.delete(target.id); };
  page.ws.on('close', drop);
  page.ws.on('error', drop);
}

async function refresh(st) {
  let list;
  try { list = await getJson(st.port, '/json/list'); } catch { st.reachable = false; return; }
  if (st.stopped || !Array.isArray(list)) return;
  st.reachable = true;
  for (const t of list) {
    if (t.type !== 'page' && t.type !== 'webview' && t.type !== 'iframe') continue;
    const known = st.pages.get(t.id);
    if (known) { known.title = t.title || known.title; known.url = t.url || known.url; } else attachPage(st, t);
  }
}

/** Verilen kapıdaki uygulamayı izlemeye başlar; uygulama açılırken kapı birkaç saniye sonra hazır olabilir (yoklanır) */
export function watch(port) {
  stop();
  const st = { port, pages: new Map(), entries: [], byId: new Map(), timer: null, stopped: false, seq: 0, attachedOnce: false, reachable: null, since: Date.now() };
  state = st;
  // Açılıştaki istekler kaçmasın diye ilk yarım dakika sık, sonra seyrek yoklanır (yeni açılan sayfalar da böyle bulunur)
  const tick = async () => {
    if (st.stopped) return;
    await refresh(st);
    if (st.stopped) return;
    st.timer = setTimeout(tick, Date.now() - st.since < 30_000 ? 500 : 3000);
    st.timer.unref?.();
  };
  tick();
  return info();
}

/** İzleme durumu: { watching, port, attached (şu an bağlı sayfa sayısı), reachable, requests } */
export function info() {
  if (!state) return { watching: false };
  return { watching: true, port: state.port, attached: state.pages.size, everAttached: state.attachedOnce, reachable: state.reachable, requests: state.entries.length, since: state.since };
}

const need = () => {
  if (!state) throw Object.assign(new Error('not-watching'), { code: 'not-watching' });
  if (!state.attachedOnce) throw Object.assign(new Error('not-attached'), { code: 'not-attached' });
  return state;
};

/** Son istekler (en yenisi sonda). search: adreste ya da gövdelerde aranır; failed: yalnızca hatalılar (4xx/5xx ya da ağ hatası) */
export function list({ search, failed, limit } = {}) {
  const st = need();
  const q = String(search || '').trim().toLowerCase();
  let rows = st.entries;
  if (q) rows = rows.filter((e) => e.url.toLowerCase().includes(q) || e.post.toLowerCase().includes(q) || e.body.toLowerCase().includes(q));
  if (failed) rows = rows.filter((e) => e.failed || (e.status !== null && e.status >= 400));
  const max = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 200);
  return { total: rows.length, rows: rows.slice(-max) };
}

export function detail(n) {
  const st = need();
  const e = st.entries.find((x) => x.n === Number(n));
  if (!e) throw Object.assign(new Error('no-request'), { code: 'no-request' });
  return e;
}

/** Uygulamanın içindeki sayfalar: adres, başlık ve görünen metin */
export async function pages() {
  const st = need();
  const out = [];
  for (const p of st.pages.values()) {
    let text = '';
    try {
      const r = await send(p, 'Runtime.evaluate', { expression: '(document.body ? document.body.innerText : "").slice(0, 20000)', returnByValue: true });
      text = String(r.result?.value || '');
    } catch { /* sayfa cevap vermedi */ }
    out.push({ url: p.url, title: p.title, text: mask(text) });
  }
  return out;
}
