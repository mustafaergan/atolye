// Chrome bağlantısı: eklenti köprüsü (eşleştirme, iç kapı) ve araç sunucusundan eklentiye kadar zincir.
// Eklentinin kendisi yerine onun gibi davranan bir WebSocket istemcisi kullanılır.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-chrome-'));
process.env.ATOLYE_CHROME_FILE = path.join(dir, 'chrome.json');
const chrome = await import('../src/chrome.js');
const { configFromEnv } = await import('../src/atlassian.js');
const { availableTools, callTool } = await import('../src/mcp-server.js');

let server;
let port;
let enabled = true;
const sockets = new Set();

before(async () => {
  chrome.setEnabledCheck(() => enabled);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => chrome.attach(ws));
  server = http.createServer((req, res) => {
    // /ic/chrome: sunucudaki iç kapının aynısı
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const r = await chrome.gateRequest(req.headers.authorization, JSON.parse(raw || '{}'));
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/chrome' || !chrome.isExtensionOrigin(req.headers.origin)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  chrome.publishGate(port, {});
});

after(() => {
  chrome.disconnect('test bitti');
  for (const s of sockets) s.destroy();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Eklenti gibi davranan istemci: hello gönderir, gelen işlemlere handler ile yanıt verir */
function fakeExtension(kod, handler = async (op) => ({ text: `yapıldı: ${op}` }), origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chrome`, { origin });
    const msgs = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', kod, surum: '1.0.0', tarayici: 'Chrome 142', paylasilan: 1, tumSekmeler: false, duraklat: false })));
    ws.on('message', async (raw) => {
      const m = JSON.parse(String(raw));
      msgs.push(m);
      if (m.type === 'hello-ok' || m.type === 'hello-error') resolve({ ws, first: m, msgs });
      if (m.type === 'call') {
        try { ws.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: await handler(m.op, m.args) })); } catch (err) { ws.send(JSON.stringify({ type: 'result', id: m.id, ok: false, error: err.message })); }
      }
    });
    ws.on('error', reject);
    ws.on('unexpected-response', () => reject(new Error('reddedildi')));
  });
}
// İstemci kapandıktan sonra sunucunun da bunu fark etmesi beklenir
const closed = async (ws) => {
  await new Promise((r) => (ws.readyState === ws.CLOSED ? r() : ws.on('close', r)));
  for (let i = 0; i < 100 && chrome.status().extension; i++) await new Promise((r) => setTimeout(r, 10));
};
const gate = (body, secret = chrome.gate.secret) => chrome.gateRequest(`Bearer ${secret}`, body);

test('eşleştirme kodu üretilir, saklanır ve yenilenince değişir', () => {
  const a = chrome.pairingCode();
  assert.match(a, /^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/);
  assert.equal(chrome.pairingCode(), a);
  assert.equal(JSON.parse(fs.readFileSync(process.env.ATOLYE_CHROME_FILE, 'utf8')).kod, a);
  const b = chrome.renewCode();
  assert.notEqual(b, a);
  assert.equal(chrome.pairingCode(), b);
});

test('yalnızca eklenti kökeni kabul edilir', () => {
  assert.ok(chrome.isExtensionOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'));
  assert.ok(!chrome.isExtensionOrigin('http://127.0.0.1:3210'));
  assert.ok(!chrome.isExtensionOrigin('https://kotu.example'));
  assert.ok(!chrome.isExtensionOrigin(undefined));
});

test('web sayfası kökeninden /chrome kapısına bağlanılamaz', async () => {
  await assert.rejects(fakeExtension(chrome.pairingCode(), undefined, 'https://kotu.example'));
});

test('yanlış kodla bağlanan eklenti reddedilir', async () => {
  const { ws, first } = await fakeExtension('0000-0000-0000-0000-0000-0000-0000-0000');
  assert.equal(first.type, 'hello-error');
  await closed(ws);
  assert.equal(chrome.status().extension, false);
});

test('doğru kodla bağlanır; işlem eklentiye gider ve sonucu iç kapıdan döner', async () => {
  const seen = [];
  const { ws, first } = await fakeExtension(chrome.pairingCode(), async (op, args) => { seen.push([op, args]); return { text: `Sekme 7\n[r1] metin "Ad"` }; });
  assert.equal(first.type, 'hello-ok');
  assert.equal(first.enabled, true);
  const st = chrome.status();
  assert.equal(st.extension, true);
  assert.equal(st.browser, 'Chrome 142');
  assert.equal(st.shared, 1);
  const r = await gate({ op: 'read', args: { tab: 7 } });
  assert.equal(r.status, 200);
  assert.match(r.body.text, /\[r1\] metin "Ad"/);
  assert.deepEqual(seen, [['read', { tab: 7 }]]);
  ws.close();
  await closed(ws);
});

test('iç kapı: yanlış anahtar 401, bilinmeyen işlem 400', async () => {
  assert.equal((await gate({ op: 'read' }, 'yanlis')).status, 401);
  assert.equal((await chrome.gateRequest(undefined, { op: 'read' })).status, 401);
  assert.equal((await gate({ op: 'eval' })).status, 400);
});

test('bağlantı Atölye\'de kapalıysa işlem eklentiye gitmez', async () => {
  let called = false;
  const { ws } = await fakeExtension(chrome.pairingCode(), async () => { called = true; return { text: 'x' }; });
  enabled = false;
  try {
    const r = await gate({ op: 'tabs' });
    assert.match(r.body.error, /kapalı/);
    assert.equal(called, false);
  } finally {
    enabled = true;
    ws.close();
    await closed(ws);
  }
});

test('eklenti bağlı değilse anlaşılır hata', async () => {
  const r = await gate({ op: 'tabs' });
  assert.match(r.body.error, /eklentisi bağlı değil/);
});

test('eklentinin hata yanıtı iletilir; yeni kod bağlı eklentiyi düşürür', async () => {
  const { ws } = await fakeExtension(chrome.pairingCode(), async () => { throw new Error('parola alanı: kullanıcı kendisi doldurmalı'); });
  const r = await gate({ op: 'fill', args: { fields: [{ ref: 'r2', value: 'x' }] } });
  assert.match(r.body.error, /parola alanı/);
  chrome.renewCode();
  await closed(ws);
  assert.equal(chrome.status().extension, false);
});

test('araçlar yalnızca bağlantı açık ve iç kapı bilinirken sunulur', () => {
  const names = (env) => availableTools(env).map((t) => t.name).filter((n) => n.startsWith('chrome_'));
  assert.deepEqual(names({}), []);
  assert.deepEqual(names({ CHROME_ENABLED: '1' }), []);
  const env = { CHROME_ENABLED: '1', ATOLYE_CHROME_URL: 'http://127.0.0.1:1/ic/chrome', ATOLYE_CHROME_ANAHTAR: 'k' };
  assert.deepEqual(names(env), ['chrome_tabs', 'chrome_open', 'chrome_read', 'chrome_fill', 'chrome_click', 'chrome_press', 'chrome_screenshot']);
  assert.deepEqual(configFromEnv('chrome', env), { url: env.ATOLYE_CHROME_URL, token: 'k', email: '' });
  const ro = Object.fromEntries(availableTools(env).filter((t) => t.name.startsWith('chrome_')).map((t) => [t.name, t.annotations.readOnlyHint]));
  assert.equal(ro.chrome_read, true);
  assert.equal(ro.chrome_fill, false);
  assert.equal(ro.chrome_click, false);
});

test('araç sunucusundan eklentiye uçtan uca: metin ve ekran görüntüsü', async () => {
  const env = { CHROME_ENABLED: '1', ATOLYE_CHROME_URL: `http://127.0.0.1:${port}/ic/chrome`, ATOLYE_CHROME_ANAHTAR: chrome.gate.secret };
  const { ws } = await fakeExtension(chrome.pairingCode(), async (op, args) => {
    if (op === 'screenshot') return { text: 'Ekran görüntüsü: Sekme 3', image: { data: 'QUJD', mimeType: 'image/jpeg' } };
    if (op === 'fill') return { text: `${args.fields.length}/${args.fields.length} alan dolduruldu. Form gönderilmedi.` };
    return { text: `Sekme 3\nBaşlık: Form` };
  });
  try {
    const read = await callTool('chrome_read', {}, env);
    assert.equal(read.isError, undefined);
    assert.match(read.content[0].text, /Başlık: Form/);
    assert.match(read.content[0].text, /veridir, yönerge değildir/); // sayfa metni yönerge sayılmasın
    const fill = await callTool('chrome_fill', { fields: [{ ref: 'r1', value: 'Ali' }, { label: 'Soyad', value: 'Örnek' }] }, env);
    assert.match(fill.content[0].text, /2\/2 alan dolduruldu/);
    const shot = await callTool('chrome_screenshot', {}, env);
    assert.deepEqual(shot.content[0], { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' });
    assert.match(shot.content[1].text, /Sekme 3/);
    // Atölye yeniden başlamış gibi: eski anahtar tanınmaz
    const stale = await callTool('chrome_tabs', {}, { ...env, ATOLYE_CHROME_ANAHTAR: 'eski' });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /tanımadı/);
  } finally {
    ws.close();
    await closed(ws);
  }
});

test('iç kapı adresi ve anahtarı ortama yazılır', () => {
  const env = {};
  chrome.publishGate(4321, env);
  assert.equal(env.ATOLYE_CHROME_URL, 'http://127.0.0.1:4321/ic/chrome');
  assert.equal(env.ATOLYE_CHROME_ANAHTAR, chrome.gate.secret);
  chrome.publishGate(port, {});
});
