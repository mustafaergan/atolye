// GitHub Copilot motoru: resmî ACP kütüphanesiyle yazılmış sahte bir "copilot --acp" ajanına
// (test/fixtures/fake-copilot.mjs) karşı gerçek bir alt süreçle çalışır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.COPILOT_CLI_PATH = fileURLToPath(new URL('./fixtures/fake-copilot.mjs', import.meta.url));
const { CopilotSession, detectCopilot, toolForUi } = await import('../src/copilot.js');
const { SessionManager } = await import('../src/manager.js');
const { StateStore } = await import('../src/store.js');

const cwd = process.cwd();
const until = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 25));
  }
};
const sdk = (events, type) => events.filter((e) => e.type === 'sdk' && e.msg.type === type).map((e) => e.msg);
const toolUses = (events) => sdk(events, 'assistant').flatMap((m) => m.message.content).filter((c) => c.type === 'tool_use');
const toolResults = (events) => sdk(events, 'user').flatMap((m) => m.message.content).filter((c) => c.type === 'tool_result');

function run(answerFn) {
  const events = [];
  const s = new CopilotSession({ cwd, emit: (e) => {
    events.push(e);
    if (e.type === 'permission') setTimeout(() => s.answer(e.id, answerFn(e)), 5);
  } });
  s.start();
  return { s, events };
}

test('Copilot CLI algılanır', async () => {
  assert.deepEqual(await detectCopilot({ force: true }), { available: true, version: '1.0.0-sahte' });
});

test("Copilot'un akışı arayüzün tanıdığı mesajlara çevrilir", async () => {
  const { s, events } = run(() => ({ behavior: 'allow' }));
  s.send('testleri çalıştır');
  await until(() => sdk(events, 'result').length);

  const init = sdk(events, 'system').find((m) => m.subtype === 'init');
  assert.match(init.session_id, /^sahte-/);
  // Akan metin: parçalar birleşip tam mesaj olur, düşünce ayrı blok
  const texts = sdk(events, 'assistant').flatMap((m) => m.message.content).filter((c) => c.type === 'text').map((c) => c.text);
  assert.deepEqual(texts, ['Testleri çalıştırıyorum.', '\n\nBitti: port **3000** oldu.']);
  assert.ok(sdk(events, 'assistant').some((m) => m.message.content[0].type === 'thinking'));
  // Araç kartları: komut, diff'li düzenleme, plan
  const tools = toolUses(events);
  assert.deepEqual(tools.map((t) => t.name), ['Bash', 'Edit', 'TodoWrite']);
  assert.equal(tools[0].input.command, 'npm test');
  assert.equal(tools[1].input.old_string, 'const port = 300;');
  assert.equal(tools[1].input.new_string, 'const port = 3000;');
  assert.deepEqual(tools[2].input.todos.map((t) => t.status), ['completed', 'in_progress']);
  // İzin kartları ve sonuçlar
  assert.deepEqual(events.filter((e) => e.type === 'permission').map((e) => [e.toolName, e.alwaysGroup]), [['Bash', 'shell'], ['Edit', 'edits']]);
  assert.equal(toolResults(events).find((r) => r.tool_use_id === 'c1').content, '12 test geçti');
  assert.equal(sdk(events, 'result')[0].subtype, 'success');
  assert.ok(events.some((e) => e.type === 'session_title' && e.title === 'Port düzeltmesi'));
  assert.ok(events.some((e) => e.type === 'capabilities' && e.commands.some((c) => c.name === 'compact')));
  // Bağlam kullanımı (usage_update)
  const ctx = await s.contextUsage();
  assert.equal(Math.round(ctx.percentage), 21);
  // Copilot'un harcama olayı (nano AIU) krediye çevrilir, anında bildirilir ve tur sonucuna eklenir
  assert.deepEqual(events.find((e) => e.type === 'credits')?.credits, { amount: 1.5, unit: 'AIC' });
  assert.deepEqual(sdk(events, 'result')[0].copilot_credits, { amount: 1.5, unit: 'AIC' });
  s.close();
});

test('reddedilen izin araç kartında hata olarak görünür; "hep izin ver" grubu sonra sorulmaz', async () => {
  const { s, events } = run((e) => (e.toolName === 'Bash' ? { behavior: 'deny' } : { behavior: 'allow', always: true }));
  s.send('ilk tur');
  await until(() => sdk(events, 'result').length === 1);
  const r1 = toolResults(events).find((r) => r.tool_use_id === 'c1');
  assert.equal(r1.is_error, true);
  const asked = events.filter((e) => e.type === 'permission').length;
  // İkinci turda düzenleme izni artık sorulmaz (komut yine sorulur)
  s.send('ikinci tur');
  await until(() => sdk(events, 'result').length === 2);
  const asked2 = events.filter((e) => e.type === 'permission').slice(asked).map((e) => e.toolName);
  assert.deepEqual(asked2, ['Bash']);
  s.close();
});

test('durdurma çalışan turu iptal eder', async () => {
  const { s, events } = run(() => ({ behavior: 'allow' }));
  s.send('yavaş bir iş');
  await until(() => events.some((e) => e.type === 'sdk' && e.msg.type === 'stream_event'));
  await s.interrupt();
  await until(() => sdk(events, 'result').length);
  assert.equal(sdk(events, 'result')[0].terminal_reason, 'interrupted');
  assert.equal(s.busy, false);
  s.close();
});

test('oturum yöneticisi Copilot oturumunu açar, listeler ve kalıcı depoya kaydeder; eski oturum yüklenir', async () => {
  const store = new StateStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-cp-')), 'durum.json'));
  const m = new SessionManager({ store });
  const entry = await m.open({ cwd, mode: 'acceptEdits', engine: 'copilot' });
  assert.equal(entry.engine, 'copilot');
  const seen = [];
  const unsub = m.subscribe(entry, (e) => seen.push(e), []);
  assert.equal(seen[0].engine, 'copilot');
  // acceptEdits: düzenleme izni sorulmaz, komut sorulur
  m.send(entry, 'portu düzelt', []);
  await until(() => seen.some((e) => e.type === 'permission'));
  const perm = seen.find((e) => e.type === 'permission');
  assert.equal(perm.toolName, 'Bash');
  entry.agent.answer(perm.id, { behavior: 'allow' });
  await until(() => seen.some((e) => e.type === 'sdk' && e.msg.type === 'result'));
  assert.equal(seen.filter((e) => e.type === 'permission').length, 1);
  assert.equal(m.list()[0].engine, 'copilot');

  const saved = store.copilotSessionsFor(cwd);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, entry.agent.sessionId);
  assert.equal(saved[0].title, 'Port düzeltmesi');
  unsub();
  m.close(entry);

  // Kaydedilmiş oturuma geri dönüş: Copilot geçmişi yeniden gönderir
  const again = await m.open({ cwd, sessionId: 'sahte-eski', engine: 'copilot' });
  const replay = [];
  m.subscribe(again, (e) => replay.push(e), []);
  await until(() => replay.some((e) => e.type === 'sdk' && e.msg.type === 'system' && e.msg.subtype === 'init'));
  const opened = replay[0].events.concat(replay.slice(1));
  assert.ok(opened.some((e) => e.type === 'user_prompt' && e.text === 'önceki soru'));
  assert.ok(opened.some((e) => e.type === 'sdk' && e.msg.type === 'assistant' && e.msg.message.content[0].text === 'önceki cevap'));
  m.close(again);
});

test('araç eşleme: yeni dosya yazma ve bilinmeyen araç türü', () => {
  assert.deepEqual(toolForUi({ kind: 'edit', title: 'x', content: [{ type: 'diff', path: '/a.txt', newText: 'merhaba' }] }),
    { name: 'Write', input: { file_path: '/a.txt', content: 'merhaba' } });
  assert.deepEqual(toolForUi({ kind: 'other', title: 'MCP aracı', rawInput: { a: 1 } }), { name: 'MCP aracı', input: { a: 1 } });
});

test("model listesi Copilot'un kendisinden gelir; seçilen model oturuma uygulanır", async () => {
  const { s, events } = run(() => ({ behavior: 'allow' }));
  await until(() => events.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  const caps = events.filter((e) => e.type === 'capabilities').at(-1);
  assert.deepEqual(caps.models.map((m) => m.value), ['sahte-hizli', 'sahte-guclu']);
  assert.deepEqual(caps.models.map((m) => m.name), ['Sahte Hızlı · 0.33x', 'Sahte Güçlü'], 'kredi çarpanı model adında görünür');
  assert.equal(s.model, 'sahte-hizli');
  await s.setModel('sahte-guclu');
  assert.equal(s.model, 'sahte-guclu');
  assert.ok(events.some((e) => e.type === 'model' && e.model === 'sahte-guclu'));
  // Claude modeli gibi listede olmayan bir değer Copilot'a gönderilmez
  await s.setModel('claude-opus');
  assert.equal(s.model, 'sahte-guclu');
  s.close();

  // Daha önce seçilen model yeni oturumda da kullanılır
  const events2 = [];
  const s2 = new CopilotSession({ cwd, model: 'sahte-guclu', emit: (e) => events2.push(e) });
  s2.start();
  await until(() => events2.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  assert.equal(s2.model, 'sahte-guclu');
  assert.equal(sdk(events2, 'system').find((m) => m.subtype === 'init').model, 'Sahte Güçlü');
  s2.close();
});

test('yerel kopya: Copilot geçmişi yeniden göndermese de konuşma görünür; çift mesaj olmaz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-tr-'));
  process.env.ATOLYE_STATE_FILE = path.join(dir, 'durum.json');
  const transcript = await import('../src/transcript.js');
  const m = new SessionManager({ store: new StateStore(process.env.ATOLYE_STATE_FILE) });
  const entry = await m.open({ cwd, mode: 'bypassPermissions', engine: 'copilot' });
  const seen = [];
  const unsub = m.subscribe(entry, (e) => seen.push(e), []);
  m.send(entry, 'portu düzelt', []);
  await until(() => seen.some((e) => e.type === 'sdk' && e.msg.type === 'result'));
  const id = entry.agent.sessionId;
  unsub();
  m.close(entry);

  const saved = transcript.read(id);
  assert.equal(saved[0].type, 'user_prompt');
  assert.equal(saved[0].text, 'portu düzelt');
  assert.ok(saved.some((e) => e.type === 'sdk' && e.msg.type === 'assistant'));
  assert.ok(!saved.some((e) => e.type === 'sdk' && e.msg.type === 'stream_event'), 'akış parçaları saklanmaz');

  // Yeniden açılış: geçmiş anında (Copilot hazır olmadan) görünür ve yükleme sırasında tekrar eklenmez
  const again = await m.open({ cwd, sessionId: id, engine: 'copilot' });
  const first = [];
  m.subscribe(again, (e) => first.push(e), []);
  assert.equal(first[0].ready, false);
  assert.equal(first[0].events.filter((e) => e.type === 'user_prompt').length, 1);
  await until(() => first.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  assert.equal(first.slice(1).filter((e) => e.type === 'user_prompt').length, 0, 'eski mesajlar ikinci kez gelmez');
  assert.equal(transcript.read(id).length, saved.length, 'yerel kopya büyümez');
  m.close(again);
  transcript.remove(id);
  assert.deepEqual(transcript.read(id), []);
  delete process.env.ATOLYE_STATE_FILE;
});

test('COPILOT_EXTRA_ARGS yalnızca basit seçenekleri kabul eder', async () => {
  const { extraArgs } = await import('../src/copilot.js');
  assert.deepEqual(extraArgs({ COPILOT_EXTRA_ARGS: ' --disable-builtin-mcps  --model=auto ' }), ['--disable-builtin-mcps', '--model=auto']);
  assert.deepEqual(extraArgs({ COPILOT_EXTRA_ARGS: '--x & calc.exe "a b" | del' }), ['--x', 'calc.exe', 'del']);
  assert.deepEqual(extraArgs({}), []);
});

test('yüklenemeyen (bulunamayan) oturum hata vermez; yeni oturum açılır', async () => {
  const events = [];
  const s = new CopilotSession({ cwd, resume: 'yok-123', emit: (e) => events.push(e) });
  s.start();
  await until(() => events.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
  assert.match(s.sessionId, /^sahte-/);
  assert.equal(events.filter((e) => e.type === 'sdk' && e.msg.subtype === 'local_command_output').length, 0, 'boş oturumda not gösterilmez');
  s.close();

  // Yerel kopyada konuşma varsa kullanıcıya haber verilir
  const events2 = [];
  const s2 = new CopilotSession({ cwd, resume: 'yok-456', skipReplay: true, emit: (e) => events2.push(e) });
  s2.start();
  await until(() => events2.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  assert.ok(events2.some((e) => e.type === 'sdk' && e.msg.subtype === 'local_command_output' && /artık bulamıyor/.test(e.msg.content)));
  s2.close();
});

test('düşünme seviyesi Copilot\'un sunduğu seçeneklerden gelir ve değiştirilebilir', async () => {
  const { s, events } = run(() => ({ behavior: 'allow' }));
  await until(() => events.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  const caps = events.filter((e) => e.type === 'capabilities').at(-1);
  assert.deepEqual(caps.effort, { current: 'medium', hasDefault: false, options: [{ value: 'low', name: 'Low', description: '' }, { value: 'medium', name: 'Medium', description: '' }, { value: 'high', name: 'High', description: '' }] });
  assert.equal(caps.models.length, 2, 'model listesi korunur');
  await s.setEffort('high');
  assert.ok(events.some((e) => e.type === 'effort' && e.effort === 'high'));
  assert.equal(events.filter((e) => e.type === 'capabilities').at(-1).effort.current, 'high');
  await s.setEffort('uydurma'); // listede olmayan değer gönderilmez
  assert.equal(events.filter((e) => e.type === 'capabilities').at(-1).effort.current, 'high');
  s.close();

  // Önceki seçim yeni oturuma uygulanır
  const events2 = [];
  const s2 = new CopilotSession({ cwd, effort: 'low', emit: (e) => events2.push(e) });
  s2.start();
  await until(() => events2.some((e) => e.type === 'sdk' && e.msg.subtype === 'init'));
  assert.equal(events2.filter((e) => e.type === 'capabilities').at(-1).effort.current, 'low');
  s2.close();
});
