// GitHub Copilot CLI motoru. Copilot CLI'ın sunucu modu (`copilot --acp --stdio`,
// Agent Client Protocol) ile konuşur ve onun mesajlarını Atölye arayüzünün Claude
// oturumlarından tanıdığı biçime çevirir: akan metin, düşünce, araç kartları, diff,
// izin kartları, plan (yapılacaklar), bağlam kullanımı. Dışarıya AgentSession ile aynı
// arayüzü sunar; oturum yöneticisi ve arayüz iki motoru aynı şekilde kullanır.
//
// Protokol: satır satır JSON-RPC 2.0 (https://agentclientprotocol.com). Bilinçli olarak
// küçük ve bağımlılıksız yazıldı; testler resmî ACP kütüphanesiyle yazılmış bir sahte
// ajana karşı çalışır (test/fixtures/fake-copilot.mjs).
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { msg } from './messages.js';

const PROTOCOL_VERSION = 1;
const isWin = process.platform === 'win32';
export const COPILOT_MODEL_LABEL = 'GitHub Copilot';

// Copilot CLI'ın yeri: COPILOT_CLI_PATH (Copilot'un kendi örneğinin de kullandığı ad) ya da PATH'teki "copilot"
const copilotPath = () => process.env.COPILOT_CLI_PATH?.trim() || 'copilot';
const isScript = (p) => /\.(mjs|cjs|js)$/i.test(p);

function spawnCopilot(args, opts) {
  const exe = copilotPath();
  if (isScript(exe)) return spawn(process.execPath, [exe, ...args], opts);
  // Windows'ta npm ile kurulan "copilot" bir .cmd dosyasıdır; kabuk üzerinden çalıştırılır
  if (isWin) return spawn(`"${exe}" ${args.join(' ')}`, { ...opts, shell: true });
  return spawn(exe, args, opts);
}

// ---------- Kurulu mu? ----------
let detectCache = null;
/** Copilot CLI kurulu ve çalışıyor mu? (VS Code'un "kurulu değil" yönlendiricisini ayırt eder) */
export function detectCopilot({ force = false } = {}) {
  if (!force && detectCache && Date.now() - detectCache.at < 60_000) return Promise.resolve(detectCache.value);
  const exe = copilotPath();
  return new Promise((resolve) => {
    const done = (value) => { detectCache = { at: Date.now(), value }; resolve(value); };
    const cb = (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      const version = out.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0];
      if (!err && version && !/not found|bulunamad/i.test(out)) return done({ available: true, version });
      done({ available: false, error: (out || err?.message || 'copilot bulunamadı').split('\n')[0].slice(0, 200) });
    };
    const opts = { timeout: 15_000, windowsHide: true };
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
  constructor({ cwd, resume, permissionMode, model, emit, lang = 'tr' }) {
    this.engine = 'copilot';
    this.cwd = cwd;
    this.resume = resume;
    this.lang = lang;
    this.emit = emit;
    this.permissionMode = permissionMode === 'plan' ? 'default' : permissionMode || 'default';
    this.model = ''; // Copilot'un kendi model kimliği (Claude modelleriyle karışmaz)
    this.wantModel = model || null; // arayüzde Copilot için son seçilen model
    this.models = []; // Copilot'un sunduğu modeller
    this.modelConfigId = null; // model, yapılandırma seçeneği olarak sunuluyorsa kimliği
    this.commands = [];
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
        this.emit({ type: 'error', message: friendlyError(err, this.lang) });
        this.emit({ type: 'session_ended' });
      }
      this.closed = true;
    });
  }

  async #boot() {
    const t0 = Date.now();
    const child = spawnCopilot(['--acp', '--stdio'], { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env });
    this.conn = new AcpConnection(child, {
      onRequest: (method, params) => this.#onRequest(method, params),
      onNotification: (method, params) => { if (method === 'session/update') this.#onUpdate(params.update); },
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'atolye', version: '1' },
    });
    this.promptCaps = init?.agentCapabilities?.promptCapabilities || {};
    const tInit = Date.now();
    let opened = null;

    if (this.resume && init?.agentCapabilities?.loadSession) {
      // Copilot eski konuşmayı session/update mesajlarıyla yeniden gönderir
      this.loading = true;
      const res = await this.conn.request('session/load', { sessionId: this.resume, cwd: this.cwd, mcpServers: [] });
      opened = res;
      this.#readModels(res);
      this.#flushUser();
      this.#closeBlock();
      this.loading = false;
    } else {
      if (this.resume) this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'local_command_output', content: msg(this.lang, 'Bu Copilot sürümü eski oturumu yüklemeyi desteklemiyor; yeni bir oturum açıldı.') } });
      const res = await this.conn.request('session/new', { cwd: this.cwd, mcpServers: [] });
      this.sessionId = res.sessionId;
      opened = res;
      this.#readModels(res);
    }
    // Teşhis satırı (atolye.log): açılış süreleri ve Copilot'un bildirdiği alanlar. Gizli bilgi içermez.
    console.log(`[copilot] ${init?.agentInfo?.version || '?'} başlatma ${((tInit - t0) / 1000).toFixed(1)} sn, oturum ${((Date.now() - tInit) / 1000).toFixed(1)} sn; ${describeSession(opened)}; model sayısı ${this.models.length}`);
    // Arayüzde Copilot için daha önce seçilen model bu oturuma da uygulanır
    if (this.wantModel && this.wantModel !== this.model && this.models.some((m) => m.value === this.wantModel)) {
      await this.setModel(this.wantModel).catch(() => {});
    }
    this.emit({ type: 'sdk', msg: { type: 'system', subtype: 'init', session_id: this.sessionId, permissionMode: this.permissionMode, model: this.#modelName() } });
    this.#drain();
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
    const opt = (res?.configOptions || []).find((o) => (o.category === 'model' || /model/i.test(o.id || '')) && Array.isArray(o.options));
    if (opt) {
      const flat = opt.options.flatMap((o) => (Array.isArray(o.options) ? o.options : [o]));
      this.modelConfigId = opt.id;
      this.models = flat.filter((o) => o.value).map((o) => ({ value: o.value, name: o.name || o.value, description: o.description || '' }));
      this.model = opt.currentValue || this.model;
    } else if (Array.isArray(res?.models?.availableModels)) {
      this.modelConfigId = null;
      this.models = res.models.availableModels.filter((m) => m.modelId).map((m) => ({ value: m.modelId, name: m.name || m.modelId, description: m.description || '' }));
      this.model = res.models.currentModelId || this.model;
    } else return;
    this.#sendCapabilities();
    this.emit({ type: 'model', model: this.model });
  }

  #modelName() {
    return this.models.find((m) => m.value === this.model)?.name || this.model || COPILOT_MODEL_LABEL;
  }

  #sendCapabilities() {
    this.emit({ type: 'capabilities', models: this.models, commands: this.commands });
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

    const id = randomUUID();
    const { name, input } = toolForUi(tc);
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, tc, pick, group });
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
    this.emit({ type: 'permission_resolved', id, behavior: decision.behavior, always: Boolean(decision.always) });
    if (allow && decision.always) {
      this.allowed.add(p.group);
      for (const [otherId, other] of this.pending) {
        if (other.group !== p.group) continue;
        this.pending.delete(otherId);
        other.resolve({ outcome: { outcome: 'selected', optionId: other.pick('allow_once', 'allow_always') } });
        this.emit({ type: 'permission_resolved', id: otherId, behavior: 'allow', always: true });
      }
    }
  }

  #cancelPending() {
    for (const [id, p] of this.pending) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
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

function friendlyError(err, lang) {
  const text = String(err?.message || err);
  if (/ENOENT|not recognized|tanınmıyor|bulunamad|not found/i.test(text))
    return msg(lang, 'GitHub Copilot CLI bulunamadı. Kurmak için: npm install -g @github/copilot ({error})', { error: text });
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(text))
    return msg(lang, "Copilot, GitHub sunucularına ulaşamadı (zaman aşımı). Şirket ağı ya da proxy engelliyor olabilir: bir terminalde 'copilot' çalıştırıp aynı sorunun orada da olup olmadığına bakın; proxy gerekiyorsa Atölye'nin .env dosyasına HTTPS_PROXY ekleyip Atölye'yi yeniden başlatın. ({error})", { error: text.slice(0, 200) });
  if (/not authorized to use this Copilot|\b403\b|permission_denied/i.test(text))
    return msg(lang, "GitHub hesabınızın Copilot kullanma yetkisi yok (lisans tanımlı değil ya da yanlış hesapla giriş yapılmış). Bir terminalde 'copilot login' ile Copilot lisansı olan hesabınızla giriş yapın. ({error})", { error: text.slice(0, 200) });
  if (/auth|login|401/i.test(text))
    return msg(lang, "Copilot'a giriş yapılmamış. Bir terminalde 'copilot login' çalıştırıp tarayıcıdan giriş yapın, sonra yeni bir Copilot oturumu açın. ({error})", { error: text });
  return text;
}

