// Claude Code'a giriş yapılmış mı? Motor seçicide Claude Code yalnızca giriş varsa gösterilir.
//
// Claude Code'u çalıştırmadan, yalnızca ayar dosyalarına bakılarak anlaşılır (hızlı, yan etkisiz). Şunlardan biri
// yeterlidir:
//   - ortam değişkeni: API anahtarı, gateway token'ı, OAuth token'ı ya da Bedrock/Vertex/Foundry seçimi
//     (Atölye'nin .env dosyası da başlarken ortama yüklenir; Ayarlar → Claude'dan girilen token buradan gelir)
//   - Claude Code ayarları (settings.json / settings.local.json): "env" içinde aynı değişkenler ya da apiKeyHelper
//   - claude.ai girişi: ~/.claude/.credentials.json (Windows/Linux) ya da ~/.claude.json'daki hesap kaydı
//     (macOS'ta token anahtar zincirinde durur, hesap kaydı yine ~/.claude.json'dadır)
// Token'ın süresinin dolup dolmadığına bakılmaz: Claude Code onu kendisi yeniler.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const set = (v) => v != null && String(v).trim() !== '' && String(v).trim() !== '0';
const hasKey = (env) => KEYS.some((k) => set(env?.[k]));

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

/** { loggedIn, via }: via = env | settings | oauth | account (giriş yoksa null) */
export async function claudeLogin(env = process.env) {
  if (hasKey(env)) return { loggedIn: true, via: 'env' };
  const home = os.homedir();
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const settings = [path.join(dir, 'settings.json'), path.join(dir, 'settings.local.json')];
  if (env.XDG_CONFIG_HOME) settings.push(path.join(env.XDG_CONFIG_HOME, 'claude', 'settings.json'));
  for (const file of settings) {
    const s = await readJson(file);
    if (s && (hasKey(s.env) || set(s.apiKeyHelper))) return { loggedIn: true, via: 'settings' };
  }
  const oauth = (await readJson(path.join(dir, '.credentials.json')))?.claudeAiOauth;
  if (set(oauth?.accessToken) || set(oauth?.refreshToken)) return { loggedIn: true, via: 'oauth' };
  const account = await readJson(env.ATOLYE_CLAUDE_JSON || path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'));
  if (account?.oauthAccount?.accountUuid || account?.oauthAccount?.emailAddress || set(account?.primaryApiKey)) return { loggedIn: true, via: 'account' };
  return { loggedIn: false, via: null };
}
