// Tek bir sohbet oturumu: Agent SDK'nın query() akışını "streaming input" modunda
// açık tutar, böylece aynı oturuma art arda mesaj gönderebilir, çalışmayı
// durdurabilir, izin modunu ve modeli anında değiştirebiliriz.
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Arayüze iletilen SDK mesaj tipleri. Geri kalanlar (hook, telemetri vb.) gürültü.
const FORWARDED = new Set(['system', 'assistant', 'user', 'stream_event', 'result']);

// "Bu oturumda hep izin ver" ile onaylanan araç grupları, oturum kimliğine göre.
// WebSocket yeniden bağlansa ya da oturum devam ettirilse de korunur.
const sessionAllowances = new Map(); // sessionId -> Set<grup>

// Claude Code'un önerdiği kurallar komutun tamamına özel olduğundan, Claude her
// seferinde farklı bir komut yazınca yeniden sorulur. Bu yüzden onayı araç
// grubu düzeyinde tutuyoruz.
const NEVER_ALWAYS = new Set(['AskUserQuestion', 'ExitPlanMode']);
function allowanceGroup(toolName) {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(toolName)) return 'edits';
  if (/^(Bash|PowerShell)$/.test(toolName)) return 'shell';
  return toolName;
}

// Klasörsüz sohbet: çalışma klasörü boş, ayrı bir klasördür; Claude'un projede dosya aramaya kalkmaması için
const GENERAL_PROMPT = [
  'Bu oturum bir projeye bağlı değil (Atölye "klasörsüz sohbet"). Çalışma klasörü boş, ayrı bir klasördür;',
  'orada proje dosyası aramayın. Kullanıcı genel sorular soruyor (ör. ağ, sistem, araçlar, kavramlar).',
  'Sorunu teşhis etmek için gerekirse kullanıcının bilgisayarında komut çalıştırabilirsiniz (ör. ping, nslookup,',
  'Test-NetConnection, ipconfig); ne yaptığınızı kısaca açıklayın. Kullanıcı Türkçe yazıyorsa Türkçe cevap verin.',
].join(' ');

export class AgentSession {
  /**
   * @param {object} opts
   * @param {string} opts.cwd            Çalışma klasörü
   * @param {string} [opts.resume]       Devam edilecek oturum kimliği
   * @param {string} [opts.model]
   * @param {string} [opts.permissionMode]
   * @param {(event: object) => void} opts.emit  Arayüze olay gönderir
   */
  constructor({ cwd, resume, model, permissionMode, emit, general = false }) {
    this.cwd = cwd;
    this.general = general;
    this.resume = resume;
    this.model = model || undefined;
    this.permissionMode = permissionMode || 'default';
    this.emit = emit;
    this.sessionId = resume || null;
    this.pending = new Map(); // izin/soru id -> { resolve, input, toolName }
    this.allowed = (resume && sessionAllowances.get(resume)) || new Set();
    this.inbox = [];
    this.wake = null;
    this.closed = false;
    this.busy = false;
    this.q = null;
  }

  start() {
    const options = {
      cwd: this.cwd,
      resume: this.resume,
      model: this.model,
      permissionMode: this.permissionMode,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      // CLAUDE.md, ~/.claude/settings.json (gateway adresi, token, izinler) yüklensin
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(this.general ? { append: GENERAL_PROMPT } : {}) },
      canUseTool: (toolName, input, ctx) => this.#askPermission(toolName, input, ctx),
      stderr: (data) => {
        if (process.env.ATOLYE_DEBUG) process.stderr.write(`[claude] ${data}`);
      },
    };
    this.q = query({ prompt: this.#input(), options });
    this.#pump();
    this.#sendCapabilities();
  }

  async *#input() {
    while (!this.closed) {
      if (this.inbox.length === 0) {
        await new Promise((r) => (this.wake = r));
        this.wake = null;
        continue;
      }
      yield this.inbox.shift();
    }
  }

  async #pump() {
    try {
      for await (const msg of this.q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id;
          this.permissionMode = msg.permissionMode;
          const saved = sessionAllowances.get(this.sessionId);
          if (saved && saved !== this.allowed) for (const g of saved) this.allowed.add(g);
          sessionAllowances.set(this.sessionId, this.allowed);
        }
        if (msg.type === 'result') this.#setBusy(false);
        if (FORWARDED.has(msg.type)) this.emit({ type: 'sdk', msg });
      }
    } catch (err) {
      if (!this.closed) this.emit({ type: 'error', message: friendlyError(err) });
    } finally {
      this.#setBusy(false);
      this.#cancelPending('Oturum kapandı');
      if (!this.closed) this.emit({ type: 'session_ended' });
      this.closed = true;
    }
  }

  async #sendCapabilities() {
    const [models, commands] = await Promise.all([
      this.q.supportedModels().catch(() => []),
      this.q.supportedCommands().catch(() => []),
    ]);
    this.emit({
      type: 'capabilities',
      models: models.map((m) => ({ value: m.value, name: m.displayName, description: m.description })),
      commands: commands.map((c) => ({ name: c.name, description: c.description, hint: c.argumentHint })),
    });
  }

  #setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.emit({ type: 'busy', busy });
  }

  send(text, images = []) {
    if (this.closed) throw new Error('Oturum kapalı');
    const content = [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })),
      { type: 'text', text },
    ];
    this.inbox.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId || '',
    });
    this.#setBusy(true);
    this.wake?.();
  }

  async interrupt() {
    this.#cancelPending('Kullanıcı durdurdu', true);
    await this.q?.interrupt().catch(() => {});
  }

  /** /context komutundaki veri: bağlamın kategorilere göre token dağılımı */
  async contextUsage() {
    if (!this.q || this.closed) throw new Error('Oturum kapalı');
    return this.q.getContextUsage();
  }

  async setPermissionMode(mode) {
    this.permissionMode = mode;
    await this.q?.setPermissionMode(mode);
    this.emit({ type: 'mode', mode });
  }

  async setModel(model) {
    this.model = model || undefined;
    await this.q?.setModel(this.model);
    this.emit({ type: 'model', model: model || '' });
  }

  /** Arayüzden gelen izin / soru cevabı */
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    const { toolName, input } = p;

    if (decision.behavior === 'deny') {
      p.resolve({ behavior: 'deny', message: decision.message || 'Kullanıcı reddetti' });
    } else if (toolName === 'AskUserQuestion') {
      p.resolve({ behavior: 'allow', updatedInput: { ...input, answers: decision.answers || {} } });
    } else {
      p.resolve({ behavior: 'allow', updatedInput: input });
    }
    this.emit({ type: 'permission_resolved', id, behavior: decision.behavior, always: Boolean(decision.always) });

    if (decision.always && decision.behavior === 'allow' && !NEVER_ALWAYS.has(toolName)) {
      const group = allowanceGroup(toolName);
      this.allowed.add(group);
      // Aynı gruptan bekleyen diğer istekleri de onayla (paralel araç çağrıları)
      for (const [otherId, other] of this.pending) {
        if (allowanceGroup(other.toolName) !== group) continue;
        this.pending.delete(otherId);
        other.resolve({ behavior: 'allow', updatedInput: other.input });
        this.emit({ type: 'permission_resolved', id: otherId, behavior: 'allow', always: true });
      }
    }

    // Plan onaylandıysa seçilen moda geç (Claude Code'daki davranış)
    if (toolName === 'ExitPlanMode' && decision.behavior === 'allow' && decision.nextMode) {
      this.setPermissionMode(decision.nextMode).catch(() => {});
    }
  }

  #askPermission(toolName, input, { signal, blockedPath, decisionReason, title }) {
    if (!NEVER_ALWAYS.has(toolName) && this.allowed.has(allowanceGroup(toolName)))
      return Promise.resolve({ behavior: 'allow', updatedInput: input });

    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, toolName, input });
      signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve({ behavior: 'deny', message: 'İptal edildi' });
        this.emit({ type: 'permission_resolved', id, behavior: 'cancelled' });
      });
      this.emit({
        type: toolName === 'AskUserQuestion' ? 'question' : 'permission',
        id,
        toolName,
        input,
        title,
        blockedPath,
        decisionReason,
        canAlways: !NEVER_ALWAYS.has(toolName),
        alwaysGroup: allowanceGroup(toolName),
      });
    });
  }

  #cancelPending(message, interrupt = false) {
    for (const [id, p] of this.pending) {
      p.resolve({ behavior: 'deny', message, interrupt });
      this.emit({ type: 'permission_resolved', id, behavior: 'cancelled' });
    }
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.#cancelPending('Oturum kapandı');
    this.wake?.();
    try {
      this.q?.close?.();
    } catch {
      /* zaten kapalı */
    }
  }
}

function friendlyError(err) {
  const text = String(err?.message || err);
  if (/ENOENT|spawn/i.test(text)) return `Claude Code çalıştırılamadı: ${text}`;
  if (/401|unauthori[sz]ed|authentication/i.test(text))
    return `Kimlik doğrulama hatası. ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY değerini kontrol edin. (${text})`;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|self.signed/i.test(text))
    return `Gateway'e bağlanılamadı. ANTHROPIC_BASE_URL, HTTPS_PROXY ve NODE_EXTRA_CA_CERTS ayarlarını kontrol edin. (${text})`;
  return text;
}
