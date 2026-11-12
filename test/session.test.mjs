// Claude oturumu: süren oturumda model değişimi gateway'de doğrulanamazsa (şirkette görülen "Network error")
// oturum aynı konuşmayla, yeni modelle yeniden başlatılır; meşgulken ise önceki model korunur.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.ATOLYE_MODEL_RETRY_MS = '20';
const started = []; // her query() çağrısının seçenekleri
let setModelError = null; // null: başarılı
let setModelCalls = 0;
const closed = [];
mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    query: ({ prompt, options }) => {
      const n = started.push(options);
      const it = prompt[Symbol.asyncIterator]();
      let stop;
      const stopped = new Promise((r) => (stop = r));
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: 'S1', permissionMode: 'default', model: options.model || 'varsayilan' };
          while (true) {
            const next = await Promise.race([it.next(), stopped.then(() => ({ done: true }))]);
            if (next.done) return;
            yield { type: 'assistant', parent_tool_use_id: null, message: { id: `a${n}`, content: [{ type: 'text', text: `cevap (süreç ${n}, model ${options.model || 'varsayilan'})` }] } };
            yield { type: 'result', subtype: 'success', is_error: false, duration_ms: 1 };
          }
        },
        supportedModels: async () => [{ value: 'model-a', displayName: 'Model A', description: '', supportedEffortLevels: ['low', 'high'] }, { value: 'model-b', displayName: 'Model B', description: '', supportsEffort: false }],
        supportedCommands: async () => [],
        setModel: async () => { setModelCalls++; if (setModelError) throw new Error(setModelError); },
        applyFlagSettings: async () => {},
        close: () => { closed.push(n); stop(); },
      };
    },
  },
});
const { AgentSession, ROLE_PROMPTS } = await import('../src/session.js');
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const texts = (events) => events.filter((e) => e.type === 'sdk' && e.msg.type === 'assistant').map((e) => e.msg.message.content[0].text);

test('model değişimi doğrulanamazsa oturum yeni modelle yeniden başlatılır; konuşma ve oturum sürer', async () => {
  const events = [];
  const s = new AgentSession({ cwd: '.', model: 'model-a', emit: (e) => events.push(e) });
  s.start();
  await until(() => s.sessionId === 'S1');
  s.send('ilk soru');
  await until(() => texts(events).length === 1);
  assert.equal(texts(events)[0], 'cevap (süreç 1, model model-a)');

  setModelError = 'Network error. Please check your internet connection.';
  setModelCalls = 0;
  await s.setModel('model-b'); // hata fırlatmaz
  assert.equal(setModelCalls, 2, 'önce bir kez daha denenir');
  assert.equal(started.length, 2, 'süreç yeniden başlatıldı');
  assert.equal(started[1].model, 'model-b');
  assert.equal(started[1].resume, 'S1', 'aynı konuşma sürdürülür');
  assert.deepEqual(closed, [1], 'eski süreç kapatıldı');
  assert.equal(events.filter((e) => e.type === 'error' || e.type === 'session_ended').length, 0, 'oturum sonlanmaz, hata gösterilmez');
  assert.equal(events.filter((e) => e.type === 'model').at(-1).model, 'model-b');
  assert.equal(s.closed, false);

  // Yeni süreç mesajları almaya devam eder
  s.send('ikinci soru');
  await until(() => texts(events).length === 2);
  assert.equal(texts(events)[1], 'cevap (süreç 2, model model-b)');
  // Düşünme seviyeleri yeni modele göre güncellenir (model-b seviye desteklemiyor)
  await until(() => events.filter((e) => e.type === 'capabilities').at(-1)?.effort.options.length === 0);
  s.close();
});

test('model geçersizse önceki model korunur ve anlaşılır hata verilir; başarılı değişimde yeniden başlatma olmaz', async () => {
  started.length = 0;
  const events = [];
  const s = new AgentSession({ cwd: '.', model: 'model-a', emit: (e) => events.push(e) });
  s.start();
  await until(() => s.sessionId === 'S1');

  setModelError = null;
  await s.setModel('model-b');
  assert.equal(started.length, 1, 'başarılı değişimde süreç yeniden başlatılmaz');
  assert.equal(s.model, 'model-b');

  setModelError = "Model 'yok' not found";
  await assert.rejects(s.setModel('yok'), /bu bağlantıda kullanılamıyor/);
  assert.equal(s.model, 'model-b', 'önceki model korunur');
  assert.equal(events.filter((e) => e.type === 'model').at(-1).model, 'model-b', 'arayüzdeki seçim geri alınır');
  assert.equal(started.length, 1);
  s.close();
});

test('kullanım rolü Claude\'un sistem yönergesine eklenir', () => {
  started.length = 0;
  const analist = new AgentSession({ cwd: '.', role: 'analist', emit: () => {} });
  analist.start();
  assert.equal(started[0].systemPrompt.append, ROLE_PROMPTS.analist);
  assert.match(started[0].systemPrompt.append, /business analyst/);
  const dev = new AgentSession({ cwd: '.', role: 'gelistirici', general: true, emit: () => {} });
  dev.start();
  assert.match(started[1].systemPrompt.append, /software developer/);
  assert.ok(started[1].systemPrompt.append.length > ROLE_PROMPTS.gelistirici.length, 'klasörsüz sohbet yönergesiyle birleşir');
  const bilinmeyen = new AgentSession({ cwd: '.', role: 'uydurma', emit: () => {} });
  bilinmeyen.start();
  assert.equal(started[2].systemPrompt.append, undefined);
  analist.close(); dev.close(); bilinmeyen.close();
});
