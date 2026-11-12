// GitHub Copilot için kurumsal proxy ayarı. Şirket ağı internete proxy üzerinden çıkıyorsa Copilot CLI
// HTTPS_PROXY / HTTP_PROXY / NO_PROXY ortam değişkenlerine bakar. Bu ayar YALNIZCA Atölye'nin başlattığı
// Copilot süreçlerine verilir: Claude Code, Atölye'nin kendisi ve bilgisayardaki diğer programlar etkilenmez.
// Atölye'nin .env dosyasında COPILOT_PROXY ve COPILOT_NO_PROXY olarak saklanır. Parola arayüze geri
// gönderilmez, kayıtlara yazılmaz.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['COPILOT_PROXY', 'COPILOT_NO_PROXY'];
const ALWAYS_DIRECT = ['localhost', '127.0.0.1']; // Atölye'nin kendisi asla proxy'den geçmemeli


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
  const p = parseProxy(env.COPILOT_PROXY);
  return {
    configured: Boolean(p),
    address: p ? `${p.host}:${p.port}` : '',
    username: p?.username || '',
    hasPassword: Boolean(p?.password),
    noProxy: env.COPILOT_NO_PROXY || '',
  };
}

/** Copilot sürecine verilecek ortam: proxy ayarlıysa standart değişkenler eklenir (yalnızca o süreç için) */
export function copilotEnv(env = process.env) {
  if (!parseProxy(env.COPILOT_PROXY)) return env;
  const out = { ...env };
  for (const k of ['https_proxy', 'http_proxy', 'no_proxy']) delete out[k];
  out.HTTPS_PROXY = env.COPILOT_PROXY;
  out.HTTP_PROXY = env.COPILOT_PROXY;
  out.NO_PROXY = normalizeNoProxy(env.COPILOT_NO_PROXY);
  return out;
}

export function persistEnvFile(values, file = path.join(ROOT, '.env')) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* dosya yok */ }
  lines = lines.filter((l) => !KEYS.some((k) => new RegExp(`^\\s*#?\\s*${k}\\s*=`).test(l)));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  for (const k of KEYS) if (values[k]) lines.push(`${k}=${values[k]}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

async function apply(values) {
  if (process.env.ATOLYE_PROXY_STORE !== 'none') persistEnvFile(values); // testlerde dosyaya yazılmaz
  for (const k of KEYS) { if (values[k]) process.env[k] = values[k]; else delete process.env[k]; }
}

export async function save({ address, username, password, noProxy }) {
  const p = parseProxy(String(address || '').trim());
  if (!p || !/^[\w.-]+$/.test(p.host) || !(p.port > 0 && p.port < 65536)) throw Object.assign(new Error('bad-address'), { code: 'bad-address' });
  const old = parseProxy(process.env.COPILOT_PROXY);
  const user = String(username ?? '').trim();
  // Parola boş bırakılırsa (ve kullanıcı adı aynıysa) kayıtlı parola korunur
  const pass = String(password || '') || (old && old.username === user ? old.password : '');
  const url = buildProxyUrl({ protocol: p.protocol, host: p.host, port: p.port, username: user, password: pass });
  await apply({ COPILOT_PROXY: url, COPILOT_NO_PROXY: normalizeNoProxy(noProxy) });
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
  const p = parseProxy(env.COPILOT_PROXY);
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
