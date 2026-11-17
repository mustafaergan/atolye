// Ayarlar penceresinin sunucu tarafı: uygulama seçenekleri (masaüstü uygulaması, kısayol, otomatik başlatma),
// Claude ve Copilot ayarları, yerel LLM, skill klasörleri ve eski oturumların seçimi.
// Kalıcı değerler kurulum klasöründeki .env dosyasına yazılır ve çalışan sürece de hemen uygulanır.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const stateDir = () => (process.env.ATOLYE_STATE_FILE ? path.dirname(process.env.ATOLYE_STATE_FILE) : path.join(os.homedir(), '.atolye'));

// ---------- .env ----------
export const envFile = () => process.env.ATOLYE_ENV_FILE || path.join(ROOT, '.env');

/** .env dosyasındaki anahtarları günceller (boş değer anahtarı kaldırır) ve bu sürece de uygular */
export function setEnv(values, file = envFile(), env = process.env) {
  const keys = Object.keys(values);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* dosya yok */ }
  lines = lines.filter((l) => !keys.some((k) => new RegExp(`^\\s*${k}\\s*=`).test(l)));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  for (const k of keys) {
    const v = String(values[k] ?? '').trim();
    if (v) { lines.push(`${k}=${v}`); env[k] = v; } else delete env[k];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

const httpUrl = (value) => {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

// ---------- Uygulama seçenekleri (Windows kurulumu: atolye.ps1) ----------
const PS1 = () => path.join(ROOT, 'atolye.ps1');
const APP_COMMANDS = {
  desktopApp: ['masaustu-ac', 'masaustu-kapat'],
  desktopShortcut: ['kisayol-ac', 'kisayol-kapat'],
  autostart: ['otomatik-ac', 'otomatik-kapat'],
};

function defaultRunner(command) {
  return new Promise((resolve) => {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1(), command],
      { cwd: ROOT, windowsHide: true, timeout: 180_000, encoding: 'utf8', env: { ...process.env, ATOLYE_SORMA: '1', ATOLYE_UTF8: '1' } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}` }));
  });
}
let runner = defaultRunner;
/** Testler için: atolye.ps1 yerine çağrılacak işlev */
export function setRunner(fn) { runner = fn || defaultRunner; }
const appSupported = () => runner !== defaultRunner || (process.platform === 'win32' && fs.existsSync(PS1()));

/** Masaüstü uygulaması, kısayol ve otomatik başlatmanın şu anki durumu */
export async function appStatus() {
  if (!appSupported()) return { supported: false };
  const r = await runner('ayarlar');
  const line = String(r.out).split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('{'));
  try { return { supported: true, ...JSON.parse(line) }; } catch { return { supported: false, error: String(r.out).trim().slice(0, 300) }; }
}

/** Bir seçeneği açar ya da kapatır; işlemin çıktısını ve yeni durumu döndürür */
export async function appSet(key, on) {
  const pair = APP_COMMANDS[key];
  if (!pair) throw fail('bad-option');
  if (!appSupported()) throw fail('not-supported');
  const r = await runner(on ? pair[0] : pair[1]);
  const output = String(r.out).split(/\r?\n/).map((l) => l.replace(/^\s*[>✓!✗]\s*/, '').trim()).filter(Boolean).join('\n').slice(0, 800);
  return { ok: r.code === 0, output, status: await appStatus() };
}

// ---------- Claude ----------
const inFile = (key, file = envFile()) => {
  try { return new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(fs.readFileSync(file, 'utf8')); } catch { return false; }
};

export function claudeStatus(env = process.env) {
  return {
    baseUrl: env.ANTHROPIC_BASE_URL || '',
    hasToken: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY),
    // Atölye'nin kendi .env dosyasında mı (değilse Claude Code ayarlarından ya da ortam değişkeninden gelir)
    saved: inFile('ANTHROPIC_BASE_URL') || inFile('ANTHROPIC_AUTH_TOKEN'),
  };
}

/** Gateway adresi ve token. Token boş bırakılırsa var olan korunur; adres boşsa doğrudan Anthropic kullanılır. */
export function saveClaude({ baseUrl, token } = {}) {
  const raw = String(baseUrl || '').trim();
  const url = raw ? httpUrl(raw) : '';
  if (raw && !url) throw fail('bad-url');
  const t = String(token || '').trim();
  if (!url && !t && !claudeStatus().hasToken) throw fail('no-token');
  setEnv({ ANTHROPIC_BASE_URL: url, ...(t ? { ANTHROPIC_AUTH_TOKEN: t } : {}) });
  return claudeStatus();
}

/** Atölye'ye yazılmış bağlantı ayarını kaldırır (Claude Code'un kendi ayarlarına dönülür) */
export function removeClaude() {
  setEnv({ ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' });
  return claudeStatus();
}

// ---------- Copilot ----------
export const copilotStatus = (env = process.env) => ({ defaultModel: env.ATOLYE_COPILOT_MODEL || '' });
export function saveCopilot({ model } = {}) {
  setEnv({ ATOLYE_COPILOT_MODEL: String(model || '').trim().slice(0, 80) });
  return copilotStatus();
}

// ---------- Yerel LLM ----------
// Bilgisayarda (ya da yerel ağda) çalışan model sunucuları: Ollama, LM Studio, llama.cpp vb. Birden fazla model
// eklenebilir; her biri motor seçicisinde ayrı bir seçenek olur. Atölye yerel modeli Claude Code motoruyla
// kullanır; bunun için sunucunun Anthropic uyumlu uç noktası (/v1/messages) olmalıdır.
// Liste ~/.atolye/yerel-llm.json dosyasında durur.
export const MAX_LOCAL = 10;
const localFile = () => process.env.ATOLYE_LOCAL_FILE || path.join(stateDir(), 'yerel-llm.json');
function readLocal() {
  try {
    const d = JSON.parse(fs.readFileSync(localFile(), 'utf8'));
    return (Array.isArray(d?.models) ? d.models : []).filter((m) => m && m.id && httpUrl(m.url) && m.model);
  } catch {
    return [];
  }
}
const writeLocal = (models) => { fs.mkdirSync(path.dirname(localFile()), { recursive: true }); fs.writeFileSync(localFile(), `${JSON.stringify({ models }, null, 2)}\n`); };
const localUrl = (value) => httpUrl(value).replace(/\/v1$/, '');

/** Kayıtlı yerel model (id verilmezse ya da bulunamazsa ilki); hiç yoksa null */
export function localConfig(id) {
  const all = readLocal();
  return all.find((m) => m.id === id) || all[0] || null;
}

/** Arayüze giden liste (anahtarlar gönderilmez) */
export function localStatus() {
  const models = readLocal().map((m) => ({ id: m.id, name: m.name || m.model, url: m.url, model: m.model, hasKey: Boolean(m.key) }));
  return { configured: models.length > 0, models };
}

/** Yeni yerel model ekler ya da (id verilmişse) var olanı günceller. Anahtar boş bırakılırsa var olan korunur. */
export function saveLocal({ id, name, url, model, key } = {}) {
  const u = localUrl(url);
  const m = String(model || '').trim().slice(0, 120);
  if (!u) throw fail('bad-url');
  if (!m) throw fail('no-model');
  const all = readLocal();
  const k = String(key || '').trim();
  const label = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || m;
  const at = id ? all.findIndex((x) => x.id === id) : -1;
  if (id && at < 0) throw fail('local-not-found');
  if (at >= 0) all[at] = { ...all[at], name: label, url: u, model: m, ...(k ? { key: k } : {}) };
  else {
    if (all.length >= MAX_LOCAL) throw fail('too-many-local');
    all.push({ id: Math.random().toString(36).slice(2, 10), name: label, url: u, model: m, key: k });
  }
  writeLocal(all);
  return localStatus();
}

export function removeLocal(id) {
  writeLocal(readLocal().filter((m) => m.id !== id));
  return localStatus();
}

/** Yerel oturumda Claude Code'a verilen ortam: bütün istekler yerel sunucuya ve seçilen modele gider */
export function localEnv(cfg, env = process.env) {
  let host = '';
  try { host = new URL(cfg.url).hostname; } catch { /* yoksay */ }
  const noProxy = [...new Set([...(env.NO_PROXY || env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean), 'localhost', '127.0.0.1', host].filter(Boolean))].join(',');
  return {
    ANTHROPIC_BASE_URL: cfg.url,
    ANTHROPIC_AUTH_TOKEN: cfg.key || 'yerel',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: cfg.model,
    ANTHROPIC_SMALL_FAST_MODEL: cfg.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: cfg.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: cfg.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: cfg.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

async function getJson(url, key, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: key ? { authorization: `Bearer ${key}`, 'x-api-key': key } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Sunucudaki modeller (OpenAI uyumlu /v1/models; yoksa Ollama'nın /api/tags listesi) */
export async function localModels({ url, key } = {}) {
  const u = localUrl(url);
  if (!u) throw fail('bad-url');
  try {
    const d = await getJson(`${u}/v1/models`, key, 8000);
    const ids = (Array.isArray(d?.data) ? d.data : []).map((m) => m?.id).filter(Boolean);
    if (ids.length) return ids;
  } catch { /* Ollama listesi denenir */ }
  try {
    const d = await getJson(`${u}/api/tags`, key, 8000);
    return (Array.isArray(d?.models) ? d.models : []).map((m) => m?.name).filter(Boolean);
  } catch (err) {
    throw fail('unreachable', { detail: err.message });
  }
}

/** Yerel sunucuya ulaşılıyor mu ve model Anthropic uyumlu uç noktadan yanıt veriyor mu */
export async function testLocal({ url, model, key } = {}) {
  const u = localUrl(url);
  if (!u) throw fail('bad-url');
  const models = await localModels({ url: u, key });
  const m = String(model || '').trim();
  if (!m) return { ok: true, models, answered: false };
  let res;
  try {
    res = await fetch(`${u}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key || 'yerel', authorization: `Bearer ${key || 'yerel'}` },
      body: JSON.stringify({ model: m, max_tokens: 16, messages: [{ role: 'user', content: 'Merhaba' }] }),
    });
  } catch (err) {
    throw fail('unreachable', { detail: err.message });
  }
  if (res.status === 404 || res.status === 405) {
    // Model adı yanlışsa da 404 dönebilir: gövdede model geçiyorsa ona göre bildir
    const body = await res.text().catch(() => '');
    if (/model/i.test(body)) throw fail('bad-model', { detail: body.slice(0, 200) });
    throw fail('no-messages-api');
  }
  if (!res.ok) throw fail('bad-model', { detail: `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` });
  return { ok: true, models, answered: true };
}

// ---------- Skill klasörleri ----------
// Eklenen skill, Claude Code'un (ve Copilot CLI'nin) kişisel skill klasörüne kopyalanır; yeni açılan oturumlarda
// "/" komut listesinde görünür. Yalnızca Atölye'nin eklediği skill'ler kaldırılabilir.
const skillsDir = () => process.env.ATOLYE_SKILLS_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills');
const skillsFile = () => path.join(stateDir(), 'skiller.json');
const readSkills = () => {
  try { const d = JSON.parse(fs.readFileSync(skillsFile(), 'utf8')); return Array.isArray(d?.skills) ? d.skills : []; } catch { return []; }
};
const writeSkills = (skills) => { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(skillsFile(), `${JSON.stringify({ skills }, null, 2)}\n`); };

function skillInfo(dir) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { return null; }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '';
  const field = (k) => (new RegExp(`^${k}\\s*:\\s*(.+)$`, 'm').exec(front)?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const name = (field('name') || path.basename(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return name ? { name, description: field('description').slice(0, 300) } : null;
}

export function listSkills() {
  return readSkills().map((s) => ({ ...s, description: skillInfo(path.join(skillsDir(), s.name))?.description || '', exists: fs.existsSync(path.join(skillsDir(), s.name, 'SKILL.md')) }));
}

/** Klasördeki skill'i (ya da alt klasörlerindeki skill'leri) ekler; eklenenlerin adlarını döndürür */
export function addSkill(dir) {
  const d = String(dir || '').trim();
  if (!d || !path.isAbsolute(d) || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw fail('no-dir');
  const sources = fs.existsSync(path.join(d, 'SKILL.md')) ? [d]
    : fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, 'SKILL.md'))).map((e) => path.join(d, e.name));
  if (!sources.length) throw fail('no-skill');
  const tracked = readSkills();
  const added = [];
  for (const src of sources.slice(0, 30)) {
    const info = skillInfo(src);
    if (!info) continue;
    const dest = path.join(skillsDir(), info.name);
    const ours = tracked.some((s) => s.name === info.name);
    // Kullanıcının kendi eklediği (Atölye'nin bilmediği) aynı adlı skill'in üzerine yazılmaz
    if (fs.existsSync(dest) && !ours) { if (sources.length === 1) throw fail('exists', { name: info.name }); continue; }
    if (path.resolve(src) !== path.resolve(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
    }
    if (!ours) tracked.push({ name: info.name, source: src, added: new Date().toISOString() });
    added.push(info.name);
  }
  if (!added.length) throw fail('no-skill');
  writeSkills(tracked);
  return added;
}

export function removeSkill(name) {
  const tracked = readSkills();
  const found = tracked.find((s) => s.name === name);
  if (!found) throw fail('not-found');
  fs.rmSync(path.join(skillsDir(), found.name), { recursive: true, force: true });
  writeSkills(tracked.filter((s) => s.name !== name));
  return listSkills();
}

// ---------- Eski oturumlar ----------
/** Temizlik sınırı: "days" gündür kullanılmayanlar ya da "before" tarihinden (YYYY-AA-GG) önce kullanılanlar */
export function cleanupCutoff({ days, before } = {}, now = Date.now()) {
  if (before) {
    const t = Date.parse(`${String(before).slice(0, 10)}T00:00:00`);
    if (!Number.isFinite(t) || t > now) throw fail('bad-date');
    return t;
  }
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 3650) throw fail('bad-days');
  return now - Math.round(n) * 24 * 60 * 60 * 1000;
}

/** Sınırdan eski ve şu an açık olmayan oturumlar */
export function selectOld(sessions, cutoff, openIds = new Set()) {
  return sessions.filter((s) => s.id && Number(s.lastModified) < cutoff && !openIds.has(s.id));
}
