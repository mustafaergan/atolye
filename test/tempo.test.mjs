import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Ayar dosyaları geçici klasörde (gerçek ~/.claude.json'a dokunulmaz)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-tempo-'));
process.env.ATOLYE_CLAUDE_JSON = path.join(dir, 'claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(dir, 'copilot.json');

const { tempo, learn, commentTemplate, defaultsFor, monthRange, isoDate } = await import('../src/tempo.js');
const { configFromEnv } = await import('../src/atlassian.js');
const { availableTools } = await import('../src/mcp-server.js');
const integrations = await import('../src/integrations.js');

const ATTRS = [
  { id: 7, key: '_Hizmet_', name: 'Hizmet', type: { value: 'DYNAMIC_DROPDOWN' }, required: true },
  { id: 3, key: '_Hesap_', name: 'Hesap', type: { value: 'ACCOUNT' }, required: false },
];
const wl = (id, key, day, h, hizmet, hesap, comment = `${key} üzerinde çalışıldı`) => ({
  tempoWorklogId: id, issue: { key, projectKey: key.split('-')[0], summary: `${key} başlığı` }, originTaskId: key,
  started: `${day} 00:00:00.000`, timeSpentSeconds: h * 3600, comment,
  attributes: { _Hizmet_: { workAttributeId: 7, key: '_Hizmet_', value: hizmet }, ...(hesap ? { _Hesap_: { workAttributeId: 3, key: '_Hesap_', value: hesap } } : {}) },
});

/** Sahte Jira + Tempo: istekleri kaydeder */
function fakeJira(history) {
  const seen = [];
  const store = [...history];
  let next = 9000;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      const json = (v, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
      if (req.headers.authorization !== 'Bearer gizli') return json({ errorMessages: ['yetki yok'] }, 401);
      if (req.url === '/rest/api/2/myself') return json({ key: 'JIRAUSER1', name: 'kisi', displayName: 'Deneme Kişi' });
      if (req.url === '/rest/tempo-core/1/work-attribute') return json(ATTRS);
      if (req.url === '/rest/tempo-timesheets/4/worklogs/search') return json(store.filter((w) => w.started.slice(0, 10) >= body.from && w.started.slice(0, 10) <= body.to));
      if (req.url === '/rest/tempo-core/2/user/schedule/search') {
        const days = [];
        for (let d = new Date(`${body.from}T12:00:00`); isoDate(d) <= body.to; d.setDate(d.getDate() + 1)) days.push({ date: isoDate(d), requiredSeconds: [0, 6].includes(d.getDay()) ? 0 : 28800 });
        return json([{ schedule: { days } }]);
      }
      if (req.method === 'POST' && req.url === '/rest/tempo-timesheets/4/worklogs/') {
        const w = { tempoWorklogId: ++next, issue: { key: body.originTaskId, projectKey: body.originTaskId.split('-')[0] }, started: `${body.started} 00:00:00.000`, timeSpentSeconds: body.timeSpentSeconds, comment: body.comment, attributes: body.attributes };
        store.push(w);
        return json([w]);
      }
      const del = req.url.match(/^\/rest\/tempo-timesheets\/4\/worklogs\/(\d+)$/);
      if (req.method === 'DELETE' && del) { res.statusCode = 204; return res.end(); }
      json({ errorMessages: ['yok'] }, 404);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seen, store, url: `http://127.0.0.1:${server.address().port}` })));
}

const today = isoDate(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };
const HISTORY = [
  wl(1, 'ABC-1', daysAgo(10), 6, '11', 'H1'),
  wl(2, 'ABC-1', daysAgo(9), 6, '11', 'H1'),
  wl(3, 'ABC-2', daysAgo(9), 2, '12', 'H1'),
  wl(4, 'IZN-5', daysAgo(8), 8, '90', 'H2'),
  wl(5, 'ABC-1', daysAgo(3), 7, '11', 'H1', 'özel açıklama'),
];

test('öğrenme: açıklama kalıbı, iş/proje/genel öncelikli alan değerleri', () => {
  const L = learn(HISTORY);
  assert.equal(commentTemplate(HISTORY), '{key} üzerinde çalışıldı');
  assert.equal(L.template, '{key} üzerinde çalışıldı');
  assert.equal(L.issues[0].key, 'ABC-1');
  assert.equal(L.issues[0].seconds, 19 * 3600);
  assert.deepEqual(defaultsFor('ABC-2', L, ATTRS), { _Hizmet_: '12', _Hesap_: 'H1' }, 'aynı işin değeri');
  assert.deepEqual(defaultsFor('IZN-9', L, ATTRS), { _Hizmet_: '90', _Hesap_: 'H2' }, 'iş yoksa aynı proje');
  assert.deepEqual(defaultsFor('XYZ-1', L, ATTRS), { _Hizmet_: '11', _Hesap_: 'H1' }, 'proje de yoksa en sık değer');
  assert.equal(commentTemplate([wl(1, 'A-1', today, 1, '1', '', 'x'), wl(2, 'A-2', today, 1, '1', '', 'y')]), '', 'kalıp yoksa boş');
});

test('Tempo bağlantısı: Jira ayarını kullanır, açılmadıkça ve yerel LLM oturumu değilse araçlar sunulmaz', () => {
  const cloud = { JIRA_URL: 'https://jira.example.com/', JIRA_TOKEN: 'gizli', TEMPO_ENABLED: '1' };
  assert.equal(configFromEnv('tempo', cloud), null, 'Claude Code / Copilot oturumunda Tempo yok');
  assert.ok(!availableTools(cloud).some((t) => t.name.startsWith('tempo_')));
  const env = { JIRA_URL: 'https://jira.example.com/', JIRA_TOKEN: 'gizli', ATOLYE_YEREL_OTURUM: '1' };
  assert.equal(configFromEnv('tempo', env), null);
  assert.ok(!availableTools(env).some((t) => t.name.startsWith('tempo_')));
  const on = { ...env, TEMPO_ENABLED: '1', TEMPO_NOTES: 'Cuma 1 saat toplantı' };
  assert.deepEqual(configFromEnv('tempo', on), { url: 'https://jira.example.com', token: 'gizli', email: '', notes: 'Cuma 1 saat toplantı' });
  const tools = availableTools(on).filter((t) => t.name.startsWith('tempo_'));
  assert.deepEqual(tools.map((t) => t.name), ['tempo_profile', 'tempo_status', 'tempo_log_work', 'tempo_delete_worklog']);
  assert.equal(tools.find((t) => t.name === 'tempo_log_work').annotations.readOnlyHint, false, 'yazan araç izinle çalışır');
  assert.equal(configFromEnv('tempo', { TEMPO_ENABLED: '1', ATOLYE_YEREL_OTURUM: '1' }), null, 'Jira yoksa Tempo da yok');
});

test('ayar: aç/kapat ve kurallar yalnızca TEMPO_* olarak yazılır, Jira anahtarı tekrar yazılmaz', () => {
  fs.writeFileSync(process.env.ATOLYE_CLAUDE_JSON, JSON.stringify({ mcpServers: { atolye: { env: { JIRA_URL: 'https://jira.example.com', JIRA_TOKEN: 'gizli' } } } }));
  let st = integrations.setTempo(true, 'Günde 8 saat\r\nCuma toplantı');
  assert.equal(st.services.tempo.connected, true);
  assert.equal(st.services.tempo.jira, true);
  assert.equal(st.services.tempo.notes, 'Günde 8 saat\nCuma toplantı');
  const env = JSON.parse(fs.readFileSync(process.env.ATOLYE_CLAUDE_JSON, 'utf8')).mcpServers.atolye.env;
  assert.deepEqual(Object.keys(env).sort(), ['JIRA_TOKEN', 'JIRA_URL', 'TEMPO_ENABLED', 'TEMPO_NOTES']);
  assert.throws(() => integrations.save('tempo', { url: 'https://x.example.com', token: 'y' }));
  st = integrations.setTempo(false);
  assert.equal(st.services.tempo.connected, false);
  assert.equal(st.services.tempo.notes, 'Günde 8 saat\nCuma toplantı', 'kapatınca kurallar korunur');
});

test('profil ve durum: geçmiş, zorunlu alanlar, gün gün eksik süre', async () => {
  const j = await fakeJira(HISTORY);
  const cfg = { url: j.url, token: 'gizli', email: '', notes: 'Cuma 1 saat toplantı' };
  try {
    assert.match(await tempo.whoami(cfg), /Deneme Kişi/);
    const p = await tempo.profile(cfg, {});
    assert.match(p, /Zorunlu alanlar: Hizmet \(_Hizmet_\)/);
    assert.match(p, /"\{key\} üzerinde çalışıldı"/);
    assert.match(p, /\| ABC-1 \| ABC-1 başlığı \| 19 sa \| 3 \|/);
    assert.match(p, /Cuma 1 saat toplantı/);
    const from = daysAgo(10); const to = daysAgo(8);
    const s = await tempo.status(cfg, { from, to });
    assert.match(s, new RegExp(`\\| ${daysAgo(9)} .. \\| \\d+ \\| 8 \\|`));
    assert.match(s, /1: ABC-1 6/);
    assert.equal(monthRange(new Date(2026, 1, 10)).to, '2026-02-28');
    await assert.rejects(tempo.status(cfg, { from: '2026-01-01', to: '2026-06-01' }), /62 gün/);
  } finally { j.server.close(); }
});

test('kayıt girme: alanlar ve açıklama geçmişten, hatalı girdide hiçbir şey gönderilmez', async () => {
  const j = await fakeJira(HISTORY);
  const cfg = { url: j.url, token: 'gizli', email: '', notes: '' };
  try {
    const out = await tempo.logWork(cfg, { entries: [{ issue: 'abc-2', date: today, hours: 1.5 }, { issue: 'IZN-5', date: today, hours: 2, comment: 'Yarım gün izin' }] });
    assert.match(out, /2 kayıt girildi/);
    const posts = j.seen.filter((r) => r.method === 'POST' && r.url === '/rest/tempo-timesheets/4/worklogs/');
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body.attributes._Hizmet_, { workAttributeId: 7, key: '_Hizmet_', name: 'Hizmet', type: 'DYNAMIC_DROPDOWN', value: '12' });
    assert.equal(posts[0].body.attributes._Hesap_.value, 'H1');
    assert.equal(posts[0].body.comment, 'ABC-2 üzerinde çalışıldı', 'öğrenilen kalıp');
    assert.equal(posts[0].body.timeSpentSeconds, 5400);
    assert.equal(posts[0].body.worker, 'JIRAUSER1');
    assert.equal(posts[0].body.originTaskId, 'ABC-2');
    assert.equal(posts[1].body.comment, 'Yarım gün izin');
    assert.equal(posts[1].body.attributes._Hizmet_.value, '90');

    // Kullanıcının istediği değer geçmişin önüne geçer
    await tempo.logWork(cfg, { entries: [{ issue: 'ABC-1', date: today, hours: 1, attributes: { _Hizmet_: '99' } }] });
    assert.equal(j.seen.at(-1).body.attributes._Hizmet_.value, '99');

    // Biri hatalıysa hiçbiri gönderilmez
    const before = j.seen.filter((r) => r.method === 'POST' && r.url.endsWith('/worklogs/')).length;
    await assert.rejects(tempo.logWork(cfg, { entries: [{ issue: 'ABC-1', date: today, hours: 1 }, { issue: 'ABC-1', date: '25.11.2026', hours: 1 }] }), /2\. kayıt: tarih/);
    await assert.rejects(tempo.logWork(cfg, { entries: [{ issue: 'ABC-1', date: today, hours: 30 }] }), /0 ile 24/);
    await assert.rejects(tempo.logWork(cfg, { entries: [{ issue: 'bozuk', date: today, hours: 1 }] }), /anahtarı geçersiz/);
    assert.equal(j.seen.filter((r) => r.method === 'POST' && r.url.endsWith('/worklogs/')).length, before);

    assert.match(await tempo.deleteWorklog(cfg, { id: '9001' }), /silindi/);
    assert.equal(j.seen.at(-1).method, 'DELETE');
    await assert.rejects(tempo.deleteWorklog(cfg, { id: 'abc' }), /sayı/);
  } finally { j.server.close(); }
});

test('geçmiş yoksa zorunlu alan sorulur', async () => {
  const j = await fakeJira([]);
  try {
    await assert.rejects(tempo.logWork({ url: j.url, token: 'gizli', email: '' }, { entries: [{ issue: 'ABC-1', date: today, hours: 1, comment: 'iş' }] }), /Hizmet \(_Hizmet_\).*attributes/);
    assert.ok(!j.seen.some((r) => r.method === 'POST' && r.url.endsWith('/worklogs/')));
  } finally { j.server.close(); }
});
