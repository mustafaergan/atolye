// Chrome bağlantısı: kullanıcının kendi Chrome'una (ya da Edge'ine) kurduğu Atölye eklentisi üzerinden yapay zekâ
// sekmeleri görür, sayfayı okur, form doldurur, tıklar ve ekran görüntüsü alır. Playwright'ın açtığı ayrı tarayıcıdan
// farkı: kullanıcının açık oturumları ve o an baktığı sayfa üzerinde çalışılır (ör. "bu formu örnek veriyle doldur").
//
// Akış:  araç sunucusu (chrome-client.js) --POST /ic/chrome--> bu modül --WebSocket /chrome--> eklenti (chrome-eklentisi/)
//
// Güvenlik:
//   - Eklenti yalnızca eşleştirme koduyla bağlanır. Kod Bağlantılar > Chrome bölümünde görünür, kullanıcı onu eklentiye
//     yapıştırır. Kod ~/.atolye/chrome.json içinde durur (eklenti yeniden başlayınca yeniden eşleştirme gerekmesin diye);
//     "Yeni kod üret" eski kodu geçersiz kılar ve bağlı eklentiyi düşürür.
//   - WebSocket yalnızca 127.0.0.1'de, yalnızca tarayıcı eklentisi kökeninden (chrome-extension://) kabul edilir; web
//     sayfaları bu kapıya bağlanamaz.
//   - Araç sunucusu bu sürece yalnızca her çalışmada yeniden üretilen iç anahtarla (gate.secret) ulaşır.
//   - Bağlantı Atölye'de kapalıyken eklenti bağlı olsa da hiçbir işlem iletilmez.
//   - Eklenti tarafında: varsayılan olarak yalnızca kullanıcının paylaştığı (ya da yapay zekânın kendi açtığı) sekmeler
//     kullanılır; parola ve dosya alanlarına yazılmaz; kullanıcı eklentiyi her an duraklatabilir.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OPS = ['tabs', 'open', 'read', 'fill', 'click', 'press', 'screenshot'];
const CALL_TIMEOUT = 60_000;
const HELLO_TIMEOUT = 10_000;
const MAX_MESSAGE = 16 * 1024 * 1024;

/** Araç sunucusunun bu sürece ulaştığı iç kapı: adres sunucu açılırken yazılır, anahtar her çalışmada yeniden üretilir */
export const gate = { origin: '', secret: crypto.randomBytes(24).toString('hex') };

const stateDir = () => (process.env.ATOLYE_STATE_FILE ? path.dirname(process.env.ATOLYE_STATE_FILE) : path.join(os.homedir(), '.atolye'));
const pairFile = () => process.env.ATOLYE_CHROME_FILE || path.join(stateDir(), 'chrome.json');

let link = null; // { ws, browser, version, since, pending: Map }
let seq = 0;
let enabledFn = () => false;
const listeners = new Set();
const changed = () => { for (const fn of listeners) { try { fn(status()); } catch { /* dinleyici hatası */ } } };

/** Bağlantının Atölye'de açık olup olmadığını söyleyen işlev (bkz. server.js; ayar dosyasından okunur) */
export function setEnabledCheck(fn) { enabledFn = fn; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const newCode = () => crypto.randomBytes(16).toString('hex').match(/.{4}/g).join('-');
const validCode = (c) => /^[0-9a-f]{4}(-[0-9a-f]{4}){7}$/.test(String(c || ''));

/** Eşleştirme kodu: yoksa üretilir ve saklanır */
export function pairingCode() {
  try {
    const d = JSON.parse(fs.readFileSync(pairFile(), 'utf8'));
    if (validCode(d?.kod)) return d.kod;
  } catch { /* ilk kez */ }
  return renewCode();
}

/** Yeni kod: eskisi geçersiz olur, bağlı eklenti düşürülür */
export function renewCode() {
  const kod = newCode();
  fs.mkdirSync(path.dirname(pairFile()), { recursive: true });
  fs.writeFileSync(pairFile(), `${JSON.stringify({ kod }, null, 2)}\n`, { mode: 0o600 });
  if (link) drop('Eşleştirme kodu değişti');
  return kod;
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Arayüze giden durum */
export function status() {
  return {
    extension: Boolean(link),
    browser: link?.browser || '',
    version: link?.version || '',
    since: link?.since || null,
    shared: link?.shared ?? null,
    allTabs: link?.allTabs ?? null,
    paused: link?.paused ?? null,
  };
}

function drop(reason) {
  const l = link;
  if (!l) return;
  link = null;
  for (const p of l.pending.values()) p.reject(new Error(`Chrome eklentisiyle bağlantı kesildi (${reason}).`));
  l.pending.clear();
  try { l.ws.close(4001, reason.slice(0, 100)); } catch { /* zaten kapalı */ }
  changed();
}

/** WebSocket yükseltme isteği eklentiden mi? (web sayfaları bu kapıya bağlanamaz) */
export const isExtensionOrigin = (origin) => /^(chrome-extension|extension):\/\/[a-z0-9]{16,64}$/i.test(String(origin || ''));

/** Eklentiden gelen yeni bağlantı. İlk mesaj { type: 'hello', kod, surum, tarayici } olmalıdır. */
export function attach(ws) {
  let me = null;
  const helloTimer = setTimeout(() => { if (!me) { try { ws.close(4002, 'hello yok'); } catch { /* */ } } }, HELLO_TIMEOUT);
  const send = (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  ws.on('message', (raw) => {
    if (raw.length > MAX_MESSAGE) { try { ws.close(1009, 'çok büyük'); } catch { /* */ } return; }
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!me) {
      if (m?.type !== 'hello') return;
      clearTimeout(helloTimer);
      if (!sameText(m.kod, pairingCode())) {
        send({ type: 'hello-error', error: 'Eşleştirme kodu yanlış. Atölye > Bağlantılar > Chrome bölümündeki kodu yapıştırın.' });
        try { ws.close(4003, 'kod yanlış'); } catch { /* */ }
        return;
      }
      if (link) drop('Eklenti yeniden bağlandı');
      me = { ws, browser: String(m.tarayici || '').slice(0, 80), version: String(m.surum || '').slice(0, 20), since: new Date().toISOString(), pending: new Map(), ...prefs(m) };
      link = me;
      send({ type: 'hello-ok', enabled: enabledFn() });
      changed();
      return;
    }
    if (link !== me) return;
    if (m?.type === 'ping') return send({ type: 'pong', enabled: enabledFn() });
    if (m?.type === 'prefs') { Object.assign(me, prefs(m)); changed(); return; }
    if (m?.type === 'result') {
      const p = me.pending.get(m.id);
      if (!p) return;
      me.pending.delete(m.id);
      if (m.ok) p.resolve(m.result ?? {});
      else p.reject(new Error(String(m.error || 'Eklenti işlemi yapamadı')));
    }
  });
  ws.on('close', () => { clearTimeout(helloTimer); if (me && link === me) drop('eklenti kapandı'); });
  ws.on('error', () => { /* close ardından gelir */ });
}

const prefs = (m) => ({
  shared: Number.isInteger(m.paylasilan) ? m.paylasilan : null,
  allTabs: typeof m.tumSekmeler === 'boolean' ? m.tumSekmeler : null,
  paused: typeof m.duraklat === 'boolean' ? m.duraklat : null,
});

/** Eklentiye bir işlem gönderir ve sonucunu bekler */
export function call(op, args = {}, { timeout = CALL_TIMEOUT } = {}) {
  if (!OPS.includes(op)) return Promise.reject(new Error(`Bilinmeyen işlem: ${op}`));
  if (!enabledFn()) return Promise.reject(new Error('Chrome bağlantısı Atölye\'de kapalı (Bağlantılar > Chrome).'));
  if (!link) return Promise.reject(new Error('Chrome eklentisi bağlı değil. Chrome\'da Atölye eklentisinin kurulu ve eşleştirilmiş olduğunu, Chrome\'un açık olduğunu denetleyin (eklenti simgesine tıklayınca durum görünür).'));
  const l = link;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { l.pending.delete(id); reject(new Error('Chrome eklentisi zamanında yanıt vermedi.')); }, timeout);
    l.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    try { l.ws.send(JSON.stringify({ type: 'call', id, op, args })); } catch (err) { l.pending.delete(id); clearTimeout(timer); reject(err); }
  });
}

/** Bağlıysa eklentiyi düşürür (bağlantı kapatıldığında) */
export function disconnect(reason = 'Atölye bağlantıyı kapattı') { drop(reason); }

// ---------- İç kapı: araç sunucusundan gelen istek ----------
const sameSecret = (given) => sameText(given, `Bearer ${gate.secret}`);

/** { status, body: { text, image?: { data, mimeType } } | { error } } döndürür (bkz. server.js /ic/chrome) */
export async function gateRequest(authorization, body) {
  if (!sameSecret(authorization)) return { status: 401, body: { error: 'yetkisiz' } };
  const op = String(body?.op || '');
  if (!OPS.includes(op)) return { status: 400, body: { error: `Bilinmeyen işlem: ${op}` } };
  try {
    const r = await call(op, body?.args && typeof body.args === 'object' ? body.args : {});
    const out = { text: String(r.text ?? '') };
    if (r.image && typeof r.image.data === 'string' && /^image\/(png|jpeg)$/.test(r.image.mimeType)) out.image = { data: r.image.data, mimeType: r.image.mimeType };
    return { status: 200, body: out };
  } catch (err) {
    return { status: 200, body: { error: err.message } };
  }
}

/** Sunucu açılırken: iç kapının adresi ve anahtarı bu sürecin ortamına yazılır; böylece bütün motorların oturumları
 *  (ve onların başlattığı araç sunucusu) kapıyı bulur. Anahtar her çalışmada yenidir, diske yazılmaz. */
export function publishGate(port, env = process.env) {
  gate.origin = `http://127.0.0.1:${port}`;
  env.ATOLYE_CHROME_URL = `${gate.origin}/ic/chrome`;
  env.ATOLYE_CHROME_ANAHTAR = gate.secret;
}
