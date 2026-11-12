// Yeni Atölye sürümü var mı? Depodaki package.json sürümü kurulu olanla karşılaştırılır.
// Yalnızca sürüm numarası okunur; hiçbir kullanıcı bilgisi gönderilmez. Ağ engelliyse sessizce geçilir.
//   ATOLYE_UPDATE_URL   : farklı bir depo/ayna için package.json adresi
//   ATOLYE_UPDATE_CHECK=0 : denetimi kapatır
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_URL = 'https://raw.githubusercontent.com/mustafaergan/atolye/main/package.json';
const CACHE_MS = 24 * 60 * 60 * 1000; // günde bir kez
let cache = null;

/** a > b ise pozitif (yalnızca sayısal parçalar karşılaştırılır: 0.10.0 > 0.9.2) */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Windows'ta atolye.ps1 hem git hem paket kurulumunu günceller (paket kurulumunda son sürümü zip olarak indirir)
const canApply = () => process.platform === 'win32' && fs.existsSync(path.join(ROOT, 'atolye.ps1'));

/**
 * Güncellemeyi başlatır: "atolye.ps1 guncelle" son sürümü çeker, paketleri kurar ve Atölye'yi yeniden başlatır.
 * Betik Atölye'yi durduracağı için bu sürecin alt süreci olmamalıdır; "start" ile bağımsız başlatılır.
 */
export function applyUpdate() {
  if (!canApply()) return { started: false };
  const script = path.join(ROOT, 'atolye.ps1');
  const child = spawn(process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `"start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" guncelle"`],
    { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, ATOLYE_SORMA: '1', ATOLYE_GUNCELLEME_KAYDI: '1' } }); // çıktı: atolye-guncelle.log
  child.unref();
  return { started: true };
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
    const res = await fetch(process.env.ATOLYE_UPDATE_URL || DEFAULT_URL, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (res.ok) {
      const latest = String(JSON.parse(await res.text()).version || '');
      if (/^\d+\.\d+\.\d+/.test(latest)) value = { latest, available: compareVersions(latest, current) > 0 };
    }
  } catch { /* ağ yok / engelli: bildirim gösterilmez */ }
  cache = { at: Date.now(), value };
  console.log(`[güncelleme] kurulu ${current}, depodaki ${value.latest || 'okunamadı'}`);
  return { ...base, ...value };
}
