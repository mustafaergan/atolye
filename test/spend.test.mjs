import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { summarize, parseResponse, getSpend } from '../src/spend.js';

test('özet: harcanan / bütçe ve hesaplanan yüzde', () => {
  const r = summarize([
    { label: 'Monthly Spend', value: '$82.40' },
    { label: 'Monthly Budget', value: '$100.00' },
    { label: 'Remaining', value: '$17.60' },
  ]);
  assert.equal(r.summary, '$82.40 / $100.00 · %82.4');
  assert.equal(r.percent, 82.4);
});

test('özet: Türkçe etiketler ve "%45" yazımı', () => {
  const r = summarize([
    { label: 'Kullanım', value: '%45' },
    { label: 'Harcama', value: '1.234,50 TL' },
    { label: 'Bütçe', value: '2.000,00 TL' },
  ]);
  assert.equal(r.percent, 45);
  assert.equal(r.summary, '1.234,50 TL / 2.000,00 TL · %45');
});

test('cevap biçimi doğrulanır', () => {
  assert.deepEqual(parseResponse('{"items":[{"label":"A","value":1}]}'), [{ label: 'A', value: '1' }]);
  assert.throws(() => parseResponse('{"foo":1}'), /Beklenmeyen/);
  assert.throws(() => parseResponse('<html>'), /JSON/);
});

test('gateway\'den harcama çekilir; uç nokta yoksa gösterge gizlenir', async () => {
  let supported = true;
  let auth;
  const server = http.createServer((req, res) => {
    auth = req.headers.authorization;
    if (!supported || req.method !== 'POST' || req.url !== '/spend-summary') return res.writeHead(404).end();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ items: [{ label: 'Spend', value: '$5.00' }, { label: 'Budget', value: '$50.00' }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}/some/path`;
  process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
  try {
    const ok = await getSpend({ force: true });
    assert.equal(ok.enabled, true);
    assert.equal(ok.ok, true);
    assert.equal(ok.summary, '$5.00 / $50.00 · %10');
    assert.equal(auth, 'Bearer test-token');

    supported = false;
    const off = await getSpend({ force: true });
    assert.equal(off.enabled, false);
  } finally {
    server.close();
  }
});

test('işletim sistemi yedeği (PowerShell / curl) aynı sonucu verir', { skip: process.env.CI ? 'CI' : false }, async () => {
  const { postWithSystem } = await import('../src/spend.js');
  const server = http.createServer((req, res) => {
    if (req.url === '/yok') return res.writeHead(404).end();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ items: [{ label: 'Auth', value: req.headers.authorization }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await postWithSystem(`${base}/spend-summary`, 'gizli-token');
    assert.equal(ok.status, 200);
    assert.deepEqual(parseResponse(ok.body), [{ label: 'Auth', value: 'Bearer gizli-token' }]);
    const missing = await postWithSystem(`${base}/yok`, 'gizli-token');
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
