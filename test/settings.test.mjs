// Ayarlar: .env yazımı, uygulama seçenekleri (atolye.ps1 yerine sahte çalıştırıcı), Claude/Copilot ayarı,
// yerel modeller, skill klasörleri, eski oturum seçimi ve sohbet araması
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-ayar-'));
process.env.ATOLYE_ENV_FILE = path.join(tmp, '.env');
process.env.ATOLYE_STATE_FILE = path.join(tmp, 'durum', 'durum.json');
process.env.ATOLYE_SKILLS_DIR = path.join(tmp, 'skills');
process.env.ATOLYE_LOCAL_FILE = path.join(tmp, 'yerel-llm.json');
const s = await import('../src/settings.js');
const { searchSessions, fold, claudeLineText, copilotEventText } = await import('../src/search.js');
const { StateStore } = await import('../src/store.js');

test('.env: anahtar eklenir, güncellenir, boş değerle kaldırılır; diğer satırlar korunur', () => {
  const file = path.join(tmp, 'a.env');
  fs.writeFileSync(file, '# yorum\nATOLYE_PORT=3210\nESKI=1\n');
  const env = {};
  s.setEnv({ YENI: ' deger ', ESKI: '' }, file, env);
  assert.equal(fs.readFileSync(file, 'utf8'), '# yorum\nATOLYE_PORT=3210\nYENI=deger\n');
  assert.deepEqual(env, { YENI: 'deger' });
});

test('uygulama seçenekleri: durum okunur, seçenek doğru komutla değiştirilir, başarısızlık bildirilir', async () => {
  const calls = [];
  let app = false;
  s.setRunner(async (cmd) => {
    calls.push(cmd);
    if (cmd === 'ayarlar') return { code: 0, out: `gürültü\n{"desktopApp":${app},"desktopAppAvailable":true,"desktopShortcut":true,"autostart":false}\n` };
    if (cmd === 'masaustu-ac') { app = true; return { code: 0, out: '  ✓ Masaüstü uygulaması hazır\n' }; }
    return { code: 1, out: '  ! Otomatik başlatma ayarlanamadı\n' };
  });
  assert.deepEqual(await s.appStatus(), { supported: true, desktopApp: false, desktopAppAvailable: true, desktopShortcut: true, autostart: false });
  const r = await s.appSet('desktopApp', true);
  assert.equal(r.ok, true);
  assert.equal(r.output, 'Masaüstü uygulaması hazır');
  assert.equal(r.status.desktopApp, true);
  const bad = await s.appSet('autostart', true);
  assert.deepEqual([bad.ok, bad.output], [false, 'Otomatik başlatma ayarlanamadı']);
  assert.deepEqual(calls, ['ayarlar', 'masaustu-ac', 'ayarlar', 'otomatik-ac', 'ayarlar']);
  await assert.rejects(s.appSet('uydurma', true), { code: 'bad-option' });
  s.setRunner(null);
});

test('Claude ve Copilot ayarı .env dosyasına yazılır; token boşsa var olan korunur', () => {
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ATOLYE_COPILOT_MODEL']) delete process.env[k];
  assert.throws(() => s.saveClaude({ baseUrl: 'gateway.example.com' }), { code: 'bad-url' });
  assert.throws(() => s.saveClaude({}), { code: 'no-token' });
  assert.deepEqual(s.saveClaude({ baseUrl: 'https://gateway.example.com/', token: 'gizli-1' }), { baseUrl: 'https://gateway.example.com', hasToken: true, saved: true });
  s.saveClaude({ baseUrl: 'https://yeni.example.com', token: '' });
  const text = fs.readFileSync(process.env.ATOLYE_ENV_FILE, 'utf8');
  assert.match(text, /ANTHROPIC_BASE_URL=https:\/\/yeni\.example\.com\n/);
  assert.match(text, /ANTHROPIC_AUTH_TOKEN=gizli-1\n/);
  assert.deepEqual(s.removeClaude(), { baseUrl: '', hasToken: false, saved: false });
  assert.equal(s.saveCopilot({ model: ' gpt-x ' }).defaultModel, 'gpt-x');
  assert.equal(process.env.ATOLYE_COPILOT_MODEL, 'gpt-x');
  assert.equal(s.saveCopilot({ model: '' }).defaultModel, '');
});

test('yerel modeller: birden fazla eklenir, düzenlenir, kaldırılır; anahtar arayüze gönderilmez', () => {
  assert.equal(s.localConfig(), null);
  assert.throws(() => s.saveLocal({ url: 'localhost:11434', model: 'm' }), { code: 'bad-url' });
  assert.throws(() => s.saveLocal({ url: 'http://localhost:11434', model: ' ' }), { code: 'no-model' });
  s.saveLocal({ url: 'http://localhost:11434/v1/', model: 'qwen3-coder' });
  const st = s.saveLocal({ name: 'Büyük model', url: 'http://10.0.0.5:1234', model: 'deepseek-r1', key: 'anahtar' });
  assert.deepEqual(st.models.map((m) => [m.name, m.url, m.model, m.hasKey]), [['qwen3-coder', 'http://localhost:11434', 'qwen3-coder', false], ['Büyük model', 'http://10.0.0.5:1234', 'deepseek-r1', true]]);
  assert.ok(!JSON.stringify(st).includes('anahtar'));
  const [a, b] = st.models;
  assert.equal(s.localConfig(b.id).key, 'anahtar');
  assert.equal(s.localConfig('yok').id, a.id, 'bulunamazsa ilki');
  s.saveLocal({ id: b.id, name: 'Yeni ad', url: b.url, model: 'deepseek-r1:32b', key: '' });
  assert.deepEqual([s.localConfig(b.id).name, s.localConfig(b.id).model, s.localConfig(b.id).key], ['Yeni ad', 'deepseek-r1:32b', 'anahtar']);
  assert.throws(() => s.saveLocal({ id: 'yok', url: b.url, model: 'x' }), { code: 'local-not-found' });
  const env = s.localEnv(s.localConfig(b.id), { NO_PROXY: 'sirket.example.com' });
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://10.0.0.5:1234');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-r1:32b');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'anahtar');
  assert.equal(env.NO_PROXY, 'sirket.example.com,localhost,127.0.0.1,10.0.0.5');
  assert.deepEqual(s.removeLocal(a.id).models.map((m) => m.name), ['Yeni ad']);
});

test('yerel model denemesi: model listesi, yanıt, uç nokta yok ve ulaşılamıyor durumları', async () => {
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })); }
    if (req.url === '/v1/messages' && mode === 'ok') { res.setHeader('content-type', 'application/json'); return res.end('{"content":[{"type":"text","text":"Merhaba"}]}'); }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await s.testLocal({ url }), { ok: true, models: ['model-a', 'model-b'], answered: false, kind: 'anthropic' });
    assert.deepEqual(await s.testLocal({ url: `${url}/v1`, model: 'model-a' }), { ok: true, models: ['model-a', 'model-b'], answered: true, kind: 'anthropic' });
    mode = 'eski';
    await assert.rejects(s.testLocal({ url, model: 'model-a' }), { code: 'no-messages-api' });
  } finally { server.close(); }
  await assert.rejects(s.testLocal({ url: 'http://127.0.0.1:9', model: 'x' }), { code: 'unreachable' });
});

test('OpenAI uyumlu sunucu: tür adresten ya da denemeden bulunur, oturum köprü üzerinden açılır', async () => {
  const { bridge } = await import('../src/kopru.js');
  bridge.origin = 'http://127.0.0.1:3210';
  let mode = 'ok';
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/models' && mode === 'liste') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'gw-a' }] })); }
    if (req.method === 'POST' && (req.url === '/chat/completions' || req.url === '/v1/chat/completions')) {
      if (mode === 'yetkisiz') { res.statusCode = 401; return res.end('anahtar gerekli'); }
      res.setHeader('content-type', 'application/json'); return res.end('{"choices":[{"message":{"content":"Merhaba"}}]}');
    }
    res.statusCode = req.method === 'GET' ? 405 : 404; res.end('yok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    // Tam adres: tür adresten anlaşılır; model listesi olmayan sunucuda model adı istenir
    await assert.rejects(s.testLocal({ url: `${root}/chat/completions` }), { code: 'no-model-list' });
    assert.deepEqual(await s.testLocal({ url: `${root}/chat/completions`, model: 'gw-a' }), { ok: true, models: [], answered: true, kind: 'openai' });
    mode = 'liste';
    assert.deepEqual(await s.testLocal({ url: `${root}/chat/completions/` }), { ok: true, models: ['gw-a'], answered: false, kind: 'openai' });
    // Kök adres: önce Anthropic uç noktası denenir, yoksa OpenAI uç noktası bulunur
    mode = 'ok';
    seen.length = 0;
    assert.deepEqual(await s.testLocal({ url: root, model: 'gw-a' }), { ok: true, models: [], answered: true, kind: 'openai' });
    assert.ok(seen.includes('POST /v1/chat/completions'));
    mode = 'yetkisiz';
    await assert.rejects(s.testLocal({ url: `${root}/chat/completions`, model: 'gw-a' }), (err) => err.code === 'bad-model' && /HTTP 401 anahtar gerekli/.test(err.detail));
  } finally { server.close(); }
  await assert.rejects(s.testLocal({ url: 'http://127.0.0.1:9/chat/completions', model: 'x' }), { code: 'unreachable' });

  for (const m of s.localStatus().models) s.removeLocal(m.id);
  const st = s.saveLocal({ name: 'Gateway', url: 'https://gateway.example.com/chat/completions/', model: 'gw-a', key: 'asil' });
  assert.deepEqual(st.models.map((m) => [m.url, m.kind, m.hasKey]), [['https://gateway.example.com/chat/completions', 'openai', true]]);
  const cfg = s.localConfig(st.models[0].id);
  const env = s.localEnv(cfg, {});
  assert.equal(env.ANTHROPIC_BASE_URL, `http://127.0.0.1:3210/kopru/${cfg.id}`);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, bridge.secret);
  assert.ok(!JSON.stringify(env).includes('asil'), 'asıl anahtar Claude Code sürecine verilmez');
  assert.equal(env.ANTHROPIC_MODEL, 'gw-a');
  // Seçimle belirtilen tür ve /v1 ile biten adres korunur; Anthropic türünde /v1 atılır
  const two = s.saveLocal({ url: 'http://localhost:8000/v1', model: 'm', kind: 'openai' }).models[1];
  assert.deepEqual([two.url, two.kind], ['http://localhost:8000/v1', 'openai']);
  const three = s.saveLocal({ id: two.id, url: 'http://localhost:8000/v1', model: 'm', kind: 'anthropic' }).models[1];
  assert.deepEqual([three.url, three.kind], ['http://localhost:8000', 'anthropic']);
  for (const m of s.localStatus().models) s.removeLocal(m.id);
});

test('yerel modeller dışa ve içe aktarılır: API anahtarı dosyada şifreli durur, anahtar yanlışsa hiçbir şey yazılmaz', () => {
  for (const m of s.localStatus().models) s.removeLocal(m.id);
  assert.throws(() => s.exportLocal({}), { code: 'nothing-to-export' });
  s.saveLocal({ name: 'Gateway', url: 'https://gateway.example.com/chat/completions', model: 'gw-a', key: 'cok-gizli-token' });
  s.saveLocal({ url: 'http://localhost:11434', model: 'qwen3-coder' });
  const file = s.exportLocal({});
  const text = JSON.stringify(file);
  assert.deepEqual([file.app, file.type, file.version], ['atolye', 'yerel-llm', 1]);
  assert.deepEqual(file.models.map((m) => [m.name, m.url, m.model, m.kind, Boolean(m.key)]), [
    ['Gateway', 'https://gateway.example.com/chat/completions', 'gw-a', 'openai', true],
    ['qwen3-coder', 'http://localhost:11434', 'qwen3-coder', 'anthropic', false],
  ]);
  assert.ok(!text.includes('cok-gizli-token'), 'anahtar dosyada açık durmaz');
  assert.ok(!('id' in file.models[0]));

  for (const m of s.localStatus().models) s.removeLocal(m.id);
  assert.throws(() => s.importLocal({ data: text }), { code: 'need-pass' });
  assert.throws(() => s.importLocal({ data: text, pass: 'yanlis' }), { code: 'bad-pass' });
  assert.equal(s.localStatus().models.length, 0, 'yanlış anahtarda hiçbir şey yazılmaz');
  assert.throws(() => s.importLocal({ data: '{bozuk', pass: 'atolye' }), { code: 'bad-file' });
  assert.throws(() => s.importLocal({ data: { app: 'baska', models: [] }, pass: 'atolye' }), { code: 'bad-file' });
  const r = s.importLocal({ data: text, pass: 'atolye' });
  assert.deepEqual([r.added, r.updated, r.status.models.map((m) => [m.name, m.kind, m.hasKey])], [2, 0, [['Gateway', 'openai', true], ['qwen3-coder', 'anthropic', false]]]);
  assert.equal(s.localConfig(r.status.models[0].id).key, 'cok-gizli-token');
  // Aynı dosya yeniden alınırsa kayıtlar çoğalmaz, güncellenir
  assert.deepEqual([s.importLocal({ data: file, pass: 'atolye' }).added, s.localStatus().models.length], [0, 2]);

  // Kullanıcının seçtiği anahtarla: varsayılan anahtar o dosyayı açmaz; anahtarsız dosyada anahtar sorulmaz
  const own = s.exportLocal({ pass: 'benim anahtarım' });
  assert.throws(() => s.importLocal({ data: own, pass: 'atolye' }), { code: 'bad-pass' });
  assert.equal(s.importLocal({ data: own, pass: 'benim anahtarım' }).updated, 2);
  assert.equal(s.importLocal({ data: { ...own, models: own.models.slice(1) } }).updated, 1);
  for (const m of s.localStatus().models) s.removeLocal(m.id);
});

test('skill klasörü eklenir (tek ya da üst klasör), listelenir ve kaldırılır; elle eklenmiş skill ezilmez', () => {
  const src = path.join(tmp, 'kaynak');
  const mk = (dir, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), text); };
  mk(path.join(src, 'Rapor Yaz'), '---\nname: rapor-yaz\ndescription: "Haftalık rapor yazar"\n---\nAdımlar…');
  fs.mkdirSync(path.join(src, 'Rapor Yaz', 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Rapor Yaz', 'sablon.txt'), 'şablon');
  mk(path.join(src, 'ikinci'), 'Başlıksız skill');
  assert.throws(() => s.addSkill(path.join(tmp, 'yok')), { code: 'no-dir' });
  assert.throws(() => s.addSkill(tmp), { code: 'no-skill' });
  assert.deepEqual(s.addSkill(path.join(src, 'Rapor Yaz')), ['rapor-yaz']);
  const dest = path.join(process.env.ATOLYE_SKILLS_DIR, 'rapor-yaz');
  assert.ok(fs.existsSync(path.join(dest, 'sablon.txt')));
  assert.ok(!fs.existsSync(path.join(dest, 'node_modules')), 'node_modules kopyalanmaz');
  // Copilot, Claude'un klasörüne bakmaz: skill onun kişisel klasörüne de kopyalanır
  const copilotDir = `${process.env.ATOLYE_SKILLS_DIR}-copilot`;
  assert.ok(fs.existsSync(path.join(copilotDir, 'rapor-yaz', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(copilotDir, 'rapor-yaz', 'sablon.txt')));
  assert.deepEqual(s.addSkill(src), ['ikinci', 'rapor-yaz'], 'üst klasör: içindeki bütün skill\'ler');
  assert.deepEqual(s.listSkills().map((x) => [x.name, x.description, x.exists, x.copilot]), [['rapor-yaz', 'Haftalık rapor yazar', true, true], ['ikinci', '', true, true]]);
  // Copilot oturumunun "/" listesi: Copilot'un kendi bildirdiği komut yinelenmez
  assert.deepEqual(s.skillCommands([{ name: 'ikinci' }, { name: 'help' }]), [{ name: 'rapor-yaz', description: 'Haftalık rapor yazar' }]);
  // "/skill istek": Copilot tanımıyorsa düz isteğe çevrilir ve skill'in yeri bildirilir
  const call = s.skillPrompt('/rapor-yaz  bu haftayı özetle\nikinci satır', [{ name: 'help' }]);
  assert.deepEqual([call.name, call.rest], ['rapor-yaz', 'bu haftayı özetle\nikinci satır']);
  assert.ok(call.note.includes(path.join(copilotDir, 'rapor-yaz', 'SKILL.md')));
  assert.equal(s.skillPrompt('/rapor-yaz x', [{ name: 'rapor-yaz' }]), null, 'Copilot komutu tanıyorsa dokunulmaz');
  assert.equal(s.skillPrompt('/compact', []), null, 'skill olmayan komut');
  assert.equal(s.skillPrompt('rapor-yaz bu haftayı özetle', []), null);
  mk(path.join(process.env.ATOLYE_SKILLS_DIR, 'elle'), 'kullanıcının kendi skill\'i');
  mk(path.join(tmp, 'baska', 'elle'), 'aynı adlı');
  assert.throws(() => s.addSkill(path.join(tmp, 'baska', 'elle')), { code: 'exists' });
  assert.throws(() => s.removeSkill('elle'), { code: 'not-found' });
  assert.deepEqual(s.removeSkill('rapor-yaz').map((x) => x.name), ['ikinci']);
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(path.join(copilotDir, 'rapor-yaz')), 'Copilot kopyası da kaldırılır');

  // Eski sürümle eklenmiş kayıt (Copilot kopyası yok) açılışta tamamlanır; kullanıcının Copilot'a kendi koyduğu ezilmez
  const file = path.join(path.dirname(process.env.ATOLYE_STATE_FILE), 'skiller.json');
  mk(path.join(process.env.ATOLYE_SKILLS_DIR, 'eski'), '---\nname: eski\n---\nAtölye kopyası');
  mk(path.join(process.env.ATOLYE_SKILLS_DIR, 'cakisan'), 'Atölye kopyası');
  mk(path.join(copilotDir, 'cakisan'), 'kullanıcının Copilot skill\'i');
  fs.rmSync(path.join(copilotDir, 'ikinci'), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ skills: [{ name: 'ikinci' }, { name: 'eski' }, { name: 'cakisan' }] }));
  assert.equal(s.syncSkills(), 2);
  assert.equal(fs.readFileSync(path.join(copilotDir, 'eski', 'SKILL.md'), 'utf8'), '---\nname: eski\n---\nAtölye kopyası');
  assert.equal(fs.readFileSync(path.join(copilotDir, 'cakisan', 'SKILL.md'), 'utf8'), 'kullanıcının Copilot skill\'i');
  assert.equal(s.syncSkills(), 0, 'ikinci kez yapılacak iş yok');
  s.removeSkill('cakisan');
  assert.ok(fs.existsSync(path.join(copilotDir, 'cakisan', 'SKILL.md')), 'kullanıcının Copilot skill\'i silinmez');
  s.removeSkill('eski');
  assert.ok(fs.existsSync(path.join(process.env.ATOLYE_SKILLS_DIR, 'elle', 'SKILL.md')), 'elle eklenen skill yerinde');
});

test('Copilot oturumunda "/skill" mesajı: düz istek ve gizli yönerge olarak gider; Claude oturumunda olduğu gibi kalır', async () => {
  const { SessionManager } = await import('../src/manager.js');
  const m = new SessionManager({});
  const sent = [];
  const copilot = { agent: { work: 'agent', commands: [{ name: 'help' }], send: (t) => sent.push(t) }, subs: new Set(), engine: 'copilot' };
  const claude = { agent: { work: 'agent', send: (t) => sent.push(t) }, subs: new Set(), engine: 'claude' };
  const go = (entry, text, work = 'agent') => { try { m.send(entry, text, [], 'tr', [], work); } catch { /* olay yayımı bu sahte kayıtta önemsiz */ } };
  go(copilot, '/ikinci canlı 90 için hazırla');
  assert.match(sent[0], /^canlı 90 için hazırla\n\n<system-reminder>The user invoked the skill "ikinci"\. /);
  assert.ok(sent[0].includes(path.join(`${process.env.ATOLYE_SKILLS_DIR}-copilot`, 'ikinci', 'SKILL.md')));
  go(copilot, '/ikinci');
  assert.match(sent[1], /^"ikinci" skill'ini kullan\.\n\n<system-reminder>The user invoked/);
  go(copilot, '/ikinci özetle', 'ask');
  assert.match(sent[2], /<\/system-reminder>\n\n<system-reminder>Ask mode:/, 'Ask kipinin yönergesi de eklenir');
  go(copilot, '/help', 'agent');
  assert.equal(sent[3], '/help', 'Copilot\'un kendi komutu olduğu gibi gider');
  go(claude, '/ikinci canlı 90 için hazırla');
  assert.equal(sent[4], '/ikinci canlı 90 için hazırla', 'Claude Code\'da skill zaten komuttur');

  // Atölye ile eklenmemiş, elle konmuş skill'ler de her oturum türünde çalışır
  const claudeDir = process.env.ATOLYE_SKILLS_DIR;
  const copilotDir = `${claudeDir}-copilot`;
  const proje = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-proje-'));
  const koy = (dir, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), text); };
  koy(path.join(claudeDir, 'elle-claude'), '---\nname: elle-claude\ndescription: Claude klasörüne elle kondu\n---\n');
  koy(path.join(copilotDir, 'elle-copilot'), '---\nname: elle-copilot\ndescription: Copilot klasörüne elle kondu\n---\n');
  koy(path.join(proje, '.claude', 'skills', 'proje-isi'), '---\nname: proje-isi\n---\n');
  try {
    // Copilot oturumu: Claude klasöründeki ve projedeki skill listede çıkar, yerinden okunur
    const liste = s.skillCommands([{ name: 'help' }], proje, 'copilot').map((x) => x.name);
    for (const ad of ['elle-claude', 'elle-copilot', 'proje-isi']) assert.ok(liste.includes(ad), `${ad} Copilot listesinde`);
    go({ ...copilot, cwd: proje }, '/elle-claude rapor çıkar');
    assert.match(sent[5], /^rapor çıkar\n\n<system-reminder>The user invoked the skill "elle-claude"\. /);
    assert.ok(sent[5].includes(path.join(claudeDir, 'elle-claude', 'SKILL.md')), 'kopyalanmaz, Claude klasöründen okunur');
    go({ ...copilot, cwd: proje }, '/proje-isi başla');
    assert.ok(sent[6].includes(path.join(proje, '.claude', 'skills', 'proje-isi', 'SKILL.md')));
    assert.equal(s.skillPrompt('/proje-isi başla', [], '', 'copilot'), null, 'proje skill\'i başka klasörde geçerli değildir');
    // Claude Code / yerel LLM oturumu: yalnızca Copilot klasöründeki skill Atölye'nin yardımıyla çalışır
    assert.deepEqual(s.skillCommands([], proje, 'claude').map((x) => x.name), ['cakisan', 'elle-copilot'], 'önceki testten kalan cakisan da yalnızca Copilot klasöründe');
    go({ ...claude, cwd: proje }, '/elle-copilot özetle');
    assert.match(sent[7], /^özetle\n\n<system-reminder>The user invoked the skill "elle-copilot"\. /);
    assert.ok(sent[7].includes(path.join(copilotDir, 'elle-copilot', 'SKILL.md')));
    go({ ...claude, cwd: proje }, '/proje-isi başla');
    assert.equal(sent[8], '/proje-isi başla', 'proje skill\'ini Claude Code kendisi yükler');
    // Ayarlar: Atölye ile eklenmemiş skill'ler ayrı listelenir
    const diger = s.otherSkills();
    assert.deepEqual(diger.find((x) => x.name === 'elle-claude'), { name: 'elle-claude', description: 'Claude klasörüne elle kondu', where: 'claude' });
    assert.equal(diger.find((x) => x.name === 'elle-copilot').where, 'copilot');
    assert.ok(!diger.some((x) => x.name === 'ikinci'), 'Atölye ile eklenen bu listede yinelenmez');
  } finally {
    fs.rmSync(proje, { recursive: true, force: true });
    fs.rmSync(path.join(claudeDir, 'elle-claude'), { recursive: true, force: true });
    fs.rmSync(path.join(copilotDir, 'elle-copilot'), { recursive: true, force: true });
  }
});

test('disk kullanımı: klasör boyutu ve oturum özeti (motorlara göre, en büyükler)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-boyut-'));
  try {
    fs.mkdirSync(path.join(dir, 'alt', 'derin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dir, 'alt', 'b.txt'), 'x'.repeat(250));
    fs.writeFileSync(path.join(dir, 'alt', 'derin', 'c.txt'), 'x'.repeat(50));
    assert.deepEqual(s.dirSize(dir), { bytes: 400, files: 3, partial: false });
    const kisitli = s.dirSize(dir, 2);
    assert.equal(kisitli.partial, true, 'sınır aşılınca yarım sonuç olduğu bildirilir');
    assert.equal(kisitli.files, 2);
    assert.deepEqual(s.dirSize(path.join(dir, 'yok')), { bytes: 0, files: 0, partial: false }, 'olmayan klasör hata vermez');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const u = s.sessionUsage([
    { id: 'a', engine: 'claude', size: 3000, title: 'A', cwd: '/p', lastModified: 1 },
    { id: 'b', engine: 'claude', size: 500, title: 'B', cwd: '/p', lastModified: 2 },
    { id: 'c', engine: 'copilot', size: 9000, title: 'C', cwd: '/q', lastModified: 3 },
    { id: 'd', engine: 'yerel', title: 'D', cwd: '/q', lastModified: 4 },
  ], 2);
  assert.equal(u.count, 4);
  assert.equal(u.bytes, 12500);
  assert.deepEqual(u.engines, { claude: { count: 2, bytes: 3500 }, copilot: { count: 1, bytes: 9000 }, yerel: { count: 1, bytes: 0 } });
  assert.deepEqual(u.largest.map((x) => x.title), ['C', 'A'], 'en büyükler, boyutu bilinmeyen listelenmez');
});

test('eski oturumlar: gün ya da tarih sınırı; açık oturumlar seçilmez', () => {
  const now = new Date(2026, 10, 17, 12, 0, 0).getTime();
  const day = 24 * 60 * 60 * 1000;
  assert.equal(s.cleanupCutoff({ days: 30 }, now), now - 30 * day);
  assert.equal(s.cleanupCutoff({ before: '2026-10-01' }, now), new Date(2026, 9, 1).getTime());
  assert.throws(() => s.cleanupCutoff({ days: 0 }, now), { code: 'bad-days' });
  assert.throws(() => s.cleanupCutoff({ before: '2027-01-01' }, now), { code: 'bad-date' });
  const sessions = [{ id: 'a', lastModified: now - 40 * day }, { id: 'b', lastModified: now - 5 * day }, { id: 'c', lastModified: now - 90 * day }, { id: null, lastModified: 0 }];
  assert.deepEqual(s.selectOld(sessions, now - 30 * day, new Set(['c'])).map((x) => x.id), ['a']);
});

test('sohbet araması: büyük/küçük harf ve Türkçe i/ı ayrımı gözetmez; araç çıktısı ve gizli yönerge aranmaz', () => {
  assert.equal(fold('JİRA Işık'), fold('jira ışık'));
  assert.equal(claudeLineText('{"type":"user","isMeta":true,"message":{"content":"x"}}'), null);
  assert.equal(claudeLineText('{"type":"user","message":{"content":[{"type":"tool_result","content":"gizli çıktı"}]}}'), null);
  assert.equal(copilotEventText({ type: 'user_prompt', text: 'soru<system-reminder>yönerge</system-reminder>' }).text, 'soru ');
  const dir = path.join(tmp, 'projeler', 'p1');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'oturum-1.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'Sipariş iptalinde İADE kuralı nedir?' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'İade kuralı şöyle işler: iade 14 gün içinde yapılır.' }, { type: 'tool_use', name: 'Read', input: { file: 'iade.js' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'iade iade iade' }] } }),
  ].join('\n'));
  const files = new Map([['oturum-1', file]]);
  const sessions = [
    { id: 'oturum-1', engine: 'claude', cwd: 'C:\\dev\\p1', title: 'Sipariş kuralları', lastModified: 3 },
    { id: 'cp-1', engine: 'copilot', cwd: 'C:\\dev\\p2', title: 'Başka konu', lastModified: 2 },
    { id: 'cp-2', engine: 'copilot', cwd: 'C:\\dev\\p2', title: 'iade başlıklı', lastModified: 1 },
  ];
  const readCopilot = (id) => (id === 'cp-1' ? [{ type: 'user_prompt', text: 'Log ara' }, { type: 'sdk', msg: { type: 'assistant', message: { content: [{ type: 'text', text: 'Kayıtlarda IADE hatası var.' }] } } }] : []);
  const r = searchSessions({ q: 'iade', sessions, readCopilot, files });
  assert.deepEqual(r.map((x) => [x.id, x.count, x.inTitle]), [['oturum-1', 3, false], ['cp-1', 1, false], ['cp-2', 0, true]]);
  assert.deepEqual(r[0].snippet, { role: 'user', before: 'Sipariş iptalinde ', match: 'İADE', after: ' kuralı nedir?' });
  assert.equal(r[1].snippet.match, 'IADE');
  assert.deepEqual(searchSessions({ q: 'a', sessions, readCopilot, files }), [], 'tek harf aranmaz');
  assert.deepEqual(searchSessions({ q: 'bulunmayan', sessions, readCopilot, files }), []);
});

test('durum: yerel oturumlar işaretlenir; elle sıralama yeni oturumları üstte bırakır', () => {
  const store = new StateStore(path.join(tmp, 'sira', 'durum.json'));
  store.recordLocalSession('y1');
  store.recordLocalSession('y1');
  assert.equal(store.isLocalSession('y1'), true);
  // Hangi yerel modelle açıldığı da saklanır (motor seçicisindeki süzgeç ve simge için); eski kayıtta model yoktur
  assert.equal(store.localModelOf('y1'), null);
  store.recordLocalSession('y1', 'm1');
  store.recordLocalSession('y2', 'm2');
  assert.deepEqual([store.localModelOf('y1'), store.localModelOf('y2'), store.localModelOf('yok')], ['m1', 'm2', null]);
  store.recordLocalSession('y1');
  assert.equal(store.localModelOf('y1'), 'm1', 'modelsiz çağrı kaydı silmez');
  store.deleteLocalSession('y1');
  assert.equal(store.isLocalSession('y1'), false);
  assert.equal(store.localModelOf('y1'), null);
  assert.equal(store.localModelOf('y2'), 'm2');
  const list = [{ id: 'yeni' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(store.applySessionOrder('C:\\p', list), list);
  store.setSessionOrder('C:\\p', ['c', 'a', 'b', 'silinmis']);
  assert.deepEqual(store.applySessionOrder('C:\\P\\', list).map((x) => x.id), ['yeni', 'c', 'a', 'b']);
  assert.deepEqual(new StateStore(path.join(tmp, 'sira', 'durum.json')).applySessionOrder('C:\\p', list).map((x) => x.id), ['yeni', 'c', 'a', 'b'], 'diske yazılır');
});

test('oturum başlığına gizli yönerge girmez', async () => {
  const { shortTitle } = await import('../src/title.js');
  assert.equal(shortTitle('Merhaba, kimsin?<system-reminder>Ask mode: answer…</system-reminder>'), 'Merhaba, kimsin?');
  assert.equal(shortTitle('Soru\n<system-reminder>yarım kalan'), 'Soru');
});

test('klasör sırası: sürüklenen sıra saklanır; listede olmayan klasör sona kalır', () => {
  const store = new StateStore(path.join(tmp, 'klasor', 'durum.json'));
  for (const p of ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d']) store.addProject(p);
  store.setProjectOrder(['C:\\c', 'c:\\A\\', 'C:\\yok']);
  assert.deepEqual(store.get().projects, ['C:\\c', 'C:\\a', 'C:\\b', 'C:\\d']);
  assert.deepEqual(new StateStore(path.join(tmp, 'klasor', 'durum.json')).get().projects, ['C:\\c', 'C:\\a', 'C:\\b', 'C:\\d']);
});
