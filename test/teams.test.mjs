// Teams bağlantısı: erişim anahtarı yalnızca bellekte, araçlar yalnızca yerel LLM oturumunda, Graph'e yalnızca okuma.
// Graph'e gidilmez: sahte taşıyıcı kullanılır. Anahtarlar bu dosyada üretilen imzasız deneme değerleridir.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-teams-'));
process.env.ATOLYE_CLAUDE_JSON = path.join(tmp, 'claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(tmp, 'copilot', 'mcp-config.json');

const teams = await import('../src/teams.js');
const { configFromEnv } = await import('../src/atlassian.js');
const { availableTools, callTool } = await import('../src/mcp-server.js');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (claims = {}) => `${b64({ alg: 'none' })}.${b64({ aud: 'https://graph.microsoft.com', exp: Math.floor(Date.now() / 1000) + 3000, scp: 'Chat.Read User.Read', oid: 'ben', ...claims })}.imza-degil`;

test('anahtar: çözülür, süresi ve izinleri okunur; hatalı, süresi dolmuş ya da başka hizmetin anahtarı reddedilir', () => {
  const p = teams.parseToken(`  Bearer ${fakeToken()}\n`);
  assert.deepEqual([p.scopes, p.me], [['Chat.Read', 'User.Read'], 'ben']);
  assert.ok(p.exp > Date.now() && !p.token.includes(' '));
  assert.equal(teams.parseToken(`"${fakeToken({ aud: '00000003-0000-0000-c000-000000000000' })}"`).me, 'ben');
  const code = (raw) => { try { teams.parseToken(raw); return null; } catch (err) { return err.code; } };
  assert.equal(code(''), 'no-token');
  assert.equal(code('merhaba dünya'), 'bad-token');
  assert.equal(code('kisa'), 'bad-token');
  assert.equal(code(fakeToken({ exp: Math.floor(Date.now() / 1000) - 10 })), 'expired');
  assert.equal(code(fakeToken({ aud: 'https://management.azure.com' })), 'wrong-audience');
  // İçi okunamayan anahtar reddedilmez: geçerliliğine Graph karar verir
  assert.deepEqual(teams.parseToken('abcdefghijklmnopqrstuvwxyz0123456789').scopes, []);
});

test('durum: anahtarın kendisi geri verilmez; kaldırınca silinir', () => {
  const t = fakeToken();
  const st = teams.setToken(t);
  assert.equal(st.hasToken, true);
  assert.equal(st.expired, false);
  assert.ok(st.minutesLeft >= 48 && st.minutesLeft <= 50);
  assert.ok(!JSON.stringify(st).includes(t.slice(0, 30)));
  teams.clearToken();
  assert.deepEqual(teams.status(), { hasToken: false, expired: false, minutesLeft: null, scopes: [] });
});

test('araçlar yalnızca yerel LLM oturumunda ve Teams açıkken sunulur', () => {
  const full = { ATOLYE_YEREL_OTURUM: '1', TEAMS_ENABLED: '1', ATOLYE_TEAMS_URL: 'http://127.0.0.1:1/ic/teams', ATOLYE_TEAMS_ANAHTAR: 'gizli' };
  assert.deepEqual(configFromEnv('teams', full), { url: 'http://127.0.0.1:1/ic/teams', token: 'gizli', email: '' });
  for (const k of Object.keys(full)) {
    const env = { ...full }; delete env[k];
    assert.equal(configFromEnv('teams', env), null, `${k} yokken`);
  }
  const names = (env) => availableTools(env).map((t) => t.name).filter((n) => n.startsWith('teams_'));
  assert.deepEqual(names(full), ['teams_list_chats', 'teams_get_messages', 'teams_list_channels', 'teams_get_channel_messages']);
  assert.deepEqual(names({ ...full, ATOLYE_YEREL_OTURUM: undefined }), []); // Claude Code / Copilot oturumu
  assert.ok(availableTools(full).filter((t) => t.name.startsWith('teams_')).every((t) => t.annotations.readOnlyHint));
});

const chats = [
  { id: '19:aaa@thread.v2', topic: 'Proje Grubu', chatType: 'group', members: [{ userId: 'ben', displayName: 'Ben' }, { userId: 'u2', displayName: 'Ayşe Yılmaz' }],
    lastMessagePreview: { createdDateTime: '2026-11-20T10:00:00Z', messageType: 'message', body: { contentType: 'text', content: 'Yarın toplanalım' }, from: { user: { displayName: 'Ayşe Yılmaz' } } } },
  { id: '19:ben_u3@unq.gbl.spaces', topic: null, chatType: 'oneOnOne', members: [{ userId: 'ben', displayName: 'Ben' }, { userId: 'u3', displayName: 'Işıl Çelik' }] },
];
const messages = [ // Graph en yeniden eskiye verir
  { id: '3', messageType: 'message', createdDateTime: '2026-11-20T10:02:00Z', from: { user: { displayName: 'Ayşe Yılmaz' } }, body: { contentType: 'html', content: '<p>Tamam <at id="0">Ben</at>, <b>rapor</b> ekte</p><attachment id="x"></attachment>' }, attachments: [{ name: 'rapor.pdf' }] },
  { id: '2', messageType: 'systemEventMessage', createdDateTime: '2026-11-20T10:01:00Z', from: null, body: { contentType: 'html', content: '<systemEventMessage/>' } },
  { id: '1', messageType: 'message', createdDateTime: '2026-11-20T10:00:00Z', deletedDateTime: '2026-11-20T10:05:00Z', from: { user: { displayName: 'Ben' } }, body: { contentType: 'text', content: '' } },
  { id: '0', messageType: 'message', createdDateTime: '2026-11-20T09:59:00Z', from: { user: { displayName: 'Ben' } }, body: { contentType: 'text', content: 'Rapor hazır mı?' } },
];

test('sohbetler ve mesajlar: Graph cevabı düz metne çevrilir; sorgu biçimi reddedilirse sadeleştirilir', async () => {
  const seen = [];
  teams.setTransport(async (url, headers) => {
    seen.push(decodeURIComponent(url.replace('https://graph.microsoft.com/v1.0', '')));
    assert.match(headers.authorization, /^Bearer [\w.-]+$/);
    if (url.includes('/me/chats?')) {
      if (url.includes('members,lastMessagePreview')) return { status: 400, text: '{"error":{"message":"expand birleşimi desteklenmiyor"}}' };
      return { status: 200, text: JSON.stringify({ value: chats }) };
    }
    // Yalnızca ilk çağrıda (limit 3) devamı varmış gibi davranılır
    if (url.includes('/messages?')) return { status: 200, text: JSON.stringify({ value: messages, ...(url.includes('$top=3&') ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sonraki' } : {}) }) };
    return { status: 404, text: '' };
  });
  teams.setToken(fakeToken());

  const list = await teams.operations.listChats({});
  assert.ok(seen[0].includes('$expand=members,lastMessagePreview'), 'önce en zengin sorgu denenir');
  assert.ok(seen[1].includes('$expand=members&$orderby='), 'reddedilince sadeleştirilir');
  const rows = list.split('\n');
  assert.equal(rows[1], `19:aaa@thread.v2 | grup | Proje Grubu | son: ${teams.when('2026-11-20T10:00:00Z')} Ayşe Yılmaz: Yarın toplanalım`);
  assert.equal(rows[2], '19:ben_u3@unq.gbl.spaces | birebir | Işıl Çelik', 'birebir sohbette karşıdaki kişinin adı');

  // Türkçe büyük/küçük harf: "IŞIL" -> "ışıl"
  assert.match(await teams.operations.listChats({ query: 'IŞIL' }), /Işıl Çelik/);
  assert.match(await teams.operations.listChats({ query: 'bulunmaz' }), /eşleşen sohbet bulunamadı/);

  seen.length = 0;
  const text = await teams.operations.getMessages({ chat: 'proje', limit: 3 });
  assert.ok(seen.at(-1).startsWith('/me/chats/19:aaa@thread.v2/messages?$top=3&$orderby=createdDateTime desc'), seen.at(-1));
  const lines = text.split('\n');
  assert.equal(lines[0], 'Sohbet: Proje Grubu');
  assert.equal(lines[1], '2 mesaj (eskiden yeniye):', 'sistem olayı atlanır');
  assert.equal(lines[2], `[${teams.when('2026-11-20T10:00:00Z')}] Ben: (silinmiş mesaj)`);
  assert.equal(lines[3], `[${teams.when('2026-11-20T10:02:00Z')}] Ayşe Yılmaz: Tamam @Ben, rapor ekte [ek: rapor.pdf]`);
  assert.match(lines[4], /Daha eski mesajlar var; onlar için before="2026-11-20T10:00:00Z"/);

  seen.length = 0;
  await teams.operations.getMessages({ chat: '19:aaa@thread.v2', before: '2026-11-20' });
  assert.equal(seen.length, 1, 'kimlik verilince sohbet aranmaz');
  assert.ok(seen[0].includes('$filter=createdDateTime lt 2026-11-20T00:00:00.000Z'));
  await assert.rejects(teams.operations.getMessages({ chat: '19:aaa@thread.v2', before: 'dün' }), /geçerli bir tarih/);
});

test('hatalar anlaşılır: anahtar yok, süresi dolmuş, kabul edilmedi, izin yok; yalnızca Graph adresine gidilir', async () => {
  teams.clearToken();
  await assert.rejects(teams.operations.listChats({}), /erişim anahtarı girilmemiş/);
  let calls = 0;
  const reply = (status, text = '') => teams.setTransport(async () => { calls += 1; return { status, text }; });
  teams.setToken(fakeToken());
  reply(401, '{"error":{"code":"InvalidAuthenticationToken"}}');
  await assert.rejects(teams.operations.listChats({}), /kabul edilmedi ya da süresi doldu/);
  reply(403);
  await assert.rejects(teams.operations.getChannelMessages({ team: 't', channel: 'c' }), /gereken izin: ChannelMessage\.Read\.All ya da Group\.Read\.All/);
  assert.equal((await teams.test()).code, 403, 'Graph durum kodu bildirilir');
  reply(200, JSON.stringify({ displayName: 'Deneme Kullanıcı', id: 'ben' }));
  assert.deepEqual(await teams.test(), { ok: true, user: 'Deneme Kullanıcı' });

  // Süresi dolmuş anahtarla Graph'e hiç gidilmez
  const real = Date.now;
  calls = 0;
  try { Date.now = () => real() + 2 * 60 * 60 * 1000; await assert.rejects(teams.operations.listChats({}), /süresi doldu/); } finally { Date.now = real; }
  assert.equal(calls, 0);
  teams.setTransport(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  await assert.rejects(teams.operations.listChats({}), /ulaşılamadı \(ENOTFOUND\).*Proxy/);
});

test('iç kapı: yalnızca Atölye\'nin yerel oturuma verdiği anahtarla, yalnızca okuma işlemleri; araç sunucusu isteği buraya iletir', async () => {
  teams.setToken(fakeToken());
  teams.setTransport(async () => ({ status: 200, text: JSON.stringify({ value: chats }) }));
  assert.equal((await teams.gateRequest('Bearer yanlis', { op: 'listChats' })).status, 401);
  assert.equal((await teams.gateRequest(undefined, { op: 'listChats' })).status, 401);
  const ok = `Bearer ${teams.gate.secret}`;
  assert.equal((await teams.gateRequest(ok, { op: 'whoami' })).status, 400, 'araç olmayan işlem çağrılamaz');
  assert.equal((await teams.gateRequest(ok, { op: 'setToken', args: { raw: 'x' } })).status, 400);
  assert.match((await teams.gateRequest(ok, { op: 'listChats', args: {} })).body.text, /Proje Grubu/);

  // Uçtan uca: araç sunucusu (MCP) -> iç kapı -> (sahte) Graph
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const r = await teams.gateRequest(req.headers.authorization, JSON.parse(raw || '{}'));
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { ATOLYE_YEREL_OTURUM: '1', TEAMS_ENABLED: '1', ATOLYE_TEAMS_URL: `http://127.0.0.1:${server.address().port}/ic/teams`, ATOLYE_TEAMS_ANAHTAR: teams.gate.secret };
    const r = await callTool('teams_list_chats', { query: 'ayşe' }, env);
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /19:aaa@thread\.v2 \| grup \| Proje Grubu/);
    // Yerel oturum işareti olmayan (Claude Code / Copilot) oturumda araç yoktur
    assert.equal((await callTool('teams_list_chats', {}, { ...env, ATOLYE_YEREL_OTURUM: undefined })).isError, true);
    // Atölye yeniden başlamış (iç anahtar değişmiş): anlaşılır hata
    const stale = await callTool('teams_list_chats', {}, { ...env, ATOLYE_TEAMS_ANAHTAR: 'eski' });
    assert.match(stale.content[0].text, /Yeni bir oturum açın/);
    // Graph hatası araca metin olarak döner
    teams.clearToken();
    assert.match((await callTool('teams_get_messages', { chat: '19:aaa@thread.v2' }, env)).content[0].text, /erişim anahtarı girilmemiş/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('bağlantı durumu ve yerel oturum ortamı: anahtar ayar dosyasına yazılmaz; iç kapı bilgisi yalnızca yerel oturuma verilir', async () => {
  const integ = await import('../src/integrations.js');
  assert.equal(integ.status().services.teams.connected, false);
  integ.setTeams(true);
  assert.equal(integ.status().services.teams.connected, true);
  const t = fakeToken();
  teams.setToken(t);
  const saved = fs.readFileSync(process.env.ATOLYE_CLAUDE_JSON, 'utf8');
  assert.ok(saved.includes('TEAMS_ENABLED') && !saved.includes(t.slice(0, 30)) && !saved.includes(teams.gate.secret));
  assert.throws(() => integ.save('teams', { url: 'https://x.example.com', token: 'a' }), /buradan kaydedilmez/);
  // "Veri getir" (Copilot oturumu) Teams'e ulaşamaz
  assert.deepEqual(integ.readTools('teams'), []);
  assert.equal((await integ.runReadTool('teams_list_chats', {})).ok, false);
  integ.setTeams(false);
  assert.equal(integ.status().services.teams.connected, false);

  const { localEnv } = await import('../src/settings.js');
  teams.gate.origin = 'http://127.0.0.1:3210';
  const env = localEnv({ id: 'a', url: 'http://localhost:11434', model: 'm', kind: 'anthropic' }, {});
  assert.deepEqual([env.ATOLYE_YEREL_OTURUM, env.ATOLYE_TEAMS_URL, env.ATOLYE_TEAMS_ANAHTAR], ['1', 'http://127.0.0.1:3210/ic/teams', teams.gate.secret]);
  teams.clearToken();
  teams.setTransport(null);
});
