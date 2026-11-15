// Test otomasyonu bağlantısı: test otomasyon deposunun bu bilgisayardaki klasörü ve testleri çalıştıran komut.
// Bağlantı seçiliyken gönderilen soruya bu bilgiler eklenir; komutu yapay zekâ kendi komut çalıştırma aracıyla,
// kullanıcının izniyle çalıştırır. Ayar bir servise değil bu bilgisayara ait olduğu için Atölye'nin kendi
// klasöründe tutulur: ~/.atolye/test-otomasyon.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const defaultFile = () => path.join(os.homedir(), '.atolye', 'test-otomasyon.json');
const isWin = process.platform === 'win32';

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}
const has = (dir, name) => fs.existsSync(path.join(dir, name));
const text = (dir, name) => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return ''; } };

/**
 * Klasördeki proje türüne göre çalıştırma komutu önerir.
 * { exists, kind, command, tagExample } — tanınmayan klasörde kind ve command boş döner.
 */
export function detect(dir) {
  const d = String(dir || '').trim();
  if (!d || !path.isAbsolute(d) || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return { exists: false, kind: '', command: '', tagExample: '' };
  const out = (kind, command, tagExample = '') => ({ exists: true, kind, command, tagExample });
  if (has(d, 'pom.xml')) {
    const mvn = has(d, isWin ? 'mvnw.cmd' : 'mvnw') ? (isWin ? 'mvnw.cmd' : './mvnw') : 'mvn';
    const cucumber = /cucumber/i.test(text(d, 'pom.xml'));
    return out(cucumber ? 'Maven + Cucumber' : 'Maven', `${mvn} test`, cucumber ? `${mvn} test "-Dcucumber.filter.tags=@etiket"` : `${mvn} test -Dtest=SinifAdi`);
  }
  if (has(d, 'build.gradle') || has(d, 'build.gradle.kts')) {
    const gradle = has(d, isWin ? 'gradlew.bat' : 'gradlew') ? (isWin ? 'gradlew.bat' : './gradlew') : 'gradle';
    return out('Gradle', `${gradle} test`, `${gradle} test --tests "SinifAdi"`);
  }
  if (has(d, 'package.json')) {
    let pkg = {};
    try { pkg = JSON.parse(text(d, 'package.json')); } catch { /* bozuk dosya */ }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['@playwright/test'] || ['playwright.config.ts', 'playwright.config.js'].some((f) => has(d, f))) return out('Playwright', 'npx playwright test', 'npx playwright test --grep "@etiket"');
    if (deps.cypress || ['cypress.config.ts', 'cypress.config.js'].some((f) => has(d, f))) return out('Cypress', 'npx cypress run', 'npx cypress run --spec "cypress/e2e/dosya.cy.js"');
    return out('Node.js', pkg.scripts?.test ? 'npm test' : '', '');
  }
  if (['pytest.ini', 'conftest.py', 'pyproject.toml', 'tox.ini'].some((f) => has(d, f))) return out('pytest', 'pytest', 'pytest -m etiket');
  if (fs.readdirSync(d).some((f) => /\.(sln|csproj)$/i.test(f))) return out('.NET', 'dotnet test', 'dotnet test --filter "Category=etiket"');
  return out('', '', '');
}

/** Arayüze giden durum */
export function status({ file = defaultFile() } = {}) {
  const c = read(file);
  const dir = typeof c.dir === 'string' ? c.dir : '';
  return {
    connected: Boolean(dir && c.command),
    dir,
    command: typeof c.command === 'string' ? c.command : '',
    notes: typeof c.notes === 'string' ? c.notes : '',
    repoUrl: typeof c.repoUrl === 'string' ? c.repoUrl : '',
    exists: Boolean(dir) && fs.existsSync(dir),
    file,
  };
}

/** Kaydeder; hata kodu: 'no-dir' | 'bad-dir' | 'no-command' */
export function save({ dir, command, notes, repoUrl } = {}, { file = defaultFile() } = {}) {
  const d = String(dir || '').trim();
  // Tek satır: komut, soruya eklenen nota olduğu gibi yazılır
  const cmd = String(command || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  const fail = (code) => Object.assign(new Error(code), { code });
  if (!d) throw fail('no-dir');
  if (!path.isAbsolute(d) || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw fail('bad-dir');
  if (!cmd) throw fail('no-command');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ dir: path.resolve(d), command: cmd, notes: String(notes || '').trim().slice(0, 2000), repoUrl: String(repoUrl || '').trim().slice(0, 500) }, null, 2)}\n`);
  return status({ file });
}

export function remove({ file = defaultFile() } = {}) {
  try { fs.unlinkSync(file); } catch { /* zaten yok */ }
  return status({ file });
}
