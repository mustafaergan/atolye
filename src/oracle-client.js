// Oracle istemci kitaplıkları (Oracle Instant Client). node-oracledb varsayılan olarak istemcisiz ("thin") çalışır; bu kip
// eski parola biçimini (10G; "NJS-116") ve 12.1'den eski veritabanlarını desteklemez. İstemci kitaplıkları varsa sürücü
// onlarla ("thick") çalışır (bkz. database.js). Bu dosya kitaplıkları bulur ve istenirse Oracle'ın kendi sitesinden indirir.
//
// İndirme yalnızca kullanıcı arayüzden istediğinde yapılır: paket Oracle'ın sitesinden, Oracle'ın lisans koşullarıyla gelir;
// Atölye paketi kendisi dağıtmaz. İnen dosyanın SHA-256 özeti doğrulanır, arşiv ~/.atolye/oracle-client altına açılır.
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { parseProxy } from './proxy.js';

export const DOWNLOAD_PAGE = 'https://www.oracle.com/database/technologies/instant-client/downloads.html';
// Oracle Instant Client 19c "Basic" paketi: 11.2 ve üstü veritabanlarına bağlanır, bütün karakter kümelerini içerir
// (Basic Light Türkçe karakter kümelerini içermez). Özet ve boyut Oracle'ın indirme sayfasından alınmıştır.
export const PACKAGES = {
  'win32-x64': {
    version: '19.33',
    url: 'https://download.oracle.com/otn_software/nt/instantclient/1933000/instantclient-basic-windows.x64-19.33.0.0.0dbru.zip',
    sha256: '2f4df61a9d4be3d2227a7cbb540ec27780e6e4f7b2a274ca7a5c1d396377b3f6',
    size: 163_756_019,
  },
};

const libName = (platform = process.platform) => (platform === 'win32' ? 'oci.dll' : platform === 'darwin' ? 'libclntsh.dylib' : 'libclntsh.so');
/** Atölye'nin indirdiği istemcinin durduğu klasör */
export const clientDir = (env = process.env) => env.ATOLYE_ORACLE_CLIENT_DIR || path.join(os.homedir(), '.atolye', 'oracle-client');

/** Atölye'nin indirdiği istemcinin kitaplık klasörü (en yeni sürüm) ya da null */
export function installedClient(env = process.env) {
  const root = clientDir(env);
  const lib = libName();
  let versions;
  try { versions = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.endsWith('.tmp')).map((d) => d.name); } catch { return null; }
  for (const v of versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))) {
    const base = path.join(root, v);
    if (fs.existsSync(path.join(base, lib))) return base;
    // Arşiv genelde tek bir üst klasörle gelir (instantclient_19_33)
    try { for (const d of fs.readdirSync(base, { withFileTypes: true })) if (d.isDirectory() && fs.existsSync(path.join(base, d.name, lib))) return path.join(base, d.name); } catch { /* sıradaki */ }
  }
  return null;
}

/**
 * Oracle istemci kitaplıklarının klasörü ya da null. Sırayla: ORACLE_CLIENT_LIB_DIR (elle gösterilen klasör), Atölye'nin
 * indirdiği istemci, ORACLE_HOME ve PATH (Linux'ta LD_LIBRARY_PATH) içindeki klasörler.
 */
export function findOracleClient(env = process.env, exists = fs.existsSync, platform = process.platform) {
  const win = platform === 'win32';
  const lib = libName(platform);
  const clean = (raw) => String(raw || '').trim().replace(/^"+|"+$/g, '');
  const has = (dir) => Boolean(dir) && exists(path.join(dir, lib));
  const explicit = clean(env.ORACLE_CLIENT_LIB_DIR);
  if (has(explicit)) return explicit;
  const own = installedClient(env);
  if (own) return own;
  const dirs = [env.ORACLE_HOME && path.join(env.ORACLE_HOME, win ? 'bin' : 'lib'), ...String((win ? env.PATH || env.Path : env.LD_LIBRARY_PATH) || '').split(win ? ';' : ':')];
  return dirs.map(clean).find(has) || null;
}

// ---------- zip açma (akışla: büyük dosyalar belleğe alınmaz) ----------
const MAX_ENTRIES = 5000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** Zip'in dizinini okur: [{ name, method, csize, usize, local }] */
export async function zipEntries(fh, size) {
  const tailLen = Math.min(size, 66_000);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('inen dosya bir zip arşivi değil');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || count > MAX_ENTRIES) throw new Error('bu zip biçimi desteklenmiyor');
  const cd = await readAt(fh, cdOffset, cdSize);
  const out = [];
  let p = 0;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip dizini bozuk');
    const nlen = cd.readUInt16LE(p + 28);
    const entry = { method: cd.readUInt16LE(p + 10), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), local: cd.readUInt32LE(p + 42), name: cd.toString('utf8', p + 46, p + 46 + nlen) };
    total += entry.usize;
    if (total > MAX_TOTAL) throw new Error('arşiv açıldığında çok büyük');
    out.push(entry);
    p += 46 + nlen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
  }
  return out;
}

/** Zip dosyasını klasöre açar; klasörün dışına çıkan adlar reddedilir. Açılan dosya sayısını döndürür. */
export async function extractZip(file, dest) {
  const root = path.resolve(dest);
  const fh = await fs.promises.open(file, 'r');
  let files = 0;
  try {
    const { size } = await fh.stat();
    for (const e of await zipEntries(fh, size)) {
      const target = path.resolve(root, e.name);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`arşivde klasör dışına çıkan ad var: ${e.name}`);
      if (e.name.endsWith('/')) { await fs.promises.mkdir(target, { recursive: true }); continue; }
      if (e.method !== 0 && e.method !== 8) throw new Error(`desteklenmeyen sıkıştırma yöntemi (${e.method}): ${e.name}`);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const head = await readAt(fh, e.local, 30);
      if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new Error('zip dosyası bozuk');
      const start = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const out = fs.createWriteStream(target);
      if (!e.csize) { await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve()))); files += 1; continue; }
      const src = fs.createReadStream(file, { start, end: start + e.csize - 1 });
      if (e.method === 0) await pipeline(src, out); else await pipeline(src, zlib.createInflateRaw(), out);
      files += 1;
    }
  } finally { await fh.close(); }
  return files;
}

// ---------- indirme ----------
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

/** Proxy üzerinden hedefe tünel (HTTP CONNECT); açılan soketi verir */
function openTunnel(proxy, target, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const fail = (err) => { socket.destroy(); reject(err); };
    socket.setTimeout(timeoutMs, () => fail(new Error('proxy cevap vermedi (zaman aşımı)')));
    socket.once('error', fail);
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
      if (code !== '200') return fail(new Error(`proxy bağlantıyı reddetti (HTTP ${code || '?'})`));
      socket.setTimeout(0);
      socket.off('error', fail);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

/** HTTPS GET; yönlendirmeleri izler ve cevabı akış olarak verir */
export async function httpsGet(url, env = process.env, redirects = 5) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('yalnızca https adreslerinden indirilir');
  trustSystemCertificates();
  const proxy = parseProxy(env.COPILOT_PROXY) || parseProxy(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
  const socket = proxy ? await openTunnel(proxy, `${u.hostname}:${u.port || 443}`) : null;
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, method: 'GET', agent: false,
      headers: { 'user-agent': 'atolye', accept: '*/*' },
      ...(socket ? { createConnection: () => tls.connect({ socket, servername: u.hostname }) } : {}),
    }, resolve);
    req.setTimeout(60_000, () => req.destroy(new Error('sunucu cevap vermedi (zaman aşımı)')));
    req.on('error', reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
    res.resume();
    if (redirects <= 0) throw new Error('çok fazla yönlendirme');
    return httpsGet(new URL(res.headers.location, url).href, env, redirects - 1);
  }
  return res;
}

let getter = httpsGet;
/** Testler için: indirme yerine sahte cevap veren işlev. (url) -> { statusCode, headers, akış } */
export function setGetter(fn) { getter = fn || httpsGet; }

const idle = () => ({ phase: 'idle', received: 0, total: 0, error: '' });
let job = idle();
let running = null;

/** Arayüze giden durum */
export function status(env = process.env) {
  const pkg = PACKAGES[`${process.platform}-${process.arch}`] || null;
  return {
    supported: Boolean(pkg),
    version: pkg?.version || null,
    size: pkg?.size || 0,
    installed: installedClient(env),
    found: findOracleClient(env),
    page: DOWNLOAD_PAGE,
    ...job,
  };
}

async function run(env, pkg) {
  const root = clientDir(env);
  const final = path.join(root, pkg.version);
  const tmp = `${final}.tmp`;
  const part = path.join(root, 'indirilen.zip.part');
  await fs.promises.mkdir(root, { recursive: true });
  try {
    job = { phase: 'download', received: 0, total: pkg.size || 0, error: '' };
    const res = await getter(env.ORACLE_CLIENT_URL || pkg.url, env);
    if (res.statusCode !== 200) { res.resume?.(); throw new Error(`Oracle'ın sitesi HTTP ${res.statusCode} döndürdü; paket adresi değişmiş olabilir`); }
    const length = Number(res.headers?.['content-length']);
    if (length > 0) job.total = length;
    const hash = crypto.createHash('sha256');
    const meter = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); job.received += chunk.length; done(null, chunk); } });
    await pipeline(res, meter, fs.createWriteStream(part));
    job.phase = 'verify';
    const digest = hash.digest('hex');
    const expected = env.ORACLE_CLIENT_URL ? env.ORACLE_CLIENT_SHA256 : pkg.sha256;
    if (expected && digest !== expected.toLowerCase()) throw new Error('inen dosya doğrulanamadı (özeti beklenenle uyuşmuyor); yeniden deneyin');
    job.phase = 'extract';
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await extractZip(part, tmp);
    await fs.promises.rm(final, { recursive: true, force: true });
    await fs.promises.rename(tmp, final);
    if (!installedClient(env)) throw new Error('arşiv açıldı ama içinde Oracle istemci kitaplığı bulunamadı');
    job = { ...job, phase: 'done' };
  } catch (err) {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    job = { ...job, phase: 'error', error: String(err.cause?.code || err.message || err) };
  } finally {
    await fs.promises.rm(part, { force: true }).catch(() => {});
  }
  return status(env);
}

/** İndirmeyi başlatır (sürüyorsa yenisini başlatmaz). Bitişi beklemek isteyenler `done` vaadini kullanır. */
export function start(env = process.env) {
  const pkg = PACKAGES[`${process.platform}-${process.arch}`];
  if (!pkg) { job = { ...idle(), phase: 'error', error: 'unsupported' }; return { status: status(env), done: Promise.resolve(status(env)) }; }
  if (!running) {
    job = { phase: 'download', received: 0, total: pkg.size || 0, error: '' }; // durum hemen "indiriliyor" görünsün
    running = run(env, pkg).finally(() => { running = null; });
  }
  return { status: status(env), done: running };
}

/** Testler için: durumu sıfırlar */
export function reset() { job = idle(); }
