// Jira / Confluence / Bitbucket bağlantıları. Bilgiler Atölye'de ayrıca saklanmaz: Claude Code ve
// GitHub Copilot CLI'ın MCP sunucularını tuttuğu kendi ayar dosyalarına "atolye" adlı sunucu olarak
// yazılır; böylece aynı araçlar terminaldeki claude / copilot komutlarında da kullanılabilir.
//   Claude Code : ~/.claude.json            → mcpServers.atolye
//   Copilot CLI : ~/.copilot/mcp-config.json → mcpServers.atolye
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clients, configFromEnv, envKey, SERVICES } from './atlassian.js';
import { availableTools, callTool, TOOLS } from './mcp-server.js';

export const SERVER_NAME = 'atolye';
const MCP_SCRIPT = fileURLToPath(new URL('./mcp-server.js', import.meta.url));

// ATOLYE_*: testlerde gerçek ayar dosyalarına dokunmamak için
const claudeFile = () => process.env.ATOLYE_CLAUDE_JSON
  || path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');
const copilotFile = () => process.env.ATOLYE_COPILOT_MCP
  || path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'mcp-config.json');

/** Dosya yoksa boş nesne; bozuksa hata (üzerine yazıp kullanıcının ayarlarını silmemek için) */
function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw.replace(/^﻿/, ''));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* aşağıda */ }
  throw new Error(`Ayar dosyası okunamadı, değiştirilmedi: ${file}`);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.atolye.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Kayıtlı ortam değişkenleri (önce Claude Code'un, yoksa Copilot'un dosyasından) */
function readEnv() {
  for (const file of [claudeFile(), copilotFile()]) {
    try {
      const env = readJson(file).mcpServers?.[SERVER_NAME]?.env;
      if (env && typeof env === 'object' && Object.keys(env).length) return { ...env };
    } catch { /* diğer dosyaya bak */ }
  }
  return {};
}

function writeEnv(env) {
  const empty = !Object.keys(env).length;
  const base = { command: process.execPath, args: [MCP_SCRIPT], env };
  for (const [file, entry] of [
    [claudeFile(), { type: 'stdio', ...base }],
    [copilotFile(), { type: 'local', ...base, tools: ['*'] }],
  ]) {
    const data = readJson(file);
    const servers = { ...(data.mcpServers || {}) };
    if (empty) delete servers[SERVER_NAME];
    else servers[SERVER_NAME] = entry;
    if (empty && !fs.existsSync(file)) continue; // silinecek bir şey yokken dosya oluşturma
    writeJson(file, { ...data, mcpServers: servers });
  }
}


// ---------- Tarayıcı bağlantısı (Playwright MCP) ----------
// Yapay zekânın bir tarayıcıyı sürebilmesi (sayfa açma, tıklama, form doldurma, ekran görüntüsü) için Microsoft'un
// resmî Playwright MCP sunucusu, diğer bağlantılar gibi CLI'ların kendi MCP ayar dosyalarına "tarayici" adıyla
// yazılır. Hangi tarayıcının açılacağı buradan seçilir.
export const BROWSER_SERVER = 'tarayici';
export const BROWSERS = ['chrome', 'msedge', 'chromium', 'firefox', 'webkit'];

/**
 * MCP sunucusunu başlatan komut: kurulu paketin kendi dosyası Node ile çalıştırılır (PATH'e ve npx'e bağlı değildir).
 * Playwright MCP varsayılan olarak görünür pencere açar; --headless yalnızca kullanıcı "arka planda" seçtiyse eklenir.
 */
export function browserCommand({ browser, headless, cli }) {
  return { command: process.execPath, args: [cli, '--browser', browser, ...(headless ? ['--headless'] : [])] };
}

function readServer(name) {
  for (const file of [claudeFile(), copilotFile()]) {
    try {
      const entry = readJson(file).mcpServers?.[name];
      if (entry && typeof entry === 'object') return entry;
    } catch { /* diğer dosyaya bak */ }
  }
  return null;
}

function writeServer(name, base) {
  for (const [file, entry] of [
    [claudeFile(), base && { type: 'stdio', ...base }],
    [copilotFile(), base && { type: 'local', ...base, tools: ['*'] }],
  ]) {
    const data = readJson(file);
    const servers = { ...(data.mcpServers || {}) };
    if (entry) servers[name] = entry; else delete servers[name];
    if (!entry && !fs.existsSync(file)) continue;
    writeJson(file, { ...data, mcpServers: servers });
  }
}

/** Kayıtlı ayarda sunucunun başlatıldığı dosya (eski, npx ile başlatan ayarlarda null) */
export function browserCli() {
  const args = readServer(BROWSER_SERVER)?.args || [];
  return args.find((a) => /[\\/]@playwright[\\/]mcp[\\/]/.test(a)) || null;
}

export function browserStatus() {
  const args = readServer(BROWSER_SERVER)?.args || [];
  const i = args.indexOf('--browser');
  const browser = i >= 0 && BROWSERS.includes(args[i + 1]) ? args[i + 1] : null;
  return { connected: Boolean(browser), browser: browser || 'chrome', headless: args.includes('--headless') };
}

export function saveBrowser({ browser, headless, cli }) {
  if (!BROWSERS.includes(browser)) throw Object.assign(new Error('bad-browser'), { code: 'bad-browser' });
  if (!cli) throw Object.assign(new Error('not-installed'), { code: 'not-installed' });
  writeServer(BROWSER_SERVER, browserCommand({ browser, headless: Boolean(headless), cli }));
  return status();
}

export function removeBrowser() {
  writeServer(BROWSER_SERVER, null);
  return status();
}

/** Arayüze giden durum: API anahtarı asla geri gönderilmez */
export function status() {
  const env = readEnv();
  const out = { files: { claude: claudeFile(), copilot: copilotFile() }, services: {} };
  for (const s of SERVICES) {
    out.services[s] = {
      url: env[envKey(s, 'url')] || '',
      email: env[envKey(s, 'email')] || '',
      hasToken: Boolean(env[envKey(s, 'token')]),
      connected: Boolean(configFromEnv(s, env)),
    };
  }
  out.services[BROWSER_SERVER] = browserStatus();
  return out;
}

/** Sunucu içi kullanım (depo indirme): kayıtlı bağlantı ayarı ya da null. Arayüze gönderilmez. */
export const config = (service) => configFromEnv(service, readEnv());

const check = (service) => { if (!SERVICES.includes(service)) throw new Error('Bilinmeyen servis'); };

export function save(service, { url, email, token }) {
  check(service);
  const env = readEnv();
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(cleanUrl); } catch { /* aşağıda */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error('bad-url'), { code: 'bad-url' });
  const newToken = String(token || '').trim() || env[envKey(service, 'token')]; // boş bırakılırsa eski anahtar korunur
  if (!newToken) throw Object.assign(new Error('no-token'), { code: 'no-token' });
  env[envKey(service, 'url')] = cleanUrl;
  env[envKey(service, 'token')] = newToken;
  const mail = String(email || '').trim();
  if (mail) env[envKey(service, 'email')] = mail;
  else delete env[envKey(service, 'email')];
  writeEnv(env);
  return status();
}

export function remove(service) {
  check(service);
  const env = readEnv();
  for (const f of ['url', 'email', 'token']) delete env[envKey(service, f)];
  writeEnv(env);
  return status();
}

/** Kayıtlı bilgilerle giriş dener: { ok, user } ya da { ok: false, error } */
export async function test(service) {
  check(service);
  const cfg = configFromEnv(service, readEnv());
  if (!cfg) return { ok: false, error: 'not-configured' };
  try {
    return { ok: true, user: await clients[service].whoami(cfg) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Arayüzdeki "veri getir": bağlantının yalnızca okuma yapan işlemleri. Veriyi yapay zekâ değil Atölye çeker
 * (kayıtlı bağlantıyla doğrudan REST); sonuç kullanıcının mesajına eklenir. MCP gerektirmez.
 */
export function readTools(service) {
  check(service);
  return availableTools(readEnv()).filter((t) => TOOLS[t.name].service === service && !TOOLS[t.name].write)
    .map((t) => ({ name: t.name, description: t.description, properties: t.inputSchema.properties, required: t.inputSchema.required }));
}

export async function runReadTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, text: 'Bilinmeyen işlem' };
  if (tool.write) return { ok: false, text: 'Bu işlem değişiklik yapar; buradan çalıştırılamaz' };
  const res = await callTool(name, args && typeof args === 'object' ? args : {}, readEnv());
  return { ok: !res.isError, text: res.content?.[0]?.text || '' };
}
