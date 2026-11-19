// Köprü: Anthropic biçimindeki isteğin OpenAI biçimine, yanıtın (akış dahil) geri çevrilmesi
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { bridge, bridgeHandlers, fromOpenAI, looksOpenAI, openaiEndpoint, openaiModelsUrl, streamTranslator, thinkFilter, toOpenAI } from '../src/kopru.js';

test('uç nokta: tam adres olduğu gibi kalır, kök adrese /v1/chat/completions eklenir', () => {
  assert.equal(openaiEndpoint('https://gateway.example.com/chat/completions'), 'https://gateway.example.com/chat/completions');
  assert.equal(openaiEndpoint('http://localhost:1234/v1/'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(openaiEndpoint('http://localhost:8000'), 'http://localhost:8000/v1/chat/completions');
  assert.equal(openaiEndpoint('localhost:8000'), '');
  assert.equal(openaiModelsUrl('https://gateway.example.com/chat/completions'), 'https://gateway.example.com/models');
  assert.equal(looksOpenAI('https://gateway.example.com/chat/completions/'), true);
  assert.equal(looksOpenAI('http://localhost:11434'), false);
});

test('istek çevirisi: sistem metni, görsel, araç çağrısı ve araç sonucu doğru sırayla aktarılır', () => {
  const out = toOpenAI({
    model: 'claude-x', max_tokens: 500, temperature: 0.2, stream: true, stop_sequences: ['DUR'],
    system: [{ type: 'text', text: 'Kural 1', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Kural 2' }],
    tool_choice: { type: 'any' },
    tools: [{ name: 'Read', description: 'Dosya okur', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }, { type: 'web_search_20250305', name: 'web_search' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Şuna bak' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'gizli' }, { type: 'text', text: 'Okuyorum' }, { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'içerik' }] }, { type: 'text', text: 'Devam et' }] },
      { role: 'user', content: 'Düz metin' },
    ],
  }, 'yerel-model');
  assert.equal(out.model, 'yerel-model');
  assert.deepEqual(out.messages, [
    { role: 'system', content: 'Kural 1\n\nKural 2' },
    { role: 'user', content: [{ type: 'text', text: 'Şuna bak' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: 'Okuyorum', tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'içerik' },
    { role: 'user', content: 'Devam et' },
    { role: 'user', content: 'Düz metin' },
  ]);
  assert.deepEqual(out.tools, [{ type: 'function', function: { name: 'Read', description: 'Dosya okur', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]);
  assert.deepEqual([out.tool_choice, out.max_tokens, out.temperature, out.stop, out.stream, out.stream_options], ['required', 500, 0.2, ['DUR'], true, { include_usage: true }]);
  const plain = toOpenAI({ messages: [{ role: 'user', content: 'Selam' }] }, 'm');
  assert.deepEqual(plain, { model: 'm', messages: [{ role: 'user', content: 'Selam' }], stream: false });
});

test('yanıt çevirisi: düşünme bölümü atılır, araç çağrısı ve kullanım bilgisi aktarılır', () => {
  const msg = fromOpenAI({
    choices: [{ finish_reason: 'tool_calls', message: { content: '<think>plan</think>\nTamam', tool_calls: [{ id: 'c1', function: { name: 'Bash', arguments: '{"command":"dir"}' } }] } }],
    usage: { prompt_tokens: 12, completion_tokens: 5 },
  }, 'm');
  assert.deepEqual(msg.content, [{ type: 'text', text: 'Tamam' }, { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'dir' } }]);
  assert.deepEqual([msg.type, msg.role, msg.model, msg.stop_reason, msg.usage], ['message', 'assistant', 'm', 'tool_use', { input_tokens: 12, output_tokens: 5 }]);
  assert.equal(fromOpenAI({ choices: [{ finish_reason: 'length', message: { content: 'yarım' } }] }, 'm').stop_reason, 'max_tokens');
  assert.equal(fromOpenAI({ choices: [{ finish_reason: 'stop', message: { content: 'bitti' } }] }, 'm').stop_reason, 'end_turn');
});

test('düşünme süzgeci: etiket parçalara bölünse de ayıklanır', () => {
  const f = thinkFilter();
  const out = ['<thi', 'nk>gizli ', 'şeyler</th', 'ink>Mer', 'haba <', 'b>'].map((p) => f.push(p)).join('') + f.flush();
  assert.equal(out, 'Merhaba <b>');
});

test('akış çevirisi: metin geldikçe, araç çağrıları sonda; olay sırası Anthropic biçiminde', () => {
  const events = [];
  const tr = streamTranslator({ model: 'm', inputEstimate: 7, send: (event, data) => events.push([event, data]) });
  tr.feed({ choices: [{ delta: { role: 'assistant', content: '' } }] });
  tr.feed({ choices: [{ delta: { content: '\n\nMer' } }] });
  tr.feed({ choices: [{ delta: { content: 'haba' } }] });
  tr.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"pa' } }] } }] });
  tr.feed({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'Glob', arguments: '' } }] } }] });
  tr.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }] });
  tr.feed({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'bozuk' } }] }, finish_reason: 'tool_calls' }] });
  tr.feed({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 9 } });
  tr.end();
  tr.end();
  assert.deepEqual(events.map(([e]) => e), [
    'message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
  ]);
  assert.deepEqual(events.filter(([e]) => e === 'content_block_delta').map(([, d]) => d.delta.text ?? d.delta.partial_json), ['Mer', 'haba', '{"path":"a"}', '{}']);
  assert.deepEqual(events[5][1].content_block, { type: 'tool_use', id: 'c1', name: 'Read', input: {} });
  assert.deepEqual(events.at(-2)[1], { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { input_tokens: 30, output_tokens: 9 } });
  assert.equal(events[0][1].message.usage.input_tokens, 7);
});

test('köprü uçtan uca: anahtar denetimi, akış, akışsız yanıt, alan reddedilince yalın istek ve hata aktarımı', async () => {
  const seen = [];
  let mode = 'ok';
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      if (mode === 'yetkisiz') { res.statusCode = 401; return res.end('{"error":"anahtar gerekli"}'); }
      if (mode === 'titiz' && (body.stream_options || body.max_tokens)) { res.statusCode = 400; return res.end('{"error":"unknown field"}'); }
      if (!body.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Tek parça' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Akan ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'yanıt' }, finish_reason: 'stop' }] })}\r\n\r\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const cfg = { id: 'abc', kind: 'openai', url: `http://127.0.0.1:${upstream.address().port}/chat/completions`, model: 'sahte-model', key: 'asil-anahtar' };
  const app = express();
  app.use(express.json());
  const h = bridgeHandlers({ configOf: (id) => (id === 'abc' ? cfg : id === 'eski' ? { ...cfg, id: 'eski', kind: 'anthropic' } : null) });
  app.post('/kopru/:id/v1/messages/count_tokens', (req, res) => h.countTokens(req, res));
  app.post('/kopru/:id/v1/messages', (req, res) => h.messages(req, res));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/kopru`;
  const call = (id, body, key = bridge.secret, sub = '') => fetch(`${base}/${id}/v1/messages${sub}?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const ask = { model: 'claude-opus', max_tokens: 100, messages: [{ role: 'user', content: 'Selam' }] };
  try {
    assert.equal((await call('abc', ask, 'yanlis')).status, 401);
    assert.equal((await call('yok', ask)).status, 404);
    assert.equal((await call('eski', ask)).status, 404, 'Anthropic uyumlu model köprüden geçmez');
    assert.equal(seen.length, 0);

    const one = await (await call('abc', ask)).json();
    assert.deepEqual([one.content, one.model, one.stop_reason, one.usage], [[{ type: 'text', text: 'Tek parça' }], 'sahte-model', 'end_turn', { input_tokens: 3, output_tokens: 2 }]);
    assert.deepEqual([seen[0].url, seen[0].auth, seen[0].body.model], ['/chat/completions', 'Bearer asil-anahtar', 'sahte-model']);

    const res = await call('abc', { ...ask, stream: true });
    assert.match(res.headers.get('content-type'), /event-stream/);
    const text = await res.text();
    const events = text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.split('\n')[1].slice(6)));
    assert.deepEqual(events.map((e) => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    assert.equal(events.filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join(''), 'Akan yanıt');
    assert.equal(events.at(-2).delta.stop_reason, 'end_turn');

    assert.ok((await (await call('abc', ask, bridge.secret, '/count_tokens')).json()).input_tokens > 0);

    // Alanı reddeden sunucu: istek yalın hâliyle yinelenir, sonraki isteklerde doğrudan yalın gönderilir
    mode = 'titiz';
    seen.length = 0;
    assert.equal((await (await call('abc', ask)).json()).content[0].text, 'Tek parça');
    assert.deepEqual(seen.map((s) => 'max_tokens' in s.body), [true, false]);
    await (await call('abc', { ...ask, stream: true })).text();
    assert.equal(seen.length, 3);
    assert.deepEqual(['max_tokens' in seen[2].body, 'stream_options' in seen[2].body], [false, false]);

    mode = 'yetkisiz';
    const bad = await call('abc', ask);
    assert.equal(bad.status, 401);
    const err = await bad.json();
    assert.deepEqual([err.type, err.error.type], ['error', 'authentication_error']);
    assert.match(err.error.message, /anahtar gerekli/);
  } finally { server.close(); upstream.close(); }

  const dead = express();
  dead.use(express.json());
  const h2 = bridgeHandlers({ configOf: () => ({ ...cfg, url: 'http://127.0.0.1:9/chat/completions' }) });
  dead.post('/kopru/:id/v1/messages', (req, res) => h2.messages(req, res));
  const s2 = http.createServer(dead);
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/kopru/abc/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': bridge.secret }, body: JSON.stringify(ask) });
    assert.equal(r.status, 502);
  } finally { s2.close(); }
});
