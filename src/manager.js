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
import { localConfig, skillPrompt } from './settings.js';
import { aiTitle, shortTitle } from './title.js';
import { validWork, workInstruction } from './workmode.js';
import { attachmentPrompt } from './attachments.js';

const IDLE_CLOSE_MS = 30_000;

// Başka bir oturumdan aktarılan özetin en fazla uzunluğu (karakter)
export const HANDOFF_MAX = 20_000;

export class SessionManager {
  /** @param {{ store?: import('./store.js').StateStore }} [opts] store: Copilot oturumlarını listelemek için */
  constructor({ store, aiTitles = false, onTitle = null } = {}) {
    this.store = store;
    this.aiTitles = aiTitles; // ilk cevaptan sonra yapay zekâya kısa bir başlık yazdır
    this.onTitle = onTitle; // (entry, title): başlığı kalıcı kaydetmek için (Claude oturumlarında)
    this.entries = new Map(); // liveId -> entry
    this.listeners = new Set(); // canlı oturum listesi değişince çağrılır
  }

  find({ liveId, sessionId }) {
    if (liveId && this.entries.has(liveId)) return this.entries.get(liveId);
    if (sessionId) for (const e of this.entries.values()) if (e.agent.sessionId === sessionId) return e;
    return null;
  }

  /** Var olan canlı oturumu döndürür ya da yenisini (gerekirse devam ettirerek) başlatır. */
  async open({ liveId, sessionId, cwd, mode, model, effort, context, role, general = false, lang = 'tr', engine = 'claude', work = 'agent', localId, extraDirs = [] }) {
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
      engine: ['copilot', 'yerel'].includes(engine) ? engine : 'claude',
      local: engine === 'yerel' ? localConfig(localId) : null, // seçilen yerel model (bkz. settings.js)
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
      effort,
      context,
      extraDirs, // ek çalışma klasörleri (ör. zamanlanmış işin kod klasörü)
      permissionMode: mode,
      work,
      general,
      role,
      lang,
      emit: (ev) => this.#onEvent(entry, ev),
      skipReplay: saved.length > 0,
      local: entry.local,
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
      local: entry.local?.id || null,
      sessionId: entry.agent.sessionId,
      cwd: entry.cwd,
      title: entry.title,
      mode: entry.agent.permissionMode,
      model: entry.agent.model || '',
      busy: entry.agent.busy,
      tasks: entry.agent.tasks || [],
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

  /**
   * handoff: başka bir motordaki oturumdan aktarılan, kullanıcının onayladığı özet. Yalnızca yapay zekâya gider (gizli
   * yönerge olarak); ekrandaki mesaj balonunda ve oturum başlığında yer almaz.
   */
  send(entry, text, images, lang = 'tr', files = [], work, handoff = '', note = '') {
    if (work) entry.agent.work = validWork(work);
    // Ekli dosyaların yolu ve içeriğinin başı yalnızca yapay zekâya giden mesaja eklenir; ekranda dosya adları görünür.
    // Ask / Plan kipinin yönergesi de yalnızca yapay zekâya gider (geçmişte system-reminder olarak gizlenir).
    const extra = attachmentPrompt(files, lang);
    // Oturumun motoru bilgisayardaki bir skill'i "/ad" komutu olarak tanımıyorsa mesaj düz isteğe çevrilir ve skill'in
    // yeri gizli yönergeyle bildirilir: Copilot'ta Claude klasöründeki skill, Claude Code ve yerel LLM oturumlarında
    // yalnızca Copilot klasöründeki skill. Motorun kendi tanıdığı skill olduğu gibi gider.
    let skill = null;
    try { skill = skillPrompt(text, entry.agent.commands || [], entry.cwd || '', entry.engine === 'copilot' ? 'copilot' : 'claude'); } catch { /* skill okunamadı: mesaj olduğu gibi gider */ }
    const body = skill ? (skill.rest || msg(lang, '"{name}" skill\'ini kullan.', { name: skill.name })) : text;
    const rule = text.startsWith('/') && !skill ? '' : workInstruction(entry.agent.work);
    const carried = String(handoff || '').trim().slice(0, HANDOFF_MAX).replace(/<\/?system-reminder>/gi, '');
    const context = carried ? `The user is continuing a conversation that started in another AI session. Summary of that session, reviewed and approved by the user:\n\n${carried}\n\n(End of the summary.) Treat it as context for this conversation; do not repeat it back.` : '';
    // note: Atölye'nin kendi gizli notu (ör. zamanlanmış işin "kullanıcı başında değil" bilgisi)
    const notes = [context, skill?.note, rule, note].filter(Boolean).map((n) => `\n\n<system-reminder>${n}</system-reminder>`).join('');
    entry.agent.send(`${body}${extra ? `\n\n${extra}` : ''}${notes}`, images);
    entry.sent = true;
    // Başlık yalnızca kullanıcının yazdığından çıkarılır (Atölye'nin eklediği notlar ve getirilen veriler hariç)
    if (!entry.title) { entry.title = shortTitle(text) || msg(lang, 'Görsel'); entry.firstPrompt = text; entry.lang = lang; }
    this.#onEvent(entry, { type: 'user_prompt', text, images, ...(files.length ? { files: files.map((f) => ({ name: f.name, size: f.size })) } : {}) });
  }

  /**
   * Oturumdaki her işi durdurur: süren tur ve arka plandaki işlemler. Oturum açık kalır; konuşma devam edebilir.
   * Ekranda açık olmayan bir oturum da listeden durdurulabilsin diye oturumun kimliğiyle çağrılır.
   */
  async stop(entry) {
    await entry.agent.interrupt();
    const tasks = entry.agent.tasks || [];
    if (tasks.length && entry.agent.stopTask) await Promise.all(tasks.map((t) => entry.agent.stopTask(t.id).catch(() => {})));
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
        local: e.local?.id || null,
        sessionId: e.agent.sessionId,
        title: e.title,
        cwd: e.cwd,
        busy: e.agent.busy,
        tasks: (e.agent.tasks || []).length,
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
    // Zamanlanmış işin oturumunun başlığı işin adıdır: motorun (Copilot) kendi verdiği başlık yok sayılır
    if (ev.type === 'session_title' && (entry.job || this.store?.jobs?.().some((j) => j.sessionId && j.sessionId === entry.agent.sessionId))) return;
    if (ev.type === 'error') console.warn(`[oturum] ${entry.engine}: ${ev.message}`);
    if (entry.engine === 'yerel' && entry.sent && entry.agent.sessionId) this.store?.recordLocalSession(entry.agent.sessionId, entry.local?.id);
    if (entry.engine === 'copilot') {
      this.#recordCopilot(entry, ev);
      if (transcript.shouldKeep(ev)) entry.unsaved.push(ev);
      if (entry.agent.sessionId && entry.unsaved.length) transcript.append(entry.agent.sessionId, entry.unsaved.splice(0));
    }
    if (ev.type === 'session_title') {
      if (ev.title) { entry.title = ev.title; entry.aiTitled = true; } // motor kendi başlığını verdiyse ayrıca istenmez
      this.#broadcast();
      return;
    }
    // İlk turun cevabı biriktirilir; tur bitince başlık istenir
    if (this.aiTitles && !entry.aiTitled && ev.type === 'sdk') {
      if (ev.msg.type === 'assistant' && !ev.msg.parent_tool_use_id) {
        entry.firstAnswer = `${entry.firstAnswer || ''}${(ev.msg.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ')}`.slice(0, 2000);
      } else if (ev.msg.type === 'result' && entry.firstPrompt && entry.firstAnswer) {
        entry.aiTitled = true;
        this.#requestTitle(entry);
      }
    }
    if (ev.type === 'capabilities') {
      entry.capabilities = ev;
    } else if (ev.type === 'tasks') {
      // Tampona yazılmaz: oturum açılınca güncel liste anlık görüntüyle gider
    } else {
      entry.buffer.push(ev);
      // Tur bitince akış parçaları gereksiz: tam mesajlar zaten tamponda
      if (ev.type === 'sdk' && ev.msg.type === 'result')
        entry.buffer = entry.buffer.filter((e) => !(e.type === 'sdk' && e.msg.type === 'stream_event'));
    }
    for (const fn of entry.subs) fn(ev);

    if (ev.type === 'session_ended') return this.close(entry);
    if (['busy', 'tasks', 'permission', 'question', 'permission_resolved', 'user_prompt'].includes(ev.type)) {
      this.#broadcast();
      this.#maybeClose(entry);
    }
  }

  // Yapay zekâdan kısa başlık: asıl oturumu etkilemeyen ayrı, tek seferlik bir istek
  /** Oturuma başlık verir ve kalıcı yazar (Claude/yerel: oturum kaydına, Copilot: Atölye'nin deposuna) */
  setTitle(entry, title) {
    if (!title || !entry.agent.sessionId) return;
    entry.title = title;
    if (entry.engine === 'copilot') this.store?.setCopilotTitle(entry.agent.sessionId, title);
    else this.onTitle?.(entry, title);
    this.#broadcast();
  }

  async #requestTitle(entry) {
    if (entry.engine === 'yerel') return; // yerel modelde ek istek yapılmaz; başlık ilk mesajdan gelir
    const title = await aiTitle({ engine: entry.engine, cwd: entry.cwd, model: entry.agent.model || undefined, question: entry.firstPrompt, answer: entry.firstAnswer, lang: entry.lang });
    if (!title) return;
    entry.title = title;
    console.log(`[oturum] başlık: ${title}`);
    if (entry.engine === 'copilot') this.store?.setCopilotTitle(entry.agent.sessionId, title);
    else this.onTitle?.(entry, title);
    this.#broadcast();
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
  // oturumlar hemen, bitmiş oturumlar kısa bir beklemeden sonra kapanır. Arka planda işlem süren oturum açık kalır
  // (kapanırsa işlem sessizce ölür; listede görünür ve oradan durdurulabilir).
  #maybeClose(entry) {
    clearTimeout(entry.idleTimer);
    if (entry.subs.size || entry.agent.busy || entry.agent.pending.size || entry.agent.tasks?.length) return;
    if (!entry.sent) return this.close(entry);
    entry.idleTimer = setTimeout(() => this.#maybeCloseNow(entry), IDLE_CLOSE_MS);
  }

  #maybeCloseNow(entry) {
    if (!entry.subs.size && !entry.agent.busy && !entry.agent.pending.size && !entry.agent.tasks?.length) this.close(entry);
  }

  #broadcast() {
    const list = this.list();
    for (const fn of this.listeners) fn(list);
  }
}
