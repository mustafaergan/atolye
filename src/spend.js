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
const TIMEOUT_MS = 45_000; // bazı script'ler isteği PowerShell üzerinden 30 sn zaman aşımıyla yapar
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

// "82%" ve Türkçe yazımdaki "%82" biçimlerinin ikisi de
const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s?%|%\s?(\d{1,3}(?:[.,]\d+)?)/;
const percentOf = (s) => {
  const m = String(s).match(PERCENT);
  return m ? Number((m[1] ?? m[2]).replace(',', '.')) : null;
};
// "$1,234.50", "1.234,50 TL" gibi değerlerden sayı
const amountOf = (s) => {
  const m = String(s).match(/-?\d[\d.,]*/);
  if (!m) return null;
  let n = m[0];
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else n = n.replace(/,/g, ''); // 1,234.50
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
};
const isMoney = (s) => /[$€₺£]|\b(usd|eur|tl|try)\b/i.test(s);

// Tablo biçimi: başlık, ardından "────" çizgisi, ardından "etiket   değer" satırları
export function parseItems(text) {
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex((l) => /^\s*[─━\-=]{3,}\s*$/.test(l));
  const body = sep >= 0 ? lines.slice(sep + 1) : lines;
  const items = [];
  for (const l of body) {
    const m = l.trim().match(/^(.+?)\s{2,}(.+)$/);
    if (m) items.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return { title: sep > 0 ? lines.slice(0, sep).join(' ').trim() : null, items };
}

// Üst çubuk için kısa özet: harcanan / bütçe · yüzde
export function summarize(text) {
  const { title, items } = parseItems(text);
  if (items.length) {
    const moneyItem = (re) => items.find((i) => re.test(i.label) && isMoney(i.value));
    const spent = moneyItem(/spen[dt]|used|usage|cost|harca|kullan/i);
    const budget = moneyItem(/budget|limit|quota|b[uü]t[cç]e|kota/i);
    const pctItem = items.find((i) => PERCENT.test(i.value));
    let percent = pctItem ? percentOf(pctItem.value) : null;
    if (percent == null && spent && budget) {
      const a = amountOf(spent.value), b = amountOf(budget.value);
      if (a != null && b) percent = Math.round((a / b) * 1000) / 10;
    }
    const money = spent || items.find((i) => isMoney(i.value));
    const parts = [];
    if (money) parts.push(budget && budget !== money ? `${money.value} / ${budget.value}` : money.value);
    if (percent != null) parts.push(`%${percent}`);
    if (!parts.length) parts.push(...items.slice(0, 2).map((i) => i.value));
    return { title, items, summary: parts.join(' · ').slice(0, 60), percent };
  }

  // Bilinmeyen biçim: tutar ya da yüzde içeren ilk satır
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => isMoney(l)) || lines.find((l) => /%/.test(l)) || lines[0] || '';
  return {
    title: null,
    items: [],
    summary: line.replace(/^[^\p{L}\p{N}$€₺]+/u, '').slice(0, 60),
    percent: percentOf(text),
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
        // Script hata verdiğinde (sıfırdan farklı çıkış kodu ya da "ERROR:" satırı) çıktısı hata mesajıdır
        if (err || /^ERROR:/m.test(output)) {
          const detail = output || stripAnsi(String(stderr || err?.message || '')).trim();
          resolve({ enabled: true, ok: false, error: (err?.killed ? 'Zaman aşımı. ' : '') + detail.slice(0, 2000) });
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
