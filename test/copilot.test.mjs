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
