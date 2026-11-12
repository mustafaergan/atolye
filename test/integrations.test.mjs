// Jira / Confluence / Bitbucket bağlantıları: ayarlar CLI'ların kendi dosyalarına yazılır, araçlar
// sahte bir Atlassian sunucusuna karşı çalışır (gerçek sunucuya ya da gerçek ayar dosyalarına dokunulmaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-int-'));
process.env.ATOLYE_CLAUDE_JSON = path.join(dir, '.claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(dir, 'copilot', 'mcp-config.json');
const integrations = await import('../src/integrations.js');
const { availableTools, callTool, handleMessage } = await import('../src/mcp-server.js');
const { errorSummary, htmlToText } = await import('../src/atlassian.js');

// Sahte şirket içi (Data Center) sunucu: Bearer anahtarını denetler
const seen = [];
let whoamiName = 'deneme';
let reposVisible = true;
const server = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  // Graylog: belirteç Basic ile gelir (kullanıcı adı = belirteç, parola = "token")
  if (u.pathname.startsWith('/api/')) {
    if (req.headers.authorization !== `Basic ${Buffer.from('gl-belirtec:token').toString('base64')}`) { res.statusCode = 401; return res.end('{"type":"ApiError","message":"Unauthorized"}'); }
    if (u.pathname === '/api/system') return json({ version: '7.0.5', hostname: 'x' });
    if (u.pathname === '/api/streams') return json({ streams: [{ id: 's1', title: 'Uygulama', description: 'uygulama logları' }, { id: 's2', title: 'Kapalı', disabled: true }] });
    if (u.pathname === '/api/search/messages') return json({
      schema: [{ field: 'timestamp' }, { field: 'source' }, { field: 'message' }],
      datarows: [['2026-01-02T10:00:00.000Z', 'sunucu-1', `sorgu=${u.searchParams.get('query')} aralik=${u.searchParams.get('timerange')} akis=${u.searchParams.get('streams')}
ikinci satır`]],
    });
    res.statusCode = 404; return res.end('{}');
  }
  if (req.headers.authorization !== 'Bearer gizli-anahtar') { res.statusCode = 401; return res.end('Unauthorized'); }
  if (u.pathname === '/rest/api/2/myself') return json({ displayName: 'Deneme Kullanıcı' });
  if (u.pathname === '/rest/api/2/search') return json({ issues: [{ key: 'ABC-1', fields: { summary: `jql=${u.searchParams.get('jql')}`, status: { name: 'Açık' }, issuetype: { name: 'Hata' } } }] });
  if (u.pathname === '/rest/api/2/issue/ABC-1') return json({ key: 'ABC-1', fields: { summary: 'Port hatası', status: { name: 'Açık' }, description: 'Port dolu', comment: { comments: [{ author: { displayName: 'Ali' }, created: '2026-01-02T10:00', body: 'bakıyorum' }] } } });
  if (u.pathname === '/rest/api/content/search') return json({ results: [{ id: '42', title: 'Kurulum', space: { key: 'DOC' }, _links: { webui: '/x/42' } }] });
  if (u.pathname === '/rest/api/content/42') return json({ title: 'Kurulum', version: { number: 3 }, body: { storage: { value: '<h1>Adımlar</h1><p>Önce <b>Node</b> kurun &amp; açın</p>' } } });
  if (u.pathname === '/plugins/servlet/applinks/whoami') return res.end(whoamiName);
  if (u.pathname === '/rest/api/1.0/repos') return json({ values: reposVisible ? [{ slug: 'depo', project: { key: 'ABC' } }] : [] });
  if (u.pathname === '/rest/api/1.0/projects/ABC/repos/depo/pull-requests') return json({ values: [{ id: 7, state: 'OPEN', title: 'Düzeltme', author: { user: { displayName: 'Ayşe' } }, fromRef: { displayId: 'fix' }, toRef: { displayId: 'main' } }] });
  if (u.pathname === '/rest/api/1.0/projects/ABC/repos/depo/raw/src/a.js') return res.end(`at=${u.searchParams.get('at')}`);
  res.statusCode = 404; res.end('yok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test("bağlantı bilgileri Claude Code ve Copilot CLI'ın kendi ayar dosyalarına yazılır; diğer ayarlar korunur", () => {
  fs.writeFileSync(process.env.ATOLYE_CLAUDE_JSON, JSON.stringify({ numStartups: 5, mcpServers: { baska: { command: 'x' } } }));
  const st = integrations.save('jira', { url: `${base}/`, token: ' gizli-anahtar ' });
  assert.deepEqual(st.services.jira, { url: base, email: '', hasToken: true, connected: true });
  assert.equal(JSON.stringify(st).includes('gizli-anahtar'), false, 'anahtar arayüze gönderilmez');

  const claude = read(process.env.ATOLYE_CLAUDE_JSON);
  assert.equal(claude.numStartups, 5);
  assert.deepEqual(claude.mcpServers.baska, { command: 'x' });
  assert.equal(claude.mcpServers.atolye.type, 'stdio');
  assert.deepEqual(claude.mcpServers.atolye.env, { JIRA_URL: base, JIRA_TOKEN: 'gizli-anahtar' });
  assert.match(claude.mcpServers.atolye.args[0], /mcp-server\.js$/);
  const copilot = read(process.env.ATOLYE_COPILOT_MCP);
  assert.equal(copilot.mcpServers.atolye.type, 'local');
  assert.deepEqual(copilot.mcpServers.atolye.env, claude.mcpServers.atolye.env);

  // Anahtar boş bırakılırsa eskisi korunur; ikinci servis eklenince birincisi durur
  integrations.save('jira', { url: base, token: '' });
  integrations.save('bitbucket', { url: base, token: 'gizli-anahtar' });
  assert.deepEqual(Object.keys(read(process.env.ATOLYE_CLAUDE_JSON).mcpServers.atolye.env).sort(), ['BITBUCKET_TOKEN', 'BITBUCKET_URL', 'JIRA_TOKEN', 'JIRA_URL']);
});

test('eksik ya da hatalı bilgi kaydedilmez; bozuk ayar dosyasının üzerine yazılmaz', () => {
  assert.throws(() => integrations.save('confluence', { url: 'adres-degil', token: 'x' }), { code: 'bad-url' });
  assert.throws(() => integrations.save('confluence', { url: base, token: '' }), { code: 'no-token' });
  assert.throws(() => integrations.save('gitlab', { url: base, token: 'x' }));
  const file = process.env.ATOLYE_CLAUDE_JSON;
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{ bozuk');
  assert.throws(() => integrations.save('confluence', { url: base, token: 'x' }), /okunamadı/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ bozuk');
  fs.writeFileSync(file, good);
});

test('bağlantı sınama: doğru anahtarla kullanıcı adı, yanlış anahtarla anlaşılır hata', async () => {
  assert.deepEqual(await integrations.test('jira'), { ok: true, user: 'Deneme Kullanıcı' });
  assert.deepEqual(await integrations.test('bitbucket'), { ok: true, user: 'deneme' });
  assert.deepEqual(await integrations.test('confluence'), { ok: false, error: 'not-configured' });
  // Şirket içi kurulumda e-posta yanlışlıkla doldurulsa da belirteç Bearer ile gönderilir
  integrations.save('bitbucket', { url: base, token: 'gizli-anahtar', email: 'biri@ornek.com' });
  assert.deepEqual(await integrations.test('bitbucket'), { ok: true, user: 'deneme' });
  // Proje/depo belirteci: kullanıcı adı dönmez ama depolar görünür → bağlantı geçerli
  whoamiName = '';
  assert.deepEqual(await integrations.test('bitbucket'), { ok: true, user: 'erişim belirteci (kullanıcı adı yok)' });
  // Ne ad ne depo: ne yapılacağı söylenir
  reposVisible = false;
  const anon = await integrations.test('bitbucket');
  assert.equal(anon.ok, false);
  assert.match(anon.error, /HTTP erişim belirteçleri/);
  whoamiName = 'deneme'; reposVisible = true;
  integrations.save('bitbucket', { url: base, token: 'gizli-anahtar' });
  integrations.save('confluence', { url: base, token: 'yanlis' });
  const bad = await integrations.test('confluence');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /401.*API anahtarı kabul edilmedi/);
  // Şirket içi kurulumda e-posta yanlışlıkla doldurulsa da kişisel erişim belirteci denenir
  integrations.save('confluence', { url: base, token: 'gizli-anahtar', email: 'biri@ornek.com' });
  assert.equal((await integrations.test('confluence')).ok, false); // sahte sunucuda bu uç yok: 404, ama 401 değil
  assert.doesNotMatch((await integrations.test('confluence')).error, /401/);
  integrations.save('confluence', { url: base, token: 'gizli-anahtar' });
});

test('araçlar yalnızca bağlı servisler için sunulur ve doğru adreslere gider', async () => {
  const env = read(process.env.ATOLYE_CLAUDE_JSON).mcpServers.atolye.env;
  assert.deepEqual(availableTools({ JIRA_URL: base, JIRA_TOKEN: 'x' }).map((t) => t.name), ['jira_search', 'jira_get_issue', 'jira_add_comment']);
  assert.equal(availableTools(env).length, 9);
  assert.equal(availableTools(env).find((t) => t.name === 'jira_add_comment').annotations.readOnlyHint, false);

  const text = async (name, args) => (await callTool(name, args, env)).content[0].text;
  assert.match(await text('jira_search', { jql: 'assignee = currentUser()' }), /^ABC-1 \[Açık\] jql=assignee = currentUser\(\)/);
  const issue = await text('jira_get_issue', { key: 'ABC-1' });
  assert.match(issue, /Port hatası/);
  assert.match(issue, /Ali \(2026-01-02\): bakıyorum/);
  assert.match(await text('confluence_search', { query: 'kurulum' }), /^42 \| Kurulum \| alan: DOC/);
  assert.ok(seen.some((s) => decodeURIComponent(s).includes('cql=text ~ "kurulum" and type = page')));
  assert.match(await text('confluence_get_page', { id: '42' }), /Kurulum \(sürüm 3\)[\s\S]*Adımlar\nÖnce Node kurun & açın/);
  assert.match(await text('bitbucket_list_pull_requests', { project: 'ABC', repo: 'depo' }), /^#7 \[OPEN\] Düzeltme — Ayşe, fix → main/);
  assert.equal(await text('bitbucket_get_file', { project: 'ABC', repo: 'depo', path: 'src/a.js', ref: 'main' }), 'at=main');

  // Hatalar araç sonucu olarak döner (oturumu düşürmez)
  const missing = await callTool('jira_get_issue', {}, env);
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /"key" gerekli/);
  assert.equal((await callTool('jira_get_issue', { key: 'YOK-9' }, env)).isError, true);
  assert.equal(htmlToText('<p>a</p><ul><li>b</li></ul>'), 'a\n- b');
  // Hata sayfasındaki betikler kullanıcıya gösterilmez
  assert.equal(errorSummary('<html><head><title>Unauthorized (401)</title><script>var contextPath = "";function f() { console.warn("x"); }</script></head><body><h1>x</h1></body></html>'), 'Unauthorized (401)');
  assert.equal(errorSummary('<div><script>var a = 1;</script><p>Oturum gerekli</p></div>'), 'Oturum gerekli');
  assert.equal(errorSummary('{"errorMessages":["Kayıt yok"],"errors":{}}'), 'Kayıt yok');
});

test('MCP sunucusu gerçek bir alt süreç olarak konuşur', async () => {
  const env = read(process.env.ATOLYE_CLAUDE_JSON).mcpServers.atolye.env;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp-server.js', import.meta.url))], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) replies.push(JSON.parse(buf.slice(0, i)));
  });
  const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  send({ id: 3, method: 'tools/call', params: { name: 'jira_get_issue', arguments: { key: 'ABC-1' } } });
  const end = Date.now() + 10_000;
  while (replies.length < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  child.stdin.end();
  assert.equal(replies[0].result.protocolVersion, '2025-06-18');
  assert.equal(replies[0].result.serverInfo.name, 'atolye');
  assert.equal(replies[1].result.tools.length, 9);
  assert.match(replies[2].result.content[0].text, /ABC-1: Port hatası/);
  assert.deepEqual(await handleMessage({ method: 'notifications/initialized' }), null);
});

test('bağlantı kaldırılınca bilgiler iki dosyadan da silinir', () => {
  for (const s of ['jira', 'confluence', 'bitbucket']) integrations.remove(s);
  const claude = read(process.env.ATOLYE_CLAUDE_JSON);
  assert.equal(claude.mcpServers.atolye, undefined);
  assert.deepEqual(claude.mcpServers.baska, { command: 'x' });
  assert.equal(read(process.env.ATOLYE_COPILOT_MCP).mcpServers.atolye, undefined);
  assert.equal(integrations.status().services.jira.connected, false);
});

test('Graylog: belirteçle giriş, log arama ve akış listesi', async () => {
  integrations.save('graylog', { url: `${base}/`, token: 'gl-belirtec' });
  assert.deepEqual(await integrations.test('graylog'), { ok: true, user: 'Graylog 7.0.5' });
  const env = read(process.env.ATOLYE_CLAUDE_JSON).mcpServers.atolye.env;
  assert.deepEqual(availableTools(env).map((t) => t.name), ['graylog_search', 'graylog_list_streams']);
  const found = (await callTool('graylog_search', { query: 'level:3', minutes: 30, stream: 's1' }, env)).content[0].text;
  assert.equal(found, '2026-01-02T10:00:00.000Z sunucu-1: sorgu=level:3 aralik=30m akis=s1 ⏎ ikinci satır');
  assert.equal((await callTool('graylog_list_streams', {}, env)).content[0].text, 's1 | Uygulama — uygulama logları');
  integrations.save('graylog', { url: base, token: 'yanlis' });
  assert.match((await integrations.test('graylog')).error, /401/);
  integrations.remove('graylog');
});
