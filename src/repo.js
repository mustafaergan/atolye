// "İlk repom": bir depoyu bilgisayara indirme (git clone) yardımcısı. Analistlerin terminale
// girmeden ilk depolarını indirebilmesi için. Bitbucket bağlıysa depo listesi ve giriş bilgisi
// oradan gelir; API anahtarı adrese ya da komut satırına yazılmaz (ortam değişkeniyle verilir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { bitbucket, isCloud } from './atlassian.js';

const run = (cmd, args, opts) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

export const defaultParent = () => path.join(os.homedir(), 'repos');

export async function gitVersion() {
  const { err, stdout } = await run('git', ['--version'], { timeout: 10_000 });
  return err ? null : (stdout.match(/\d+\.\d+(\.\d+)?/)?.[0] || stdout.trim());
}

/** Depo adresinden klasör adı: .../scm/abc/depo-adi.git → depo-adi */
export function repoName(url) {
  const last = String(url).trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() || '';
  return last.replace(/\.git$/i, '').replace(/[^\w.-]/g, '');
}

/** Yalnızca https/http/ssh depo adresleri; "-" ile başlayan (git seçeneği gibi görünen) değerler reddedilir */
export function validRepoUrl(url) {
  const u = String(url || '').trim();
  if (!u || u.startsWith('-') || /\s/.test(u)) return false;
  return /^https?:\/\/[^/]+\/.+/i.test(u) || /^ssh:\/\/[^/]+\/.+/i.test(u) || /^[\w.-]+@[\w.-]+:.+/.test(u);
}

/** Adres bağlı Bitbucket sunucusundaysa giriş başlığı (Git'e ortam değişkeniyle verilir) */
export function authHeaderFor(url, cfg) {
  if (!cfg || !/^https?:/i.test(url)) return null;
  let host; let cfgHost;
  try { host = new URL(url).hostname.toLowerCase(); cfgHost = new URL(cfg.url).hostname.toLowerCase(); } catch { return null; }
  if (host !== cfgHost) return null;
  if (isCloud(cfg.url)) return `Authorization: Basic ${Buffer.from(`x-bitbucket-api-token-auth:${cfg.token}`).toString('base64')}`;
  return `Authorization: Bearer ${cfg.token}`;
}

/** Depoyu indirir: { ok: true, dir } ya da { ok: false, code, error } */
export async function cloneRepo({ url, parent, bitbucketCfg }) {
  const repoUrl = String(url || '').trim();
  if (!validRepoUrl(repoUrl)) return { ok: false, code: 'bad-url' };
  const name = repoName(repoUrl);
  if (!name) return { ok: false, code: 'bad-url' };
  if (!(await gitVersion())) return { ok: false, code: 'no-git' };
  const base = path.resolve(String(parent || '').trim() || defaultParent());
  const dir = path.join(base, name);
  if (fs.existsSync(dir)) return { ok: false, code: 'exists', dir };
  fs.mkdirSync(base, { recursive: true });

  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }; // konsoldan parola bekleyip takılmasın
  const header = authHeaderFor(repoUrl, bitbucketCfg);
  if (header) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: header });
  const { err, stderr } = await run('git', ['clone', '--', repoUrl, dir], { env, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (err) {
    const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(Cloning into|remote: (Counting|Compressing|Enumerating))/.test(l));
    return { ok: false, code: 'git', error: lines.slice(-4).join('\n').slice(0, 600) || String(err.message).slice(0, 300) };
  }
  return { ok: true, dir };
}

/** Bağlı Bitbucket'taki depolar (indirme adresleriyle) */
export async function listRepos(bitbucketCfg, project) {
  return bitbucket.repos(bitbucketCfg, { project });
}
