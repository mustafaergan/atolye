// Tarayıcı bağlantısının ön koşulları ve kurulumu: seçilen tarayıcı bu bilgisayarda var mı, Playwright MCP paketi
// kurulu mu, değilse indirilebiliyor mu? Kurulum yalnızca kullanıcı arayüzde onayladıktan sonra yapılır.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const PACKAGE = '@playwright/mcp';

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

const run = (cmd, timeout) => new Promise((resolve) => {
  exec(cmd, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
});

let globalRoot = null; // npm'in genel paket klasörü (bir kez sorulur)
async function npmGlobalRoot() {
  if (!globalRoot) globalRoot = await run('npm root -g', 20_000);
  return globalRoot;
}

/** Playwright MCP bu bilgisayarda (npm genel paketleri arasında) kurulu mu? { version, cli } ya da null */
export async function installedMcp() {
  const root = await npmGlobalRoot();
  if (!root) return null;
  try {
    const dir = path.join(root, ...PACKAGE.split('/'));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0];
    const cli = bin && path.join(dir, bin);
    return cli && fs.existsSync(cli) ? { version: pkg.version, cli } : null;
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
