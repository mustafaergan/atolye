// Klasör seçicideki kısayollar: ev klasörü, Masaüstü, Belgeler, İndirilenler.
// Windows'ta bu klasörler taşınmış olabilir (OneDrive, başka sürücü): önce kayıt defterindeki gerçek yerleri okunur,
// okunamazsa bilinen adlar denenir. Yalnızca gerçekten var olan klasörler döner.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SHELL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
// Kayıt defterindeki ad → kısayol kimliği (İndirilenler'in adı bir GUID'dir)
const REG_NAMES = { Desktop: 'desktop', Personal: 'documents', '{374DE290-123F-4565-9164-39C4925E467B}': 'downloads' };
// Kayıt defteri okunamadığında denenecek klasör adları (OneDrive bazen yerelleştirilmiş adla oluşturur)
const NAMES = {
  desktop: ['Desktop', 'Masaüstü'],
  documents: ['Documents', 'Belgeler'],
  downloads: ['Downloads', 'İndirilenler'],
};

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const expand = (value, env) => String(value).replace(/%([^%]+)%/g, (all, name) => env[name] ?? env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())] ?? all);

/** "reg query" çıktısından { desktop, documents, downloads } yollarını çıkarır (ortam değişkenleri açılmış) */
export function parseShellFolders(text, env = process.env) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s+(\S.*?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}(.+?)\s*$/.exec(line);
    if (!m || !REG_NAMES[m[1]]) continue;
    out[REG_NAMES[m[1]]] = expand(m[2], env);
  }
  return out;
}

let regReader = () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve('');
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  execFile(exe, ['query', SHELL_KEY], { windowsHide: true, timeout: 4000, encoding: 'latin1' }, (err, stdout) => resolve(err ? '' : stdout));
});
/** Testler için: kayıt defteri okuyucusunu değiştirir */
export function setRegReader(fn) { regReader = fn; cache = null; }

let cache = null;
/** [{ id: 'home' | 'desktop' | 'documents' | 'downloads', path }] — yalnızca var olan klasörler, her yol bir kez */
export async function userPlaces({ home = os.homedir(), env = process.env, fresh = false } = {}) {
  if (cache && !fresh) return cache;
  let fromReg = {};
  try { fromReg = parseShellFolders(await regReader(), env); } catch { /* kayıt defteri okunamadı: bilinen adlar denenir */ }
  // OneDrive kökleri: kişisel ve kurumsal hesap ayrı ortam değişkenlerinde durur
  const roots = [home, env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean);
  const out = [{ id: 'home', path: home }];
  for (const id of ['desktop', 'documents', 'downloads']) {
    const candidates = [fromReg[id], ...roots.flatMap((r) => NAMES[id].map((n) => path.join(r, n)))].filter(Boolean);
    const found = candidates.find(isDir);
    if (found && !out.some((p) => path.resolve(p.path).toLowerCase() === path.resolve(found).toLowerCase())) out.push({ id, path: path.resolve(found) });
  }
  cache = out.filter((p) => isDir(p.path));
  return cache;
}
