// Öğretilen komutlar: dosyada saklama, düzenleme, silme ve yapay zekâ yanıtının komuta çevrilmesi
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { list, save, remove, clean, guessLinks, parseCompiled, compile, compileRequest, builtins, saveBuiltin, resetBuiltin, MAX_COMMANDS, readDocs, digest } from '../src/commands.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-komut-')), 'alt', 'komutlar.json');

test('komut kaydedilir, düzenlenir, bağlantıları değişir ve silinir', () => {
  const file = tmp();
  assert.deepEqual(list(file), []);
  const [c] = save({ name: '  Jira   özeti ', prompt: 'Jira kaydını oku.\r\nÖzetle.', links: ['jira', 'bilinmeyen', 'jira', 'bitbucket'], fill: 1 }, file);
  assert.equal(c.name, 'Jira özeti');
  assert.equal(c.prompt, 'Jira kaydını oku.\nÖzetle.');
  assert.deepEqual(c.links, ['jira', 'bitbucket']);
  assert.equal(c.fill, true);
  assert.ok(c.id && c.created);
  save({ name: 'İkinci', prompt: 'x' }, file);
  const after = save({ id: c.id, name: 'Jira ve PR', prompt: 'Yeni yönerge', links: ['confluence'], fill: false }, file);
  assert.equal(after.length, 2);
  assert.deepEqual([after[0].id, after[0].name, after[0].links, after[0].fill], [c.id, 'Jira ve PR', ['confluence'], false]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).commands.length, 2, 'dosyada durur');
  assert.deepEqual(remove(c.id, file).map((x) => x.name), ['İkinci']);
  assert.deepEqual(list(file).map((x) => x.name), ['İkinci']);
});

test('eksik ad ya da yönerge, olmayan komut ve sınır hata verir', () => {
  const file = tmp();
  assert.throws(() => clean({ name: ' ', prompt: 'x' }), { code: 'no-name' });
  assert.throws(() => clean({ name: 'x', prompt: '' }), { code: 'no-prompt' });
  assert.throws(() => save({ id: 'yok', name: 'x', prompt: 'y' }, file), { code: 'not-found' });
  assert.equal(clean({ name: 'x', prompt: 'y', links: ['jira', 'confluence', 'bitbucket', 'graylog', 'jenkins'] }).links.length, 4, 'en fazla 4 bağlantı');
  for (let i = 0; i < MAX_COMMANDS; i++) save({ name: `k${i}`, prompt: 'p' }, file);
  assert.throws(() => save({ name: 'fazla', prompt: 'p' }, file), { code: 'too-many' });
});

test('tarifte adı geçen bağlantılar bulunur', () => {
  assert.deepEqual(guessLinks('Önce Jira kaydına git, sonra Bitbucket PR listesine ve Confluence dokümanına bak'), ['jira', 'confluence', 'bitbucket']);
  assert.deepEqual(guessLinks('PostgreSQL tablosuna bak, Sonar sonucunu oku'), ['sonarqube', 'postgres']);
  assert.deepEqual(guessLinks('kodu oku'), []);
});

test('yapay zekâ yanıtı komuta çevrilir; çevrilemezse tarif olduğu gibi kullanılır', async () => {
  const raw = 'İşte komut:\n```json\n{"name": "Jira PR kontrolü", "prompt": "1. Jira kaydını oku.\\n2. PR ara:", "links": ["jira", "bitbucket", "uydurma"], "fill": true}\n```';
  assert.deepEqual(parseCompiled(raw, 'tarif'), { name: 'Jira PR kontrolü', prompt: '1. Jira kaydını oku.\n2. PR ara:', links: ['jira', 'bitbucket'], fill: true, color: '', ai: true });
  // Bağlantı vermediyse tariften çıkarılır
  assert.deepEqual(parseCompiled('{"name": "A", "prompt": "B"}', 'jira kaydına bak').links, ['jira']);
  const fb = parseCompiled('üzgünüm, yapamadım', 'Jira kaydını oku ve özetle');
  assert.deepEqual(fb, { name: 'Jira kaydını oku ve özetle', prompt: 'Jira kaydını oku ve özetle', links: ['jira'], fill: false, ai: false });
  assert.equal(parseCompiled('{"name": "", "prompt": ""}', 'x y').ai, false, 'boş yanıt yedeğe düşer');

  let asked;
  const c = await compile({ engine: 'copilot', cwd: '.', description: ' Jira oku ', ask: async (o) => { asked = o; return '{"name":"Jira oku","prompt":"Jira kaydını oku.","links":["jira"],"fill":false}'; } });
  assert.equal(c.ai, true);
  assert.equal(asked.engine, 'copilot');
  assert.match(asked.text, /Kullanıcının tarifi:\nJira oku$/);
  assert.match(compileRequest('en', 'x'), /The user's description:\nx$/);
  assert.equal((await compile({ description: 'Sonar bak', ask: async () => { throw new Error('ağ yok'); } })).ai, false, 'istek başarısızsa yedek');
  await assert.rejects(compile({ description: '  ' }), { code: 'no-description' });
});

test('hazır komutlar değiştirilir, gizlenir, renklendirilir ve sıfırlanır; öğretilen komutlar etkilenmez', () => {
  const file = tmp();
  save({ name: 'Benim', prompt: 'p', color: 'green' }, file);
  assert.equal(list(file)[0].color, 'green');
  assert.equal(clean({ name: 'x', prompt: 'y', color: 'uydurma' }).color, '', 'bilinmeyen renk alınmaz');
  assert.deepEqual(builtins(file), {});
  saveBuiltin('Projeyi özetle', { hidden: true }, file);
  saveBuiltin('Kodu incele', { name: ' İnceleme ', prompt: 'Yeni yönerge', links: ['jira', 'yok'], fill: true, color: 'purple' }, file);
  assert.deepEqual(builtins(file), { 'Projeyi özetle': { hidden: true }, 'Kodu incele': { name: 'İnceleme', prompt: 'Yeni yönerge', links: ['jira'], fill: true, color: 'purple' } });
  assert.deepEqual(list(file).map((c) => c.name), ['Benim'], 'öğretilen komutlar yerinde');
  save({ name: 'İkinci', prompt: 'p' }, file);
  assert.equal(Object.keys(builtins(file)).length, 2, 'komut kaydı hazır komut değişikliklerini silmez');
  // Hiçbir değişiklik kalmadıysa kayıt da kalmaz
  saveBuiltin('Projeyi özetle', { hidden: false }, file);
  resetBuiltin('Kodu incele', file);
  assert.deepEqual(builtins(file), {});
  assert.throws(() => saveBuiltin('', { hidden: true }, file), { code: 'not-found' });
});

test('örnek belgeler: metinleri okunur, özet komutla saklanır, okunamayanlar bildirilir', async () => {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const files = [{ name: 'sablon.md', data: b64('# Rapor\nBaşlık: X\nDurum: Y') }, { name: 'resim.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]).toString('base64') }];
  const { docs, unread } = readDocs(files);
  assert.deepEqual(docs.map((d) => d.name), ['sablon.md']);
  assert.deepEqual(unread, ['resim.png']);
  assert.match(compileRequest('tr', 'rapor yaz', docs), /"notes"[\s\S]*--- Belge: sablon\.md ---\n# Rapor/);
  assert.doesNotMatch(compileRequest('tr', 'rapor yaz'), /notes/, 'belge yoksa özet istenmez');

  let asked;
  const c = await compile({ description: 'Raporu bu şablona göre yaz', files, ask: async (o) => { asked = o; return '{"name":"Rapor","prompt":"Komutla gelen belge özetine göre rapor yaz.","links":[],"fill":false,"notes":"Rapor: Başlık ve Durum alanları"}'; } });
  assert.match(asked.text, /Durum: Y/);
  assert.equal(c.notes, 'Rapor: Başlık ve Durum alanları');
  assert.deepEqual(c.sources, ['sablon.md']);
  assert.deepEqual(c.unread, ['resim.png']);

  // Saklama: özet ve kaynaklar kalır; özet silinince ikisi de gider
  const file = tmp();
  const [saved] = save({ name: c.name, prompt: c.prompt, notes: c.notes, sources: c.sources }, file);
  assert.equal(list(file)[0].notes, 'Rapor: Başlık ve Durum alanları');
  save({ id: saved.id, name: 'Rapor', prompt: 'p', notes: '' }, file);
  assert.equal(list(file)[0].notes, undefined);
  assert.equal(list(file)[0].sources, undefined);

  // Var olan komut için özet
  const d = await digest({ prompt: 'p', files, ask: async () => '```\nÖzet metni\n```' });
  assert.deepEqual(d, { notes: 'Özet metni', sources: ['sablon.md'], unread: ['resim.png'] });
  await assert.rejects(digest({ prompt: 'p', files: [files[1]] }), { code: 'no-docs' });
  await assert.rejects(digest({ prompt: 'p', files, ask: async () => '' }), { code: 'no-digest' });
});
