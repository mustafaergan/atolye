// IntelliJ IDEA'daki Tomcat çalıştırma ayarlarını okur. Hiçbir dosyaya yazmaz.
// Okunanlar:
//   <proje>/.idea/workspace.xml, <proje>/.run/*.run.xml, <proje>/.idea/runConfigurations/*.xml : Tomcat çalıştırma ayarı
//     (VM options, ortam değişkenleri, açılış adresi, dağıtılan artifact ve context path, ayrı JRE seçildiyse yolu)
//   <proje>/.idea/misc.xml : projenin JDK'sının adı;  <proje>/.idea/artifacts/*.xml : artifact'in çıktı klasörü
//   %APPDATA%\JetBrains\<IntelliJ sürümü>\options\applicationServers.xml : Tomcat'in kurulu olduğu klasör
//   %APPDATA%\JetBrains\<IntelliJ sürümü>\options\jdk.table.xml           : JDK adlarının yolları
// IntelliJ'in dosya biçimi sürümden sürüme küçük farklar gösterebilir; okuyucu bu yüzden hoşgörülüdür ve bulamadığını
// boş bırakır, kullanıcı panelde düzeltir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOMCAT_TYPE = /tomcat/i;

// ---------- Küçük XML yardımcıları (IntelliJ dosyaları düzgün ve basit XML'dir) ----------
const unescape = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_m, e) => {
  const k = e.toLowerCase();
  if (k === 'quot') return '"';
  if (k === 'apos') return "'";
  if (k === 'amp') return '&';
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});

export function attrs(tagText) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagText))) out[m[1]] = unescape(m[3] ?? m[4]);
  return out;
}

const stripComments = (xml) => String(xml || '').replace(/<!--[\s\S]*?-->/g, '');

/** <tag ...>...</tag> ve <tag .../> öğeleri: [{ attrs, inner }]. Aynı adlı öğeler iç içe değilse doğrudur. */
export function elements(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(\\s[^>]*?)?(/?)>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const a = attrs(m[1] || '');
    if (m[2] === '/') { out.push({ attrs: a, inner: '' }); continue; }
    const end = xml.indexOf(`</${tag}>`, re.lastIndex);
    if (end < 0) { out.push({ attrs: a, inner: '' }); continue; }
    out.push({ attrs: a, inner: xml.slice(re.lastIndex, end) });
    re.lastIndex = end + tag.length + 3;
  }
  return out;
}

/** <option name="X" value="..."/> değerleri (yalnızca verilen metnin içinde, ilk bulunan) */
function option(xml, name) {
  for (const o of elements(xml, 'option')) if (o.attrs.name === name && o.attrs.value !== undefined) return o.attrs.value;
  return undefined;
}

const readText = (file) => { try { return stripComments(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return ''; } };
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** IntelliJ yollarındaki makrolar ve URL biçimi (file://, jar://...!/) → Windows yolu */
export function expandPath(value, { projectDir = '', home = os.homedir() } = {}) {
  let v = String(value || '').trim();
  if (!v) return '';
  v = v.replace(/^(jar|file):\/\//i, '').replace(/!\/.*$/, '');
  v = v.replace(/\$PROJECT_DIR\$/g, projectDir).replace(/\$USER_HOME\$/g, home).replace(/\$MODULE_DIR\$/g, projectDir);
  v = v.replace(/\$([A-Z_][A-Z0-9_]*)\$/g, (m, name) => process.env[name] ?? m);
  return path.normalize(v);
}

/**
 * VM options metnini parçalara ayırır (IntelliJ'in kuralı: boşlukla ayrılır, çift tırnak içi tek parçadır,
 * tırnaklar parçadan çıkarılır; \" tırnağın kendisidir).
 */
export function splitParams(text) {
  const out = [];
  let cur = '';
  let quoted = false;
  let has = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '"') { cur += '"'; i++; has = true; continue; }
    if (c === '"') { quoted = !quoted; has = true; continue; }
    if (!quoted && /\s/.test(c)) { if (has) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

// ---------- JetBrains ayar klasörü ----------
/** En son kullanılan IntelliJ'in ayar klasörü (%APPDATA%\JetBrains\IntelliJIdea2024.2 gibi) ya da '' */
export function jetbrainsDir(env = process.env) {
  if (env.ATOLYE_JETBRAINS_DIR) return env.ATOLYE_JETBRAINS_DIR;
  const root = path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JetBrains');
  let best = '';
  let bestTime = -1;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return ''; }
  for (const e of entries) {
    if (!e.isDirectory() || !/^(IntelliJIdea|IdeaIC)\d/.test(e.name)) continue;
    const dir = path.join(root, e.name);
    let t = 0;
    try { t = fs.statSync(path.join(dir, 'options')).mtimeMs; } catch { continue; }
    if (t > bestTime) { best = dir; bestTime = t; }
  }
  return best;
}

/** applicationServers.xml: kayıtlı uygulama sunucusu adı → kurulu olduğu klasör (içinde bin\bootstrap.jar olan) */
export function appServers(jbDir) {
  const out = {};
  if (!jbDir) return out;
  const xml = readText(path.join(jbDir, 'options', 'applicationServers.xml'));
  for (const lib of elements(xml, 'library')) {
    const name = lib.attrs.name;
    if (!name) continue;
    const candidates = [];
    // Ayar değerleri (TOMCAT_HOME benzeri) ve kütüphane kökleri (jar://C:/tomcat/lib/x.jar!/ → C:/tomcat)
    for (const m of lib.inner.matchAll(/(?:value|url)\s*=\s*"([^"]+)"/g)) {
      const p = expandPath(unescape(m[1]));
      if (!p) continue;
      candidates.push(p);
      if (/\.jar$/i.test(p)) candidates.push(path.dirname(path.dirname(p)));
    }
    const home = candidates.find((c) => exists(path.join(c, 'bin', 'bootstrap.jar')));
    if (home) out[name] = home;
  }
  return out;
}

/** jdk.table.xml: JDK adı → klasörü */
export function jdkTable(jbDir) {
  const out = {};
  if (!jbDir) return out;
  const xml = readText(path.join(jbDir, 'options', 'jdk.table.xml'));
  for (const jdk of elements(xml, 'jdk')) {
    const name = elements(jdk.inner, 'name')[0]?.attrs.value;
    const home = elements(jdk.inner, 'homePath')[0]?.attrs.value;
    if (name && home) out[name] = expandPath(home);
  }
  return out;
}

// ---------- Proje ----------
function projectJdkName(projectDir) {
  const xml = readText(path.join(projectDir, '.idea', 'misc.xml'));
  for (const c of elements(xml, 'component')) if (c.attrs.name === 'ProjectRootManager') return c.attrs['project-jdk-name'] || '';
  return '';
}

/** IntelliJ'in Maven ayarı: { mavenHome, userSettingsFile } (boş olabilir) */
function mavenPrefs(projectDir) {
  const xml = readText(path.join(projectDir, '.idea', 'workspace.xml'));
  for (const c of elements(xml, 'component')) {
    if (c.attrs.name !== 'MavenImportPreferences' && c.attrs.name !== 'MavenProjectsManager') continue;
    const home = option(c.inner, 'mavenHome') || option(c.inner, 'mavenHomeTypeForPersistence') || '';
    const settings = option(c.inner, 'userSettingsFile') || '';
    return { mavenHome: home, userSettingsFile: settings ? expandPath(settings, { projectDir }) : '' };
  }
  return { mavenHome: '', userSettingsFile: '' };
}

/** Tomcat çalıştırma ayarları: workspace.xml + .run/*.run.xml + .idea/runConfigurations/*.xml */
function rawConfigs(projectDir) {
  const texts = [readText(path.join(projectDir, '.idea', 'workspace.xml'))];
  for (const dir of [path.join(projectDir, '.run'), path.join(projectDir, '.idea', 'runConfigurations')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (/\.xml$/i.test(n)) texts.push(readText(path.join(dir, n)));
  }
  const out = [];
  const seen = new Set();
  for (const xml of texts) {
    for (const c of elements(xml, 'configuration')) {
      if (!TOMCAT_TYPE.test(c.attrs.type || '') || c.attrs.default === 'true' || !c.attrs.name) continue;
      if (/remote/i.test(c.attrs.factoryName || '')) continue; // uzaktaki Tomcat'e bağlanan ayar çalıştırılamaz
      if (seen.has(c.attrs.name)) continue;
      seen.add(c.attrs.name);
      out.push(c);
    }
  }
  return out;
}

/** Çalıştırma (Run) için VM parametreleri: ortak alan + "Run" çalıştırıcısının başlangıç ayarı */
function vmParamsOf(conf) {
  const parts = [];
  const common = option(conf.inner.replace(/<ConfigurationWrapper[\s\S]*?<\/ConfigurationWrapper>/g, ''), 'COMMON_VM_ARGUMENTS');
  if (common) parts.push(common);
  for (const w of elements(conf.inner, 'ConfigurationWrapper')) {
    if (w.attrs.RunnerId !== 'Run') continue;
    const start = elements(w.inner, 'STARTUP')[0]?.inner || '';
    if (option(start, 'USE_DEFAULT') === 'false') continue; // kullanıcı kendi betiğini yazmış: VM_PARAMETERS kullanılmaz
    const vm = option(start, 'VM_PARAMETERS');
    if (vm) parts.push(vm);
  }
  return splitParams(parts.join(' '));
}

function envOf(conf) {
  const env = {};
  for (const e of elements(conf.inner, 'env')) if (e.attrs.name) env[e.attrs.name] = e.attrs.value ?? '';
  return env;
}

/** Dağıtılan artifact'ler: [{ name, contextPath }] */
function deploymentsOf(conf) {
  const dep = elements(conf.inner, 'deployment')[0]?.inner || '';
  return elements(dep, 'artifact').map((a) => ({ name: a.attrs.name || '', contextPath: option(a.inner, 'CONTEXT_PATH') ?? '' }));
}

/** .idea/artifacts içindeki artifact tanımı: çıktı klasörü ve türü */
function artifactDef(projectDir, name) {
  let names = [];
  const dir = path.join(projectDir, '.idea', 'artifacts');
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const n of names) {
    const xml = readText(path.join(dir, n));
    for (const a of elements(xml, 'artifact')) {
      if (a.attrs.name !== name) continue;
      const out = elements(a.inner, 'output-path')[0];
      const text = out ? a.inner.match(/<output-path>([^<]*)<\/output-path>/)?.[1] : '';
      return { type: a.attrs.type || '', outputPath: text ? expandPath(unescape(text), { projectDir }) : '' };
    }
  }
  return null;
}

// ---------- Maven ----------
const SKIP = new Set(['node_modules', '.git', '.idea', 'target', 'build', 'out', 'dist', '.mvn', 'src']);

/** Proje altındaki pom.xml dosyaları (en çok 4 seviye): [{ dir, artifactId, packaging }] */
export function mavenModules(projectDir) {
  const out = [];
  const walk = (dir, depth) => {
    const pom = readText(path.join(dir, 'pom.xml'));
    if (pom) {
      // Üst (parent) bölümündeki artifactId'yi saymamak için o bölüm atılır
      const own = pom.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<(dependencies|dependencyManagement|build|profiles|plugins|reporting)>[\s\S]*?<\/\1>/g, '');
      out.push({
        dir,
        artifactId: own.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1] || path.basename(dir),
        packaging: own.match(/<packaging>\s*([^<\s]+)\s*<\/packaging>/)?.[1] || 'jar',
      });
    }
    if (depth >= 4) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
  };
  walk(projectDir, 0);
  return out;
}

/** IntelliJ kurulum klasörlerinde gelen Maven (IntelliJ'de "Bundled") */
function bundledMaven(env = process.env) {
  const roots = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'JetBrains'),
    path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs'),
    path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'JetBrains', 'Toolbox', 'apps'),
  ];
  const found = [];
  const look = (dir, depth) => {
    // Eski sürümlerde plugins\maven, 2025 sonrası plugins\maven-plugin (ev-pc'de IntelliJ 2026.2 ile görüldü)
    for (const rel of ['maven', 'maven-plugin'].flatMap((pl) => [['plugins', pl, 'lib', 'maven3'], ['plugins', pl, 'lib', 'maven4']])) {
      const home = path.join(dir, ...rel);
      if (exists(path.join(home, 'bin', 'mvn.cmd'))) found.push(home);
    }
    if (depth >= 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && /idea|intellij|ch-\d|^\d/i.test(e.name)) look(path.join(dir, e.name), depth + 1);
  };
  for (const r of roots) look(r, 0);
  return found.sort().reverse()[0] || '';
}

const onPath = (cmd, env = process.env) => (env.PATH || env.Path || '').split(path.delimiter).some((d) => d && exists(path.join(d, cmd)));

/** Derleme komutu: mvnw varsa o, yoksa IntelliJ'in Maven'ı, yoksa PATH'teki mvn. Modül kökte değilse -pl ile yalnızca o derlenir. */
export function buildCommand(projectDir, moduleDir, prefs = {}, env = process.env) {
  if (!exists(path.join(projectDir, 'pom.xml')) && !(moduleDir && exists(path.join(moduleDir, 'pom.xml')))) return '';
  let mvn = '';
  if (exists(path.join(projectDir, 'mvnw.cmd'))) mvn = 'mvnw.cmd';
  else if (prefs.mavenHome && exists(path.join(expandPath(prefs.mavenHome, { projectDir }), 'bin', 'mvn.cmd'))) mvn = `"${path.join(expandPath(prefs.mavenHome, { projectDir }), 'bin', 'mvn.cmd')}"`;
  else if (onPath('mvn.cmd', env)) mvn = 'mvn';
  else {
    const b = bundledMaven(env);
    mvn = b ? `"${path.join(b, 'bin', 'mvn.cmd')}"` : 'mvn';
  }
  const parts = [mvn];
  if (prefs.userSettingsFile && exists(prefs.userSettingsFile)) parts.push('-s', `"${prefs.userSettingsFile}"`);
  parts.push('-DskipTests', 'package');
  const rel = moduleDir ? path.relative(projectDir, moduleDir) : '';
  if (rel && !rel.startsWith('..')) parts.push('-pl', `"${rel.replace(/\\/g, '/')}"`, '-am');
  return parts.join(' ');
}

/** Derleme sonrası dağıtılacak yer: modülün target klasöründe açılmış web uygulaması (WEB-INF içeren) ya da .war */
export function findDeployable(moduleDir) {
  const target = path.join(moduleDir, 'target');
  let entries = [];
  try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { return ''; }
  const byTime = (list) => list.map((p) => ({ p, t: (() => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.t - a.t).map((x) => x.p);
  const dirs = byTime(entries.filter((e) => e.isDirectory() && exists(path.join(target, e.name, 'WEB-INF'))).map((e) => path.join(target, e.name)));
  if (dirs.length) return dirs[0];
  const wars = byTime(entries.filter((e) => e.isFile() && /\.war$/i.test(e.name)).map((e) => path.join(target, e.name)));
  return wars[0] || '';
}

/** Artifact adına göre Maven modülü ("uygulama:war exploded" → artifactId "uygulama"); yoksa tek war modülü */
function moduleFor(projectDir, artifactName, artifact) {
  const mods = mavenModules(projectDir);
  const wars = mods.filter((m) => m.packaging === 'war');
  const base = String(artifactName || '').split(':')[0].trim();
  const byOutput = artifact?.outputPath && mods.find((m) => artifact.outputPath.toLowerCase().startsWith(path.join(m.dir, 'target').toLowerCase()));
  return byOutput || wars.find((m) => m.artifactId === base) || mods.find((m) => m.artifactId === base) || (wars.length === 1 ? wars[0] : null);
}

// ---------- Dışa açık ----------
/**
 * Projedeki Tomcat çalıştırma ayarlarını profil önerisi olarak döndürür.
 * { projectDir, jetbrains, configs: [{ name, tomcatHome, serverName, javaHome, contextPath, vmParams, env, openUrl,
 *   moduleDir, buildCommand, deployPath, problems: [] }] }
 */
export function scanProject(projectDir, env = process.env) {
  const dir = path.resolve(String(projectDir || ''));
  if (!isDir(dir)) throw Object.assign(new Error('Klasör bulunamadı'), { code: 'no-dir' });
  if (!isDir(path.join(dir, '.idea')) && !isDir(path.join(dir, '.run'))) {
    return { projectDir: dir, jetbrains: '', configs: [], noIdea: true };
  }
  const jb = jetbrainsDir(env);
  const servers = appServers(jb);
  const jdks = jdkTable(jb);
  const prefs = mavenPrefs(dir);
  const projectJdk = projectJdkName(dir);
  const configs = rawConfigs(dir).map((conf) => {
    const problems = [];
    const serverName = conf.attrs.APPLICATION_SERVER_NAME || '';
    let tomcatHome = servers[serverName] || '';
    if (!tomcatHome && Object.keys(servers).length === 1) tomcatHome = Object.values(servers)[0];
    if (!tomcatHome && env.CATALINA_HOME && exists(path.join(env.CATALINA_HOME, 'bin', 'bootstrap.jar'))) tomcatHome = env.CATALINA_HOME;
    if (!tomcatHome) problems.push('tomcat');
    let javaHome = '';
    if (conf.attrs.ALTERNATIVE_JRE_ENABLED === 'true' && conf.attrs.ALTERNATIVE_JRE_PATH) {
      const alt = conf.attrs.ALTERNATIVE_JRE_PATH;
      javaHome = jdks[alt] || expandPath(alt, { projectDir: dir });
    }
    if (!javaHome && projectJdk) javaHome = jdks[projectJdk] || '';
    if (!javaHome && env.JAVA_HOME) javaHome = env.JAVA_HOME;
    if (javaHome && !exists(path.join(javaHome, 'bin', 'java.exe')) && !exists(path.join(javaHome, 'bin', 'java'))) javaHome = '';
    if (!javaHome) problems.push('java');
    const deps = deploymentsOf(conf);
    const dep = deps[0] || { name: '', contextPath: '' };
    if (!deps.length) problems.push('artifact');
    if (deps.length > 1) problems.push('many-artifacts');
    const art = dep.name ? artifactDef(dir, dep.name) : null;
    const mod = moduleFor(dir, dep.name, art);
    const moduleDir = mod?.dir || '';
    const build = buildCommand(dir, moduleDir, prefs, env);
    if (!build) problems.push('build');
    return {
      name: conf.attrs.name,
      serverName,
      tomcatHome,
      javaHome,
      contextPath: dep.contextPath || (dep.name ? `/${dep.name.split(':')[0].trim()}` : '/'),
      artifact: dep.name,
      vmParams: vmParamsOf(conf).map((p) => p.replace(/\$PROJECT_DIR\$/g, dir.replace(/\\/g, '/'))),
      env: envOf(conf),
      openUrl: option(conf.inner, 'OPEN_IN_BROWSER_URL') || '',
      moduleDir,
      buildCommand: build,
      deployPath: (moduleDir && findDeployable(moduleDir)) || (art?.outputPath && exists(art.outputPath) ? art.outputPath : ''),
      problems,
    };
  });
  return { projectDir: dir, jetbrains: jb, configs };
}
