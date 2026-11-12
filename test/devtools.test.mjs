// Geliştirici bağlantıları (Jenkins, OpenText Fortify SSC, WebLogic): sahte sunuculara karşı giriş biçimi,
// adresler ve çıktı. Gerçek sunuculara ya da gerçek ayar dosyalarına dokunulmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { availableTools, callTool, TOOLS } from '../src/mcp-server.js';

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const seen = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  seen.push(`${req.method} ${p}`);
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const auth = req.headers.authorization;
  const deny = () => { res.statusCode = 401; res.end('Unauthorized'); };

  // ----- Jenkins: kullanıcı adı + API belirteci (Basic) -----
  if (p.startsWith('/jenkins')) {
    if (auth !== basic('gelistirici', 'jk-belirtec')) return deny();
    const q = p.slice('/jenkins'.length);
    if (q === '/whoAmI/api/json') return json({ name: 'gelistirici', authenticated: true, anonymous: false });
    if (q === '/job/takim/api/json') return json({ jobs: [{ name: 'proje', color: 'red', lastBuild: { number: 42, result: 'FAILURE', timestamp: Date.UTC(2026, 0, 2, 10, 0) } }, { name: 'alt-klasor' }] });
    if (q === '/job/takim/job/proje/lastBuild/api/json') return json({ number: 42, result: 'FAILURE', building: false, duration: 61000, timestamp: Date.UTC(2026, 0, 2, 10, 0), url: 'http://x/job/takim/job/proje/42/', fullDisplayName: 'takim » proje #42', changeSets: [{ items: [{ msg: 'port düzeltmesi', author: { fullName: 'Ayşe' } }] }], actions: [{ causes: [{ shortDescription: 'Started by user Ali' }] }, {}] });
    if (q === '/job/takim/job/proje/42/consoleText') return res.end(Array.from({ length: 500 }, (_, i) => `satır ${i + 1}`).join('\n') + '\nBUILD FAILURE: Test başarısız');
    if (q === '/crumbIssuer/api/json') return json({ crumbRequestField: 'Jenkins-Crumb', crumb: 'kirinti' });
    if (req.method === 'POST' && q === '/job/takim/job/proje/buildWithParameters') {
      if (req.headers['jenkins-crumb'] !== 'kirinti' || u.searchParams.get('DAL') !== 'main') { res.statusCode = 400; return res.end('eksik'); }
      res.statusCode = 201; return res.end('');
    }
  }
  // ----- Fortify SSC: "FortifyToken" şeması -----
  if (p.startsWith('/ssc')) {
    if (auth !== 'FortifyToken fy-belirtec') return deny();
    const q = p.slice('/ssc'.length);
    if (q === '/api/v1/projectVersions') return json({ count: 2, data: [{ id: 7, name: '1.0', project: { name: 'Rezervasyon' } }, { id: 8, name: 'main', project: { name: 'Bilet' } }] });
    if (q === '/api/v1/projectVersions/7/issues') return json({ count: 2, data: [
      { id: 101, issueName: 'SQL Injection', friority: 'Critical', primaryLocation: 'Dao.java', lineNumber: 55 },
      { id: 102, issueName: 'Log Forging', friority: 'Low', primaryLocation: 'Log.java', lineNumber: 9, audited: true }] });
    if (q === '/api/v1/issueDetails/101') return json({ data: { issueName: 'SQL Injection', friority: 'Critical', fullFileName: 'src/Dao.java', lineNumber: 55, kingdom: 'Input Validation', brief: '<p>Sorgu <b>birleştirilerek</b> kuruluyor</p>', recommendation: '<p>Parametreli sorgu kullanın</p>' } });
  }
  // ----- WebLogic: kullanıcı adı + parola (Basic), REST yönetim arayüzü -----
  if (p.startsWith('/management/weblogic/latest')) {
    if (auth !== basic('izleyici', 'wl-parola')) return deny();
    const q = p.slice('/management/weblogic/latest'.length);
    if (q === '/domainRuntime') return json({ name: 'ornek_domain' });
    if (q === '/domainRuntime/serverRuntimes') return json({ items: [{ name: 'AdminServer', state: 'RUNNING', healthState: { state: 'ok' }, weblogicVersion: 'WebLogic Server 15.1.1.0.0' }, { name: 'ms1', state: 'RUNNING', healthState: { state: 'warn' } }] });
    if (q === '/domainRuntime/serverRuntimes/ms1/applicationRuntimes') return json({ items: [{ name: 'rezervasyon', overallHealthState: { state: 'ok' } }] });
    if (q === '/domainConfig/appDeployments') return json({ items: [{ name: 'rezervasyon', sourcePath: '/u01/app/rezervasyon.ear', targets: [{ identity: ['clusters', 'kume1'] }] }] });
    if (q === '/domainRuntime/serverRuntimes/ms1/JDBCServiceRuntime/JDBCDataSourceRuntimeMBeans') return json({ items: [{ name: 'anaDS', state: 'Running', activeConnectionsCurrentCount: 4, waitingForConnectionCurrentCount: 0, failuresToReconnectCount: 1 }] });
  }
  res.statusCode = 404; res.end('yok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const env = {
  JENKINS_URL: `${base}/jenkins`, JENKINS_EMAIL: 'gelistirici', JENKINS_TOKEN: 'jk-belirtec',
  FORTIFY_URL: `${base}/ssc`, FORTIFY_TOKEN: 'fy-belirtec',
  WEBLOGIC_URL: base, WEBLOGIC_EMAIL: 'izleyici', WEBLOGIC_TOKEN: 'wl-parola',
};
const text = async (name, args = {}, e = env) => (await callTool(name, args, e)).content[0].text;

test('araçlar: yalnızca bağlı servisler sunulur; yazan tek geliştirici aracı derleme başlatmadır', () => {
  assert.equal(availableTools(env).length, 11);
  assert.deepEqual(availableTools({ FORTIFY_URL: base, FORTIFY_TOKEN: 'x' }).map((t) => t.name), ['fortify_list_versions', 'fortify_list_issues', 'fortify_get_issue']);
  const writes = Object.entries(TOOLS).filter(([, t]) => t.write && ['jenkins', 'fortify', 'weblogic'].includes(t.service)).map(([n]) => n);
  assert.deepEqual(writes, ['jenkins_trigger_build']);
});

test('Jenkins: işler, derleme sonucu, konsolun sonu ve derleme başlatma', async () => {
  assert.equal(await text('jenkins_list_jobs', { folder: 'takim' }), 'takim/proje — #42 FAILURE 2026-01-02 10:00\ntakim/alt-klasor — klasör');
  const build = await text('jenkins_get_build', { job: 'takim/proje' });
  assert.match(build, /takim » proje #42: FAILURE/);
  assert.match(build, /Süre: 61 sn/);
  assert.match(build, /Sebep: Started by user Ali/);
  assert.match(build, /- port düzeltmesi \(Ayşe\)/);
  const log = await text('jenkins_get_console', { job: 'takim/proje', build: 42, lines: 3 });
  assert.match(log, /^… \(498 satır atlandı; son 3 satır\)\nsatır 499\nsatır 500\nBUILD FAILURE: Test başarısız$/);
  assert.equal(await text('jenkins_trigger_build', { job: 'takim/proje', parameters: { DAL: 'main' } }), 'Derleme sıraya alındı: takim/proje (DAL=main)');
  const bad = await callTool('jenkins_list_jobs', { folder: 'takim' }, { ...env, JENKINS_TOKEN: 'yanlis' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /401/);
});

test('Fortify: uygulama sürümleri, bulgular ve bulgu ayrıntısı', async () => {
  assert.equal(await text('fortify_list_versions', { query: 'rezer' }), '7 | Rezervasyon / 1.0');
  const issues = await text('fortify_list_issues', { versionId: 7 });
  assert.match(issues, /^Toplam 2 bulgu \(gösterilen 2\):\n101 \| Critical \| SQL Injection \| Dao\.java:55\n102 \| Low \| Log Forging \| Log\.java:9 \| incelendi$/);
  assert.match(await text('fortify_list_issues', { versionId: 7, severity: 'critical' }), /gösterilen 1\)/);
  const issue = await text('fortify_get_issue', { id: 101 });
  assert.match(issue, /SQL Injection \[Critical\]\nDosya: src\/Dao\.java:55/);
  assert.match(issue, /Özet:\nSorgu birleştirilerek kuruluyor/);
  assert.match(issue, /Öneri:\nParametreli sorgu kullanın/);
});

test('WebLogic: sunucular, uygulamalar, dağıtımlar ve veri kaynakları (yalnızca okuma)', async () => {
  assert.equal(await text('weblogic_servers'), 'AdminServer — RUNNING | sağlık: ok | WebLogic Server 15.1.1.0.0\nms1 — RUNNING | sağlık: warn');
  assert.equal(await text('weblogic_applications', { server: 'ms1' }), 'rezervasyon — sağlık: ok');
  assert.equal(await text('weblogic_deployments'), 'rezervasyon → kume1 (/u01/app/rezervasyon.ear)');
  assert.equal(await text('weblogic_datasources', { server: 'ms1' }), 'anaDS — Running | etkin bağlantı: 4 | bekleyen: 0 | yeniden bağlanma hatası: 1');
  // Konsol adresi yapıştırılsa da REST adresi doğru kurulur
  assert.equal(await text('weblogic_servers', {}, { ...env, WEBLOGIC_URL: `${base}/console` }), await text('weblogic_servers'));
  assert.ok(!seen.some((s) => s.startsWith('POST /management')), 'WebLogic\'e yazma isteği gitmez');
});
