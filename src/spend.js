// İsteğe bağlı harcama göstergesi. Bazı kurumsal gateway'ler, Claude Code
// token'ıyla çağrılabilen bir harcama özeti sunar:
//
//   POST <ANTHROPIC_BASE_URL kökü>/spend-summary   (Authorization: Bearer <token>)
//   → { "items": [ { "label": "...", "value": "..." }, ... ] }
//
// Atölye bunu kendiliğinden dener; gateway desteklemiyorsa gösterge gizlenir.
// Yol ATOLYE_SPEND_PATH ile değiştirilebilir, ATOLYE_SPEND=0 ile kapatılabilir.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFile } from 'node:child_process';

const CACHE_MS = 60_000;
const UNSUPPORTED_RETRY_MS = 10 * 60_000;
const TIMEOUT_MS = 30_000;
let cache = null; // { at, ttl, value }
let running = null;

// Kurumsal ağlarda TLS denetimi yapan sertifikalar genelde sadece işletim
// sisteminin deposundadır. Destekleyen Node sürümlerinde onları da güven listesine ekle.
let systemCaAdded = false;
function trustSystemCertificates() {
  if (systemCaAdded) return;
  systemCaAdded = true;
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const merged = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
    tls.setDefaultCACertificates(merged);
  } catch {
    /* eski Node: aşağıdaki işletim sistemi yedeği devreye girer */
  }
}

// Claude Code'un ayar dosyaları (spend skill'inin baktığı sırayla) + ortam değişkenleri
async function credentials() {
  const home = os.homedir();
  const dir = process.env.CLAUDE_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [
    dir && path.join(dir, 'settings.local.json'),
    dir && path.join(dir, 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(home, '.claude', 'settings.json'),
    xdg && path.join(xdg, 'claude', 'settings.json'),
  ].filter(Boolean);

  let env = {};
  for (const p of candidates) {
    try {
      const e = JSON.parse(await fs.readFile(p, 'utf8'))?.env || {};
      if (e.ANTHROPIC_AUTH_TOKEN && e.ANTHROPIC_BASE_URL) { env = e; break; }
      if (!Object.keys(env).length) env = e;
    } catch {
      /* dosya yok ya da okunamadı */
    }
  }
  return {
    token: process.env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL || env.ANTHROPIC_BASE_URL,
  };
}

async function postWithFetch(url, token) {
  trustSystemCertificates();
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
}

// Yedek: işletim sisteminin kendi HTTP istemcisi (Windows'ta PowerShell/Schannel,
// diğerlerinde curl). Token komut satırına değil, ortam değişkenine konur.
export function postWithSystem(url, token) {
  const env = { ...process.env, ATOLYE_SPEND_TOKEN: token, ATOLYE_SPEND_URL: url };
  const [cmd, args] = process.platform === 'win32'
    ? ['powershell', ['-NonInteractive', '-NoProfile', '-Command',
        "try { $r = Invoke-WebRequest -Uri $env:ATOLYE_SPEND_URL -Method POST -UseBasicParsing -ErrorAction Stop " +
        "-Headers @{ Authorization = 'Bearer ' + $env:ATOLYE_SPEND_TOKEN; 'content-type' = 'application/json' }; " +
        "'STATUS:' + $r.StatusCode; $r.Content } " +
        "catch { if ($_.Exception.Response) { 'STATUS:' + [int]$_.Exception.Response.StatusCode } else { throw } }"]]
    : ['sh', ['-c', 'curl -s -X POST -H "Authorization: Bearer $ATOLYE_SPEND_TOKEN" -H "content-type: application/json" -w "\nSTATUS:%{http_code}" "$ATOLYE_SPEND_URL"']];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || '').replace(/\r\n/g, '\n');
      const statusLine = out.split('\n').find((l) => l.startsWith('STATUS:'));
      if (!statusLine) return reject(new Error(String(stderr || err?.message || 'İstek başarısız').trim().slice(0, 400)));
      const body = out.split('\n').filter((l) => !l.startsWith('STATUS:')).join('\n').trim();
      resolve({ status: Number(statusLine.slice(7)), body });
    });
  });
}

async function post(url, token) {
  try {
    return await postWithFetch(url, token);
  } catch (err) {
    // HTTP cevabı alınamadıysa (TLS/proxy sorunu) işletim sistemi istemcisiyle tekrar dene
    try {
      return await postWithSystem(url, token);
    } catch {
      throw err;
    }
  }
}

// ---------- Özet ----------
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

/** Üst çubuk için kısa özet: "harcanan / bütçe · %yüzde" */
export function summarize(items) {
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
  return { summary: parts.join(' · ').slice(0, 60), percent };
}

export function parseResponse(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Cevap JSON olarak okunamadı');
  }
  const items = Array.isArray(data?.items)
    ? data.items.map((i) => ({ label: String(i?.label ?? ''), value: String(i?.value ?? '') })).filter((i) => i.label || i.value)
    : [];
  if (!items.length) throw new Error('Beklenmeyen cevap biçimi ({ items: [...] } bekleniyordu)');
  return items;
}

async function fetchSpend() {
  if (process.env.ATOLYE_SPEND === '0') return { value: { enabled: false }, ttl: Infinity };
  const { token, baseUrl } = await credentials();
  if (!token || !baseUrl) return { value: { enabled: false }, ttl: UNSUPPORTED_RETRY_MS };

  let url;
  try {
    const origin = new URL(baseUrl).origin;
    // Özel gateway yoksa (doğrudan Anthropic API'si) böyle bir uç nokta yok; token'ı boşuna gönderme
    if (/(^|\.)anthropic\.com$/i.test(new URL(origin).hostname)) return { value: { enabled: false }, ttl: Infinity };
    url = new URL(process.env.ATOLYE_SPEND_PATH || '/spend-summary', origin).href;
  } catch {
    return { value: { enabled: false }, ttl: UNSUPPORTED_RETRY_MS };
  }

  try {
    const { status, body } = await post(url, token);
    // Bu gateway'de böyle bir uç nokta yok: göstergeyi gizle, arada bir yeniden dene
    if (status === 404 || status === 405 || status === 501) return { value: { enabled: false }, ttl: UNSUPPORTED_RETRY_MS };
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    const items = parseResponse(body);
    return { value: { enabled: true, ok: true, title: 'Claude Code harcama', items, ...summarize(items), at: Date.now() }, ttl: CACHE_MS };
  } catch (err) {
    return { value: { enabled: true, ok: false, error: String(err?.message || err).slice(0, 1000) }, ttl: CACHE_MS };
  }
}

export async function getSpend({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < cache.ttl) return cache.value;
  if (running) return running;
  running = fetchSpend().then(({ value, ttl }) => {
    cache = { at: Date.now(), ttl, value };
    return value;
  });
  try {
    return await running;
  } finally {
    running = null;
  }
}
