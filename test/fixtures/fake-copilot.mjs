#!/usr/bin/env node
// Testler için sahte "copilot --acp --stdio": resmî ACP kütüphanesiyle yazılmış bir ajan.
// Gerçek Copilot CLI'ın gönderdiği türde mesajları gönderir; Atölye'nin ACP istemcisinin
// protokole uygun konuştuğunu resmî kütüphanenin doğrulamasından geçirerek sınar.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

if (process.argv.includes('--version')) {
  console.log('1.0.0-sahte');
  process.exit(0);
}

const sessions = new Map(); // sessionId -> { cwd, abort, history: [] }
let counter = 0;

const send = (cx, sessionId, update) => cx.notify(acp.methods.client.session.update, { sessionId, update });
const sleep = (ms, signal) => new Promise((r, j) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('aborted')); });
});

const MODELS = [
  { modelId: 'sahte-hizli', name: 'Sahte Hızlı', description: 'Hızlı model', _meta: { copilotUsage: '0.33x' } },
  { modelId: 'sahte-guclu', name: 'Sahte Güçlü', description: 'Güçlü model' },
];

const initResult = {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
    agentInfo: { name: 'sahte-copilot', version: '1.0.0' },
};
let usageEvents = false;

const effortOptions = (current) => [{ id: 'reasoning_effort', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: current,
  options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] }];

acp.agent({ name: 'sahte-copilot' })
  .onRequest('initialize', (ctx) => {
    // Gerçek Copilot gibi: harcama olayları yalnızca istemci abone olduysa gönderilir
    usageEvents = Boolean(ctx.params?.clientCapabilities?._meta?.['github.com/copilot']?.events?.includes('session.usage_checkpoint'));
    return initResult;
  })
  .onRequest('session/new', (ctx) => {
    const sessionId = `sahte-${++counter}-${Date.now()}`;
    sessions.set(sessionId, { cwd: ctx.params.cwd, history: [] });
    ctx.client.notify(acp.methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Konuşmayı özetle' }, { name: 'review', description: 'Kod incelemesi' }] },
    });
    sessions.get(sessionId).effort = 'medium';
    return { sessionId, models: { availableModels: MODELS, currentModelId: 'sahte-hizli' }, configOptions: effortOptions('medium') };
  })
  .onRequest('session/set_config_option', (ctx) => {
    if (ctx.params.configId !== 'reasoning_effort') throw new Error('bilinmeyen seçenek');
    sessions.get(ctx.params.sessionId).effort = ctx.params.value;
    return { configOptions: effortOptions(ctx.params.value) };
  })
  .onRequest('session/set_model', (params) => params, (ctx) => {
    if (!MODELS.some((m) => m.modelId === ctx.params.modelId)) throw new Error('bilinmeyen model');
    sessions.get(ctx.params.sessionId).model = ctx.params.modelId;
    return {};
  })
  .onRequest('session/load', async (ctx) => {
    const { sessionId, cwd } = ctx.params;
    if (sessionId.startsWith("yok-")) throw new acp.RequestError(-32002, `Resource not found: Session ${sessionId} not found`);
    const s = sessions.get(sessionId) || { cwd, history: [{ role: 'user', text: 'önceki soru' }, { role: 'agent', text: 'önceki cevap' }] };
    sessions.set(sessionId, s);
    for (const h of s.history) {
      await send(ctx.client, sessionId, { sessionUpdate: h.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: h.text } });
    }
    return {};
  })
  .onNotification('session/cancel', (ctx) => {
    sessions.get(ctx.params.sessionId)?.abort?.abort();
  })
  .onRequest('session/prompt', async (ctx) => {
    const { sessionId, prompt } = ctx.params;
    const s = sessions.get(sessionId);
    const abort = new AbortController();
    s.abort = abort;
    const text = prompt.filter((b) => b.type === 'text').map((b) => b.text).join('');
    s.history.push({ role: 'user', text });
    const cx = ctx.client;
    try {
      if (text.includes('yavaş')) {
        await send(cx, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Uzun bir iş başlıyor…' } });
        await sleep(30_000, abort.signal);
      }
      await send(cx, sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Önce dosyalara bakayım.' } });
      await send(cx, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Testleri ' } });
      await send(cx, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'çalıştırıyorum.' } });

      // İzin isteyen bir komut
      await send(cx, sessionId, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'npm test', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } });
      const p1 = await cx.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 'c1', title: 'npm test', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [
          { optionId: 'izin', name: 'Allow', kind: 'allow_once' },
          { optionId: 'hep', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'red', name: 'Reject', kind: 'reject_once' },
        ],
      });
      const allowed = p1.outcome.outcome === 'selected' && p1.outcome.optionId !== 'red';
      await send(cx, sessionId, allowed
        ? { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '12 test geçti' } }] }
        : { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'Kullanıcı reddetti' } }] });

      // Diff'li bir dosya düzenlemesi (izin isteğiyle)
      const edit = { toolCallId: 'e1', title: 'src/a.js düzenleniyor', kind: 'edit', locations: [{ path: `${s.cwd}/src/a.js` }], content: [{ type: 'diff', path: `${s.cwd}/src/a.js`, oldText: 'const port = 300;', newText: 'const port = 3000;' }] };
      await send(cx, sessionId, { sessionUpdate: 'tool_call', status: 'pending', ...edit });
      const p2 = await cx.request(acp.methods.client.session.requestPermission, {
        sessionId, toolCall: edit,
        options: [{ optionId: 'izin', name: 'Allow', kind: 'allow_once' }, { optionId: 'red', name: 'Reject', kind: 'reject_once' }],
      });
      const editOk = p2.outcome.outcome === 'selected' && p2.outcome.optionId === 'izin';
      await send(cx, sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: editOk ? 'completed' : 'failed' });

      await send(cx, sessionId, { sessionUpdate: 'plan', entries: [
        { content: 'Portu düzelt', priority: 'high', status: 'completed' },
        { content: 'Testleri çalıştır', priority: 'medium', status: 'in_progress' },
      ] });
      await send(cx, sessionId, { sessionUpdate: 'usage_update', used: 42000, size: 200000 });
      if (usageEvents) await cx.notify('github.com/copilot/sessionEvent', { sessionId, type: 'session.usage_checkpoint', data: { totalNanoAiu: 1500000000, totalPremiumRequests: 1 } });
      await send(cx, sessionId, { sessionUpdate: 'session_info_update', title: 'Port düzeltmesi' });
      await send(cx, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\nBitti: port **3000** oldu.' } });
      s.history.push({ role: 'agent', text: 'Bitti' });
      return { stopReason: 'end_turn' };
    } catch {
      return { stopReason: 'cancelled' };
    } finally {
      s.abort = null;
    }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
