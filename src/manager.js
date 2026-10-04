// Çalışan oturumlar tarayıcı bağlantısından bağımsızdır: başka bir oturuma
// geçmek ya da sayfayı yenilemek işi durdurmaz. Her oturum, bu süreçte ürettiği
// olayları bir tamponda tutar; tarayıcı yeniden bağlandığında önce diskteki
// eski geçmiş, ardından bu tampon gönderilerek ekran aynen kurulur.
//
// Sadece çalışan oturumlar bellekte kalır. İşi bitmiş ve kimsenin bakmadığı
// oturumlar kısa bir süre sonra kapatılır; tamamlanmış geçmiş zaten Claude
// Code'un kendi oturum dosyalarından okunur.
import { randomUUID } from 'node:crypto';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { AgentSession } from './session.js';

const IDLE_CLOSE_MS = 30_000;

export class SessionManager {
  constructor() {
    this.entries = new Map(); // liveId -> entry
    this.listeners = new Set(); // canlı oturum listesi değişince çağrılır
  }

  find({ liveId, sessionId }) {
    if (liveId && this.entries.has(liveId)) return this.entries.get(liveId);
    if (sessionId) for (const e of this.entries.values()) if (e.agent.sessionId === sessionId) return e;
    return null;
  }

  /** Var olan canlı oturumu döndürür ya da yenisini (gerekirse devam ettirerek) başlatır. */
  async open({ liveId, sessionId, cwd, mode, model, general = false }) {
    const existing = this.find({ liveId, sessionId });
    if (existing) return existing;

    // Devam ettirilen oturumda diskte zaten olan mesaj sayısı; bu süreçte
    // eklenenler tampondan gönderileceği için geçmiş bu sayıyla sınırlanır.
    const historyCount = sessionId
      ? (await getSessionMessages(sessionId, { dir: cwd }).catch(() => [])).length
      : 0;

    const raced = this.find({ sessionId });
    if (raced) return raced;

    const entry = {
      liveId: randomUUID(),
      cwd,
      historyCount,
      buffer: [],
      subs: new Set(),
      capabilities: null,
      title: null,
      sent: false,
      lastActivity: Date.now(),
      idleTimer: null,
      agent: null,
    };
    entry.agent = new AgentSession({
      cwd,
      resume: sessionId || undefined,
      model,
      permissionMode: mode,
      general,
      emit: (ev) => this.#onEvent(entry, ev),
    });
    this.entries.set(entry.liveId, entry);
    entry.agent.start();
    return entry;
  }

  /**
   * Bir tarayıcı bağlantısını oturuma bağlar. Önce ekranın tamamını kuracak
   * anlık görüntü gönderilir, sonra yeni olaylar akar. İkisi arasında `await`
   * olmadığı için olay kaçırılmaz.
   */
  subscribe(entry, fn, history) {
    clearTimeout(entry.idleTimer);
    fn({
      type: 'opened',
      liveId: entry.liveId,
      sessionId: entry.agent.sessionId,
      cwd: entry.cwd,
      title: entry.title,
      mode: entry.agent.permissionMode,
      model: entry.agent.model || '',
      busy: entry.agent.busy,
      capabilities: entry.capabilities,
      history,
      events: entry.buffer.slice(),
    });
    entry.subs.add(fn);
    return () => {
      entry.subs.delete(fn);
      this.#maybeClose(entry);
    };
  }

  send(entry, text, images) {
    entry.agent.send(text, images);
    entry.sent = true;
    if (!entry.title) entry.title = text.slice(0, 120) || 'Görsel';
    this.#onEvent(entry, { type: 'user_prompt', text, images });
  }

  close(entry) {
    clearTimeout(entry.idleTimer);
    if (!this.entries.delete(entry.liveId)) return;
    entry.agent.close();
    this.#broadcast();
  }

  closeBySessionId(sessionId) {
    const e = this.find({ sessionId });
    if (e) this.close(e);
  }

  list() {
    return [...this.entries.values()]
      .filter((e) => e.sent)
      .map((e) => ({
        liveId: e.liveId,
        sessionId: e.agent.sessionId,
        title: e.title,
        cwd: e.cwd,
        busy: e.agent.busy,
        waiting: e.agent.pending.size,
        lastActivity: e.lastActivity,
      }));
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #onEvent(entry, ev) {
    entry.lastActivity = Date.now();
    if (ev.type === 'capabilities') {
      entry.capabilities = ev;
    } else {
      entry.buffer.push(ev);
      // Tur bitince akış parçaları gereksiz: tam mesajlar zaten tamponda
      if (ev.type === 'sdk' && ev.msg.type === 'result')
        entry.buffer = entry.buffer.filter((e) => !(e.type === 'sdk' && e.msg.type === 'stream_event'));
    }
    for (const fn of entry.subs) fn(ev);

    if (ev.type === 'session_ended') return this.close(entry);
    if (['busy', 'permission', 'question', 'permission_resolved', 'user_prompt'].includes(ev.type)) {
      this.#broadcast();
      this.#maybeClose(entry);
    }
  }

  // Kimse bakmıyorsa ve iş bitmişse kapat. Hiç mesaj gönderilmemiş boş
  // oturumlar hemen, bitmiş oturumlar kısa bir beklemeden sonra kapanır.
  #maybeClose(entry) {
    clearTimeout(entry.idleTimer);
    if (entry.subs.size || entry.agent.busy || entry.agent.pending.size) return;
    if (!entry.sent) return this.close(entry);
    entry.idleTimer = setTimeout(() => this.#maybeCloseNow(entry), IDLE_CLOSE_MS);
  }

  #maybeCloseNow(entry) {
    if (!entry.subs.size && !entry.agent.busy && !entry.agent.pending.size) this.close(entry);
  }

  #broadcast() {
    const list = this.list();
    for (const fn of this.listeners) fn(list);
  }
}
