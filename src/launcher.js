// Masaüstü uygulaması bağlantısı (yalnızca Windows): kullanıcının bilgisayarındaki bir uygulamayı (EXE) seçer, aynı klasördeki
// ayar dosyasında (INI) yalnızca başlangıç adresini (InitialPage) düzenler ve uygulamayı kendi penceresinde başlatır.
// Uygulamanın içinde yapılanlara (giriş, çağrı, ödeme vb.) karışılmaz; sohbetten, komutlardan ya da araçlardan tetiklenemez.
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
import { spawn } from 'node:child_process';

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
    return { definition, exe: typeof j.exe === 'string' ? j.exe : '' };
  } catch { return { definition: null, exe: '' }; }
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
  return { title, exeName, allowedHosts: [...new Set(hosts)], allowLoopbackHttp, note };
}

export function setDefinition(input) {
  const definition = parseDefinition(input);
  const st = readState();
  // Tanım başka bir uygulamayı gösteriyorsa eski seçim geçersizdir
  const keep = st.exe && win.basename(st.exe).toLowerCase() === definition.exeName.toLowerCase();
  writeState({ definition, exe: keep ? st.exe : '' });
  return status();
}
export function clearDefinition() {
  writeState({ definition: null, exe: '' });
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
let spawner = (exe, cwd) => spawn(exe, [], { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
/** Testler için: gerçek uygulamayı başlatmak yerine çağrılacak işlev. (exe, cwd) -> olay yayan süreç benzeri nesne */
export function setSpawner(fn) { spawner = fn || ((exe, cwd) => spawn(exe, [], { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false })); }
let running = null;   // { pid, startedAt }: yalnızca Atölye'nin bu çalışmasında başlattığı örnek
let launching = null; // süren başlatma (eşzamanlı istekler aynı sonucu bekler)
/** Testler için: süreç kaydını sıfırlar */
export function resetProcess() { running = null; launching = null; }

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
  const out = {
    supported: supported(platform),
    definition: st.definition,
    exe: '', exeError: '',
    target: null,          // { value, rev, allowed } ya da { error }
    // Atölye'nin başlattığı örnek çalışıyorsa "started"; değilse durum bilinmez (elle açılmış bir örnek saptanamaz)
    process: running ? 'started' : 'unknown',
    startedAt: running?.startedAt || null,
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
  return status(platform);
}
export function clearExe() {
  const st = readState();
  writeState({ ...st, exe: '' });
  return status();
}

/** Başlangıç adresini yazar ve diskten geri okuyarak doğrular; uygulamayı başlatmaz */
export function save({ url, rev } = {}, platform = process.platform) {
  const st = context(platform);
  if (!st.exe) throw fail('not-selected');
  const exe = checkExe(st.exe, st.definition);
  if (running || launching) throw fail('running');
  const value = checkUrl(url, st.definition);
  const ini = readIni(exe);
  // Ekrandaki veri eskiyse (dosya dışarıdan değişmişse) üzerine yazılmaz
  if (!rev || rev !== ini.rev) throw fail('stale');
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
    if (running) throw fail('already-running');
    let ini = null;
    try { ini = readIni(exe); } catch (err) {
      if (!['no-ini', 'no-key'].includes(err.code) || !unverified) throw err;
    }
    if (ini) checkUrl(ini.hit.value, st.definition);
    const child = await new Promise((resolve, reject) => {
      let c;
      try { c = spawner(exe, win.dirname(exe)); } catch (err) { return reject(fail('launch-failed', err.code || err.message)); }
      c.once('error', (err) => reject(fail('launch-failed', err.code || err.message)));
      c.once('spawn', () => resolve(c));
    });
    running = { pid: child.pid, startedAt: Date.now() };
    child.once('exit', () => { running = null; });
    child.unref?.();
    return status(platform);
  };
  launching = run().finally(() => { launching = null; });
  return launching;
}
