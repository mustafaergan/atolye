// GitHub Copilot CLI motoru. Copilot CLI'ın sunucu modu (`copilot --acp --stdio`,
// Agent Client Protocol) ile konuşur ve onun mesajlarını Atölye arayüzünün Claude
// oturumlarından tanıdığı biçime çevirir: akan metin, düşünce, araç kartları, diff,
// izin kartları, plan (yapılacaklar), bağlam kullanımı. Dışarıya AgentSession ile aynı
// arayüzü sunar; oturum yöneticisi ve arayüz iki motoru aynı şekilde kullanır.
//
// Protokol: satır satır JSON-RPC 2.0 (https://agentclientprotocol.com). Bilinçli olarak
// küçük ve bağımlılıksız yazıldı; testler resmî ACP kütüphanesiyle yazılmış bir sahte
// ajana karşı çalışır (test/fixtures/fake-copilot.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { msg } from './messages.js';
import { copilotEnv } from './proxy.js';
import { npmEnv } from './browser-check.js';

const PROTOCOL_VERSION = 1;
const isWin = process.platform === 'win32';
export const COPILOT_MODEL_LABEL = 'GitHub Copilot';

// Copilot CLI'ın yeri. Atölye bir kısayoldan ya da Windows açılışında başlatıldığında PATH güncel olmayabilir
// (Copilot sonradan kurulduysa "kurulu değil" görünürdü). Bu yüzden yalnızca PATH'e değil, kurulumların dosyayı
// koyduğu bilinen klasörlere de bakılır. VS Code'un "copilot" yönlendiricisi (copilot-shim) gerçek CLI sayılmaz.
const isScript = (p) => /\.(mjs|cjs|js)$/i.test(p);
const isShim = (p) => /copilot-shim/i.test(p);

/** Copilot CLI'ın bulunabileceği yerler, öncelik sırasıyla */
export function copilotCandidates(env = process.env, platform = process.platform, execPath = process.execPath) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const list = [];
  const names = win ? ['copilot.cmd', 'copilot.exe', 'copilot.bat'] : ['copilot'];
  const addDir = (...parts) => { if (parts.every(Boolean)) for (const n of names) list.push(p.join(...parts, n)); };
  if (win) {
    addDir(env.APPDATA, 'npm');                                  // npm install -g (kurulu Node)
    addDir(p.dirname(execPath));                                 // npm install -g (Atölye ile gelen Node)
    addDir(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links');    // winget
    addDir(env.LOCALAPPDATA, 'Programs', 'GitHub Copilot');
    addDir(env.USERPROFILE, '.local', 'bin');
  } else {
    addDir(env.HOME, '.local', 'bin');
    addDir('/usr/local/bin');
    addDir('/opt/homebrew/bin');
  }
  for (const dir of String(env.PATH || env.Path || '').split(win ? ';' : ':')) addDir(dir.trim());
  return [...new Set(list)].filter((f) => !isShim(f));
}

let resolvedCopilot = null; // bulunan dosyanın tam yolu (bulunamadıysa null)
/** Kullanılacak Copilot CLI: COPILOT_CLI_PATH verilmişse o, yoksa bilinen yerlerde bulunan ilk dosya */
function copilotPath() {
  const explicit = process.env.COPILOT_CLI_PATH?.trim();
  if (explicit) return explicit;
  if (!resolvedCopilot || !fs.existsSync(resolvedCopilot)) resolvedCopilot = copilotCandidates().find((f) => fs.existsSync(f)) || null;
  return resolvedCopilot;
}

// COPILOT_EXTRA_ARGS: Copilot'a eklenecek seçenekler (ör. --disable-builtin-mcps: şirket ağı GitHub'ın kendi
// MCP sunucusuna izin vermiyorsa açılıştaki beklemeyi kaldırır). Yalnızca "--seçenek" ve basit değerler kabul edilir.
export const extraArgs = (env = process.env) => String(env.COPILOT_EXTRA_ARGS || '').split(/\s+/).filter((a) => /^[\w=.,:@/-]+$/.test(a));

function spawnCopilot(baseArgs, opts, withExtra = true) {
  const args = [...baseArgs, ...(withExtra ? extraArgs() : [])];
  const exe = copilotPath() || 'copilot';
  if (isScript(exe)) return spawn(process.execPath, [exe, ...args], opts);
  // Windows'ta npm ile kurulan "copilot" bir .cmd dosyasıdır; kabuk üzerinden çalıştırılır
  if (isWin) return spawn(`"${exe}" ${args.join(' ')}`, { ...opts, shell: true });
  return spawn(exe, args, opts);
}

// ---------- Kurulu mu? ----------
let detectCache = null;
/**
 * Copilot CLI kurulu mu? Dosya bilinen yerlerden birinde bulunursa kurulu sayılır; sürüm ayrıca sorulur ama
 * cevap gecikirse (şirket ağında açılış denetimleri uzun sürebilir) bu "kurulu değil" anlamına gelmez.
 */
export function detectCopilot({ force = false } = {}) {
  if (!force && detectCache && Date.now() - detectCache.at < 60_000) return Promise.resolve(detectCache.value);
  if (force) resolvedCopilot = null;
  const exe = copilotPath();
  return new Promise((resolve) => {
    const done = (value) => {
      const changed = JSON.stringify(detectCache?.value) !== JSON.stringify(value);
      detectCache = { at: Date.now(), value };
      if (changed) console.log(`[copilot] algılama: ${value.available ? `bulundu (${exe}${value.version ? `, sürüm ${value.version}` : ', sürüm okunamadı'})` : value.error}`);
      resolve(value);
    };
    if (exe && path.isAbsolute(exe) && !fs.existsSync(exe)) return done({ available: false, error: `Copilot CLI bulunamadı: ${exe}` });
    if (!exe) return done({ available: false, error: 'Copilot CLI bulunamadı (PATH ve bilinen kurulum klasörlerine bakıldı). Kurmak için: npm install -g @github/copilot' });
    const cb = (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      const version = out.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0]?.replace(/[.-]+$/, ''); // cümle sonundaki nokta sürüme dahil değil
      if (!err && version && !/not found|bulunamad/i.test(out)) return done({ available: true, version });
      // Yönlendirici "kurulu değil" diyorsa gerçekten yok; bunun dışında dosya yerindeyse kurulu sayılır
      if (/not found|bulunamad|is not recognized|tanınmıyor/i.test(out)) return done({ available: false, error: out.split('\n')[0].slice(0, 200) });
      if (process.env.COPILOT_CLI_PATH?.trim() && err?.code === 'ENOENT') return done({ available: false, error: `COPILOT_CLI_PATH bulunamadı: ${exe}` });
      done({ available: true, version: null });
    };
    const opts = { timeout: 20_000, windowsHide: true };
    if (isScript(exe)) execFile(process.execPath, [exe, '--version'], opts, cb);
    else if (isWin) execFile(`"${exe}" --version`, { ...opts, shell: true }, cb);
    else execFile(exe, ['--version'], opts, cb);
  });
}

// ---------- JSON-RPC bağlantısı ----------
class AcpConnection {
  constructor(child, { onRequest, onNotification, onExit }) {
    this.child = child;
    this.nextId = 1;
    this.waiting = new Map(); // id -> { resolve, reject }
    this.onRequest = onRequest;
    this.onNotification = onNotification;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.#handle(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (process.env.ATOLYE_DEBUG) process.stderr.write(`[copilot] ${d}`); });
    child.on('exit', (code) => {
      for (const w of this.waiting.values()) w.reject(new Error(`Copilot CLI kapandı (kod ${code})`));
      this.waiting.clear();
      onExit?.(code);
    });
    child.on('error', (err) => onExit?.(err));
  }

  #write(obj) {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  async #handle(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; } // protokol dışı satır
    if (m.id !== undefined && m.method === undefined) {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(Object.assign(new Error(m.error.message || 'ACP hatası'), { code: m.error.code, data: m.error.data }));
      else w.resolve(m.result);
    } else if (m.id !== undefined) {
      try {
        this.#write({ jsonrpc: '2.0', id: m.id, result: await this.onRequest(m.method, m.params) });
      } catch (err) {
        this.#write({ jsonrpc: '2.0', id: m.id, error: { code: err.code ?? -32603, message: String(err.message || err) } });
      }
    } else if (m.method) {
      this.onNotification(m.method, m.params);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params });
  }

  close() {
    try { this.child.stdin.end(); } catch { /* zaten kapalı */ }
    const pid = this.child.pid;
    setTimeout(() => {
      if (this.child.exitCode !== null) return;
      // Windows'ta kabukla başlatıldığı için süreç ağacıyla birlikte kapat
      if (isWin && pid) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else this.child.kill('SIGTERM');
    }, 1500);
  }
}

// ---------- Araç eşleme: ACP araç çağrısı → arayüzün tanıdığı araç kartı ----------
const firstPath = (tc) => tc.locations?.[0]?.path;
const diffOf = (tc) => (tc.content || []).find((c) => c.type === 'diff');

export function toolForUi(tc) {
  const raw = tc.rawInput && typeof tc.rawInput === 'object' ? tc.rawInput : {};
  switch (tc.kind) {
    case 'execute':
      return { name: 'Bash', input: { command: raw.command ?? raw.cmd ?? tc.title, description: raw.description } };
    case 'read':
      return { name: 'Read', input: { file_path: firstPath(tc) ?? raw.path ?? raw.file_path ?? tc.title } };
    case 'edit': {
      const d = diffOf(tc);
      if (d && (d.oldText === undefined || d.oldText === null)) return { name: 'Write', input: { file_path: d.path, content: d.newText } };
      if (d) return { name: 'Edit', input: { file_path: d.path, old_string: d.oldText, new_string: d.newText } };
      return { name: 'Edit', input: { file_path: firstPath(tc) ?? tc.title, old_string: '', new_string: '' } };
    }
    case 'search':
      return { name: 'Grep', input: { pattern: raw.pattern ?? raw.query ?? tc.title, path: raw.path } };
    case 'fetch':
      return { name: 'WebFetch', input: { url: raw.url ?? tc.title } };
    default:
      return { name: tc.title || tc.name || tc.kind || 'Araç', input: raw };
  }
}

/** "Bu oturumda hep izin ver" grubu (Claude oturumlarıyla aynı mantık) */
const allowanceGroup = (kind) => (kind === 'execute' ? 'shell' : ['edit', 'delete', 'move'].includes(kind) ? 'edits' : kind || 'other');

function resultText(tc) {
  const parts = [];
  for (const c of tc.content || []) {
    if (c.type === 'content' && c.content?.type === 'text') parts.push(c.content.text);
    else if (c.type === 'diff') parts.push(c.path);
  }
  if (!parts.length && tc.rawOutput !== undefined) parts.push(typeof tc.rawOutput === 'string' ? tc.rawOutput : JSON.stringify(tc.rawOutput, null, 2));
  return parts.join('\n');
}

/** Copilot'un oturum cevabındaki alanların kısa dökümü (değerler değil, yalnızca yapı) */
export function describeSession(res) {
  if (!res || typeof res !== 'object') return 'alanlar: yok';
  const parts = Object.keys(res).map((k) => {
    const v = res[k];
    if (k === 'configOptions' && Array.isArray(v)) return `configOptions[${v.map((o) => `${o.id}:${o.category || o.type || '?'}`).join(', ')}]`;
    if (k === 'models' && v && typeof v === 'object') return `models{${Object.keys(v).join(', ')}}`;
    if (k === 'modes' && v && typeof v === 'object') return `modes{${Object.keys(v).join(', ')}}`;
    return k;
  });
  return `alanlar: ${parts.join(', ') || 'yok'}`;
}

// ---------- Oturum ----------
export class CopilotSession {
  constructor({ cwd, resume, permissionMode, model, effort, emit, lang = 'tr', skipReplay = false }) {
    this.engine = 'copilot';
    this.cwd = cwd;
    this.resume = resume;
    this.lang = lang;
    // Yerel kopyası olan oturum yüklenirken Copilot'un yeniden gönderdiği eski mesajlar arayüze iletilmez
    this.emit = (ev) => {
      if (this.loading && skipReplay && !['capabilities', 'model', 'session_title', 'error'].includes(ev.type)) return;
      emit(ev);
    };
    this.hadHistory = skipReplay; // yerel kopyada konuşma var mı
    this.booted = false; // Copilot oturumu hazır mı (arayüzde "bağlanılıyor" göstergesi)
    this.permissionMode = permissionMode === 'plan' ? 'default' : permissionMode || 'default';
    this.model = ''; // Copilot'un kendi model kimliği (Claude modelleriyle karışmaz)
    this.wantModel = model || null; // arayüzde Copilot için son seçilen model
    this.models = []; // Copilot'un sunduğu modeller
    this.modelConfigId = null; // model, yapılandırma seçeneği olarak sunuluyorsa kimliği
    this.commands = [];
    this.modelUsage = new Map(); // modelId -> kredi çarpanı
    this.wantEffort = effort || null; // arayüzde Copilot için son seçilen düşünme seviyesi
    this.effort = { id: null, current: '', options: [] }; // Copilot'un sunduğu düşünme seviyeleri
    this.sessionId = resume || null;
    this.pending = new Map(); // izin id -> { resolve, toolCall, options }
    this.allowed = new Set();
    this.closed = false;
    this.busy = false;
    this.queue = []; // hazır olmadan / çalışırken gönderilen istemler
    this.tools = new Map(); // toolCallId -> birleştirilmiş araç çağrısı
    this.cards = new Set(); // arayüzde kartı açılmış araç çağrıları
    this.block = null; // { id, type: 'text' | 'thinking', text }
    this.userBuf = '';
    this.loading = false;
    this.usage = null;
    this.promptCaps = {};
    this.planCount = 0;
    this.ready = null;
  }

  start() {
    this.ready = this.#boot().catch((err) => {
      if (!this.closed) {
        this.emit({ type: 'error', message: friendlyError(err, this.lang), ...(needsLogin(err) ? { login: 'copilot' } : {}) });
        this.emit({ type: 'session_ended' });
      }
      this.closed = true;
    });
  }

  async #boot() {
    const t0 = Date.now();
    const child = spawnCopilot(['--acp', '--stdio'], { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: copilotEnv() });
    this.conn = new AcpConnection(child, {
      onRequest: (method, params) => this.#onRequest(method, params),
      onNotification: (method, params) => {
        if (method === 'session/update') this.#onUpdate(params.update);
        else if (method === 'github.com/copilot/sessionEvent') this.#onSessionEvent(params);
      },
      onExit: () => {
        if (this.closed) return;
        this.#setBusy(false);
        this.#cancelPending();
        this.emit({ type: 'error', message: msg(this.lang, 'Copilot CLI beklenmedik şekilde kapandı') });
        this.emit({ type: 'session_ended' });
        this.closed = true;
      },
    });
    const init = await this.conn.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      // _meta: Copilot'un oturum harcaması (AI kredisi) olaylarına abonelik; tanımayan sürümler yok sayar
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, _meta: { 'github.com/copilot': { events: ['session.usage_checkpoint'] } } },
      clientInfo: { name: 'atolye', version: '1' },
    });
    this.promptCaps = init?.agentCapabilities?.promptCapabilities || {};
    const tInit = Date.now();
    let opened = null;

    const canLoad = Boolean(init?.agentCapabilities?.loadSession);
    let loaded = false;
    if (this.resume && canLoad) {
      // Copilot eski konuşmayı session/update mesajlarıyla yeniden gönderir
      this.loading = true;
      try {
        const res = await this.#withRetry(() => this.conn.request('session/load', { sessionId: this.resume, cwd: this.cwd, mcpServers: [] }));
        opened = res;
        this.#readModels(res);
        loaded = true;
      } catch (err) {
        // Hiç mesaj yazılmamış (ya da Copilot'un sildiği) oturum yüklenemez: hata göstermek yerine yenisi açılır
        if (err?.code !== -32002 && !/not found|no such session|unknown session|does not exist/i.test(String(err?.message || err))) throw err;
        console.warn(`[copilot] oturum bulunamadı, yenisi açılıyor (${String(err.message).slice(0, 80)})`);
      } finally {
        this.#flushUser();
        this.#closeBlock();
        this.loading = false;
      }
    }
    if (!loaded) {
      if (this.resume && !canLoad) this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'local_command_output', content: msg(this.lang, 'Bu Copilot sürümü eski oturumu yüklemeyi desteklemiyor; yeni bir oturum açıldı.') } });
      else if (this.resume && this.hadHistory) this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'local_command_output', content: msg(this.lang, 'Copilot bu oturumu artık bulamıyor; önceki konuşma ekranda duruyor ama yeni mesajlarınız yeni bir Copilot oturumuyla devam edecek.') } });
      const res = await this.#withRetry(() => this.conn.request('session/new', { cwd: this.cwd, mcpServers: [] }));
      this.sessionId = res.sessionId;
      opened = res;
      this.#readModels(res);
    }
    this.booted = true;
    // Teşhis satırı (atolye.log): açılış süreleri ve Copilot'un bildirdiği alanlar. Gizli bilgi içermez.
    console.log(`[copilot] ${init?.agentInfo?.version || '?'} başlatma ${((tInit - t0) / 1000).toFixed(1)} sn, oturum ${((Date.now() - tInit) / 1000).toFixed(1)} sn; ${describeSession(opened)}; model sayısı ${this.models.length}`);
    // Arayüzde Copilot için daha önce seçilen model bu oturuma da uygulanır
    if (this.wantModel && this.wantModel !== this.model && this.models.some((m) => m.value === this.wantModel)) {
      await this.setModel(this.wantModel).catch(() => {});
    }
    if (this.wantEffort && this.wantEffort !== this.effort.current) await this.setEffort(this.wantEffort).catch(() => {});
    this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'init', session_id: this.sessionId, permissionMode: this.permissionMode, model: this.#modelName() } });
    this.#drain();
  }

  // Copilot'a özgü olaylar. usage_checkpoint: oturumun birikimli harcaması (1 AI kredisi = 10^9 nano AIU).
  // Kalan plan kotası Copilot tarafından bildirilmez.
  #onSessionEvent(p) {
    if (p?.type !== 'session.usage_checkpoint') return;
    const nano = Number(p.data?.totalNanoAiu ?? p.data?.accountingSnapshot?.totalNanoAiu);
    if (!Number.isFinite(nano)) return;
    this.credits = { amount: nano / 1e9, unit: 'AIC' };
    this.emit({ type: 'credits', credits: this.credits });
  }

  // Copilot açılışta GitHub'dan model listesini çeker; ağ yavaşsa zaman aşımına düşebilir. Bir kez daha denenir.
  async #withRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (this.closed || !/timed out|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(err?.message || err))) throw err;
      console.warn(`[copilot] ${String(err.message).slice(0, 120)} — yeniden deneniyor`);
      return fn();
    }
  }

  // ----- Copilot'tan gelen akış -----
  #onUpdate(u) {
    if (!u || this.closed) return;
    const kind = u.sessionUpdate;
    if (kind !== 'user_message_chunk') this.#flushUser();
    if (!this.firstChunk && this.promptStart && !this.loading) this.firstChunk = Date.now();
    switch (kind) {
      case 'user_message_chunk':
        if (this.loading && u.content?.type === 'text') this.userBuf += u.content.text;
        break;
      case 'agent_message_chunk':
        if (u.content?.type === 'text') this.#appendText('text', u.content.text);
        break;
      case 'agent_thought_chunk':
        if (u.content?.type === 'text') this.#appendText('thinking', u.content.text);
        break;
      case 'tool_call':
      case 'tool_call_update': {
        this.#closeBlock();
        const tc = { ...(this.tools.get(u.toolCallId) || {}), ...strip(u) };
        this.tools.set(u.toolCallId, tc);
        this.#showTool(tc);
        if (tc.status === 'completed' || tc.status === 'failed') this.#finishTool(tc);
        break;
      }
      case 'plan':
        this.#closeBlock();
        this.#emitPlan(u.entries || []);
        break;
      case 'available_commands_update':
        this.commands = (u.availableCommands || []).map((c) => ({ name: c.name, description: c.description, hint: c.input?.hint }));
        this.#sendCapabilities();
        break;
      case 'config_option_update':
        this.#readModels({ configOptions: u.configOptions });
        break;
      case 'usage_update':
        this.usage = { used: u.used, size: u.size };
        // Copilot harcamayı (kredi) bildiriyorsa oturum toplamı olarak tutulur
        if (u.cost && typeof u.cost.amount === 'number') this.credits = { amount: u.cost.amount, unit: String(u.cost.currency || '') };
        if (!this.usageLogged) {
          this.usageLogged = true; // teşhis: Copilot kullanım bilgisinde hangi alanları gönderiyor
          console.log(`[copilot] kullanım alanları: ${Object.keys(u).filter((k) => k !== 'sessionUpdate').join(', ')}${u.cost ? ` (cost: ${Object.keys(u.cost).join(', ')})` : ''}`);
        }
        break;
      case 'session_info_update':
        if (u.title) this.emit({ type: 'session_title', title: u.title });
        break;
      case 'notice':
        this.#closeBlock();
        this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'local_command_output', content: u.message || u.text || '' } });
        break;
      default:
        break; // mod, yapılandırma, özetleme bildirimleri: arayüzde karşılığı yok
    }
  }

  // Copilot modellerini iki biçimde bildirebilir: "models" (availableModels/currentModelId) ya da
  // "configOptions" içinde model kategorisindeki seçenek. İkisi de okunur.
  #readModels(res) {
    // Düşünme seviyesi (Copilot'ta "thought_level" kategorisindeki yapılandırma seçeneği); modele göre değişebilir
    const eff = (res?.configOptions || []).find((o) => (o.category === 'thought_level' || /reasoning|effort|thought/i.test(o.id || '')) && Array.isArray(o.options));
    if (res?.configOptions) {
      this.effort = eff
        ? { id: eff.id, current: eff.currentValue || '', options: eff.options.flatMap((o) => (Array.isArray(o.options) ? o.options : [o])).filter((o) => o.value).map((o) => ({ value: o.value, name: o.name || o.value, description: o.description || '' })) }
        : { id: null, current: '', options: [] };
    }
    // Her modelin kredi çarpanı (ör. "1x", "15x") model listesindeki _meta'dan okunur ve adın yanında gösterilir
    for (const m of res?.models?.availableModels || []) {
      const usage = m?._meta?.copilotUsage;
      if (m?.modelId && typeof usage === 'string' && usage) this.modelUsage.set(m.modelId, usage);
    }
    const withUsage = (id, name) => (this.modelUsage.has(id) && !String(name).includes(this.modelUsage.get(id)) ? `${name} · ${this.modelUsage.get(id)}` : name);
    const opt = (res?.configOptions || []).find((o) => (o.category === 'model' || /model/i.test(o.id || '')) && Array.isArray(o.options));
    if (opt) {
      const flat = opt.options.flatMap((o) => (Array.isArray(o.options) ? o.options : [o]));
      this.modelConfigId = opt.id;
      this.models = flat.filter((o) => o.value).map((o) => ({ value: o.value, name: withUsage(o.value, o.name || o.value), description: o.description || '' }));
      this.model = opt.currentValue || this.model;
    } else if (Array.isArray(res?.models?.availableModels)) {
      this.modelConfigId = null;
      this.models = res.models.availableModels.filter((m) => m.modelId).map((m) => ({ value: m.modelId, name: withUsage(m.modelId, m.name || m.modelId), description: m.description || '' }));
      this.model = res.models.currentModelId || this.model;
    } else {
      if (res?.configOptions) this.#sendCapabilities();
      return;
    }
    this.#sendCapabilities();
    this.emit({ type: 'model', model: this.model });
  }

  #modelName() {
    return this.models.find((m) => m.value === this.model)?.name || this.model || COPILOT_MODEL_LABEL;
  }

  #sendCapabilities() {
    this.emit({ type: 'capabilities', models: this.models, commands: this.commands, effort: { current: this.effort.current, hasDefault: false, options: this.effort.options } });
  }

  #appendText(type, text) {
    if (this.block && this.block.type !== type) this.#closeBlock();
    if (!this.block) {
      this.block = { id: `cp-${randomUUID()}`, type, text: '' };
      this.#stream({ type: 'message_start', message: { id: this.block.id } });
      this.#stream({ type: 'content_block_start', index: 0, content_block: { type } });
    }
    this.block.text += text;
    this.#stream({ type: 'content_block_delta', index: 0, delta: type === 'text' ? { type: 'text_delta', text } : { type: 'thinking_delta', thinking: text } });
  }

  #closeBlock() {
    const b = this.block;
    if (!b) return;
    this.block = null;
    this.#stream({ type: 'content_block_stop', index: 0 });
    const content = b.type === 'text' ? [{ type: 'text', text: b.text }] : [{ type: 'thinking', thinking: b.text }];
    this.emit({ type: 'sdk', msg: { type: 'assistant', parent_tool_use_id: null, message: { id: b.id, content } } });
  }

  #stream(event) {
    this.emit({ type: 'sdk', msg: { type: 'stream_event', parent_tool_use_id: null, event } });
  }

  #flushUser() {
    if (!this.userBuf) return;
    this.emit({ type: 'user_prompt', text: this.userBuf, images: [] });
    this.userBuf = '';
  }

  // Düzenleme kartı diff gelince (ya da izin/sonuç anında) açılır; diğerleri hemen
  #showTool(tc, force = false) {
    if (this.cards.has(tc.toolCallId) || tc.kind === 'think') return;
    if (tc.kind === 'edit' && !diffOf(tc) && !force && tc.status !== 'completed' && tc.status !== 'failed') return;
    this.cards.add(tc.toolCallId);
    const { name, input } = toolForUi(tc);
    this.emit({ type: 'sdk', msg: { type: 'assistant', parent_tool_use_id: null, message: { id: `cp-tool-${tc.toolCallId}`, content: [{ type: 'tool_use', id: tc.toolCallId, name, input }] } } });
  }

  #finishTool(tc) {
    if (!this.cards.has(tc.toolCallId) || tc.done) return;
    tc.done = true;
    this.emit({ type: 'sdk', msg: { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tc.toolCallId, content: resultText(tc), is_error: tc.status === 'failed' }] } } });
  }

  #emitPlan(entries) {
    const id = `cp-plan-${++this.planCount}`;
    const todos = entries.map((e) => ({ content: e.content, status: e.status, activeForm: e.content }));
    this.emit({ type: 'sdk', msg: { type: 'assistant', parent_tool_use_id: null, message: { id, content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] } } });
    this.emit({ type: 'sdk', msg: { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '' }] } } });
  }

  // ----- Copilot'un istekleri -----
  async #onRequest(method, params) {
    if (method !== 'session/request_permission') throw Object.assign(new Error(`Desteklenmeyen istek: ${method}`), { code: -32601 });
    this.#closeBlock();
    const tc = { ...(this.tools.get(params.toolCall?.toolCallId) || {}), ...strip(params.toolCall || {}) };
    if (tc.toolCallId) this.tools.set(tc.toolCallId, tc);
    this.#showTool(tc, true);
    const options = params.options || [];
    const pick = (...kinds) => options.find((o) => kinds.includes(o.kind))?.optionId;
    const group = allowanceGroup(tc.kind);
    const auto = this.allowed.has(group)
      || this.permissionMode === 'bypassPermissions'
      || (this.permissionMode === 'acceptEdits' && group === 'edits');
    if (auto && pick('allow_once', 'allow_always')) return { outcome: { outcome: 'selected', optionId: pick('allow_once', 'allow_always') } };

    // Copilot aynı işlem için izni yeniden isterse (aynı toolCallId) ikinci bir soru gösterilmez:
    // ekrandaki soruya verilen cevap ikisine de uygulanır.
    const same = tc.toolCallId && [...this.pending.values()].find((p) => p.tc.toolCallId === tc.toolCallId);
    if (same) return new Promise((resolve) => { same.also.push({ resolve, pick }); });

    const id = randomUUID();
    const { name, input } = toolForUi(tc);
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, tc, pick, group, also: [] });
      this.emit({
        type: 'permission', id, toolName: name, input,
        title: tc.title && name === 'Bash' ? undefined : tc.title,
        canAlways: Boolean(pick('allow_once', 'allow_always')), alwaysGroup: group,
      });
    });
  }

  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const allow = decision.behavior !== 'deny';
    const optionId = allow ? p.pick('allow_once', 'allow_always') : p.pick('reject_once', 'reject_always');
    p.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
    for (const o of p.also) {
      const oid = allow ? o.pick('allow_once', 'allow_always') : o.pick('reject_once', 'reject_always');
      o.resolve(oid ? { outcome: { outcome: 'selected', optionId: oid } } : { outcome: { outcome: 'cancelled' } });
    }
    this.emit({ type: 'permission_resolved', id, behavior: decision.behavior, always: Boolean(decision.always) });
    if (allow && decision.always) {
      this.allowed.add(p.group);
      for (const [otherId, other] of this.pending) {
        if (other.group !== p.group) continue;
        this.pending.delete(otherId);
        other.resolve({ outcome: { outcome: 'selected', optionId: other.pick('allow_once', 'allow_always') } });
        for (const o of other.also) o.resolve({ outcome: { outcome: 'selected', optionId: o.pick('allow_once', 'allow_always') } });
        this.emit({ type: 'permission_resolved', id: otherId, behavior: 'allow', always: true });
      }
    }
  }

  #cancelPending() {
    for (const [id, p] of this.pending) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
      for (const o of p.also) o.resolve({ outcome: { outcome: 'cancelled' } });
      this.emit({ type: 'permission_resolved', id, behavior: 'cancelled' });
    }
    this.pending.clear();
  }

  // ----- Arayüzden gelenler -----
  send(text, images = []) {
    if (this.closed) throw new Error(msg(this.lang, 'Oturum kapalı'));
    this.queue.push({ text, images });
    this.#setBusy(true);
    if (this.sessionId && this.conn) this.#drain();
  }

  async #drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.closed) {
        const { text, images } = this.queue.shift();
        const prompt = [
          ...(this.promptCaps.image ? images.map((i) => ({ type: 'image', mimeType: i.mediaType, data: i.data })) : []),
          { type: 'text', text },
        ];
        const started = Date.now();
        let stopReason = 'end_turn';
        let error = null;
        try {
          this.promptStart = Date.now();
          stopReason = (await this.conn.request('session/prompt', { sessionId: this.sessionId, prompt }))?.stopReason || 'end_turn';
          console.log(`[copilot] tur ${((Date.now() - this.promptStart) / 1000).toFixed(1)} sn (ilk yanıt ${this.firstChunk ? ((this.firstChunk - this.promptStart) / 1000).toFixed(1) : '?'} sn)`);
          this.firstChunk = null;
        } catch (err) {
          error = err;
        }
        this.#closeBlock();
        if (this.closed) break;
        const ok = !error && stopReason === 'end_turn';
        this.emit({ type: 'sdk', msg: {
          type: 'result',
          subtype: ok ? 'success' : 'error_during_execution',
          is_error: !ok,
          duration_ms: Date.now() - started,
          num_turns: 1,
          terminal_reason: stopReason === 'cancelled' ? 'interrupted' : undefined,
          result: error ? friendlyError(error, this.lang) : ok ? '' : msg(this.lang, 'Copilot durdu: {reason}', { reason: stopReason }),
          copilot_credits: this.credits || undefined,
        } });
      }
    } finally {
      this.draining = false;
      if (!this.queue.length) this.#setBusy(false);
    }
  }

  async interrupt() {
    this.queue = [];
    this.#cancelPending();
    if (this.sessionId) this.conn?.notify('session/cancel', { sessionId: this.sessionId });
  }

  async setPermissionMode(mode) {
    // Plan modu Copilot'ta /plan komutuyla kullanılır; burada "her işlemde sor" gibi davranır
    this.permissionMode = mode === 'plan' ? 'default' : mode;
    this.emit({ type: 'mode', mode: this.permissionMode });
  }

  async setModel(model) {
    // Boş seçim "Copilot'un varsayılanı" demektir: oturumun modeline dokunulmaz
    if (!model || !this.sessionId || model === this.model || !this.models.some((m) => m.value === model)) return;
    if (this.modelConfigId) {
      const res = await this.conn.request('session/set_config_option', { sessionId: this.sessionId, configId: this.modelConfigId, value: model });
      this.model = model;
      if (res?.configOptions) return this.#readModels(res);
    } else {
      await this.conn.request('session/set_model', { sessionId: this.sessionId, modelId: model });
      this.model = model;
    }
    this.emit({ type: 'model', model });
  }

  /** Düşünme seviyesi (Copilot sunuyorsa) */
  async setEffort(effort) {
    if (!effort || !this.sessionId || !this.effort.id || effort === this.effort.current || !this.effort.options.some((o) => o.value === effort)) return;
    const res = await this.conn.request('session/set_config_option', { sessionId: this.sessionId, configId: this.effort.id, value: effort });
    this.effort.current = effort;
    if (res?.configOptions) this.#readModels(res);
    this.emit({ type: 'effort', effort: this.effort.current });
  }

  async contextUsage() {
    if (!this.usage?.size) throw new Error('Bağlam bilgisi henüz yok');
    const { used, size } = this.usage;
    return {
      model: this.#modelName(),
      totalTokens: used,
      maxTokens: size,
      percentage: (used / size) * 100,
      categories: [
        { name: 'Messages', tokens: used, kind: 'used' },
        { name: 'Free space', tokens: Math.max(0, size - used), kind: 'free' },
      ],
      memoryFiles: [],
      mcpTools: [],
    };
  }

  #setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.emit({ type: 'busy', busy });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.#cancelPending();
    if (this.sessionId) this.conn?.notify('session/cancel', { sessionId: this.sessionId });
    this.conn?.close();
  }
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== 'sessionUpdate' && v !== null && v !== undefined));

/** Hata, GitHub'a (yeniden) giriş yapılarak çözülebilecek türden mi? (giriş yok, süresi dolmuş ya da yanlış hesap) */
export function needsLogin(err) {
  const text = String(err?.message || err);
  if (/ENOENT|is not recognized|tanınmıyor|command not found|bulunamad|not found|timed out|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(text)) return false;
  return /not authorized to use this Copilot|\b403\b|permission_denied|auth|login|401/i.test(text);
}

// ---------- Arayüzden kurulum: "npm install -g @github/copilot" ----------
// İlk kurulumda Copilot atlandıysa terminale dönmek gerekmesin diye. Yalnızca kullanıcı arayüzde onaylayınca çalışır.
// Bağlantılar > Proxy'deki ayar ve işletim sisteminin sertifika deposu kullanılır (bkz. browser-check.js npmEnv).
const INSTALL_CMD = process.env.ATOLYE_COPILOT_INSTALL_CMD || 'npm install -g @github/copilot --no-audit --no-fund --loglevel=error';
let install = { status: 'idle' }; // idle | running | done | failed
const publicInstall = () => ({ status: install.status, error: install.error || null, version: install.version || null });
export function installStatus() { return publicInstall(); }
export function startInstall() {
  if (install.status === 'running') return publicInstall();
  const mine = { status: 'running' };
  install = mine;
  console.log('[copilot] kurulum başladı');
  exec(INSTALL_CMD, { timeout: 10 * 60_000, windowsHide: true, env: npmEnv(), maxBuffer: 4 * 1024 * 1024 }, async (err, stdout, stderr) => {
    const found = await detectCopilot({ force: true });
    if (found.available) { mine.status = 'done'; mine.version = found.version || null; }
    else {
      mine.status = 'failed';
      const lines = `${stderr || ''}\n${stdout || ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      mine.error = (err?.killed ? 'timeout' : lines.find((l) => /E[A-Z]{4,}|error|ERR!/i.test(l)) || lines.pop() || String(err?.message || found.error || '')).slice(0, 300);
    }
    console.log(`[copilot] kurulum: ${mine.status}${mine.error ? ` (${mine.error})` : ''}`);
  });
  return publicInstall();
}

// ---------- Arayüzden giriş: "copilot login --device-code" ----------
// Copilot CLI bir kod üretir; kullanıcı GitHub sayfasında bu kodu girince CLI girişi kendi güvenli deposuna kaydeder.
// Atölye yalnızca kodu ve adresi ekrana taşır; GitHub parolası ya da token Atölye'den geçmez.
const LOGIN_TIMEOUT_MS = 10 * 60_000;
let login = { status: 'idle' }; // idle | starting | waiting | done | failed
let loginChild = null;
const publicLogin = () => ({ status: login.status, url: login.url || null, code: login.code || null, error: login.error || null });

export function loginStatus() { return publicLogin(); }

export function startLogin() {
  if (loginChild) return publicLogin();
  login = { status: 'starting', output: '' };
  let child;
  try {
    child = spawnCopilot(['login', '--device-code'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: copilotEnv() }, false);
  } catch (err) {
    login = { status: 'failed', error: String(err.message || err) };
    return publicLogin();
  }
  loginChild = child;
  const mine = login;
  const timer = setTimeout(() => { mine.error = 'timeout'; killTree(child); }, LOGIN_TIMEOUT_MS);
  const onData = (d) => {
    mine.output = `${mine.output}${d}`.slice(-4000);
    const url = /https?:\/\/[^\s"')]+/.exec(mine.output)?.[0];
    const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(mine.output)?.[1];
    if (url && code && mine.status === 'starting') { mine.url = url; mine.code = code; mine.status = 'waiting'; }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => { mine.error = mine.error || String(err.message || err); });
  child.on('close', (exit) => {
    clearTimeout(timer);
    if (loginChild === child) loginChild = null;
    if (mine.status === 'cancelled') return;
    if (exit === 0 && !mine.error) mine.status = 'done';
    else { mine.status = 'failed'; mine.error = mine.error || mine.output.trim().split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || `exit ${exit}`; }
    console.log(`[copilot] giriş: ${mine.status}${mine.error ? ` (${mine.error})` : ''}`);
    if (mine.status === 'done') detectCache = null;
  });
  return publicLogin();
}

export function cancelLogin() {
  if (loginChild) { login.status = 'cancelled'; killTree(loginChild); loginChild = null; }
  login = { status: 'idle' };
  return publicLogin();
}

function killTree(child) {
  if (isWin && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function friendlyError(err, lang) {
  const text = String(err?.message || err);
  if (/ENOENT|is not recognized|tanınmıyor|command not found|copilot bulunamad|copilot: not found/i.test(text))
    return msg(lang, 'GitHub Copilot CLI bulunamadı. Kurmak için: npm install -g @github/copilot ({error})', { error: text });
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(text))
    return msg(lang, "Copilot, GitHub sunucularına ulaşamadı (zaman aşımı). Şirket ağı ya da proxy engelliyor olabilir: bir terminalde 'copilot' çalıştırıp aynı sorunun orada da olup olmadığına bakın; proxy gerekiyorsa Atölye'nin .env dosyasına HTTPS_PROXY ekleyip Atölye'yi yeniden başlatın. ({error})", { error: text.slice(0, 200) });
  if (/not authorized to use this Copilot|\b403\b|permission_denied/i.test(text))
    return msg(lang, "GitHub hesabınızın Copilot kullanma yetkisi yok (lisans tanımlı değil ya da yanlış hesapla giriş yapılmış). Bir terminalde 'copilot login' ile Copilot lisansı olan hesabınızla giriş yapın. ({error})", { error: text.slice(0, 200) });
  if (/auth|login|401/i.test(text))
    return msg(lang, "Copilot'a giriş yapılmamış. Bir terminalde 'copilot login' çalıştırıp tarayıcıdan giriş yapın, sonra yeni bir Copilot oturumu açın. ({error})", { error: text });
  return text;
}

