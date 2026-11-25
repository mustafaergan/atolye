// Jira / Confluence / Bitbucket bağlantıları. Bilgiler Atölye'de ayrıca saklanmaz: Claude Code ve
// GitHub Copilot CLI'ın MCP sunucularını tuttuğu kendi ayar dosyalarına "atolye" adlı sunucu olarak
// yazılır; böylece aynı araçlar terminaldeki claude / copilot komutlarında da kullanılabilir.
//   Claude Code : ~/.claude.json            → mcpServers.atolye
//   Copilot CLI : ~/.copilot/mcp-config.json → mcpServers.atolye
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { asLocal, clients, configFromEnv, envKey, SERVICES } from './atlassian.js';
import { availableTools, callTool, TOOLS } from './mcp-server.js';
import { validDbUrl } from './database.js';

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
      // Outlook'ta "bağlı" = kullanıcı etkinleştirmiş; araçları yine de yalnızca yerel LLM oturumlarında sunulur
      // Teams de öyle; erişim anahtarının durumu sunucuda eklenir (bkz. server.js, teams.js)
      // Chrome'da iç kapının adresi ayar dosyasında değil sunucunun ortamındadır; "bağlı" = kullanıcı etkinleştirmiş
      // Veritabanları yalnızca yerel oturumda sunulur ama "bağlı" bilgisi kayıtlı ayara göredir
      connected: s === 'outlook' ? env.OUTLOOK_ENABLED === '1' : s === 'teams' ? env.TEAMS_ENABLED === '1' : s === 'chrome' ? env.CHROME_ENABLED === '1' : s === 'tomcat' ? env.TOMCAT_ENABLED === '1' : Boolean(configFromEnv(s, ['oracle', 'postgres'].includes(s) ? asLocal(env) : env)),
    };
  }
  out.services[BROWSER_SERVER] = browserStatus();
  // Tempo: Jira'nın adresi ve anahtarıyla çalışır; açık olsa bile Jira kurulu değilse bağlı sayılmaz
  // (araçları yine de yalnızca yerel LLM oturumlarında sunulur; "bağlı" = etkinleştirilmiş ve Jira kurulu)
  const jiraOn = Boolean(configFromEnv('jira', env));
  out.services.tempo = { ...out.services.tempo, connected: env.TEMPO_ENABLED === '1' && jiraOn, enabled: env.TEMPO_ENABLED === '1', notes: env.TEMPO_NOTES || '', jira: jiraOn };
  return out;
}

/** Sunucu içi kullanım (depo indirme): kayıtlı bağlantı ayarı ya da null. Arayüze gönderilmez. */
export const config = (service) => configFromEnv(service, readEnv());

const check = (service) => { if (!SERVICES.includes(service)) throw new Error('Bilinmeyen servis'); };

export function save(service, { url, email, token }) {
  check(service);
  if (['outlook', 'teams', 'tomcat', 'tempo'].includes(service)) throw new Error('Bu bağlantı buradan kaydedilmez'); // kendi uçları var
  const env = readEnv();
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  if (['oracle', 'postgres'].includes(service)) {
    // Veritabanı: bağlantı adresi (kullanıcı adı ve parola ayrı alanlarda)
    if (!validDbUrl(service, cleanUrl)) throw Object.assign(new Error('bad-db-url'), { code: 'bad-db-url', service });
  } else {
    let parsed;
    try { parsed = new URL(cleanUrl); } catch { /* aşağıda */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error('bad-url'), { code: 'bad-url' });
  }
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

/** Outlook: adres ya da anahtar yok; araçlar açılır ya da kapatılır */
export function setOutlook(enabled) {
  const env = readEnv();
  if (enabled) env.OUTLOOK_ENABLED = '1';
  else delete env.OUTLOOK_ENABLED;
  writeEnv(env);
  return status();
}

/** Teams: araçlar açılır ya da kapatılır. Erişim anahtarı buraya (ayar dosyalarına) yazılmaz; bellekte tutulur (bkz. teams.js) */
export function setTeams(enabled) {
  const env = readEnv();
  if (enabled) env.TEAMS_ENABLED = '1';
  else delete env.TEAMS_ENABLED;
  writeEnv(env);
  return status();
}

export function remove(service) {
  check(service);
  const env = readEnv();
  for (const f of ['url', 'email', 'token', 'enabled']) delete env[envKey(service, f)];
  writeEnv(env);
  return status();
}

/** Chrome: ayar dosyasına yalnızca "açık" bilgisi yazılır (iç kapı ve eşleştirme kodu orada durmaz; bkz. chrome.js) */
export function setChrome(enabled) {
  const env = readEnv();
  if (enabled) env.CHROME_ENABLED = '1';
  else delete env.CHROME_ENABLED;
  writeEnv(env);
  return status();
}

/** Sunucu içi: Chrome bağlantısı açık mı (ayar dosyasından) */
export const chromeEnabled = () => readEnv().CHROME_ENABLED === '1';

/** Fikirhane: adres ya da anahtar yok (bu bilgisayarda çalışan ayrı uygulama); araçlar açılır ya da kapatılır (bkz. fikirhane.js) */
export function setFikirhane(enabled) {
  const env = readEnv();
  if (enabled) env.FIKIRHANE_ENABLED = '1';
  else delete env.FIKIRHANE_ENABLED;
  writeEnv(env);
  return status();
}

/** Tempo: araçlar açılır ya da kapatılır; kullanıcının kendi kuralları (serbest metin) yapay zekâya geçmişle birlikte verilir */
export function setTempo(enabled, notes) {
  const env = readEnv();
  if (enabled) env.TEMPO_ENABLED = '1';
  else delete env.TEMPO_ENABLED;
  if (notes !== undefined) {
    const text = String(notes || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
    if (text) env.TEMPO_NOTES = text; else delete env.TEMPO_NOTES;
  }
  writeEnv(env);
  return status();
}

/** Uygulama sunucusu (Tomcat): araçlar açılır ya da kapatılır; profiller ayrı dosyada durur (bkz. tomcat.js) */
export function setTomcat(enabled) {
  const env = readEnv();
  if (enabled) env.TOMCAT_ENABLED = '1';
  else delete env.TOMCAT_ENABLED;
  writeEnv(env);
  return status();
}

// Oracle sürücüsünün kipi (istemcili / istemcisiz) süreç başına bir kez, ilk bağlantıdan önce belirlenir ve sonradan
// değişmez. İstemci Atölye çalışırken indirilebildiği için Oracle işlemleri bu süreçte değil, her seferinde yeni bir
// alt süreçte çalıştırılır (bkz. mcp-server.js runOnce); böylece indirilen istemci hemen kullanılır.
const OWN_PROCESS = ['oracle'];
let oneShotImpl = null;
/** Testler için: alt süreç yerine çağrılacak işlev */
export function setOneShot(fn) { oneShotImpl = fn; }
function oneShot(payload, timeoutMs = 90_000, extraEnv = {}) {
  if (oneShotImpl) return oneShotImpl(payload, extraEnv);
  return new Promise((resolve) => {
    const fail = (text) => resolve({ ok: false, isError: true, error: text, content: [{ type: 'text', text }] });
    let child;
    try { child = spawn(process.execPath, [MCP_SCRIPT, '--once'], { env: { ...process.env, ...readEnv(), ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { return fail(err.message); }
    let out = '';
    let errText = '';
    const timer = setTimeout(() => { child.kill(); fail('işlem zamanında bitmedi'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (err) => { clearTimeout(timer); fail(err.message); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { fail(errText.trim().split('\n').pop() || 'işlem tamamlanamadı'); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Kayıtlı bilgilerle giriş dener: { ok, user } ya da { ok: false, error } */
export async function test(service) {
  check(service);
  if (OWN_PROCESS.includes(service)) {
    // Sınamayı kullanıcı yapar (sonuç yapay zekâya gitmez): yalnızca yerel oturumda sunulan bağlantılar da sınanır
    const r = await oneShot({ op: 'whoami', service }, undefined, { ATOLYE_YEREL_OTURUM: '1' });
    if (r.ok) return { ok: true, user: r.user };
    // Oracle istemcisi gerektiren hatalar: arayüz indirme seçeneğini yalnızca bu durumda gösterir
    return { ok: false, error: r.error || 'not-configured', ...(/NJS-116|NJS-138|NJS-112/.test(r.error || '') ? { needsClient: true } : {}) };
  }
  // Sınamayı kullanıcı arayüzden yapar (sonuç yapay zekâya gitmez): Outlook'ta oturum işareti burada verilir
  const cfg = configFromEnv(service, asLocal(readEnv()));
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
export function readTools(service, { local = false } = {}) {
  check(service);
  // Yalnızca yerel oturumda sunulan bağlantıların (veritabanları) verisi yalnızca yerel oturumda getirilebilir
  return availableTools(local ? asLocal(readEnv()) : readEnv()).filter((t) => TOOLS[t.name].service === service && !TOOLS[t.name].write)
    .map((t) => ({ name: t.name, description: t.description, properties: t.inputSchema.properties, required: t.inputSchema.required }));
}

export async function runReadTool(name, args, { local = false } = {}) {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, text: 'Bilinmeyen işlem' };
  if (tool.write) return { ok: false, text: 'Bu işlem değişiklik yapar; buradan çalıştırılamaz' };
  const input = args && typeof args === 'object' ? args : {};
  const extra = local ? { ATOLYE_YEREL_OTURUM: '1' } : {};
  const res = OWN_PROCESS.includes(tool.service) ? await oneShot({ op: 'call', name, args: input }, undefined, extra) : await callTool(name, input, { ...readEnv(), ...extra });
  return { ok: !res.isError, text: res.content?.[0]?.text || '' };
}
