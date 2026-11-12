// Tarayıcı bağlantısı (Playwright MCP): ayarın CLI dosyalarına yazılması ve ön koşul denetimi.
// Gerçek ayar dosyalarına dokunulmaz; hiçbir şey kurulmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-tarayici-'));
process.env.ATOLYE_CLAUDE_JSON = path.join(dir, '.claude.json');
process.env.ATOLYE_COPILOT_MCP = path.join(dir, 'copilot', 'mcp-config.json');
const integrations = await import('../src/integrations.js');
const { installedBrowserPath } = await import('../src/browser-check.js');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cli = path.join(dir, 'node_modules', '@playwright', 'mcp', 'cli.js');

test('tarayıcı seçimi CLI ayar dosyalarına "tarayici" sunucusu olarak yazılır; diğer bağlantılar etkilenmez', () => {
  integrations.save('jira', { url: 'https://jira.ornek.com', token: 'x' });
  assert.deepEqual(integrations.status().services.tarayici, { connected: false, browser: 'chrome', headless: false });

  const st = integrations.saveBrowser({ browser: 'msedge', headless: true, cli });
  assert.deepEqual(st.services.tarayici, { connected: true, browser: 'msedge', headless: true });
  const claude = read(process.env.ATOLYE_CLAUDE_JSON).mcpServers;
  assert.equal(claude.tarayici.type, 'stdio');
  assert.equal(claude.tarayici.command, process.execPath, 'PATH ya da npx gerektirmez: paketin dosyası Node ile çalıştırılır');
  assert.deepEqual(claude.tarayici.args, [cli, '--browser', 'msedge', '--headless']);
  assert.ok(claude.atolye, 'Jira bağlantısı yerinde durur');
  const copilot = read(process.env.ATOLYE_COPILOT_MCP).mcpServers;
  assert.equal(copilot.tarayici.type, 'local');
  assert.deepEqual(copilot.tarayici.args, claude.tarayici.args);

  // Tarayıcı değiştirme
  assert.deepEqual(integrations.saveBrowser({ browser: 'chrome', headless: false, cli }).services.tarayici, { connected: true, browser: 'chrome', headless: false });
  assert.deepEqual(read(process.env.ATOLYE_CLAUDE_JSON).mcpServers.tarayici.args, [cli, '--browser', 'chrome']);
});

test('geçersiz seçim ya da kurulmamış paket kaydedilmez; kaldırınca yalnızca tarayıcı silinir', () => {
  assert.throws(() => integrations.saveBrowser({ browser: 'opera', cli }), { code: 'bad-browser' });
  assert.throws(() => integrations.saveBrowser({ browser: 'chrome', cli: null }), { code: 'not-installed' });
  const st = integrations.removeBrowser();
  assert.equal(st.services.tarayici.connected, false);
  const claude = read(process.env.ATOLYE_CLAUDE_JSON).mcpServers;
  assert.equal(claude.tarayici, undefined);
  assert.ok(claude.atolye);
  integrations.remove('jira');
});

test('kurulu tarayıcı algılama (Chrome / Edge); Playwright\'ın kendi tarayıcıları için aranmaz', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const exists = (p) => p === edge;
  assert.equal(installedBrowserPath('msedge', env, exists, 'win32'), edge);
  assert.equal(installedBrowserPath('chrome', env, exists, 'win32'), null);
  assert.equal(installedBrowserPath('firefox', env, () => true, 'win32'), null);
  assert.equal(installedBrowserPath('msedge', env, exists, 'linux'), null);
});
