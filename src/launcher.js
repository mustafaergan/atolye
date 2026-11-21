// Masaüstü uygulaması bağlantısı (yalnızca Windows): kullanıcının bilgisayarındaki bir uygulamayı (EXE) seçer, aynı klasördeki
// ayar dosyasında (INI) yalnızca başlangıç adresini (InitialPage) düzenler ve uygulamayı kendi penceresinde başlatır.
// Uygulamanın içinde yapılanlara (giriş, çağrı, ödeme vb.) karışılmaz. Yapay zekâ bu bağlantıyı yalnızca kullanıcı panelden
// açıkça izin verdiyse kullanabilir (durum, adres değiştirme, açma, kapatma); uygulamanın penceresini göremez.
//
// Hangi uygulama, hangi adresler: kuruluşa özgüdür ve kaynak kodda yer almaz. Bunlar bir "tanım dosyası" ile gelir
// (başlık, EXE adı, izinli adresler); tanım ve seçilen EXE yolu bu bilgisayarda ~/.atolye/uygulama.json içinde tutulur.
//
// Kurallar:
//   - INI yolu sunucuda, seçilen EXE'nin klasöründen türetilir; istemciden yol, komut ya da argüman alınmaz.
//   - INI'nin tamamı arayüze ya da kayıtlara verilmez; yalnızca InitialPage değeri okunur ve yazılır.
//   - Yalnızca o değer değiştirilir: diğer satırlar, yorumlar, satır sonları ve dosyanın kodlaması olduğu gibi kalır.
//     Anahtar yoksa ya da birden fazlaysa yazılmaz; dosya ya da anahtar oluşturulmaz.
//   - Adres sunucuda doğrulanır: yalnızca tanımdaki izinli sunuculara https; http yalnızca tanım izin verdiyse ve
//     yalnızca bu bilgisayarın kendisine (localhost).
//   - Uygulama kabuk (shell) kullanılmadan, doğrulanmış EXE yoluyla ve kendi klasöründe başlatılır.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import * as inspector from './inspector.js';

const KEY = 'InitialPage';
const MAX_INI = 2 * 1024 * 1024;
const stateFile = () => process.env.ATOLYE_LAUNCHER_FILE || path.join(os.homedir(), '.atolye', 'uygulama.json');
const fail = (code, detail = '') => Object.assign(new Error(code), { code, detail });
const win = path.win32;

// ---------- kayıt ----------
function readState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    let definition = null;
    try { definition = j.definition ? parseDefinition(j.definition) : null; } catch { /* bozuk tanım yok sayılır */ }
    return { definition, exe: typeof j.exe === 'string' ? j.exe : '', ai: j.ai === true };
  } catch { return { definition: null, exe: '', ai: false }; }
}
function writeState(st) {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ---------- tanım dosyası ----------
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
/** Tanım dosyasının içeriğini doğrular: { title, exeName, allowedHosts, allowLoopbackHttp, note } */
export function parseDefinition(input) {
  const d = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { throw fail('bad-definition'); } })() : input;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw fail('bad-definition');
  const title = String(d.title || '').trim();
  const exeName = String(d.exeName || '').trim();
  const hosts = Array.isArray(d.allowedHosts) ? d.allowedHosts.map((h) => String(h).trim().toLowerCase()) : [];
  if (!title || title.length > 40 || /[\x00-\x1f]/.test(title)) throw fail('bad-definition', 'title');
  if (!/^[\w .()-]{1,80}\.exe$/i.test(exeName)) throw fail('bad-definition', 'exeName');
  if (hosts.length > 50 || hosts.some((h) => !HOST.test(h))) throw fail('bad-definition', 'allowedHosts');
  const allowLoopbackHttp = d.allowLoopbackHttp === true;
  if (!hosts.length && !allowLoopbackHttp) throw fail('bad-definition', 'allowedHosts');
  const note = String(d.note || '').replace(/[\x00-\x08\x0b-\x1f]/g, ' ').trim().slice(0, 600);
  // inspect: uygulama Chromium tabanlıysa içindeki sayfanın ağ trafiği izlenebilsin diye hata ayıklama kapısıyla başlatılır
  return { title, exeName, allowedHosts: [...new Set(hosts)], allowLoopbackHttp, note, ...(d.inspect === true ? { inspect: true } : {}) };
}

export function setDefinition(input) {
  const definition = parseDefinition(input);
  const st = readState();
  // Tanım başka bir uygulamayı gösteriyorsa eski seçim geçersizdir
  const keep = st.exe && win.basename(st.exe).toLowerCase() === definition.exeName.toLowerCase();
  writeState({ definition, exe: keep ? st.exe : '', ai: st.ai });
  return status();
}
export function clearDefinition() {
  writeState({ definition: null, exe: '', ai: false });
  return status();
}

// ---------- adres doğrulama ----------
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
/** Adres bu tanıma göre kullanılabilir mi? Kullanılamıyorsa neden kodu fırlatılır; kullanılabiliyorsa temiz adres döner. */
export function checkUrl(raw, definition) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 2000 || /[^\x21-\x7e]/.test(text) || /["'<>\\^`{|}]/.test(text)) throw fail('bad-url');
  let u;
  try { u = new URL(text); } catch { throw fail('bad-url'); }
  if (u.username || u.password) throw fail('url-credentials');
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:') {
    if (!(definition.allowLoopbackHttp && LOOPBACK.includes(host))) throw fail('http-not-allowed');
    return text;
  }
  if (u.protocol !== 'https:') throw fail('bad-url');
  const port = u.port || '443';
  const ok = definition.allowedHosts.some((h) => { const [name, p] = h.split(':'); return name === host && (p || '443') === port; });
  if (!ok) throw fail('url-not-allowed');
  return text;
}

// ---------- EXE ve INI ----------
/** Seçilen yol: bu bilgisayardaki (ağ yolu olmayan) mutlak bir yol, tanımdaki adla normal bir dosya */
export function checkExe(raw, definition) {
  const p = win.normalize(String(raw || '').trim());
  if (!/^[a-zA-Z]:\\/.test(p) || p.includes('\0')) throw fail('bad-path');
  if (win.basename(p).toLowerCase() !== definition.exeName.toLowerCase()) throw fail('not-exe');
  let st;
  try { st = fs.lstatSync(p); } catch { throw fail('no-exe'); }
  if (!st.isFile()) throw fail('no-exe');
  return p;
}
/** Ayar dosyasının yolu: EXE ile aynı klasörde, aynı adla (.ini) */
const iniPathOf = (exe) => win.join(win.dirname(exe), `${win.basename(exe).replace(/\.exe$/i, '')}.ini`);

function decodeIni(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { enc: 'utf16le', text: buf.subarray(2).toString('utf16le') };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) throw fail('bad-encoding');
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = bom ? buf.subarray(3) : buf;
  if (body.includes(0)) throw fail('bad-encoding');
  // Tek baytlık çözme: yalnızca ASCII bir değer değiştirildiği için diğer baytlar (UTF-8 ya da Windows kod sayfası) aynen korunur
  return { enc: bom ? 'utf8bom' : 'bytes', text: body.toString('latin1') };
}
function encodeIni(text, enc) {
  if (enc === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const body = Buffer.from(text, 'latin1');
  return enc === 'utf8bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

/** Metindeki InitialPage satırları: [{ start, end (değerin konumu), value, quoted }]; yorum satırları sayılmaz */
export function findKey(text) {
  const out = [];
  const line = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (let m = line.exec(text); m; m = line.exec(text)) {
    const k = /^([ \t]*InitialPage[ \t]*=[ \t]*)(.*)$/i.exec(m[1]);
    if (k) {
      const raw = k[2].replace(/[ \t]+$/, '');
      const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
      out.push({ start: m.index + k[1].length, end: m.index + m[1].length, value: quoted ? raw.slice(1, -1) : raw, quoted });
    }
    if (!m[2]) break; // dosya sonu
  }
  return out;
}

function readIni(exe) {
  const file = iniPathOf(exe);
  let buf;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) throw fail('no-ini');
    if (st.size > MAX_INI) throw fail('ini-too-big');
    buf = fs.readFileSync(file);
  } catch (err) { throw err.code && !err.syscall ? err : fail('no-ini'); }
  const { enc, text } = decodeIni(buf);
  const hits = findKey(text);
  if (!hits.length) throw fail('no-key');
  if (hits.length > 1) throw fail('many-keys');
  return { file, enc, text, hit: hits[0], rev: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}

// ---------- süreç ----------
const realSpawner = (exe, cwd, args = []) => spawn(exe, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
let spawner = realSpawner;
/** Testler için: gerçek uygulamayı başlatmak yerine çağrılacak işlev. (exe, cwd) -> olay yayan süreç benzeri nesne */
export function setSpawner(fn) { spawner = fn || realSpawner; }
/** Bu bilgisayarda boş bir kapı numarası */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
let running = null;   // { pid, startedAt }: yalnızca Atölye'nin bu çalışmasında başlattığı örnek
let seen = null;      // bu adla çalışan süreçlerin kimlikleri (son taramada); taranamadıysa null

// Süreç araçları (testlerde değiştirilebilir): yaşıyor mu, bu adla çalışanlar, kapat
const realTools = {
  alive: (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } },
  // tasklist kabuk kullanılmadan çağrılır; yalnızca süreç kimlikleri okunur
  list: (name) => new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) return resolve(null);
      const pids = [];
      for (const line of String(out).split(/\r?\n/)) { const m = /^"([^"]+)","(\d+)"/.exec(line); if (m && m[1].toLowerCase() === name.toLowerCase()) pids.push(Number(m[2])); }
      resolve(pids);
    });
  }),
  kill: (pid, force) => new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 8000 }, () => resolve());
  }),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
let tools = realTools;
/** Testler için: süreç araçlarının yerine geçecek işlevler ({ alive, list, kill, wait }) */
export function setProcessTools(t) { tools = t ? { ...realTools, ...t } : realTools; }

/** Bu adla çalışan süreçleri tarar (Atölye'nin başlatmadığı, elle açılmış örnekler de görülür) */
export async function scan(platform = process.platform) {
  const st = readState();
  if (!supported(platform) || !st.definition) { seen = null; return null; }
  if (running && !tools.alive(running.pid)) running = null;
  seen = await tools.list(st.definition.exeName);
  return seen;
}
let launching = null; // süren başlatma (eşzamanlı istekler aynı sonucu bekler)
/** Testler için: süreç kaydını sıfırlar */
export function resetProcess() { running = null; launching = null; seen = null; }

const supported = (platform = process.platform) => platform === 'win32';
function context(platform) {
  if (!supported(platform)) throw fail('unsupported');
  const st = readState();
  if (!st.definition) throw fail('no-definition');
  return st;
}

/** Arayüze giden durum. INI'nin içeriği verilmez; yalnızca başlangıç adresi ve dosyanın sürüm özeti (rev). */
export function status(platform = process.platform) {
  const st = readState();
  if (running && !tools.alive(running.pid)) running = null; // çıkış olayı kaçtıysa
  const out = {
    supported: supported(platform),
    definition: st.definition,
    ai: st.ai,             // yapay zekâ bu bağlantıyı kullanabilir mi (kullanıcı panelden açar)
    instances: seen ? seen.length : null, // bu adla çalışan süreç sayısı (son taramada); bilinmiyorsa null
    exe: '', exeError: '',
    target: null,          // { value, rev, allowed } ya da { error }
    // Atölye'nin başlattığı örnek çalışıyorsa "started"; değilse durum bilinmez (elle açılmış bir örnek saptanamaz)
    process: running ? 'started' : 'unknown',
    startedAt: running?.startedAt || null,
    pid: running?.pid || null,
    inspect: { enabled: st.definition?.inspect === true, ...inspector.info() },
  };
  if (!out.supported || !st.definition || !st.exe) return out;
  try { out.exe = checkExe(st.exe, st.definition); } catch (err) { out.exe = st.exe; out.exeError = err.code; return out; }
  try {
    const ini = readIni(out.exe);
    let allowed = true;
    try { checkUrl(ini.hit.value, st.definition); } catch { allowed = false; }
    out.target = { value: ini.hit.value, rev: ini.rev, allowed };
  } catch (err) { out.target = { error: err.code || 'no-ini' }; }
  return out;
}

/** EXE seçimi: doğrular ve kaydeder; uygulamayı başlatmaz, INI'ye dokunmaz */
export function selectExe(raw, platform = process.platform) {
  const st = context(platform);
  writeState({ ...st, exe: checkExe(raw, st.definition) });
  seen = null;
  return status(platform);
}
export function clearExe() {
  const st = readState();
  writeState({ ...st, exe: '' });
  return status();
}

/** Başlangıç adresini yazar ve diskten geri okuyarak doğrular; uygulamayı başlatmaz */
export function save({ url, rev, fresh = false } = {}, platform = process.platform) {
  const st = context(platform);
  if (!st.exe) throw fail('not-selected');
  const exe = checkExe(st.exe, st.definition);
  if (running && !tools.alive(running.pid)) running = null;
  if (running || launching) throw fail('running');
  const value = checkUrl(url, st.definition);
  const ini = readIni(exe);
  // Ekrandaki veri eskiyse (dosya dışarıdan değişmişse) üzerine yazılmaz
  if (!fresh && (!rev || rev !== ini.rev)) throw fail('stale');
  if (ini.hit.value !== value) {
    const next = `${ini.text.slice(0, ini.hit.start)}${ini.hit.quoted ? `"${value}"` : value}${ini.text.slice(ini.hit.end)}`;
    const tmp = `${ini.file}.atolye.tmp`;
    try {
      fs.writeFileSync(tmp, encodeIni(next, ini.enc));
      fs.renameSync(tmp, ini.file);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* geçici dosya kalmış olabilir */ }
      throw fail('write-failed', err.code || '');
    }
  }
  let check;
  try { check = readIni(exe); } catch (err) { throw fail('verify-failed', err.code || ''); }
  if (check.hit.value !== value) throw fail('verify-failed');
  return status(platform);
}

/**
 * Uygulamayı başlatır; ayarı değiştirmez. Diskteki başlangıç adresi yeniden doğrulanır: izinli değilse başlatılmaz.
 * Adres dosyadan okunamıyorsa (ayar bu sürümde uygulamanın kendi arayüzündeyse) yalnızca `unverified: true` ile başlatılır.
 */
export function launch({ unverified = false } = {}, platform = process.platform) {
  if (launching) return launching; // çift tıklama / eşzamanlı istek: ikinci bir başlatma yapılmaz
  const run = async () => {
    const st = context(platform);
    if (!st.exe) throw fail('not-selected');
    const exe = checkExe(st.exe, st.definition);
    if (running && !tools.alive(running.pid)) running = null;
    if (running) throw fail('already-running', String(running.pid));
    let ini = null;
    try { ini = readIni(exe); } catch (err) {
      if (!['no-ini', 'no-key'].includes(err.code) || !unverified) throw err;
    }
    if (ini) checkUrl(ini.hit.value, st.definition);
    // Ağ incelemesi tanımda açıksa uygulama yalnızca bu bilgisayardan erişilen bir hata ayıklama kapısıyla başlatılır.
    // Argüman sunucuda üretilir; istemciden argüman alınmaz.
    const port = st.definition.inspect ? await freePort() : 0;
    const args = port ? [`--remote-debugging-port=${port}`] : [];
    const child = await new Promise((resolve, reject) => {
      let c;
      try { c = spawner(exe, win.dirname(exe), args); } catch (err) { return reject(fail('launch-failed', err.code || err.message)); }
      c.once('error', (err) => reject(fail('launch-failed', err.code || err.message)));
      c.once('spawn', () => resolve(c));
    });
    const mine = { pid: child.pid, startedAt: Date.now() };
    running = mine;
    child.once('exit', () => { if (running === mine) { running = null; inspector.stop(); } });
    child.unref?.();
    if (port) inspector.watch(port);
    // Uygulama hemen kapandıysa (ör. zaten çalışan bir örnek olduğu için) bu ayrıca bildirilir
    await tools.wait(1200);
    await scan(platform);
    if (running !== mine && !(seen && seen.length)) throw fail('exited-early');
    return { ...status(platform), early: running !== mine };
  };
  launching = run().finally(() => { launching = null; });
  return launching;
}

/**
 * Çalışan uygulamayı kapatır: önce penceresine kapanma isteği gönderilir, birkaç saniyede kapanmazsa süreç sonlandırılır.
 * Varsayılan olarak yalnızca Atölye'nin başlattığı örnek; `all` ile bu adla çalışan bütün örnekler (elle açılanlar dahil).
 * Yalnızca kullanıcının isteğiyle (panelden ya da izin verdiyse yapay zekâ aracından) çağrılır.
 */
export async function close({ all = false } = {}, platform = process.platform) {
  context(platform);
  await scan(platform);
  const pids = new Set();
  if (running) pids.add(running.pid);
  if (all) for (const p of seen || []) pids.add(p);
  if (!pids.size) throw fail('not-running');
  for (const pid of pids) await tools.kill(pid, false);
  for (let i = 0; i < 6 && [...pids].some((p) => tools.alive(p)); i += 1) await tools.wait(500);
  for (const pid of pids) if (tools.alive(pid)) await tools.kill(pid, true);
  await tools.wait(300);
  if (running && pids.has(running.pid) && !tools.alive(running.pid)) { running = null; inspector.stop(); }
  await scan(platform);
  if ([...pids].some((p) => tools.alive(p))) throw fail('close-failed');
  return status(platform);
}

// ---------- uygulamanın logları (yalnızca okuma) ----------
// Uygulama klasöründeki log dosyaları listelenir ve sondan okunur; hangi servislere gidildiği ve hatalar buradan görülür.
// Yalnızca .log / .txt dosyaları ve "log" adlı klasörlerin içi okunur: ayar dosyası, program dosyaları ve başka türler okunmaz.
const LOG_FILE = /\.(log|txt)$/i;
const NOT_LOG = /\.(ini|config|exe|dll|pdb|manifest|json|xml|dat|pak|bin|key|pfx|cer)$/i;
const LOG_DIR = /log/i;
const MAX_LOG_BYTES = 400_000;

function appDir(platform) {
  const st = context(platform);
  if (!st.exe) throw fail('not-selected');
  return win.dirname(checkExe(st.exe, st.definition));
}

/** Log dosyaları: [{ file (klasöre göre yol), size, modified }], en yenisi üstte */
export function listLogs(platform = process.platform) {
  const root = appDir(platform);
  const out = [];
  let budget = 3000;
  const walk = (dir, depth, inLogDir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if ((budget -= 1) < 0) return;
      const full = win.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(full, depth + 1, inLogDir || LOG_DIR.test(e.name)); continue; }
      if (!e.isFile() || NOT_LOG.test(e.name) || !(LOG_FILE.test(e.name) || inLogDir)) continue;
      try { const s = fs.statSync(full); out.push({ file: win.relative(root, full), size: s.size, modified: s.mtimeMs }); } catch { /* okunamayan dosya atlanır */ }
    }
  };
  walk(root, 0, false);
  return out.sort((a, b) => b.modified - a.modified).slice(0, 40);
}

/** Bir log dosyasının son satırları; `search` verilirse yalnızca onu içeren satırlar */
export function readLog({ file, lines, search } = {}, platform = process.platform) {
  const root = appDir(platform);
  const known = listLogs(platform);
  const name = String(file || '').trim();
  // Yalnızca listede görünen dosyalar okunur (klasör dışına çıkan ya da log olmayan yol kabul edilmez)
  const hit = name ? known.find((k) => k.file.toLowerCase() === win.normalize(name).toLowerCase()) : known[0];
  if (!hit) throw fail('no-log');
  const full = win.join(root, hit.file);
  const fd = fs.openSync(full, 'r');
  let text;
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, MAX_LOG_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8')).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    if (size > len) text = text.slice(text.indexOf('\n') + 1); // yarım kalan ilk satır atılır
  } finally { fs.closeSync(fd); }
  let rows = text.split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  const q = String(search || '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.toLowerCase().includes(q));
  const max = Math.min(Math.max(Math.floor(Number(lines)) || 200, 1), 1000);
  const shown = rows.slice(-max).map((r) => (r.length > 2000 ? `${r.slice(0, 2000)}…` : r));
  return { file: hit.file, size: hit.size, modified: hit.modified, total: rows.length, lines: shown };
}

// ---------- yapay zekâ kullanımı (kullanıcı açarsa) ----------
/** İç kapı: araç sunucusu bu sürece buradan ulaşır (adres sunucu açılırken yazılır, anahtar her çalışmada yeniden üretilir) */
export const gate = { origin: '', secret: crypto.randomBytes(24).toString('hex') };

export function setAi(enabled) {
  const st = readState();
  writeState({ ...st, ai: Boolean(enabled) });
  return status();
}

const TEXT = {
  'unsupported': 'Bu bağlantı yalnızca Windows\'ta çalışır.',
  'no-definition': 'Tanım dosyası yüklenmemiş; kullanıcı Bağlantılar penceresinden yüklemeli.',
  'not-selected': 'Uygulama dosyası seçilmemiş; kullanıcı Bağlantılar penceresinden seçmeli.',
  'no-exe': 'Uygulama dosyası yerinde değil; kullanıcı yeniden seçmeli.',
  'no-ini': 'Uygulamanın yanında ayar dosyası yok; bu sürümde başlangıç adresi uygulamanın kendi arayüzünden yapılıyor olabilir.',
  'no-key': 'Ayar dosyasında başlangıç adresi yok; bu sürümde ayar uygulamanın kendi arayüzünden yapılıyor olabilir.',
  'many-keys': 'Ayar dosyasında başlangıç adresi birden fazla yerde geçiyor; değiştirilmedi.',
  'bad-encoding': 'Ayar dosyasının kodlaması desteklenmiyor; değiştirilmedi.',
  'bad-url': 'Geçerli bir adres değil (https://… biçiminde, boşluksuz olmalı).',
  'url-credentials': 'Adres kullanıcı adı ya da parola içeremez.',
  'url-not-allowed': 'Bu adres izinli adresler arasında değil.',
  'http-not-allowed': 'http adresi yalnızca tanım izin veriyorsa ve yalnızca localhost için kullanılabilir.',
  'running': 'Uygulama açıkken ayar değiştirilmez; önce uygulama kapatılmalı.',
  'already-running': 'Atölye\'nin başlattığı uygulama zaten açık.',
  'not-running': 'Çalışan bir uygulama bulunamadı.',
  'exited-early': 'Uygulama açıldıktan hemen sonra kapandı.',
  'close-failed': 'Uygulama kapatılamadı.',
  'no-log': 'Log dosyası bulunamadı; desktop_app_list_logs ile dosyalara bakın.',
  'not-watching': 'Ağ trafiği izlenmiyor: izleme, tanım dosyasında "inspect": true varsa ve uygulama Atölye\'den açıldığında başlar. Uygulamayı desktop_app_open ile (gerekirse önce kapatıp) yeniden açın.',
  'not-attached': 'Uygulama inceleme kapısını açmadı ya da henüz açılmadı. Birkaç saniye sonra yeniden deneyin; yine olmuyorsa bu uygulama ağ incelemesini desteklemiyor demektir (loglarına bakın).',
  'no-request': 'Bu numarayla kayıtlı istek yok; desktop_app_network ile listeye bakın.',
};
const describe = (st) => {
  const t = st.target;
  const lines = [
    `Uygulama: ${st.definition?.title || '?'} (${st.definition?.exeName || '?'})${st.exe ? '' : ' — dosya seçilmemiş'}`,
    `Başlangıç adresi (dosyada): ${!t ? '—' : t.error ? TEXT[t.error] || t.error : `${t.value}${t.allowed ? '' : ' (izinli değil)'}`}`,
    `İzinli adresler: ${[...(st.definition?.allowedHosts || []).map((h) => `https://${h}`), ...(st.definition?.allowLoopbackHttp ? ['http://localhost'] : [])].join(', ') || '—'}`,
    `Süreç: ${st.process === 'started' ? `Atölye başlattı, açık (PID ${st.pid})` : 'Atölye başlatmadı'}; bu adla çalışan süreç sayısı: ${st.instances ?? 'bilinmiyor'}`,
    `Ağ incelemesi: ${!st.inspect.enabled ? 'kapalı (tanım dosyasında "inspect": true ile açılır)' : !st.inspect.watching ? 'uygulama Atölye\'den açıldığında başlar' : st.inspect.everAttached ? `açık, ${st.inspect.requests} istek kaydedildi` : 'uygulama inceleme kapısını (henüz) açmadı'}`,
    'Uygulamanın penceresi, giriş durumu ve sayfa dışındaki bağlantıları (ör. çağrı tarafı) buradan görülemez; kullanıcıya sorun.',
    st.definition?.note ? `Kuruluşun notu: ${st.definition.note}` : null,
  ];
  return lines.filter(Boolean).join('\n');
};

/** Yapay zekâ araçlarının işlemleri: düz metin döndürür */
export const aiOps = {
  async status() { await scan(); return describe(status()); },
  async setUrl({ url } = {}) { save({ url, fresh: true }); await scan(); return `Başlangıç adresi kaydedildi ve dosyadan geri okunarak doğrulandı. Uygulama başlatılmadı.\n${describe(status())}`; },
  async open({ unverified } = {}) {
    const st = await launch({ unverified: unverified === true });
    return `${st.early ? 'Uygulama başlatıldı ve süreç hemen sonlandı; bu adla çalışan bir örnek var (uygulama zaten açık olabilir).' : 'Uygulama başlatıldı.'} Giriş ve bağlantı durumu doğrulanmadı.\n${describe(st)}`;
  },
  async close({ all } = {}) { const st = await close({ all: all === true }); return `Uygulama kapatıldı.\n${describe(st)}`; },
  async network({ search, failed, limit } = {}) {
    const r = inspector.list({ search, failed: failed === true, limit });
    if (!r.rows.length) return search || failed ? 'Bu ölçüte uyan istek yok.' : 'Henüz kaydedilmiş istek yok; uygulamada bir işlem yapıldıktan sonra yeniden bakın.';
    const t = (ms) => new Date(ms).toLocaleTimeString('sv-SE');
    return `${r.total} istekten son ${r.rows.length} (ayrıntı için desktop_app_network_detail):\nno | saat | yöntem | durum | süre | tür | adres\n${r.rows.map((e) => `${e.n} | ${t(e.at)} | ${e.method} | ${e.failed ? `HATA ${e.failed}` : e.status ?? 'bekliyor'} | ${e.ms ?? '-'} ms | ${e.type || '-'} | ${e.url.slice(0, 300)}`).join('\n')}`.slice(0, 60_000);
  },
  async networkDetail({ id } = {}) {
    const e = inspector.detail(id);
    return [`${e.method} ${e.url}`, `Durum: ${e.failed ? `HATA ${e.failed}` : e.status ?? 'bekliyor'} | tür: ${e.type || '-'} | içerik: ${e.mime || '-'} | süre: ${e.ms ?? '-'} ms | saat: ${new Date(e.at).toLocaleTimeString('sv-SE')}`,
      e.post ? `Gönderilen gövde:\n${e.post}` : 'Gönderilen gövde: yok',
      e.body ? `Cevap (ilk ${e.body.length} karakter):\n${e.body}` : 'Cevap gövdesi: alınmadı (metin değil, boş ya da sayfa onu artık tutmuyor)'].join('\n\n');
  },
  async page() {
    const list = await inspector.pages();
    if (!list.length) return 'Uygulamada açık sayfa görünmüyor.';
    return list.map((p) => `Sayfa: ${p.title || '(başlıksız)'}\nAdres: ${p.url}\nGörünen metin:\n${p.text || '(boş)'}`).join('\n\n---\n\n').slice(0, 60_000);
  },
  async logs() {
    const list = listLogs();
    if (!list.length) return 'Uygulama klasöründe log dosyası bulunamadı (.log / .txt ya da "log" adlı klasör yok).';
    return `dosya | boyut | son değişiklik\n${list.map((l) => `${l.file} | ${Math.max(1, Math.round(l.size / 1024))} KB | ${new Date(l.modified).toLocaleString('sv-SE')}`).join('\n')}`;
  },
  async readLog(args = {}) {
    const r = readLog(args);
    const head = `${r.file} (${Math.max(1, Math.round(r.size / 1024))} KB, son değişiklik ${new Date(r.modified).toLocaleString('sv-SE')}); ${args.search ? `"${args.search}" geçen ` : ''}${r.total} satırdan son ${r.lines.length}:`;
    return `${head}\n${r.lines.join('\n')}`.slice(0, 120_000);
  },
};

const sameSecret = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(`Bearer ${gate.secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
/** İç kapı isteği: { status, body }. Kullanıcı izin vermediyse hiçbir işlem yapılmaz. */
export async function gateRequest(authorization, body) {
  if (!sameSecret(authorization)) return { status: 401, body: { error: 'yetkisiz' } };
  if (!readState().ai) return { status: 200, body: { error: 'Kullanıcı yapay zekânın bu uygulamayı yönetmesine izin vermemiş (Bağlantılar penceresindeki seçenek kapalı).' } };
  const op = String(body?.op || '');
  if (!Object.hasOwn(aiOps, op)) return { status: 400, body: { error: `Bilinmeyen işlem: ${op}` } };
  try {
    return { status: 200, body: { text: await aiOps[op](body?.args && typeof body.args === 'object' ? body.args : {}) } };
  } catch (err) {
    return { status: 200, body: { error: `${TEXT[err.code] || err.message}${err.detail ? ` (${err.detail})` : ''}` } };
  }
}
