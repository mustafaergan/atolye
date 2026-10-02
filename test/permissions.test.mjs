import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let captured;
mock.module('@anthropic-ai/claude-agent-sdk', { namedExports: { query: ({ options }) => {
  captured = options;
  return { async *[Symbol.asyncIterator]() { yield { type: 'system', subtype: 'init', session_id: 'S1', permissionMode: 'default' }; await new Promise(() => {}); },
    supportedModels: async () => [], supportedCommands: async () => [], close() {} };
} } });
const { AgentSession } = await import('../src/session.js');

test('hep izin ver: sonraki farklı komutlar sorulmaz', async () => {
  const events = [];
  const s = new AgentSession({ cwd: '.', emit: (e) => events.push(e) });
  s.start();
  await new Promise((r) => setTimeout(r, 20));
  const ctx = { signal: new AbortController().signal };
  const p1 = captured.canUseTool('Bash', { command: 'mvn install' }, ctx);
  const ev = events.find((e) => e.type === 'permission');
  assert.equal(ev.alwaysGroup, 'shell');
  s.answer(ev.id, { behavior: 'allow', always: true });
  assert.equal((await p1).behavior, 'allow');
  const before = events.filter((e) => e.type === 'permission').length;
  const p2 = await captured.canUseTool('PowerShell', { command: 'cd x && mvn -q compile | grep ERROR' }, ctx);
  assert.equal(p2.behavior, 'allow');
  assert.equal(events.filter((e) => e.type === 'permission').length, before, 'yeniden sorulmamalı');
  // düzenlemeler hâlâ sorulur
  captured.canUseTool('Edit', { file_path: 'a' }, ctx);
  assert.equal(events.filter((e) => e.type === 'permission').length, before + 1);
  // aynı oturum yeniden açılınca izin korunur
  const s2 = new AgentSession({ cwd: '.', resume: 'S1', emit: () => {} });
  assert.ok(s2.allowed.has('shell'));
  s.close(); s2.close();
});
