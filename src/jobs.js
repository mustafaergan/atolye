// Zamanlanmış işler (job): kullanıcının seçtiği günlerde ve saatlerde bir oturum açılır, komut gönderilir ve
// yapay zekâ işi kimse başında olmadan yapar. Her iş hep aynı oturumda çalışır: ilk çalıştırmada oturum açılır,
// kimliği işe yazılır, sonraki çalıştırmalar o oturuma devam eder (yapay zekâ önceki çalıştırmaları görür).
//
// İzinler: kullanıcı işi kurarken Ask ya da Agent seçer. İş çalışırken gelen izin istekleri burada onaylanır;
// Ask kipinde dosya düzenleme araçlarını oturumun kendisi zaten reddeder (bkz. workmode.js), Agent kipinde her şeye
// izin verilir (kullanıcı kurarken bu riski onaylar). Yapay zekâ soru sorarsa cevap verilemeyeceği söylenir.
//
// Zaman: sunucunun yerel saati. Atölye kapalıyken kaçırılan bir çalıştırma, o gün içindeyse açılışta bir kez yapılır.
import { randomUUID } from 'node:crypto';

export const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Pzt…Paz (Date#getDay değerleri)
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LINK_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_JOBS = 50;
const MAX_TIMES = 24;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Kullanıcının gönderdiği işi doğrular ve temizler; geçersizse Error fırlatır (code: alan adı) */
export function cleanJob(input = {}, previous = null) {
  const fail = (code) => Object.assign(new Error(code), { code });
  const name = str(input.name, 80);
  if (!name) throw fail('name');
  const engine = ['claude', 'copilot', 'yerel'].includes(input.engine) ? input.engine : null;
  if (!engine) throw fail('engine');
  const local = engine === 'yerel' ? str(input.local, 64) : '';
  if (engine === 'yerel' && !local) throw fail('local');
  const prompt = str(input.prompt, 20_000);
  if (!prompt) throw fail('prompt');
  const cwd = str(input.cwd, 1000);
  if (!cwd) throw fail('cwd');
  // Kodun bulunduğu klasör (isteğe bağlı): oturum cwd'de durur, yapay zekâya bu klasör ek çalışma klasörü olarak verilir
  const codeDir = str(input.codeDir, 1000) || null;
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number).filter((d) => DAYS.includes(d)))];
  if (!days.length) throw fail('days');
  const times = [...new Set((Array.isArray(input.times) ? input.times : []).map((t) => String(t).trim()).filter((t) => TIME.test(t)))].sort().slice(0, MAX_TIMES);
  if (!times.length) throw fail('times');
  const work = input.work === 'agent' ? 'agent' : 'ask';
  const links = [...new Set((Array.isArray(input.links) ? input.links : []).filter((l) => typeof l === 'string' && LINK_ID.test(l)))].slice(0, 4);
  const sameTarget = previous && previous.engine === engine && (previous.local || '') === local && previous.cwd === cwd;
  const sameSchedule = previous && String(previous.days) === String(days) && String(previous.times) === String(times);
  return {
    id: previous?.id || randomUUID(),
    name, engine, local: local || null, work, links,
    linkHint: str(input.linkHint, 8000), // bağlantı notları (arayüz, kayıt anında üretir; mesajın sonuna eklenir)
    prompt, cwd, codeDir, days, times,
    enabled: input.enabled !== false,
    // Motor ya da klasör değişirse eski oturum devam ettirilemez: bir sonraki çalıştırmada yenisi açılır
    sessionId: sameTarget ? previous.sessionId || null : null,
    lastRun: previous?.lastRun || 0,
    // Bu andan önceki zamanlar sayılmaz: yeni kurulan (ya da saati değişen, yeniden etkinleştirilen) iş geçmiş saatler
    // için hemen çalışmaz
    since: sameSchedule && Number(previous.since) ? Number(previous.since) : Date.now(),
    lastStatus: previous?.lastStatus || null,
    lastError: previous?.lastError || '',
    createdAt: previous?.createdAt || Date.now(),
  };
}

/** Kayıttan okunan işi (bozuk alanlara karşı) düzeltir; kullanılamazsa null */
export function loadJob(j) {
  try {
    const job = cleanJob(j, { ...j, id: typeof j?.id === 'string' && j.id ? j.id : randomUUID() });
    job.sessionId = typeof j.sessionId === 'string' && j.sessionId ? j.sessionId : null;
    // Atölye bir çalıştırmanın ortasında kapandıysa o çalıştırma yarım kalmıştır
    if (job.lastStatus === 'running') job.lastStatus = 'interrupted';
    return job;
  } catch {
    return null;
  }
}

/** Bugünkü en son zamanı geçmiş çalıştırma anı (ms); bugün çalışma günü değilse ya da saat gelmediyse 0 */
export function latestSlot(job, now = Date.now()) {
  const d = new Date(now);
  if (!job.days.includes(d.getDay())) return 0;
  let best = 0;
  for (const t of job.times) {
    const [h, m] = t.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at.getTime() <= now && at.getTime() > best) best = at.getTime();
  }
  return best;
}

/** Bir sonraki çalıştırma anı (ms); en fazla 8 gün ileriye bakılır */
export function nextRun(job, now = Date.now()) {
  if (!job.enabled) return 0;
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!job.days.includes(d.getDay())) continue;
    for (const t of job.times) {
      const [h, m] = t.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      if (d.getTime() > now) return d.getTime();
    }
  }
  return 0;
}

/** Çalışma zamanı geldi mi: bugünkü son zaman geçmiş ve o zamandan sonra hiç çalışmamış */
export const isDue = (job, now = Date.now()) => {
  if (!job.enabled) return false;
  const slot = latestSlot(job, now);
  return slot > 0 && Math.max(job.lastRun || 0, job.since || 0) < slot;
};

const JOB_NOTE = (name, codeDir) => `This message was sent by the scheduled job "${name}" in Atölye. The user is not at the computer: do not ask questions or wait for confirmation. Do the task with the most reasonable assumptions, then finish with a short summary of what you did and what you found.${codeDir ? ` The code this job is about is in the folder ${codeDir} (use absolute paths there).` : ''}`;
const QUESTION_ANSWER = 'This is a scheduled job and the user is not here to answer. Continue with the most reasonable assumption and mention it in your summary.';

/**
 * Zamanlayıcı. manager: SessionManager; store: işlerin saklandığı StateStore (jobs, setJob, …);
 * canRun(job): motor kullanılabilir mi (değilse hata metni döner); general(cwd): klasörsüz sohbet klasörü mü.
 */
export function createScheduler({ manager, store, canRun = async () => null, general = () => false, now = () => Date.now(), tickMs = 30_000, log = console }) {
  const running = new Map(); // job id -> { entry, unsubscribe }

  function update(id, patch) {
    const job = store.jobs().find((j) => j.id === id);
    if (job) store.setJob({ ...job, ...patch });
  }

  /** İşi hemen çalıştırır. Dönen: { ok, error? } (çalıştırma başladıysa ok; bitişi beklenmez) */
  async function run(id, { reason = 'zaman' } = {}) {
    const job = store.jobs().find((j) => j.id === id);
    if (!job) return { ok: false, error: 'not-found' };
    if (running.has(id)) return { ok: false, error: 'running' };
    const started = now();
    // Aynı zaman diliminde bir daha denenmesin (hata olsa da)
    update(id, { lastRun: started, lastStatus: 'running', lastError: '' });
    const problem = await canRun(job).catch((err) => String(err?.message || err));
    if (problem) {
      update(id, { lastStatus: 'error', lastError: problem });
      log.warn?.(`[iş] "${job.name}" çalıştırılamadı: ${problem}`);
      return { ok: false, error: problem };
    }
    let entry;
    try {
      entry = (job.sessionId && manager.find({ sessionId: job.sessionId })) || await manager.open({
        engine: job.engine, localId: job.local || undefined, sessionId: job.sessionId || null, cwd: job.cwd,
        extraDirs: job.codeDir ? [job.codeDir] : [],
        mode: 'default', work: job.work, general: general(job.cwd), lang: 'tr',
      });
    } catch (err) {
      update(id, { lastStatus: 'error', lastError: String(err?.message || err).slice(0, 400) });
      return { ok: false, error: String(err?.message || err) };
    }
    if (entry.agent.busy) {
      update(id, { lastStatus: 'skipped', lastError: 'Oturum o sırada başka bir işle meşguldü.' });
      return { ok: false, error: 'busy' };
    }
    entry.job = { id: job.id, name: job.name };
    // İş oturumunun başlığı işin adıdır (yapay zekâdan başlık istenmez)
    const firstRun = !job.sessionId;
    entry.aiTitled = true;
    if (firstRun) entry.title = job.name;
    let unsubscribe = () => {};
    const finish = (status, error = '') => {
      if (!running.has(id)) return;
      running.delete(id);
      const sessionId = entry.agent.sessionId || job.sessionId || null;
      update(id, { lastStatus: status, lastError: String(error || '').slice(0, 400), sessionId });
      if (firstRun && sessionId) manager.setTitle?.(entry, job.name);
      log.log?.(`[iş] "${job.name}" bitti: ${status}${error ? ` (${String(error).slice(0, 120)})` : ''}`);
      setTimeout(() => unsubscribe(), 0);
    };
    running.set(id, { entry });
    unsubscribe = manager.subscribe(entry, (ev) => {
      // Cevap bir sonraki turda verilir: olay önce diğer abonelere (açık sekmelere) ulaşsın; yoksa arayüze "çözüldü"
      // bilgisi izin kartından önce gider ve kart cevap bekliyor gibi açık kalır
      if (ev.type === 'permission') setTimeout(() => entry.agent.answer(ev.id, { behavior: 'allow', auto: 'job' }), 0);
      else if (ev.type === 'question') setTimeout(() => entry.agent.answer(ev.id, { behavior: 'deny', message: QUESTION_ANSWER, auto: 'job' }), 0);
      else if (ev.type === 'sdk' && ev.msg?.type === 'system' && ev.msg.subtype === 'init' && ev.msg.session_id && !job.sessionId) {
        job.sessionId = ev.msg.session_id;
        update(id, { sessionId: ev.msg.session_id });
      } else if (ev.type === 'sdk' && ev.msg?.type === 'result') {
        finish(ev.msg.is_error ? 'error' : 'ok', ev.msg.is_error ? ev.msg.result || ev.msg.subtype : '');
      } else if (ev.type === 'error') finish('error', ev.message);
      else if (ev.type === 'session_ended') finish('error', 'Oturum kapandı');
    }, []);
    const text = job.linkHint ? `${job.prompt}\n\n${job.linkHint}` : job.prompt;
    try {
      manager.send(entry, text, [], 'tr', [], job.work, '', JOB_NOTE(job.name, job.codeDir));
    } catch (err) {
      finish('error', err?.message || err);
      return { ok: false, error: String(err?.message || err) };
    }
    log.log?.(`[iş] "${job.name}" çalıştırıldı (${reason}): ${job.engine}, ${job.work}, ${job.cwd}`);
    return { ok: true };
  }

  async function tick() {
    const t = now();
    for (const job of store.jobs()) {
      if (running.has(job.id) || !isDue(job, t)) continue;
      await run(job.id, { reason: job.lastRun && t - job.lastRun > tickMs * 4 ? 'kaçırılan' : 'zaman' }).catch((err) => log.error?.(`[iş] ${err?.message || err}`));
    }
  }

  const first = setTimeout(() => { tick(); }, Math.min(5000, tickMs));
  const timer = setInterval(() => { tick(); }, tickMs);
  first.unref?.();
  timer.unref?.();
  return {
    run,
    tick,
    isRunning: (id) => running.has(id),
    stop: () => { clearTimeout(first); clearInterval(timer); },
  };
}
