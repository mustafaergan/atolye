import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Sahte SDK: dışarıdan `push` ile mesaj verilen bir akış. İlk kullanıcı mesajında bir komutu ve bir alt ajanı arka plana
// atar, turu bitirir; arka plandaki işlemler sürer. stopTask/interrupt çağrıları kaydedilir.
const calls = [];
let push;
mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    getSessionMessages: async () => [],
    query: ({ prompt }) => {
      const queue = [];
      let wake = null;
      push = (m) => { queue.push(m); wake?.(); };
      const tasks = [
        { task_id: 'b1', task_type: 'local_bash', description: 'npm run dev' },
        { task_id: 'a1', task_type: 'local_agent', subagent_type: 'general-purpose', description: 'Testleri incele' },
        { task_id: 'w1', task_type: 'monitor', description: 'izleyici', ambient: true },
      ];
      (async () => {
        const it = prompt[Symbol.asyncIterator]();
        const { done } = await it.next();
        if (done) return;
        push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'arka planda başlattım' }] } });
        push({ type: 'system', subtype: 'background_tasks_changed', tasks });
        push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
      })();
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: 'S-arka', permissionMode: 'default' };
          while (true) {
            if (!queue.length) await new Promise((r) => (wake = r));
            wake = null;
            const m = queue.shift();
            if (m === 'END') return;
            yield m;
          }
        },
        stopTask: async (id) => {
          calls.push(`stop:${id}`);
          const i = tasks.findIndex((t) => t.task_id === id);
          if (i >= 0) tasks.splice(i, 1);
          push({ type: 'system', subtype: 'background_tasks_changed', tasks: tasks.slice() });
        },
        interrupt: async () => { calls.push('interrupt'); },
        supportedModels: async () => [],
        supportedCommands: async () => [],
        close: () => {},
      };
    },
  },
});
const { SessionManager } = await import('../src/manager.js');
const { backgroundTasks } = await import('../src/session.js');
const tick = () => new Promise((r) => setTimeout(r, 15));

test('arka plandaki işlemler: listede görünür, oturumu açık tutar, tek tek ya da toptan durdurulur', async () => {
  const m = new SessionManager();
  const entry = await m.open({ cwd: '.', mode: 'default' });
  const seen = [];
  const unsub = m.subscribe(entry, (e) => seen.push(e), []);
  m.send(entry, 'sunucuyu başlat', []);
  await tick();

  // Tur bitti ama iki işlem arka planda sürüyor (etkinlik sayılmayan izleyici gösterilmez)
  assert.equal(entry.agent.busy, false);
  assert.deepEqual(entry.agent.tasks.map((t) => t.id), ['b1', 'a1']);
  assert.equal(entry.agent.tasks[1].agent, 'general-purpose');
  const ev = seen.filter((e) => e.type === 'tasks').at(-1);
  assert.equal(ev.tasks.length, 2);
  assert.equal(m.list()[0].tasks, 2, 'kenar çubuğu listesinde sayı görünür');
  assert.ok(!entry.buffer.some((e) => e.type === 'tasks'), 'olay tamponuna yazılmaz');

  // Ekrandan ayrılınca oturum kapanmaz (kapanırsa işlemler sessizce ölür)
  unsub();
  assert.ok(!entry.idleTimer, 'kapanma zamanlayıcısı kurulmaz');
  assert.ok(m.entries.has(entry.liveId));

  // Geri dönünce anlık görüntüde güncel liste gelir
  const back = [];
  const unsub2 = m.subscribe(entry, (e) => back.push(e), []);
  assert.deepEqual(back[0].tasks.map((t) => t.id), ['b1', 'a1']);

  // Tek işlem durdurulur
  await entry.agent.stopTask('b1');
  await tick();
  assert.deepEqual(entry.agent.tasks.map((t) => t.id), ['a1']);

  // Oturumdaki her şey: tur + kalan işlemler
  await m.stop(entry);
  await tick();
  assert.deepEqual(calls, ['stop:b1', 'interrupt', 'stop:a1']);
  assert.equal(entry.agent.tasks.length, 0);
  assert.equal(m.list()[0].tasks, 0);

  // Claude Code turu kendisi başlatırsa (ör. arka plandaki işlem bitince) çalışıyor görünür ve durdurulabilir
  push({ type: 'system', subtype: 'session_state_changed', state: 'running' });
  await tick();
  assert.equal(entry.agent.busy, true);
  assert.equal(m.list()[0].busy, true);
  push({ type: 'system', subtype: 'session_state_changed', state: 'idle' });
  await tick();
  assert.equal(entry.agent.busy, false);

  unsub2();
  clearTimeout(entry.idleTimer);
  m.close(entry);
});

test('backgroundTasks: geçersiz girdi ve uzun açıklama', () => {
  assert.deepEqual(backgroundTasks(null), []);
  assert.deepEqual(backgroundTasks([{ description: 'kimliksiz' }]), []);
  const [t] = backgroundTasks([{ task_id: 7, task_type: 'local_bash', description: 'x'.repeat(500) }]);
  assert.equal(t.id, '7');
  assert.equal(t.description.length, 200);
  assert.ok(t.description.endsWith('…'));
  assert.equal(t.agent, undefined);
});
