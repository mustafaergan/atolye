import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Sahte SDK: her kullanıcı mesajına, `release()` çağrılana kadar bekleyip cevap verir
let release;
const closed = [];
mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    getSessionMessages: async () => [],
    query: ({ prompt }) => {
      const it = prompt[Symbol.asyncIterator]();
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: 'S1', permissionMode: 'default' };
          while (true) {
            const { done } = await it.next();
            if (done) return;
            yield { type: 'assistant', parent_tool_use_id: null, message: { id: 'a1', content: [{ type: 'text', text: 'ilk parça' }] } };
            await new Promise((r) => (release = r));
            yield { type: 'assistant', parent_tool_use_id: null, message: { id: 'a2', content: [{ type: 'text', text: 'ayrıldıktan sonra' }] } };
            yield { type: 'result', subtype: 'success', is_error: false, duration_ms: 1 };
          }
        },
        supportedModels: async () => [],
        supportedCommands: async () => [],
        close: () => closed.push('S1'),
      };
    },
  },
});
const { SessionManager } = await import('../src/manager.js');
const tick = () => new Promise((r) => setTimeout(r, 10));

test('başka oturuma geçmek ya da sayfayı yenilemek işi durdurmaz', async () => {
  const m = new SessionManager();
  const entry = await m.open({ cwd: '.', mode: 'default' });
  const seen1 = [];
  const unsub = m.subscribe(entry, (e) => seen1.push(e), []);
  assert.equal(seen1[0].type, 'opened');

  m.send(entry, 'merhaba', []);
  await tick();
  assert.ok(entry.agent.busy);
  assert.equal(m.list().length, 1);
  assert.equal(m.list()[0].busy, true);

  // Tarayıcı ayrılır (başka oturuma geçti / sayfayı yeniledi)
  unsub();
  assert.ok(m.entries.has(entry.liveId), 'çalışan oturum kapanmamalı');

  // Ayrıyken iş devam eder
  release();
  await tick();

  // Geri dönünce kaçırılan her şey anlık görüntüde gelir
  const seen2 = [];
  const again = m.find({ sessionId: 'S1' });
  assert.equal(again, entry);
  const unsub2 = m.subscribe(again, (e) => seen2.push(e), []);
  const opened = seen2[0];
  const types = opened.events.map((e) => e.type === 'sdk' ? `sdk:${e.msg.type}` : e.type);
  assert.ok(types.includes('user_prompt'));
  const texts = opened.events.filter((e) => e.type === 'sdk' && e.msg.type === 'assistant').map((e) => e.msg.message.content[0].text);
  assert.deepEqual(texts, ['ilk parça', 'ayrıldıktan sonra']);
  assert.equal(opened.busy, false);
  assert.equal(opened.title, 'merhaba');

  // İş bitmiş ve kimse bakmıyorsa kısa süre sonra bellekten silinir
  unsub2();
  assert.ok(m.entries.has(entry.liveId), 'hemen değil, bekleme süresinden sonra kapanır');
  clearTimeout(entry.idleTimer);
  m.close(entry);
  assert.equal(m.entries.size, 0);
  assert.equal(m.list().length, 0);
});

test('hiç mesaj gönderilmemiş boş oturum, ayrılınca hemen kapanır', async () => {
  const m = new SessionManager();
  const entry = await m.open({ cwd: '.', mode: 'default' });
  const unsub = m.subscribe(entry, () => {}, []);
  assert.equal(m.list().length, 0, 'boş oturum listede görünmez');
  unsub();
  assert.equal(m.entries.size, 0);
});
