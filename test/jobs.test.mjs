// Zamanlanmış işler: doğrulama, zaman hesabı ve çalıştırma (sahte oturum yöneticisiyle)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanJob, loadJob, latestSlot, nextRun, isDue, createScheduler } from '../src/jobs.js';

const base = { name: 'Sabah raporu', engine: 'claude', prompt: 'Dünkü hataları özetle', cwd: 'C:/proje', days: [1, 2, 3, 4, 5], times: ['09:00', '14:30'], work: 'ask' };
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
// 2026-11-23 Pazartesi, 2026-11-28 Cumartesi

test('iş doğrulanır: eksik alan hata verir, saatler sıralanır, geçersiz değerler atılır', () => {
  for (const [field, value] of [['name', ''], ['engine', 'gpt'], ['prompt', ' '], ['cwd', ''], ['days', [9]], ['times', ['25:00', 'x']]]) {
    assert.throws(() => cleanJob({ ...base, [field]: value }), (e) => e.code === field, field);
  }
  assert.throws(() => cleanJob({ ...base, engine: 'yerel' }), (e) => e.code === 'local');
  const j = cleanJob({ ...base, times: ['14:30', '09:00', '09:00'], links: ['jira', 'JIRA!', 'jira'], work: 'herşey' });
  assert.deepEqual(j.times, ['09:00', '14:30']);
  assert.deepEqual(j.links, ['jira']);
  assert.equal(j.work, 'ask', 'bilinmeyen kip Ask sayılır');
  assert.equal(j.enabled, true);
  assert.equal(j.sessionId, null);
  assert.ok(j.id && j.since > 0);
});

test('düzenlemede oturum yalnızca motor ve klasör aynıysa korunur; zaman değişince "since" yenilenir', () => {
  const first = { ...cleanJob(base), sessionId: 'oturum-1', lastRun: 5, since: 1 };
  const same = cleanJob({ ...base, prompt: 'başka komut' }, first);
  assert.equal(same.id, first.id);
  assert.equal(same.sessionId, 'oturum-1');
  assert.equal(same.since, 1);
  assert.equal(same.lastRun, 5);
  assert.equal(cleanJob({ ...base, engine: 'copilot' }, first).sessionId, null);
  assert.equal(cleanJob({ ...base, cwd: 'C:/baska' }, first).sessionId, null);
  assert.ok(cleanJob({ ...base, times: ['10:00'] }, first).since > 1);
});

test('kayıttan yükleme: yarım kalan çalıştırma "interrupted" olur; bozuk kayıt atılır', () => {
  const j = loadJob({ ...cleanJob(base), sessionId: 'x', lastStatus: 'running' });
  assert.equal(j.lastStatus, 'interrupted');
  assert.equal(j.sessionId, 'x');
  assert.equal(loadJob({ name: 'eksik' }), null);
});

test('zaman hesabı: bugünkü son geçmiş saat, bir sonraki çalıştırma, çalışma günü olmayan gün', () => {
  const j = { ...cleanJob(base), since: 0 };
  assert.equal(latestSlot(j, at(2026, 11, 23, 8, 0)), 0, 'saat gelmedi');
  assert.equal(latestSlot(j, at(2026, 11, 23, 10, 0)), at(2026, 11, 23, 9, 0));
  assert.equal(latestSlot(j, at(2026, 11, 23, 15, 0)), at(2026, 11, 23, 14, 30));
  assert.equal(latestSlot(j, at(2026, 11, 28, 10, 0)), 0, 'cumartesi çalışma günü değil');
  assert.equal(nextRun(j, at(2026, 11, 23, 10, 0)), at(2026, 11, 23, 14, 30));
  assert.equal(nextRun(j, at(2026, 11, 27, 15, 0)), at(2026, 11, 30, 9, 0), 'cuma akşamından pazartesiye');
  assert.equal(nextRun({ ...j, enabled: false }, at(2026, 11, 23, 10, 0)), 0);
});

test('çalışma zamanı: son saatten sonra çalışmadıysa gelmiştir; kurulmadan önceki saatler sayılmaz', () => {
  const j = { ...cleanJob(base), since: 0, lastRun: 0 };
  const now = at(2026, 11, 23, 9, 5);
  assert.equal(isDue(j, now), true);
  assert.equal(isDue({ ...j, lastRun: at(2026, 11, 23, 9, 0) }, now), false, 'o saat için çalıştı');
  assert.equal(isDue({ ...j, since: at(2026, 11, 23, 9, 2) }, now), false, 'iş 9:02\'de kuruldu');
  assert.equal(isDue({ ...j, enabled: false }, now), false);
  // Atölye sabah kapalıydı, 11:00'de açıldı: 9:00 kaçırıldı, bir kez çalışır
  assert.equal(isDue({ ...j, lastRun: at(2026, 11, 20, 14, 30) }, at(2026, 11, 23, 11, 0)), true);
});

// ---------- Çalıştırma ----------
function fakeStore(jobs) {
  let list = jobs.map((j) => ({ ...j }));
  return { jobs: () => list.map((j) => ({ ...j })), setJob: (j) => { list = list.map((x) => (x.id === j.id ? { ...j } : x)); } };
}
function fakeManager() {
  const m = { opened: [], sent: [], answers: [], entries: [] };
  m.find = ({ sessionId }) => m.entries.find((e) => e.agent.sessionId === sessionId && sessionId) || null;
  m.open = async (opts) => {
    m.opened.push(opts);
    const entry = { subs: new Set(), agent: { sessionId: opts.sessionId || null, busy: false, answer: (id, d) => m.answers.push({ id, ...d }) } };
    m.entries.push(entry);
    return entry;
  };
  m.subscribe = (entry, fn) => { entry.subs.add(fn); return () => entry.subs.delete(fn); };
  m.send = (entry, text, images, lang, files, work, handoff, note) => m.sent.push({ entry, text, work, note });
  m.emit = (entry, ev) => { for (const fn of entry.subs) fn(ev); };
  return m;
}
const quiet = { log() {}, warn() {}, error() {} };

test('çalıştırma: oturum açılır, izinler onaylanır, soru reddedilir, oturum kimliği işe yazılır; sonraki çalıştırma aynı oturuma gider', async () => {
  const job = { ...cleanJob({ ...base, links: ['jira'], linkHint: '(Jira bağlantısını kullan)' }), since: 0 };
  const store = fakeStore([job]);
  const m = fakeManager();
  const s = createScheduler({ manager: m, store, tickMs: 60_000, log: quiet });
  try {
    assert.deepEqual(await s.run(job.id), { ok: true });
    assert.equal(m.opened[0].engine, 'claude');
    assert.equal(m.opened[0].work, 'ask');
    assert.equal(m.opened[0].sessionId, null);
    assert.match(m.sent[0].text, /Dünkü hataları özetle\n\n\(Jira bağlantısını kullan\)/);
    assert.match(m.sent[0].note, /scheduled job "Sabah raporu"/);
    assert.equal(store.jobs()[0].lastStatus, 'running');
    assert.equal(s.isRunning(job.id), true);
    const e = m.entries[0];
    m.emit(e, { type: 'sdk', msg: { type: 'system', subtype: 'init', session_id: 'oturum-9' } });
    m.emit(e, { type: 'permission', id: 'p1', toolName: 'Bash' });
    m.emit(e, { type: 'question', id: 'q1' });
    assert.deepEqual(m.answers.map((a) => [a.id, a.behavior]), [['p1', 'allow'], ['q1', 'deny']]);
    assert.equal(store.jobs()[0].sessionId, 'oturum-9');
    e.agent.sessionId = 'oturum-9';
    m.emit(e, { type: 'sdk', msg: { type: 'result', is_error: false } });
    assert.equal(store.jobs()[0].lastStatus, 'ok');
    assert.equal(s.isRunning(job.id), false);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(e.subs.size, 0, 'bitince abonelik bırakılır (oturum boşta kapanabilir)');

    // Oturum hâlâ açıksa o kullanılır; kapandıysa aynı kimlikle yeniden açılır
    assert.deepEqual(await s.run(job.id), { ok: true });
    assert.equal(m.opened.length, 1, 'açık oturum yeniden kullanıldı');
    m.emit(e, { type: 'sdk', msg: { type: 'result', is_error: true, result: 'API hatası' } });
    assert.equal(store.jobs()[0].lastStatus, 'error');
    assert.equal(store.jobs()[0].lastError, 'API hatası');
    m.entries.length = 0;
    await s.run(job.id);
    assert.equal(m.opened[1].sessionId, 'oturum-9');
  } finally {
    s.stop();
  }
});

test('çalıştırma: motor kullanılamıyorsa hata yazılır; oturum meşgulse atlanır; aynı iş üst üste başlamaz', async () => {
  const job = { ...cleanJob(base), since: 0 };
  const store = fakeStore([job]);
  const m = fakeManager();
  let problem = 'Claude Code\'a giriş yapılmamış.';
  const s = createScheduler({ manager: m, store, canRun: async () => problem, tickMs: 60_000, log: quiet });
  try {
    assert.equal((await s.run(job.id)).ok, false);
    assert.equal(store.jobs()[0].lastStatus, 'error');
    assert.match(store.jobs()[0].lastError, /giriş/);
    assert.equal(m.opened.length, 0);
    problem = null;
    m.open = async (opts) => { m.opened.push(opts); const entry = { subs: new Set(), agent: { busy: true, answer() {} } }; return entry; };
    assert.deepEqual(await s.run(job.id), { ok: false, error: 'busy' });
    assert.equal(store.jobs()[0].lastStatus, 'skipped');
    m.open = async (opts) => { m.opened.push(opts); return { subs: new Set(), agent: { busy: false, answer() {} } }; };
    assert.equal((await s.run(job.id)).ok, true);
    assert.deepEqual(await s.run(job.id), { ok: false, error: 'running' });
  } finally {
    s.stop();
  }
});

test('zamanlayıcı: zamanı gelen etkin işler çalışır, gelmeyenler ve kapalılar çalışmaz', async () => {
  const now = at(2026, 11, 23, 9, 1);
  const due = { ...cleanJob(base), since: 0 };
  const later = { ...cleanJob({ ...base, times: ['18:00'] }), since: 0 };
  const off = { ...cleanJob(base), since: 0, enabled: false };
  const store = fakeStore([due, later, off]);
  const m = fakeManager();
  const s = createScheduler({ manager: m, store, now: () => now, tickMs: 60_000, log: quiet });
  try {
    await s.tick();
    assert.equal(m.sent.length, 1);
    assert.equal(store.jobs().find((j) => j.id === due.id).lastRun, now);
    await s.tick();
    assert.equal(m.sent.length, 1, 'çalışan iş tekrar başlatılmaz');
  } finally {
    s.stop();
  }
});
