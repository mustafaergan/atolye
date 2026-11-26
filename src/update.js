// Yeni Atölye sürümü var mı? Depodaki package.json sürümü kurulu olanla karşılaştırılır.
// Yalnızca sürüm numarası okunur; hiçbir kullanıcı bilgisi gönderilmez. Ağ engelliyse sessizce geçilir.
//   ATOLYE_UPDATE_URL   : farklı bir depo/ayna için package.json adresi
//   ATOLYE_UPDATE_CHECK=0 : denetimi kapatır
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { httpsGet } from './oracle-client.js';
import { parseProxy } from './proxy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_URL = 'https://raw.githubusercontent.com/mustafaergan/atolye/main/package.json';
const API_URL = 'https://api.github.com/repos/mustafaergan/atolye/contents/package.json?ref=main';
const CACHE_MS = 24 * 60 * 60 * 1000; // günde bir kez
let cache = null;

/** a > b ise pozitif (yalnızca sayısal parçalar karşılaştırılır: 0.10.0 > 0.9.2) */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Windows'ta atolye.ps1 hem git hem paket kurulumunu günceller (paket kurulumunda son sürümü zip olarak indirir);
// macOS'ta atolye.sh aynı işi yapar (git ya da arşiv)
const canApply = () => (process.platform === 'win32' && fs.existsSync(path.join(ROOT, 'atolye.ps1')))
  || (process.platform === 'darwin' && fs.existsSync(path.join(ROOT, 'atolye.sh')));

/**
 * Güncellemeyi başlatır: "atolye.ps1 guncelle" son sürümü çeker, paketleri kurar ve Atölye'yi yeniden başlatır.
 * Betik Atölye'yi durduracağı için bu sürecin alt süreci olmamalıdır; "start" ile bağımsız başlatılır.
 */
export function applyUpdate() {
  if (!canApply()) return { started: false };
  if (process.platform === 'darwin') {
    // Araya giren kabuk hemen çıkar: güncelleyici bu sürecin torunu olarak kalmaz (Atölye durdurulurken onunla
    // birlikte kapatılmasın diye). Çıktı: atolye-guncelle.log
    const sh = path.join(ROOT, 'atolye.sh').replace(/'/g, `'\\''`);
    const child = spawn('/bin/bash', ['-c', `nohup /bin/bash '${sh}' guncelle < /dev/null > /dev/null 2>&1 &`],
      { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, ATOLYE_SORMA: '1', ATOLYE_GUNCELLEME_KAYDI: '1' } });
    child.unref();
    return { started: true };
  }
  const script = path.join(ROOT, 'atolye.ps1');
  const child = spawn(process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `"start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" guncelle"`],
    { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, ATOLYE_SORMA: '1', ATOLYE_GUNCELLEME_KAYDI: '1' } }); // çıktı: atolye-guncelle.log
  child.unref();
  return { started: true };
}

const hasProxy = (env) => Boolean(parseProxy(env.COPILOT_PROXY) || parseProxy(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy));
let proxyGet = httpsGet;
/** Testler için: proxy üzerinden okuma yerine çağrılacak işlev */
export function setProxyGet(fn) { proxyGet = fn || httpsGet; }

/**
 * Adresteki metni okur: önce doğrudan; ağ doğrudan çıkışa izin vermiyorsa ve bir proxy ayarlıysa (Bağlantılar > Proxy ya da
 * bilgisayarın genel ayarı) proxy üzerinden. { text } ya da { error } döndürür.
 */
async function readText(url, accept, env = process.env) {
  let error = '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept, 'user-agent': 'atolye' } });
    if (res.ok) return { text: await res.text() };
    return { error: `HTTP ${res.status}` }; // sunucu cevap verdi: proxy denemek sonucu değiştirmez
  } catch (err) { error = String(err.cause?.code || err.name || err.message); }
  if (!hasProxy(env)) return { error };
  try {
    const res = await proxyGet(url, env, 5, { accept });
    if (res.statusCode !== 200) { res.resume?.(); return { error: `HTTP ${res.statusCode} (proxy)` }; }
    const chunks = [];
    let size = 0;
    for await (const c of res) { size += c.length; if (size > 1_000_000) break; chunks.push(c); }
    return { text: Buffer.concat(chunks).toString('utf8') };
  } catch (err) { return { error: `${error}; proxy: ${String(err.cause?.code || err.code || err.message)}` }; }
}

export async function checkUpdate({ force = false } = {}) {
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  // Git ile indirilmişse "atolye.ps1 guncelle", paketten kurulmuşsa yeni paket
  const how = fs.existsSync(path.join(ROOT, '.git')) ? 'git' : 'paket';
  const base = { current, latest: null, available: false, how, canApply: canApply() };
  if (process.env.ATOLYE_UPDATE_CHECK === '0') return base;
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ...base, ...cache.value };
  let value = {};
  try {
    try {
      if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function')
        tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
    } catch { /* eski Node */ }
    // Olağan adres (raw.githubusercontent.com) dosyayı birkaç dakika önbellekte tutar. Kullanıcı elle denetlediğinde
    // önce önbelleksiz GitHub API'si sorulur ki yeni gönderilmiş sürüm hemen görülsün; o yanıt vermezse (saatlik
    // istek sınırı, ağ engeli) olağan adrese dönülür.
    const custom = process.env.ATOLYE_UPDATE_URL;
    const sources = custom ? [[custom, 'application/json']] : [...(force ? [[API_URL, 'application/vnd.github.raw+json']] : []), [DEFAULT_URL, 'application/json']];
    const errors = [];
    for (const [url, accept] of sources) {
      try {
        const r = await readText(url, accept);
        if (!r.text) { errors.push(`${new URL(url).host}: ${r.error}`); continue; }
        const latest = String(JSON.parse(r.text).version || '');
        if (/^\d+\.\d+\.\d+/.test(latest)) { value = { latest, available: compareVersions(latest, current) > 0 }; break; }
      } catch (err) { errors.push(`${new URL(url).host}: ${err.message}`); }
    }
    // Okunamadıysa nedeni arayüze ve kayıtlara verilir (ör. şirket ağı GitHub'a doğrudan çıkışa izin vermiyor)
    if (!value.latest && errors.length) value = { reason: errors.join(' | ').slice(0, 300) };
  } catch { /* ağ yok / engelli: bildirim gösterilmez */ }
  cache = { at: Date.now(), value };
  console.log(`[güncelleme] kurulu ${current}, depodaki ${value.latest || `okunamadı${value.reason ? ` (${value.reason})` : ''}`}`);
  return { ...base, ...value };
}

/** Bir sonraki günlük denetim anı: yerel saatle "hour":00 (o an geçtiyse ertesi gün) */
export function nextDailyAt(now, hour = 9) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Güncellemeyi Atölye açılır açılmaz bir kez, sonra her sabah 9'da denetler. Bilgisayar o saatte kapalı ya da
 * uykudaysa denetim açıldığında yapılır (saat birkaç dakikada bir yoklanır). Sonuç önbelleğe yazılır; arayüz
 * "Güncelleme var" düğmesini oradan gösterir. ATOLYE_UPDATE_HOUR ile saat, ATOLYE_UPDATE_CHECK=0 ile kapatma.
 */
export function startDailyCheck({ hour = Number(process.env.ATOLYE_UPDATE_HOUR) || 9, check = () => checkUpdate({ force: true }), now = () => Date.now(), tickMs = 5 * 60 * 1000, firstMs = 5000 } = {}) {
  if (process.env.ATOLYE_UPDATE_CHECK === '0') return () => {};
  let due = nextDailyAt(now(), hour);
  const run = () => Promise.resolve().then(check).catch(() => {});
  const first = setTimeout(run, firstMs);
  const timer = setInterval(() => {
    if (now() < due) return;
    due = nextDailyAt(now(), hour);
    run();
  }, tickMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
