// Claude Code girişi algılama: motor seçicide Claude Code yalnızca giriş varsa gösterilir
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeLogin } from '../src/claude-auth.js';

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-giris-'));
  // Gerçek ~/.claude ve ~/.claude.json'a hiç bakılmasın
  return { dir, env: { CLAUDE_CONFIG_DIR: dir, ATOLYE_CLAUDE_JSON: path.join(dir, '.claude.json') } };
};
const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));

test('hiçbir iz yoksa giriş yok', async () => {
  const { env } = fresh();
  assert.deepEqual(await claudeLogin(env), { loggedIn: false, via: null });
});

test('ortam değişkeni: API anahtarı, gateway token\'ı, OAuth token\'ı ya da Bedrock seçimi yeter; boş ve "0" sayılmaz', async () => {
  const { env } = fresh();
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) {
    assert.equal((await claudeLogin({ ...env, [k]: 'x' })).via, 'env', k);
  }
  assert.equal((await claudeLogin({ ...env, ANTHROPIC_API_KEY: ' ', CLAUDE_CODE_USE_VERTEX: '0' })).loggedIn, false);
});

test('Claude Code ayarları: env içinde token ya da apiKeyHelper', async () => {
  const a = fresh();
  write(a.dir, 'settings.json', { env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: 'x' } });
  assert.deepEqual(await claudeLogin(a.env), { loggedIn: true, via: 'settings' });
  const b = fresh();
  write(b.dir, 'settings.local.json', { apiKeyHelper: 'anahtar-ver.cmd' });
  assert.equal((await claudeLogin(b.env)).via, 'settings');
  const c = fresh();
  write(c.dir, 'settings.json', { env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com' }, model: 'opus' });
  assert.equal((await claudeLogin(c.env)).loggedIn, false, 'yalnızca adres yetmez');
});

test('claude.ai girişi: .credentials.json ya da ~/.claude.json hesap kaydı; bozuk dosya giriş sayılmaz', async () => {
  const a = fresh();
  write(a.dir, '.credentials.json', { claudeAiOauth: { accessToken: 'x', refreshToken: 'y', expiresAt: 1 } });
  assert.deepEqual(await claudeLogin(a.env), { loggedIn: true, via: 'oauth' });
  const b = fresh();
  write(b.dir, '.claude.json', { numStartups: 3, oauthAccount: { accountUuid: 'u-1', emailAddress: 'kisi@example.com' } });
  assert.deepEqual(await claudeLogin(b.env), { loggedIn: true, via: 'account' });
  const c = fresh();
  write(c.dir, '.credentials.json', '{bozuk');
  write(c.dir, '.claude.json', { numStartups: 3, mcpServers: {} });
  assert.equal((await claudeLogin(c.env)).loggedIn, false);
});
