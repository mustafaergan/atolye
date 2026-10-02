// İsteğe bağlı harcama göstergesi. Kurumların kendi harcama/bütçe script'leri
// olabildiği için Atölye belirli bir kaynağa bağlı değildir: ATOLYE_SPEND_CMD
// ile verilen komutu çalıştırır ve çıktısını üst çubukta gösterir.
//
//   ATOLYE_SPEND_CMD=node "C:\yol\scripts\spend.mjs"
//
// Komut, Claude Code'un bir skill'i çalıştırdığı ortama benzer şekilde
// ~/.claude/settings.json içindeki "env" değerleriyle (gateway, token) çalışır.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 20_000;
let cache = null; // { at, value }
let running = null;

export const spendCommand = () => process.env.ATOLYE_SPEND_CMD?.trim() || null;

async function settingsEnv() {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8');
    const env = JSON.parse(raw)?.env;
    return env && typeof env === 'object' ? env : {};
  } catch {
    return {};
  }
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

// Çıktının biçimi bilinmediği için kısa bir özet çıkar: yüzde ve tutar içeren ilk satır
export function summarize(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // "82%" ve Türkçe yazımdaki "%82" biçimlerinin ikisi de
  const m = text.match(/(\d{1,3}(?:[.,]\d+)?)\s?%|%\s?(\d{1,3}(?:[.,]\d+)?)/);
  const pct = m && [null, m[1] ?? m[2]];
  const line = lines.find((l) => /[$€₺]|\d\s?(usd|tl|eur)\b/i.test(l)) || lines.find((l) => /%/.test(l)) || lines[0] || '';
  return {
    summary: line.replace(/^[^\p{L}\p{N}$€₺]+/u, '').slice(0, 60),
    percent: pct ? Number(pct[1].replace(',', '.')) : null,
  };
}

export async function getSpend({ force = false } = {}) {
  const cmd = spendCommand();
  if (!cmd) return { enabled: false };
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (running) return running;

  running = (async () => {
    const env = { ...(await settingsEnv()), ...process.env };
    const value = await new Promise((resolve) => {
      exec(cmd, { env, cwd: os.homedir(), timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const output = stripAnsi(String(stdout || '')).trim();
        if (err && !output) {
          resolve({ enabled: true, ok: false, error: stripAnsi(String(stderr || err.message)).trim().slice(0, 2000) });
          return;
        }
        resolve({ enabled: true, ok: true, output: output.slice(0, 8000), ...summarize(output), at: Date.now() });
      });
    });
    cache = { at: Date.now(), value };
    return value;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}
