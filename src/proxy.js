// Kurumsal proxy ayarı. Şirket ağı internete proxy üzerinden çıkıyorsa Copilot CLI (ve Claude Code)
// HTTPS_PROXY / HTTP_PROXY / NO_PROXY ortam değişkenlerine bakar. Bu modül o değişkenleri
//   - Windows'ta kullanıcı ortam değişkeni olarak (terminaller de görsün diye; komut satırı araçlarının
//     kendi baktığı yer burasıdır),
//   - diğer sistemlerde Atölye'nin .env dosyasına
// yazar ve çalışan Atölye'ye hemen uygular. Parola arayüze geri gönderilmez, kayıtlara yazılmaz.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
const ALWAYS_DIRECT = ['localhost', '127.0.0.1']; // Atölye'nin kendisi asla proxy'den geçmemeli

const envGet = (env, k) => env[k] || env[k.toLowerCase()] || '';

/** "kullanıcı:parola@sunucu:port" adresini parçalar (kullanıcı adındaki @ gibi karakterler %40 biçimindedir) */
export function parseProxy(value) {
  if (!value) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`);
    if (!u.hostname) return null;
    return {
      protocol: u.protocol === 'https:' ? 'https' : 'http',
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      username: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
    };
  } catch {
    return null;
  }
}

export function buildProxyUrl({ protocol = 'http', host, port, username, password }) {
  const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  return `${protocol}://${auth}${host}:${port}`;
}

/** NO_PROXY listesini düzenler; localhost ve 127.0.0.1 her zaman eklenir */
export function normalizeNoProxy(value) {
  const items = String(value || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...ALWAYS_DIRECT, ...items])].join(',');
}

/** Arayüze giden durum: parola asla geri gönderilmez */
export function status(env = process.env) {
  const p = parseProxy(envGet(env, 'HTTPS_PROXY') || envGet(env, 'HTTP_PROXY'));
  return {
    configured: Boolean(p),
    address: p ? `${p.host}:${p.port}` : '',
    username: p?.username || '',
    hasPassword: Boolean(p?.password),
    noProxy: envGet(env, 'NO_PROXY'),
    store: process.platform === 'win32' ? 'windows-user-env' : 'env-file',
  };
}

// Değerler alt sürece ortam değişkeniyle verilir (komut satırında parola görünmesin)
export function persistWindows(values, keys = KEYS) {
  const script = keys.map((k) => `[Environment]::SetEnvironmentVariable('${k}', $(if ($env:ATOLYE_SET_${k}) { $env:ATOLYE_SET_${k} } else { $null }), 'User')`).join('; ');
  const env = { ...process.env };
  for (const k of keys) { if (values[k]) env[`ATOLYE_SET_${k}`] = values[k]; else delete env[`ATOLYE_SET_${k}`]; }
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { env, windowsHide: true, timeout: 30_000 },
      (err) => (err ? reject(new Error('Windows ortam değişkenleri yazılamadı')) : resolve()));
  });
}

function persistEnvFile(values, file = path.join(ROOT, '.env')) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* dosya yok */ }
  lines = lines.filter((l) => !KEYS.some((k) => new RegExp(`^\\s*#?\\s*${k}\\s*=`).test(l)));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  for (const k of KEYS) if (values[k]) lines.push(`${k}=${values[k]}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

async function apply(values) {
  if (process.env.ATOLYE_PROXY_STORE === 'none') { /* testlerde kalıcı yazma yapılmaz */ }
  else if (process.platform === 'win32') await persistWindows(values);
  else persistEnvFile(values);
  for (const k of KEYS) {
    delete process.env[k.toLowerCase()];
    if (values[k]) process.env[k] = values[k]; else delete process.env[k];
  }
}

export async function save({ address, username, password, noProxy }) {
  const p = parseProxy(String(address || '').trim());
  if (!p || !/^[\w.-]+$/.test(p.host) || !(p.port > 0 && p.port < 65536)) throw Object.assign(new Error('bad-address'), { code: 'bad-address' });
  const old = parseProxy(envGet(process.env, 'HTTPS_PROXY') || envGet(process.env, 'HTTP_PROXY'));
  const user = String(username ?? '').trim();
  // Parola boş bırakılırsa (ve kullanıcı adı aynıysa) kayıtlı parola korunur
  const pass = String(password || '') || (old && old.username === user ? old.password : '');
  const url = buildProxyUrl({ protocol: p.protocol, host: p.host, port: p.port, username: user, password: pass });
  await apply({ HTTPS_PROXY: url, HTTP_PROXY: url, NO_PROXY: normalizeNoProxy(noProxy) });
  return status();
}

export async function remove() {
  await apply({});
  return status();
}

/**
 * Proxy üzerinden GitHub'a tünel açmayı dener (HTTP CONNECT). Parolayı ya da adresi bir yere yazmaz.
 * { ok: true } ya da { ok: false, code, status }
 */
export function test({ target = 'api.github.com:443', timeoutMs = 15_000, env = process.env } = {}) {
  const p = parseProxy(envGet(env, 'HTTPS_PROXY') || envGet(env, 'HTTP_PROXY'));
  if (!p) return Promise.resolve({ ok: false, code: 'not-configured' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; socket.destroy(); resolve(r); } };
    const socket = net.connect({ host: p.host, port: p.port });
    socket.setTimeout(timeoutMs, () => finish({ ok: false, code: 'timeout' }));
    socket.on('error', (err) => finish({ ok: false, code: 'unreachable', detail: err.code || '' }));
    socket.on('connect', () => {
      const auth = p.username ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
    });
    let buf = '';
    socket.on('data', (d) => {
      buf += d.toString('latin1');
      const m = buf.match(/^HTTP\/\d\.\d (\d{3})/);
      if (!m) return;
      const code = Number(m[1]);
      if (code === 200) finish({ ok: true });
      else finish({ ok: false, code: code === 407 ? 'auth' : 'refused', status: code });
    });
    socket.on('end', () => finish({ ok: false, code: 'refused' }));
  });
}
