// Fikirhane bağlantısı: araçlar sahte bir Fikirhane'ye karşı çalışır (gerçek ~/.fikirhane ve ~/.atolye'ye dokunulmaz).
// Sahte sunucu gerçeğiyle aynı kapı kuralını uygular: açılışta kapi.json yazar, soru başlığı gelen yanıtı imzalar.
// Senaryo betiği olarak Playwright gerektirmeyen küçük bir deneme betiği verilir; tarayıcı açılmaz.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-fikirhane-'));
const home = path.join(tmp, 'fikirhane');
const work = path.join(tmp, 'atolye-fikirhane');
fs.mkdirSync(home, { recursive: true });
process.env.ATOLYE_CLAUDE_JSON = path.join(tmp, 'claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(tmp, 'copilot', 'mcp-config.json');
process.env.FIKIRHANE_HOME = home;
process.env.ATOLYE_FIKIRHANE_DIR = work;

const { availableTools, callTool } = await import('../src/mcp-server.js');
const { configFromEnv } = await import('../src/atlassian.js');
const integrations = await import('../src/integrations.js');
const fikirhane = await import('../src/fikirhane.js');

// ---------- Sahte Fikirhane ----------
const key = crypto.randomBytes(32).toString('hex');
let signWith = key; // yanlış anahtarla imzalamak ya da hiç imzalamamak (null) için değiştirilir
const seen = [];
const sites = [{ id: 'site1', name: 'Üye Uygulaması', origin: 'https://uygulama.example.com', screens: 3 }];
const scenarios = [{ id: 's1a2b3', name: 'Üye ekle', steps: 4, vars: ['ad'] }, { id: 's4d5e6', name: 'Üye sil', steps: 2, vars: [] }];
const SCRIPT = `const E = process.env;
if (process.argv.includes('--giris')) { console.log('Oturum kaydedildi.'); process.exit(0); }
console.log(E.FIKIRHANE_VAR_AD === 'kal' ? 'KALDI: Üye ekle 3. adımda (3/4)' : 'GEÇTİ: Üye ekle (4 adım, 0.1 sn)');
console.log(JSON.stringify({ ad: E.FIKIRHANE_VAR_AD, pw: E.FIKIRHANE_PLAYWRIGHT, kanal: E.FIKIRHANE_KANAL, profil: E.FIKIRHANE_PROFIL, gorunur: E.FIKIRHANE_GORUNUR || '', sizan: Object.keys(E).filter((k) => /TOKEN|JIRA|^ATOLYE|ANTHROPIC|COMPAT/i.test(k)) }));
process.exit(E.FIKIRHANE_VAR_AD === 'kal' ? 1 : 0);
`;
const siteList = () => ({ sites, text: sites.map((s) => `- [${s.id}] ${s.name} — ${s.origin} (${s.screens} ekran)`).join('\n') || 'Fikirhane\'de gezilmiş site yok. Önce Fikirhane\'de "Site gez" ile uygulama tanıtılmalı.' });
function route(method, url, body) {
  const u = new URL(url, 'http://x');
  const p = u.pathname;
  if (method === 'GET' && p === '/api/sites') return siteList();
  if (method === 'GET' && p === '/api/sites/find') return u.searchParams.get('q').includes('yok')
    ? { results: [], text: 'Eşleşen ekran bulunamadı.' }
    : { results: [{ site: 'site1', no: 2 }], text: `[site1] Ekran 2: Üyeler — https://uygulama.example.com/uyeler\n- düğme Üye ekle: getByRole('button', { name: 'Üye ekle' })` };
  if (method === 'GET' && p === '/api/sites/site1') return { text: '# Üye Uygulaması\n## Ekranlar\n1. Giriş — /giris\n2. Üyeler — /uyeler\n## Senaryolar (kayıtlı, yeniden çalıştırılabilir)\n- [s1a2b3] Üye ekle (4 adım) — geçti' };
  if (method === 'GET' && p === '/api/sites/site1/screens/2') return { text: 'Ekran 2: Üyeler\nDüğmeler:\n- Üye ekle: getByRole(\'button\', { name: \'Üye ekle\' })' };
  if (method === 'GET' && p === '/api/sites/site1/route/2') return { text: 'page.goto(\'https://uygulama.example.com/uyeler\')' };
  if (method === 'GET' && p === '/api/sites/site1/scenarios') return { scenarios, text: scenarios.map((s) => `- [${s.id}] ${s.name} (${s.steps} adım)`).join('\n') };
  if (method === 'GET' && p === '/api/sites/site1/scenarios/s1a2b3') return { text: 'Üye ekle\n1. Üyeler ekranına git\n2. "Üye ekle" düğmesine tıkla' };
  if (method === 'GET' && p === '/api/sites/site1/scenarios/s1a2b3/script') return { file: 'uye-ekle.mjs', vars: ['ad'], script: SCRIPT };
  if (method === 'POST' && p === '/api/sites/site1/scenarios') {
    return body.steps.length ? { ok: true, scenario: { id: 's777aa' }, text: `Kaydedildi.\n${body.name} (${body.steps.length} adım)` } : { ok: false, error: 'Senaryoda en az bir adım olmalı.', code: 'no-steps' };
  }
  return { ok: false, error: 'Bulunamadı.', code: 'not-found' };
}
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, body, mark: req.headers['x-fikirhane'] || '', soru: req.headers['x-fikirhane-soru'] || '' });
    const text = JSON.stringify(route(req.method, req.url, body));
    const head = { 'content-type': 'application/json' };
    if (signWith && req.headers['x-fikirhane-soru']) head['x-fikirhane-imza'] = crypto.createHmac('sha256', signWith).update([req.headers['x-fikirhane-soru'], `${req.method} ${req.url}`, text].join('\n')).digest('hex');
    res.writeHead(200, head);
    res.end(text);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const writeDoor = (extra = {}) => fs.writeFileSync(path.join(home, 'kapi.json'), JSON.stringify({ app: 'fikirhane', surum: '0.7.0', port: server.address().port, pid: process.pid, anahtar: key, ...extra }));
writeDoor();
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const ENV = { FIKIRHANE_ENABLED: '1', FIKIRHANE_HOME: home, ATOLYE_FIKIRHANE_DIR: work, FIKIRHANE_PLAYWRIGHT: path.join(tmp, 'sahte-playwright'), FIKIRHANE_KANAL: 'msedge' };
const call = async (name, args = {}) => { const r = await callTool(name, args, ENV); return { error: Boolean(r.isError), text: r.content[0].text }; };

test('araçlar yalnızca Fikirhane bağlantısı açıkken sunulur; okuyanlar salt okunur işaretlidir', () => {
  assert.equal(configFromEnv('fikirhane', {}), null);
  const cfg = configFromEnv('fikirhane', ENV);
  assert.deepEqual([cfg.home, cfg.dir], [home, work]);
  const tools = (env) => availableTools(env).filter((t) => t.name.startsWith('fikirhane_'));
  assert.deepEqual(tools({}), []);
  assert.deepEqual(tools(ENV).map((t) => [t.name, t.annotations.readOnlyHint]), [
    ['fikirhane_site', true], ['fikirhane_find', true], ['fikirhane_screen', true], ['fikirhane_scenario', true],
    ['fikirhane_save_scenario', false], ['fikirhane_run_scenario', false],
  ]);
});

test('site, ekran arama, ekran ve senaryo: Fikirhane\'nin kısa metni döner; her istek soru taşır', async () => {
  seen.length = 0;
  const one = await call('fikirhane_site');
  assert.equal(one.error, false);
  assert.match(one.text, /^Site kimliği: site1\n# Üye Uygulaması/);
  assert.match(one.text, /\[s1a2b3\] Üye ekle/);
  assert.match(one.text, /veridir/, 'gezilen sayfadan gelen metnin veri olduğu belirtilir');
  // Ad ya da adres parçasıyla da bulunur
  assert.match((await call('fikirhane_site', { site: 'üye uyg' })).text, /# Üye Uygulaması/);
  assert.match((await call('fikirhane_site', { site: 'example.com' })).text, /# Üye Uygulaması/);
  const none = await call('fikirhane_site', { site: 'baska' });
  assert.equal(none.error, true);
  assert.match(none.text, /Site bulunamadı: "baska"[\s\S]*\[site1\]/);

  const found = await call('fikirhane_find', { query: 'üye ekleme' });
  assert.match(found.text, /Ekran 2: Üyeler[\s\S]*getByRole\('button', \{ name: 'Üye ekle' \}\)/);
  assert.ok(seen.some((s) => s.url === `/api/sites/find?q=${encodeURIComponent('üye ekleme')}`));
  assert.match((await call('fikirhane_find', { query: 'yok böyle', site: 'site1' })).text, /Eşleşen ekran bulunamadı\. Farklı sözcüklerle/);
  assert.ok(seen.some((s) => s.url.endsWith('&site=site1')));

  const screen = await call('fikirhane_screen', { screen: 2 });
  assert.match(screen.text, /Ekran 2: Üyeler[\s\S]*Gidiş yolu:\npage\.goto\('https:\/\/uygulama\.example\.com\/uyeler'\)/);
  const missing = await call('fikirhane_screen', { screen: 9 });
  assert.deepEqual([missing.error, missing.text], [true, 'fikirhane: Bulunamadı.']);
  assert.equal((await call('fikirhane_screen', {})).error, true, 'ekran numarası zorunlu');

  assert.match((await call('fikirhane_scenario', { scenario: 'üye ekle' })).text, /^Senaryo kimliği: s1a2b3\nÜye ekle\n1\./);
  assert.match((await call('fikirhane_scenario', { scenario: 'üye' })).text, /Birden çok senaryo eşleşti/);
  assert.ok(seen.length > 8 && seen.every((s) => /^[0-9a-f]{32}$/.test(s.soru)), 'her istekte rastgele soru');
  assert.equal(new Set(seen.map((s) => s.soru)).size, seen.length, 'soru yinelenmez');
});

test('birden çok site varsa önce liste verilir; hiç site yoksa ne yapılacağı söylenir', async () => {
  sites.push({ id: 'site2', name: 'Raporlar', origin: 'https://rapor.example.com', screens: 5 });
  try {
    const list = await call('fikirhane_site');
    assert.match(list.text, /^Gezilmiş siteler[\s\S]*\[site1\][\s\S]*\[site2\]/);
    assert.match((await call('fikirhane_screen', { screen: 2 })).text, /Birden çok site var/);
    assert.match((await call('fikirhane_screen', { site: 'site1', screen: 2 })).text, /Ekran 2/);
  } finally { sites.pop(); }
  const keep = sites.splice(0);
  try { assert.match((await call('fikirhane_site')).text, /gezilmiş site yok\. Önce Fikirhane'de "Site gez"/); } finally { sites.push(...keep); }
});

test('Fikirhane çalışmıyorsa, kurulu değilse ya da doğrulanamıyorsa açıkça söylenir; doğrulanmayan yanıt kullanılmaz', async () => {
  // Yanlış anahtarla imzalayan ya da hiç imzalamayan program (aynı porta oturmuş başka bir şey)
  for (const bad of ['f'.repeat(64), null]) {
    signWith = bad;
    try {
      const r = await call('fikirhane_site');
      assert.equal(r.error, true);
      assert.match(r.text, /doğrulanamadı; yanıtı kullanılmadı/);
      assert.ok(!r.text.includes('Üye Uygulaması'));
    } finally { signWith = key; }
  }
  // Kapı dosyası yok: Fikirhane hiç çalışmamış ya da eski sürüm
  fs.renameSync(path.join(home, 'kapi.json'), path.join(home, 'kapi.yedek'));
  try {
    const r = await call('fikirhane_find', { query: 'üye' });
    assert.equal(r.error, true);
    assert.match(r.text, /Fikirhane bu bilgisayarda çalışmıyor[\s\S]*Fikirhane olmadan da sürdürülebilir/);
    assert.deepEqual(await fikirhane.probe(configFromEnv('fikirhane', ENV)).then((p) => [p.found, p.running]), [false, false]);
  } finally { fs.renameSync(path.join(home, 'kapi.yedek'), path.join(home, 'kapi.json')); }
  // Dosya var ama o portta kimse yok: Fikirhane kapanmış
  const closed = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  writeDoor({ port: closed });
  try {
    const r = await call('fikirhane_site');
    assert.equal(r.error, true);
    assert.match(r.text, /Fikirhane çalışmıyor: kayıtlı adresine ulaşılamadı/);
    const p = await fikirhane.probe(configFromEnv('fikirhane', ENV));
    assert.deepEqual([p.found, p.running, p.version], [true, false, '0.7.0']);
  } finally { writeDoor(); }
  // Bozuk kapı dosyası (anahtar biçimi yanlış) da "çalışmıyor" sayılır
  writeDoor({ anahtar: 'kisa' });
  try { assert.match((await call('fikirhane_site')).text, /çalışmıyor/); } finally { writeDoor(); }
});

test('senaryo kaydetme: değiştiren istek Fikirhane\'nin istediği başlıkla gider; Fikirhane\'nin hatası aktarılır', async () => {
  seen.length = 0;
  const steps = [{ do: 'goto', screen: 2 }, { do: 'click', locator: 'getByRole(\'button\', { name: \'Üye ekle\' })' }];
  const saved = await call('fikirhane_save_scenario', { name: 'Üye ekle', description: 'Yeni üye', steps });
  assert.deepEqual([saved.error, saved.text], [false, 'Senaryo kimliği: s777aa\nKaydedildi.\nÜye ekle (2 adım)']);
  const post = seen.find((s) => s.method === 'POST');
  assert.deepEqual([post.url, post.mark, post.body], ['/api/sites/site1/scenarios', '1', { name: 'Üye ekle', description: 'Yeni üye', steps }]);
  assert.ok(seen.filter((s) => s.method === 'GET').every((s) => !s.mark), 'okuma isteklerinde değiştirme başlığı yok');
  // Bazı modeller diziyi metin olarak gönderir
  assert.equal((await call('fikirhane_save_scenario', { name: 'Üye ekle', steps: JSON.stringify(steps) })).error, false);
  assert.match((await call('fikirhane_save_scenario', { name: 'Üye ekle', steps: 'tıkla' })).text, /adım nesnelerinden oluşan bir dizi/);
  const empty = await call('fikirhane_save_scenario', { name: 'Boş', steps: [] });
  assert.deepEqual([empty.error, empty.text], [true, 'fikirhane: Senaryoda en az bir adım olmalı.']);
});

test('senaryo çalıştırma: imzası doğrulanan betik yürütülür, çıktısı kısa döner; anahtarlar betiğe verilmez', async () => {
  // Eksik değişken: betik hiç çalıştırılmaz
  const need = await call('fikirhane_run_scenario', { scenario: 'Üye ekle' });
  assert.match(need.text, /^ÇALIŞTIRILAMADI: senaryo şu değişkenleri ister: ad\./);
  assert.equal(fs.existsSync(path.join(work, 'profil-site1')), false);

  const secrets = { JIRA_TOKEN: 'gizli-1', ANTHROPIC_AUTH_TOKEN: 'gizli-2', ATOLYE_TEAMS_ANAHTAR: 'gizli-3', __COMPAT_LAYER: 'DetectorsAppHealth' };
  Object.assign(process.env, secrets);
  try {
    const ok = await call('fikirhane_run_scenario', { scenario: 's1a2b3', variables: { ad: 'Ayşe', 'geçersiz ad': 'x' } });
    assert.equal(ok.error, false);
    const [first, json] = ok.text.split('\n');
    assert.equal(first, 'GEÇTİ: Üye ekle (4 adım, 0.1 sn)');
    assert.deepEqual(JSON.parse(json), { ad: 'Ayşe', pw: ENV.FIKIRHANE_PLAYWRIGHT, kanal: 'msedge', profil: path.join(work, 'profil-site1'), gorunur: '1', sizan: [] });
    assert.ok(!ok.text.includes('gizli-'));
    assert.equal(fs.readFileSync(path.join(work, 'site1-s1a2b3.mjs'), 'utf8'), SCRIPT);

    const hidden = await call('fikirhane_run_scenario', { scenario: 's1a2b3', variables: { ad: 'Ali' }, visible: false });
    assert.equal(JSON.parse(hidden.text.split('\n')[1]).gorunur, '');

    const failed = await call('fikirhane_run_scenario', { scenario: 's1a2b3', variables: { ad: 'kal' } });
    assert.equal(failed.error, false, 'kalan senaryo araç hatası değil, test sonucudur');
    assert.match(failed.text, /^KALDI: Üye ekle 3\. adımda[\s\S]*yalnızca ilgili adımı düzeltip fikirhane_save_scenario/);

    const login = await call('fikirhane_run_scenario', { scenario: 's1a2b3', login: true });
    assert.match(login.text, /^Giriş penceresi kapandı; oturum bu site için saklandı/);
  } finally { for (const k of Object.keys(secrets)) delete process.env[k]; }

  // Doğrulanmayan betik diske yazılmaz ve çalıştırılmaz
  fs.rmSync(path.join(work, 'site1-s1a2b3.mjs'));
  signWith = 'e'.repeat(64);
  try {
    const r = await call('fikirhane_run_scenario', { scenario: 's1a2b3', variables: { ad: 'Ayşe' } });
    assert.deepEqual([r.error, /doğrulanamadı/.test(r.text), fs.existsSync(path.join(work, 'site1-s1a2b3.mjs'))], [true, true, false]);
  } finally { signWith = key; }
});

test('betiğe giden ortam: anahtar, adres ve sağlayıcı değişkenleri ayıklanır; sistem değişkenleri kalır', () => {
  const env = fikirhane.runEnv({ PATH: 'p', SystemRoot: 'C:\\Windows', TEMP: 't', LOCALAPPDATA: 'l', JIRA_URL: 'u', JIRA_EMAIL: 'e', JIRA_TOKEN: 't', ORACLE_TOKEN: 'x', ANTHROPIC_BASE_URL: 'b',
    ANTHROPIC_AUTH_TOKEN: 'a', COPILOT_PROXY: 'c', HTTPS_PROXY: 'h', GITHUB_TOKEN: 'g', ATOLYE_YEREL_OTURUM: '1', OPENAI_API_KEY: 'o', __COMPAT_LAYER: 'x', FIKIRHANE_HOME: 'f' }, { FIKIRHANE_VAR_PAROLA: 'kullanıcının verdiği' });
  assert.deepEqual(Object.keys(env).sort(), ['FIKIRHANE_HOME', 'FIKIRHANE_VAR_PAROLA', 'LOCALAPPDATA', 'PATH', 'SystemRoot', 'TEMP']);
});

test('bağlantı açılır/kapanır: ayar CLI dosyalarına yazılır; "veri getir" yalnızca okuyan araçları sunar; sınama sürümü denetler', async () => {
  assert.equal(integrations.status().services.fikirhane.connected, false);
  assert.equal(integrations.setFikirhane(true).services.fikirhane.connected, true);
  const saved = JSON.parse(fs.readFileSync(process.env.ATOLYE_CLAUDE_JSON, 'utf8')).mcpServers.atolye.env;
  assert.deepEqual(saved, { FIKIRHANE_ENABLED: '1' }, 'adres ya da anahtar saklanmaz');
  assert.deepEqual(integrations.readTools('fikirhane').map((t) => t.name), ['fikirhane_site', 'fikirhane_find', 'fikirhane_screen', 'fikirhane_scenario']);
  const fetched = await integrations.runReadTool('fikirhane_find', { query: 'üye ekleme' });
  assert.deepEqual([fetched.ok, /Ekran 2: Üyeler/.test(fetched.text)], [true, true]);
  assert.equal((await integrations.runReadTool('fikirhane_run_scenario', { scenario: 's1a2b3' })).ok, false, 'değiştiren araç buradan çalışmaz');

  assert.deepEqual(await integrations.test('fikirhane'), { ok: true, user: 'Fikirhane 0.7.0 (1 site)' });
  writeDoor({ surum: '0.6.0' });
  try { assert.match((await integrations.test('fikirhane')).error, /sürümü eski \(0\.6\.0\); en az 0\.7\.0/); } finally { writeDoor(); }
  const p = await fikirhane.probe(configFromEnv('fikirhane', ENV));
  assert.deepEqual([p.found, p.running, p.version, p.port, p.sites], [true, true, '0.7.0', server.address().port, [{ id: 'site1', name: 'Üye Uygulaması', origin: 'https://uygulama.example.com', screens: 3 }]]);
  assert.ok(!JSON.stringify(p).includes(key), 'durum bilgisinde kapı anahtarı yer almaz');

  assert.equal(integrations.setFikirhane(false).services.fikirhane.connected, false);
  assert.equal(JSON.parse(fs.readFileSync(process.env.ATOLYE_CLAUDE_JSON, 'utf8')).mcpServers?.atolye, undefined);
});
