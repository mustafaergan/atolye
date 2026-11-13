// Tarayıcı bağlantısının ön koşulları ve kurulumu: seçilen tarayıcı bu bilgisayarda var mı, Playwright MCP paketi
// kurulu mu, değilse indirilebiliyor mu? Kurulum yalnızca kullanıcı arayüzde onayladıktan sonra yapılır.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { copilotEnv } from './proxy.js';

const PACKAGE = '@playwright/mcp';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Kurulu tarayıcıyı kullanan seçenekler için bilinen yerler (Playwright'ın kendi tarayıcıları ayrıca indirilir) */
export function installedBrowserPath(browser, env = process.env, exists = fs.existsSync, platform = process.platform) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
  const rel = {
    chrome: 'Google\\Chrome\\Application\\chrome.exe',
    msedge: 'Microsoft\\Edge\\Application\\msedge.exe',
  }[browser];
  if (platform !== 'win32' || !rel) return null;
  for (const root of roots) { const p = path.win32.join(root, rel); if (exists(p)) return p; }
  return null;
}

// npm komutları: Bağlantılar > Proxy'de bir proxy tanımlıysa o kullanılır; kurumsal ağların araya giren sertifikaları
// için Node'un işletim sistemi sertifika deposuna güvenmesi istenir (destekleyen sürümlerde).
export function npmEnv() {
  const env = { ...copilotEnv() };
  const [major, minor] = process.versions.node.split('.').map(Number);
  if ((major > 22 || (major === 22 && minor >= 15)) && !/--use-system-ca/.test(env.NODE_OPTIONS || '')) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --use-system-ca`.trim();
  }
  return env;
}
const run = (cmd, timeout) => new Promise((resolve) => {
  exec(cmd, { timeout, windowsHide: true, env: npmEnv() }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
});

let globalRoot = null; // npm'in genel paket klasörü (bir kez sorulur)
async function npmGlobalRoot() {
  if (!globalRoot) globalRoot = await run('npm root -g', 20_000);
  return globalRoot;
}

function readPackage(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0];
    const cli = bin && path.join(dir, bin);
    return cli && fs.existsSync(cli) ? { version: pkg.version, cli } : null;
  } catch {
    return null;
  }
}

/**
 * Playwright MCP kullanılabilir mi? { version, cli, bundled } ya da null. Önce Atölye'nin kendi kütüphaneleri
 * arasına bakılır: paket Atölye ile birlikte gelir, bu yüzden npm erişimi olmayan ağlarda da kurulum gerekmez.
 * Orada yoksa (eski ya da eksik kurulum) npm'in genel paketlerine bakılır.
 */
export async function installedMcp(root = ROOT) {
  const bundled = readPackage(path.join(root, 'node_modules', ...PACKAGE.split('/')));
  if (bundled) return { ...bundled, bundled: true };
  const globalDir = await npmGlobalRoot();
  const global = globalDir && readPackage(path.join(globalDir, ...PACKAGE.split('/')));
  return global ? { ...global, bundled: false } : null;
}

/**
 * Playwright MCP ile birlikte kurulan Playwright kütüphanesinin klasörü. MCP araçlarının kullanılamadığı oturumlarda
 * (ör. kuruluş politikasıyla kısıtlı Copilot) yapay zekâ tarayıcıyı bir betikle sürebilir; kütüphane zaten kurulu
 * olduğu için yeniden bir şey kurması gerekmez.
 */
export function playwrightLibrary(cli) {
  if (!cli) return null;
  try {
    return path.dirname(createRequire(cli).resolve('playwright/package.json'));
  } catch {
    return null;
  }
}

/**
 * Ön koşullar: { browser: 'found' | 'missing' | 'managed' | 'unknown', installed: sürüm | null, available: sürüm | null }
 * available yalnızca paket kurulu değilken sorulur: npm kayıt defterinden indirilebiliyor mu?
 */
export async function checkBrowser(browser) {
  const managed = !['chrome', 'msedge'].includes(browser);
  const found = managed ? null : installedBrowserPath(browser);
  const mcp = await installedMcp();
  const latest = mcp ? null : await run(`npm view ${PACKAGE} version`, 25_000);
  return {
    browser: managed ? 'managed' : process.platform !== 'win32' ? 'unknown' : found ? 'found' : 'missing',
    installed: mcp?.version || null,
    available: latest && /^\d+\.\d+/.test(latest) ? latest : null,
  };
}

/** Playwright MCP paketini npm ile bu bilgisayara kurar. Yalnızca kullanıcı onayından sonra çağrılır. */
export async function installPlaywrightMcp() {
  const out = await run(`npm install -g ${PACKAGE} --no-audit --no-fund --loglevel=error`, 5 * 60_000);
  const mcp = await installedMcp();
  if (out === null || !mcp) return { ok: false, error: 'paket kurulamadı (npm erişimini ve Node.js kurulumunu kontrol edin)' };
  return { ok: true, version: mcp.version };
}
