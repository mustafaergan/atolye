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
import * as transcript from './transcript.js';
import { CopilotSession } from './copilot.js';
import { msg } from './messages.js';

const IDLE_CLOSE_MS = 30_000;

export class SessionManager {
  /** @param {{ store?: import('./store.js').StateStore }} [opts] store: Copilot oturumlarını listelemek için */
  constructor({ store } = {}) {
    this.store = store;
    this.entries = new Map(); // liveId -> entry
    this.listeners = new Set(); // canlı oturum listesi değişince çağrılır
  }

  find({ liveId, sessionId }) {
    if (liveId && this.entries.has(liveId)) return this.entries.get(liveId);
    if (sessionId) for (const e of this.entries.values()) if (e.agent.sessionId === sessionId) return e;
    return null;
  }

  /** Var olan canlı oturumu döndürür ya da yenisini (gerekirse devam ettirerek) başlatır. */
  async open({ liveId, sessionId, cwd, mode, model, general = false, lang = 'tr', engine = 'claude' }) {
    const existing = this.find({ liveId, sessionId });
    if (existing) return existing;

    // Devam ettirilen oturumda diskte zaten olan mesaj sayısı; bu süreçte
    // eklenenler tampondan gönderileceği için geçmiş bu sayıyla sınırlanır.
    // (Copilot eski konuşmayı oturum yüklenirken kendisi yeniden gönderir; disk geçmişi yok)
    const historyCount = sessionId && engine !== 'copilot'
      ? (await Promise.race([
          getSessionMessages(sessionId, { dir: cwd }).catch(() => []),
          new Promise((r) => setTimeout(() => r([]), 15_000)), // çok büyük ya da kilitli geçmiş açılışı bekletmesin
        ])).length
      : 0;

    const raced = this.find({ sessionId });
    if (raced) return raced;

    // Copilot konuşmasının yerel kopyası: Copilot o an yüklenemese bile geçmiş hemen görünür.
    // Kopya varsa Copilot'un yükleme sırasında yeniden gönderdiği eski mesajlar yok sayılır (çift görünmesin).
    const saved = sessionId && engine === 'copilot' ? transcript.read(sessionId) : [];

    const entry = {
      liveId: randomUUID(),
      engine: engine === 'copilot' ? 'copilot' : 'claude',
      cwd,
      historyCount,
      buffer: saved.slice(),
      unsaved: [], // oturum kimliği belli olana kadar bekleyen kalıcı olaylar
      subs: new Set(),
      capabilities: null,
      title: null,
      sent: false,
      lastActivity: Date.now(),
      idleTimer: null,
      agent: null,
    };
    const Engine = entry.engine === 'copilot' ? CopilotSession : AgentSession;
    entry.agent = new Engine({
      cwd,
      resume: sessionId || undefined,
      model,
      permissionMode: mode,
      general,
      lang,
      emit: (ev) => this.#onEvent(entry, ev),
      skipReplay: saved.length > 0,
    });
    this.entries.set(entry.liveId, entry);
    entry.agent.start();
    console.log(`[oturum] ${entry.engine} oturumu açılıyor: ${cwd}${sessionId ? ' (kayıtlı oturum)' : ''}`);
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
      engine: entry.engine,
      sessionId: entry.agent.sessionId,
      cwd: entry.cwd,
      title: entry.title,
      mode: entry.agent.permissionMode,
      model: entry.agent.model || '',
      busy: entry.agent.busy,
      capabilities: entry.capabilities,
      ready: entry.agent.ready !== false && entry.agent.booted !== false,
      history,
      events: entry.buffer.slice(),
    });
    entry.subs.add(fn);
    return () => {
      entry.subs.delete(fn);
      this.#maybeClose(entry);
    };
  }

  send(entry, text, images, lang = 'tr') {
    entry.agent.send(text, images);
    entry.sent = true;
    if (!entry.title) entry.title = text.slice(0, 120) || msg(lang, 'Görsel');
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
        engine: e.engine,
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
    if (ev.type === 'error') console.warn(`[oturum] ${entry.engine}: ${ev.message}`);
    if (entry.engine === 'copilot') {
      this.#recordCopilot(entry, ev);
      if (transcript.shouldKeep(ev)) entry.unsaved.push(ev);
      if (entry.agent.sessionId && entry.unsaved.length) transcript.append(entry.agent.sessionId, entry.unsaved.splice(0));
    }
    if (ev.type === 'session_title') {
      if (ev.title) entry.title = ev.title;
      this.#broadcast();
      return;
    }
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

  // Copilot oturumları listede görünsün diye kalıcı depoya yazılır (oluşunca, ilk mesajda, başlıkta, tur sonunda)
  #recordCopilot(entry, ev) {
    const id = entry.agent.sessionId;
    if (!this.store || !id) return;
    const isInit = ev.type === 'sdk' && ev.msg.type === 'system' && ev.msg.subtype === 'init';
    const isResult = ev.type === 'sdk' && ev.msg.type === 'result';
    if (isInit && !entry.sent) return; // boş oturumlar listeye girmesin
    if (isInit || isResult || ev.type === 'user_prompt') this.store.recordCopilotSession({ id, cwd: entry.cwd, title: entry.title });
    if (ev.type === 'session_title') this.store.setCopilotTitle(id, ev.title);
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
