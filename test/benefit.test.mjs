// Fayda analizi: sayıları Atölye hesaplar, metni yerel model yazar
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-fayda-'));
process.env.ATOLYE_STATE_FILE = path.join(tmp, 'durum.json');
const b = await import('../src/benefit.js');

const at = (min) => new Date(Date.UTC(2026, 10, 20, 9, 0) + min * 60_000).toISOString();
const user = (min, text) => ({ type: 'user', timestamp: at(min), parent_tool_use_id: null, message: { role: 'user', content: text } });
const said = (min, text, tools = []) => ({ type: 'assistant', timestamp: at(min), parent_tool_use_id: null, message: { content: [{ type: 'text', text }, ...tools.map(([name, input]) => ({ type: 'tool_use', name, input }))] } });
const result = (min, isError = false) => ({ type: 'user', timestamp: at(min), parent_tool_use_id: null, message: { content: [{ type: 'tool_result', is_error: isError, content: 'x' }] } });

const sample = [
  user(0, 'Sipariş ekranındaki hatayı incele\n\n<system-reminder>Ask mode</system-reminder>'),
  said(1, 'Bakıyorum.', [['Read', { file_path: 'C:/p/Siparis.java' }], ['mcp__atolye__jira_get_issue', { key: 'ABC-1' }], ['mcp__atolye__graylog_prod_search', {}]]),
  result(2), result(2, true),
  said(3, 'Düzeltiyorum.', [['Edit', { file_path: 'C:/p/Siparis.java' }], ['Bash', { command: 'mvn test' }], ['mcp__playwright__browser_click', {}]]),
  user(40, 'Teşekkürler, testleri de yaz'), // 37 dk ara: 2 dk sayılır
  said(41, 'Yazdım.', [['Write', { file_path: 'C:/p/SiparisTest.java' }]]),
];

test('araç adından iş türü ve bağlantı', () => {
  assert.deepEqual(b.toolKind('Read'), { kind: 'read' });
  assert.deepEqual(b.toolKind('mcp__atolye__jira_search'), { kind: 'service', service: 'Jira' });
  assert.deepEqual(b.toolKind('mcp__atolye__graylog_prod_search'), { kind: 'service', service: 'Graylog' });
  assert.deepEqual(b.toolKind('mcp__playwright__browser_snapshot'), { kind: 'service', service: 'Tarayıcı' });
  assert.deepEqual(b.toolKind('confluence_search'), { kind: 'service', service: 'Confluence' }, 'Copilot kaydında ön ek yoktur');
  assert.deepEqual(b.toolKind('PowerShell'), { kind: 'command' });
  assert.deepEqual(b.toolKind('TodoWrite'), { kind: 'other' });
});

test('oturum sayıları: soru, işlem, dosya, hata ve etkin süre', () => {
  const s = b.sessionStats(sample);
  assert.equal(s.prompts, 2, 'araç sonuçları soru sayılmaz');
  assert.equal(s.replies, 3);
  assert.equal(s.tools, 7);
  assert.deepEqual([s.read, s.edit, s.command, s.other], [1, 2, 1, 0]);
  assert.deepEqual(s.services, { Jira: 1, Graylog: 1, Tarayıcı: 1 });
  assert.equal(s.edited.size, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.activeMs, (3 + 2 + 1) * 60_000, 'uzun ara yalnızca 2 dakika sayılır');
  assert.equal(b.sessionStats([]).prompts, 0);
});

test('toplamlar, ölçüm tablosu ve yerel modele giden liste', () => {
  const general = path.join(tmp, 'genel');
  const rows = [
    { session: { engine: 'claude', cwd: 'C:/dev/siparis', title: 'Sipariş hatası', lastModified: Date.parse(at(41)) }, stats: b.sessionStats(sample) },
    { session: { engine: 'yerel', cwd: general, title: 'Ağ sorunu', lastModified: Date.parse(at(60)) }, stats: b.sessionStats([user(60, 'ping atar mısın'), said(61, 'Attım.', [['Bash', {}]])]) },
  ];
  const t = b.totals(rows, { generalDir: general });
  assert.equal(t.sessions, 2);
  assert.equal(t.prompts, 3);
  assert.equal(t.command, 2);
  assert.deepEqual(t.engines, { claude: 1, yerel: 1 });
  assert.deepEqual(t.projects, { siparis: 1, '(klasörsüz sohbet)': 1 });
  assert.equal(t.days.size, 1);

  const m = b.metricsMarkdown(t, { days: 30 });
  assert.match(m, /\| Oturum \| 2 \|/);
  assert.match(m, /\| Dönem \| son 30 gün \(2026-11-20 – 2026-11-20\) \|/);
  assert.match(m, /\| Bağlantı kullanımı \| (Jira 1, Graylog 1, Tarayıcı 1|.*Jira 1.*) \|/);
  assert.match(m, /Claude Code 1, Yerel LLM 1|Yerel LLM 1, Claude Code 1/);

  const list = b.digest(rows, { generalDir: general });
  assert.equal(list.split('\n').length, 2);
  assert.match(list.split('\n')[0], /^- \[2026-11-20\] siparis · Claude Code · "Sipariş hatası" · 2 soru · 7 işlem \(okuma 1, düzenleme 2, komut 1, .*\) · 2 dosya değişti · ~6 dk$/);
  assert.match(list, /klasörsüz sohbet · Yerel LLM · "Ağ sorunu"/);
  const cut = b.digest(rows, { generalDir: general, max: 150 });
  assert.match(cut, /daha az işlem yapılan 1 oturum/, 'sınırı aşan oturumlar sayı olarak belirtilir');

  const p = b.reportPrompt({ list, metrics: m, days: 30 });
  assert.match(p, /ÜST YÖNETİM/);
  assert.match(p, /uydurma/);
  assert.ok(p.includes('<oturumlar>\n- [2026-11-20] siparis'));
});

test('model yanıtı temizlenir: düşünme bloğu ve kod çiti atılır', () => {
  assert.equal(b.cleanReport('<think>plan</think>\n```markdown\n## Özet\n- iyi\n```'), '## Özet\n- iyi');
  assert.equal(b.cleanReport('  ## Özet  '), '## Özet');
  assert.equal(b.cleanReport(''), '');
});

test('analiz işi: dönem süzülür, boş oturum sayılmaz, rapor diske yazılır; aynı anda ikinci analiz başlamaz', async () => {
  b.reset();
  const now = Date.parse(at(100));
  let asked = '';
  const sessions = [
    { id: 'a', engine: 'claude', cwd: 'C:/dev/siparis', title: 'Sipariş hatası', lastModified: now - 1000 },
    { id: 'bos', engine: 'copilot', cwd: 'C:/dev/siparis', title: 'Boş', lastModified: now - 2000 },
    { id: 'eski', engine: 'claude', cwd: 'C:/dev/siparis', title: 'Eski', lastModified: now - 90 * 86_400_000 },
  ];
  const r = b.start({ days: 30, model: 'Deneme Model', now, list: async () => sessions, read: async (s) => (s.id === 'a' ? sample : []), ask: async (text) => { asked = text; return '## Yönetici özeti\n- Hata analizi hızlandı.'; } });
  assert.equal(r.ok, true);
  assert.deepEqual(b.start({ list: async () => [], read: async () => [], ask: async () => '' }), { ok: false, code: 'busy' });
  await r.promise;
  const st = b.status();
  assert.equal(st.phase, 'done');
  assert.equal(st.total, 2, '30 günden eski oturum taranmaz');
  assert.ok(!asked.includes('"Eski"') && !asked.includes('"Boş"'), 'konuşmasız ve dönem dışı oturum listeye girmez');
  assert.match(st.last.markdown, /^# Atölye Fayda Analizi\n\n\*.* · son 30 gün · 1 oturum · raporu yazan: Deneme Model \(yerel model\)\*\n\n## Yönetici özeti/);
  assert.match(st.last.markdown, /## Ölçümler \(Atölye kayıtlardan hesapladı\)/);
  b.reset();
  assert.equal(b.status().last.sessions, 1, 'son rapor diskten okunur');

  const bos = b.start({ days: 7, now, list: async () => [], read: async () => [], ask: async () => 'x' });
  await bos.promise;
  assert.deepEqual([b.status().phase, b.status().code], ['error', 'empty']);
  const sessiz = b.start({ days: 0, now, list: async () => sessions, read: async () => sample, ask: async () => '' });
  await sessiz.promise;
  assert.equal(b.status().code, 'no-answer');
  fs.rmSync(tmp, { recursive: true, force: true });
});
