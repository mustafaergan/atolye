// Uygulama sunucusu (Tomcat) bağlantısı: IntelliJ ayar okuyucusu, server.xml uyarlaması, profiller ve maskeleme.
// Gerçek Tomcat ile uçtan uca deneme yalnızca ATOLYE_TOMCAT_TEST_HOME (Tomcat klasörü) ve ATOLYE_TOMCAT_TEST_JAVA
// (Java klasörü) verildiğinde çalışır; verilmezse atlanır.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-tomcat-'));
process.env.ATOLYE_TOMCAT_FILE = path.join(tmp, 'tomcat.json');
process.env.ATOLYE_TOMCAT_WORK = path.join(tmp, 'calisma');
process.env.ATOLYE_JETBRAINS_DIR = path.join(tmp, 'jetbrains', 'IntelliJIdea2025.2');
// Sunucu testi için: gerçek ayar dosyalarına dokunulmaz
process.env.ATOLYE_STATE_FILE = path.join(tmp, 'durum.json');
process.env.ATOLYE_CLAUDE_JSON = path.join(tmp, 'claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(tmp, 'copilot-mcp.json');
process.env.ATOLYE_ENV_FILE = path.join(tmp, '.env');
process.env.ATOLYE_AI_TITLE = '0';

const intellij = await import('../src/intellij.js');
const tomcat = await import('../src/tomcat.js');

after(() => { tomcat._reset(); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); });

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const fwd = (p) => p.replace(/\\/g, '/');

// Sahte Tomcat (yalnızca okuyucunun aradığı dosyalar) ve sahte JDK
const fakeTomcat = path.join(tmp, 'apache-tomcat-9.0.99');
write(path.join(fakeTomcat, 'bin', 'bootstrap.jar'), '');
write(path.join(fakeTomcat, 'lib', 'servlet-api.jar'), '');
const fakeJdk = path.join(tmp, 'jdk-17');
write(path.join(fakeJdk, 'bin', 'java.exe'), '');

const project = path.join(tmp, 'proje');

/** IntelliJ projesi: Tomcat çalıştırma ayarı, Maven modülü, artifact, proje JDK'sı */
function makeProject({ tomcatHome = fakeTomcat, webapp = 'ok' } = {}) {
  fs.rmSync(project, { recursive: true, force: true });
  write(path.join(project, 'pom.xml'), `<project><modelVersion>4.0.0</modelVersion><groupId>ornek</groupId><artifactId>ust</artifactId><packaging>pom</packaging>
  <modules><module>web</module></modules></project>`);
  write(path.join(project, 'web', 'pom.xml'), `<project><parent><groupId>ornek</groupId><artifactId>ust</artifactId></parent>
  <artifactId>demo</artifactId><packaging>war</packaging>
  <dependencies><dependency><artifactId>baska</artifactId></dependency></dependencies></project>`);
  write(path.join(project, '.idea', 'misc.xml'), '<project version="4"><component name="ProjectRootManager" version="2" languageLevel="JDK_17" project-jdk-name="17" project-jdk-type="JavaSDK" /></project>');
  write(path.join(project, '.idea', 'artifacts', 'demo_war_exploded.xml'), `<component name="ArtifactManager">
  <artifact type="exploded-war" name="demo:war exploded"><output-path>$PROJECT_DIR$/web/target/demo-1.0</output-path></artifact></component>`);
  write(path.join(project, '.idea', 'workspace.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="MavenImportPreferences">
    <option name="generalSettings"><MavenGeneralSettings><option name="mavenHome" value="Bundled (Maven 3)" /></MavenGeneralSettings></option>
  </component>
  <component name="RunManager" selected="Tomcat Server.Demo">
    <configuration default="true" type="#com.intellij.j2ee.web.tomcat.TomcatRunConfigurationFactory" factoryName="Local" />
    <!-- <configuration name="Yorumdaki" type="#com.intellij.j2ee.web.tomcat.TomcatRunConfigurationFactory" factoryName="Local" /> -->
    <configuration name="Uzak" type="#com.intellij.j2ee.web.tomcat.TomcatRunConfigurationFactory" factoryName="Remote" />
    <configuration name="Uygulama" type="Application" factoryName="Application" />
    <configuration name="Demo" type="#com.intellij.j2ee.web.tomcat.TomcatRunConfigurationFactory" factoryName="Local" APPLICATION_SERVER_NAME="Tomcat 9.0.99" ALTERNATIVE_JRE_ENABLED="false">
      <option name="COMMON_VM_ARGUMENTS" value="-Ddemo.message=&quot;Merhaba Atölye&quot; -Ddb.password=GizliDeger123 -Dkok=$PROJECT_DIR$/ayar -Xmx256m" />
      <option name="OPEN_IN_BROWSER_URL" value="http://localhost:8080/demo/" />
      <deployment>
        <artifact name="demo:war exploded"><settings><option name="CONTEXT_PATH" value="/demo" /></settings></artifact>
      </deployment>
      <server-settings><option name="BASE_DIRECTORY_NAME" value="x" /></server-settings>
      <ConfigurationWrapper VM_VAR="JAVA_OPTS" RunnerId="Debug">
        <STARTUP><option name="USE_DEFAULT" value="true" /><option name="VM_PARAMETERS" value="-Dyalniz.debug=1" /></STARTUP>
      </ConfigurationWrapper>
      <ConfigurationWrapper VM_VAR="JAVA_OPTS" RunnerId="Run">
        <option name="USE_ENV_VARIABLES" value="true" />
        <STARTUP><option name="USE_DEFAULT" value="true" /><option name="SCRIPT" value="" /><option name="VM_PARAMETERS" value="-Dekstra.ayar=evet" /></STARTUP>
      </ConfigurationWrapper>
      <envs><env name="DEMO_ORTAM" value="deneme" /><env name="API_TOKEN" value="tok-12345" /></envs>
      <method v="2"><option name="BuildArtifacts" enabled="true"><artifact name="demo:war exploded" /></option></method>
    </configuration>
  </component>
</project>`);
  write(path.join(process.env.ATOLYE_JETBRAINS_DIR, 'options', 'applicationServers.xml'), `<application><component name="AppserversManager"><LibraryTable>
    <library name="Tomcat 9.0.99"><CLASSES><root url="jar://${fwd(tomcatHome)}/lib/servlet-api.jar!/" /></CLASSES></library>
  </LibraryTable></component></application>`);
  write(path.join(process.env.ATOLYE_JETBRAINS_DIR, 'options', 'jdk.table.xml'), `<application><component name="ProjectJdkTable">
    <jdk version="2"><name value="17" /><type value="JavaSDK" /><homePath value="${fwd(fakeJdk)}" /></jdk></component></application>`);
  // Derlenmiş (açılmış) web uygulaması
  const out = path.join(project, 'web', 'target', 'demo-1.0');
  write(path.join(out, 'WEB-INF', 'web.xml'), webapp === 'bozuk'
    ? '<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="3.1"><listener><listener-class>yok.BoyleBirSinif</listener-class></listener></web-app>'
    : '<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="3.1"></web-app>');
  write(path.join(out, 'META-INF', 'context.xml'), '<Context reloadable="false"><Environment name="demo/ayar" value="context-xml-calisti" type="java.lang.String" override="false"/></Context>');
  write(path.join(out, 'index.jsp'), `<%@ page contentType="text/html; charset=UTF-8" %><html><body>
<h1 id="mesaj"><%= System.getProperty("demo.message") %></h1><p id="ortam"><%= System.getenv("DEMO_ORTAM") %></p>
<p id="jndi"><%= new javax.naming.InitialContext().lookup("java:comp/env/demo/ayar") %></p>
<% System.out.println("index.jsp cagrildi, parola=" + System.getProperty("db.password")); %></body></html>`);
  return out;
}

test('splitParams: tırnaklar ve boşluklar IntelliJ gibi ayrılır', () => {
  assert.deepEqual(intellij.splitParams('-Da=1  -Db="iki kelime" "-Dc=x y" -Dd=\\"q\\"'), ['-Da=1', '-Db=iki kelime', '-Dc=x y', '-Dd="q"']);
  assert.deepEqual(intellij.splitParams(''), []);
});

test('scanProject: Tomcat ayarı, Tomcat klasörü, JDK, modül, context ve parametreler bulunur', () => {
  const out = makeProject();
  const r = intellij.scanProject(project);
  assert.equal(r.configs.length, 1, 'varsayılan, uzak, yorumdaki ve Tomcat olmayan ayarlar alınmaz');
  const c = r.configs[0];
  assert.equal(c.name, 'Demo');
  assert.equal(c.tomcatHome, path.normalize(fakeTomcat));
  assert.equal(c.javaHome, path.normalize(fakeJdk));
  assert.equal(c.contextPath, '/demo');
  assert.equal(c.moduleDir, path.join(project, 'web'));
  assert.equal(c.deployPath, out);
  assert.deepEqual(c.vmParams, ['-Ddemo.message=Merhaba Atölye', '-Ddb.password=GizliDeger123', `-Dkok=${fwd(project)}/ayar`, '-Xmx256m', '-Dekstra.ayar=evet']);
  assert.deepEqual(c.env, { DEMO_ORTAM: 'deneme', API_TOKEN: 'tok-12345' });
  assert.match(c.buildCommand, /-DskipTests package -pl "web" -am$/);
  assert.deepEqual(c.problems, []);
});

test('scanProject: .idea yoksa noIdea, klasör yoksa hata', () => {
  const empty = path.join(tmp, 'bos');
  fs.mkdirSync(empty, { recursive: true });
  assert.equal(intellij.scanProject(empty).noIdea, true);
  assert.throws(() => intellij.scanProject(path.join(tmp, 'olmayan')), /Klasör bulunamadı/);
});

test('rewriteServerXml: portlar değişir, yalnızca 127.0.0.1, AJP ve yorumlar', () => {
  const xml = `<Server port="8005" shutdown="SHUTDOWN">
  <!-- <Connector port="8443" protocol="HTTP/1.1" SSLEnabled="true" /> -->
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" connectionTimeout="20000" redirectPort="8443" />
    <Connector protocol="AJP/1.3" address="::1" port="8009" redirectPort="8443" />
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" maxThreads="150"></Connector>
    <Engine name="Catalina" defaultHost="localhost"><Host name="localhost" appBase="webapps" /></Engine>
  </Service>
</Server>`;
  const r = tomcat.rewriteServerXml(xml, { httpPort: 18080, shutdownPort: 18005, shutdownCmd: 'gizli', extraPorts: [18443] });
  assert.match(r.xml, /<Server port="18005" shutdown="gizli">/);
  assert.match(r.xml, /<Connector address="127.0.0.1" port="18080" protocol="HTTP\/1.1"/);
  assert.match(r.xml, /port="18443"[^>]*SSLEnabled="true"/);
  assert.doesNotMatch(r.xml, /AJP\/1\.3/);
  assert.match(r.xml, /<!-- <Connector port="8443" protocol="HTTP\/1.1" SSLEnabled="true" \/> -->/, 'yorum olduğu gibi kalır');
  assert.equal(r.engine, 'Catalina');
  assert.equal(r.host, 'localhost');
  assert.equal(r.httpFound, true);
});

test('contextXml: uygulamanın context.xml kaynakları korunur, docBase eklenir', () => {
  const out = makeProject();
  const x = tomcat.contextXml(out);
  assert.match(x, /<Context reloadable="false" docBase="[^"]+demo-1\.0">/);
  assert.match(x, /Environment name="demo\/ayar"/);
  assert.equal(tomcat.contextXml(path.join(tmp, 'yok')), `<?xml version="1.0" encoding="UTF-8"?>\n<Context docBase="${path.join(tmp, 'yok')}"/>\n`);
  assert.equal(tomcat.contextFileName('/'), 'ROOT');
  assert.equal(tomcat.contextFileName('a/b/'), 'a#b');
});

test('profil: parola benzeri değerler maskelenir, maskeli kaydedilince eski değer korunur', () => {
  makeProject();
  const c = intellij.scanProject(project).configs[0];
  const p = tomcat.saveProfile({ ...c, name: 'Demo uygulama', projectDir: project });
  assert.equal(p.id, 'demo-uygulama');
  const pub = tomcat.publicProfile(p);
  assert.ok(pub.vmParams.includes(`-Ddb.password=${tomcat.MASK}`));
  assert.ok(pub.vmParams.includes('-Ddemo.message=Merhaba Atölye'));
  assert.equal(pub.env.API_TOKEN, tomcat.MASK);
  assert.equal(pub.env.DEMO_ORTAM, 'deneme');
  assert.ok(!JSON.stringify(pub).includes('GizliDeger123'));
  assert.ok(!JSON.stringify(pub).includes('tok-12345'));
  // Arayüzden maskeli geri gelen değerler eski gerçek değerle saklanır; yenisi yazılırsa yenisi
  const again = tomcat.saveProfile({ ...pub, vmParams: [...pub.vmParams, '-Dyeni=1'] });
  assert.ok(again.vmParams.includes('-Ddb.password=GizliDeger123'));
  assert.equal(again.env.API_TOKEN, 'tok-12345');
  const changed = tomcat.saveProfile({ ...pub, vmParams: pub.vmParams.map((x) => x.replace(tomcat.MASK, 'YeniParola')) });
  assert.ok(changed.vmParams.includes('-Ddb.password=YeniParola'));
  assert.deepEqual(tomcat.paramNames(changed).slice(0, 2), ['-Ddemo.message', '-Ddb.password']);
  assert.throws(() => tomcat.saveProfile({ name: 'demo uygulama' }), /zaten var/);
  assert.throws(() => tomcat.saveProfile({ name: 'X', port: 80 }), /1024/);
});

test('findProfile: ad, kimlik, ad parçası; tek profilde boş', () => {
  assert.equal(tomcat.findProfile('').id, 'demo-uygulama');
  assert.equal(tomcat.findProfile('DEMO').id, 'demo-uygulama');
  tomcat.saveProfile({ name: 'İkinci' });
  assert.throws(() => tomcat.findProfile(''), /Hangi profil/);
  assert.throws(() => tomcat.findProfile('olmayan'), /bulunamadı/);
  assert.equal(tomcat.findProfile('ikinci').name, 'İkinci');
  tomcat.removeProfile('ikinci');
});

test('childEnv: Atölye\'nin anahtarları derleme ve Tomcat süreçlerine geçmez', () => {
  const env = tomcat.childEnv({ PATH: 'p', ANTHROPIC_AUTH_TOKEN: 'x', COPILOT_PROXY: 'y', ATOLYE_TOMCAT_ANAHTAR: 'z', JAVA_HOME: 'j' }, { A: '1' });
  assert.deepEqual(env, { PATH: 'p', JAVA_HOME: 'j', A: '1' });
});

test('iç kapı: anahtarsız istek reddedilir; list parametre değerlerini göstermez', async () => {
  assert.equal((await tomcat.gateRequest('Bearer yanlis', { op: 'list' })).status, 401);
  const ok = await tomcat.gateRequest(`Bearer ${tomcat.gate.secret}`, { op: 'list' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.text, /Demo uygulama/);
  assert.match(ok.body.text, /-Ddb\.password/);
  assert.ok(!ok.body.text.includes('GizliDeger123'));
  assert.ok(!ok.body.text.includes('Merhaba Atölye'), 'parola olmayan değerler de yapay zekâya gösterilmez');
  assert.equal((await tomcat.gateRequest(`Bearer ${tomcat.gate.secret}`, { op: 'sil' })).status, 400);
});

test('başlatma: Tomcat klasörü geçersizse anlaşılır hata', async () => {
  const p = tomcat.saveProfile({ name: 'Bozuk', tomcatHome: path.join(tmp, 'yok'), javaHome: fakeJdk, deployPath: tmp });
  const run = tomcat.start(p.id, { build: false });
  await tomcat.waitFor(run, 10_000);
  assert.equal(run.phase, 'failed');
  assert.match(run.error, /Tomcat klasörü geçersiz/);
  tomcat.removeProfile(p.id);
});

test('derleme hatası: süreç kodu ve çıktı', async () => {
  const p = tomcat.saveProfile({ name: 'Derleme', projectDir: tmp, buildCommand: 'node -e "console.log(\'derleniyor\'); process.exit(3)"', tomcatHome: fakeTomcat, javaHome: fakeJdk });
  const run = tomcat.start(p.id);
  await tomcat.waitFor(run, 20_000);
  assert.equal(run.phase, 'failed');
  assert.match(run.error, /3 koduyla/);
  assert.ok(tomcat.readLogs(p.id, { source: 'derleme' }).lines.some((l) => l.includes('derleniyor')));
  tomcat.removeProfile(p.id);
});

test('zincir: MCP aracı -> iç kapı (/ic/tomcat) -> Atölye sunucusu; bağlantı kapalıyken araç yok', async () => {
  const { createServer } = await import('../src/server.js');
  const mcp = await import('../src/mcp-server.js');
  const port = await tomcat.freePort();
  const server = await createServer({ port, defaultCwd: tmp });
  try {
    assert.equal(process.env.ATOLYE_TOMCAT_URL, `http://127.0.0.1:${port}/ic/tomcat`);
    const names = async (env) => (await mcp.handleMessage({ id: 1, method: 'tools/list' }, env)).result.tools.map((t) => t.name).filter((n) => n.startsWith('tomcat_'));
    assert.deepEqual(await names({ ...process.env }), [], 'bağlantı açılmadan araç sunulmaz');
    // Arayüzdeki "Yapay zekâ kullanabilsin": ayar dosyasına yalnızca TOMCAT_ENABLED yazılır
    const on = await fetch(`http://127.0.0.1:${port}/api/tomcat/enable`, { method: 'POST' }).then((r) => r.json());
    assert.equal(on.enabled, true);
    const saved = JSON.parse(fs.readFileSync(process.env.ATOLYE_CLAUDE_JSON, 'utf8')).mcpServers.atolye.env;
    assert.deepEqual(saved, { TOMCAT_ENABLED: '1' }, 'iç adres ve anahtar ayar dosyasına yazılmaz');
    // Araç sunucusu, CLI'nın verdiği ortamla (kayıtlı env + Atölye'den devralınan iç adres/anahtar) çalışır
    const env = { ...process.env, ...saved };
    assert.deepEqual(await names(env), ['tomcat_list', 'tomcat_start', 'tomcat_status', 'tomcat_logs', 'tomcat_stop']);
    const list = await mcp.handleMessage({ id: 2, method: 'tools/call', params: { name: 'tomcat_list', arguments: {} } }, env);
    assert.match(list.result.content[0].text, /Demo uygulama/);
    assert.ok(!list.result.content[0].text.includes('GizliDeger123'));
    // Yanlış anahtarla gelen istek reddedilir
    const bad = await mcp.handleMessage({ id: 3, method: 'tools/call', params: { name: 'tomcat_list', arguments: {} } }, { ...env, ATOLYE_TOMCAT_ANAHTAR: 'yanlis' });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /tanımadı/);
    // Arayüze giden profil listesinde parola yok
    const view = await fetch(`http://127.0.0.1:${port}/api/tomcat`).then((r) => r.text());
    assert.ok(view.includes('Demo uygulama') && !view.includes('GizliDeger123') && !view.includes('tok-12345'));
    // Tarama da maskeli döner; içe aktarma değerleri sunucuda yeniden okur
    makeProject();
    const scan = await fetch(`http://127.0.0.1:${port}/api/tomcat/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: project }) }).then((r) => r.text());
    assert.ok(scan.includes('db.password=********') && !scan.includes('GizliDeger123'));
    const imp = await fetch(`http://127.0.0.1:${port}/api/tomcat/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: project, config: 'Demo', name: 'İçe aktarılan' }) }).then((r) => r.json());
    assert.equal(imp.ok, true);
    assert.ok(tomcat.profiles().find((p) => p.id === imp.id).vmParams.includes('-Ddb.password=GizliDeger123'));
    tomcat.removeProfile(imp.id);
    await fetch(`http://127.0.0.1:${port}/api/tomcat/enable`, { method: 'DELETE' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------- Gerçek Tomcat ile (isteğe bağlı) ----------
const realHome = process.env.ATOLYE_TOMCAT_TEST_HOME;
const realJava = process.env.ATOLYE_TOMCAT_TEST_JAVA;
const get = (url) => new Promise((resolve) => {
  http.get(url, { agent: false }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); })
    .on('error', (e) => resolve({ status: 0, body: e.message }));
});

test('gerçek Tomcat: IntelliJ ayarından profil, derleme, açılış, parametre, JNDI, log maskeleme, kapatma', { skip: !(realHome && realJava) && 'ATOLYE_TOMCAT_TEST_HOME / ATOLYE_TOMCAT_TEST_JAVA verilmedi', timeout: 240_000 }, async () => {
  const out = makeProject({ tomcatHome: realHome });
  const src = path.join(tmp, 'kaynak');
  fs.rmSync(src, { recursive: true, force: true });
  fs.cpSync(out, src, { recursive: true });
  fs.rmSync(path.join(project, 'web', 'target'), { recursive: true, force: true });
  const c = intellij.scanProject(project).configs[0];
  assert.equal(c.tomcatHome, path.normalize(realHome));
  // Derleme: kaynak klasörü target altına kopyalanır (Maven yerine)
  const p = tomcat.saveProfile({ ...c, name: 'Gerçek', projectDir: project, javaHome: realJava, buildCommand: `node -e "require('fs').cpSync(String.raw\`${src}\`, String.raw\`${out}\`, {recursive:true}); console.log('kopyalandi')"` });
  assert.equal(p.deployPath, '', 'derlemeden önce dağıtılacak klasör yok');
  const run = tomcat.start(p.id);
  await tomcat.waitFor(run, 200_000);
  assert.equal(run.phase, 'running', `${run.error || ''}\n${tomcat.readLogs(p.id, { lines: 60 }).lines.join('\n')}`);
  assert.equal(tomcat.profiles().find((x) => x.id === p.id).deployPath, out, 'derleme sonrası bulunan klasör profile yazılır');
  const page = await get(run.url);
  assert.equal(page.status, 200);
  assert.match(page.body, /<h1 id="mesaj">Merhaba Atölye<\/h1>/);
  assert.match(page.body, /<p id="ortam">deneme<\/p>/);
  assert.match(page.body, /context-xml-calisti/);
  await new Promise((r) => setTimeout(r, 500));
  const logs = tomcat.readLogs(p.id, { filter: 'parola=' }).lines.join('\n');
  assert.match(logs, /parola=\*\*\*/);
  assert.ok(!tomcat.readLogs(p.id, { lines: 2000 }).lines.join('\n').includes('GizliDeger123'), 'parola konsol logunda açık görünmez');
  const files = tomcat.logSources(p.id);
  assert.ok(files.some((f) => /^catalina\..*\.log$/.test(f)), files.join(', '));
  assert.ok(!tomcat.readLogs(p.id, { source: files.find((f) => /^catalina\./.test(f)), lines: 2000 }).lines.join('\n').includes('GizliDeger123'), 'dosya loglarında da gizli');
  // Araç metni
  const st = await tomcat.gateRequest(`Bearer ${tomcat.gate.secret}`, { op: 'status', args: { profile: 'gerçek' } });
  assert.match(st.body.text, /çalışıyor/);
  // İkinci başlatma reddedilir
  assert.throws(() => tomcat.start(p.id), /zaten çalışıyor/);
  await tomcat.stop(p.id);
  assert.equal(run.phase, 'stopped');
  assert.equal((await get(run.url)).status, 0, 'port kapandı');

  // Uygulama açılamazsa uyarı ve hata satırları
  makeProject({ tomcatHome: realHome, webapp: 'bozuk' });
  const run2 = tomcat.start(p.id, { build: false });
  await tomcat.waitFor(run2, 200_000);
  assert.equal(run2.phase, 'running');
  assert.match(run2.warning || '', /uygulama başlatılamamış/);
  assert.ok(run2.problems.some((l) => /BoyleBirSinif|listeners/.test(l)));
  await tomcat.stop(p.id);

  // Sahipsiz kalan Tomcat: Atölye zorla kapatılmış gibi çalıştırma unutulur; sonraki açılıştaki temizlik onu kapatma
  // portundan kapatır ve çalışma klasörünü siler
  const run3 = tomcat.start(p.id, { build: false });
  await tomcat.waitFor(run3, 200_000);
  assert.equal(run3.phase, 'running');
  const orphanUrl = run3.url;
  tomcat._forget();
  assert.equal(await tomcat.cleanWork(), 1);
  assert.equal((await get(orphanUrl)).status, 0, 'sahipsiz Tomcat kapatıldı');
  assert.deepEqual(fs.readdirSync(process.env.ATOLYE_TOMCAT_WORK), []);
});
