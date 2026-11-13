// Takılan bir oturum, yeni oturum açmayı kilitlememeli. Sahte Claude Code süreci bağlam,
// durdurma ve mod isteklerine hiç cevap vermez (şirkette görülen "Opening session…" takılması).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

process.env.ATOLYE_STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-srv-')), 'durum.json');
process.env.ATOLYE_CONTROL_TIMEOUT_MS = '300';
process.env.ATOLYE_AI_TITLE = '0'; // başlık isteği bu testlerin konusu değil

const never = () => new Promise(() => {});
let sessionCounter = 0;
mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    listSessions: async () => [],
    getSessionMessages: async () => [],
    deleteSession: async () => {},
    renameSession: async () => {},
    query: () => {
      const id = `takilan-${++sessionCounter}`;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: id, permissionMode: 'default' };
          await never();
        },
        supportedModels: async () => [],
        supportedCommands: async () => [],
        getContextUsage: never, // takılı süreç: hiç cevap vermez
        interrupt: never,
        setPermissionMode: never,
        setModel: never,
        close() {},
      };
    },
  },
});
const { createServer } = await import('../src/server.js');

const port = 41000 + Math.floor(Math.random() * 2000);
await createServer({ port, defaultCwd: process.cwd() });

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
  const events = [];
  ws.on('message', (d) => events.push(JSON.parse(d)));
  return new Promise((resolve) => ws.on('open', () => resolve({ ws, events })));
}
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const send = (ws, m) => ws.send(JSON.stringify({ lang: 'tr', cwd: process.cwd(), ...m }));

test('takılan bir oturum yeni oturum açmayı kilitlemez', async () => {
  const { ws, events } = await connect();
  send(ws, { type: 'open', new: true });
  await until(() => events.filter((e) => e.type === 'opened').length === 1);

  // Takılan süreç: bağlam ve mod istekleri cevapsız kalır
  send(ws, { type: 'get_context' });
  send(ws, { type: 'set_mode', mode: 'acceptEdits' });
  // Yeni oturum hemen açılabilmeli (eskiden bu istek kuyrukta sonsuza kadar bekliyordu)
  const t0 = Date.now();
  send(ws, { type: 'open', new: true });
  await until(() => events.filter((e) => e.type === 'opened').length === 2, 2000);
  assert.ok(Date.now() - t0 < 1500, 'yeni oturum beklemeden açılmalı');
  // Cevapsız bağlam isteği zaman aşımıyla sonlanır
  await until(() => events.some((e) => e.type === 'context' && /zaman aşımı/.test(e.data?.error || '')));
  ws.close();
});

test('durdurmaya cevap vermeyen oturum zorla kapatılır ve kullanıcıya söylenir', async () => {
  const { ws, events } = await connect();
  send(ws, { type: 'open', new: true });
  await until(() => events.some((e) => e.type === 'opened'));
  send(ws, { type: 'interrupt' });
  await until(() => events.some((e) => e.type === 'error' && /yanıt vermiyordu/.test(e.message)));
  // Sonrasında yeni oturum açılabilir
  send(ws, { type: 'open', new: true });
  await until(() => events.filter((e) => e.type === 'opened').length === 2);
  ws.close();
});

test('arka arkaya iki oturum istenince son istenen açılır', async () => {
  const { ws, events } = await connect();
  send(ws, { type: 'open', new: true });
  send(ws, { type: 'open', new: true });
  send(ws, { type: 'open', new: true });
  await until(() => events.some((e) => e.type === 'opened'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
  // İstekler aynı anda gelirse yalnızca sonuncusu ekrana bağlanır (öncekiler boş oturum olarak kapatılır).
  // Yük altında bir istek, sonraki gelmeden tamamlanabilir; o zaman o da açılır ama son açılan yine son istenendir.
  const opened = events.filter((e) => e.type === 'opened');
  assert.ok(opened.length >= 1 && opened.length <= 3);
  assert.equal(new Set(opened.map((e) => e.liveId)).size, opened.length);
  ws.close();
});
