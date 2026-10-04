#!/usr/bin/env node
// Dağıtım paketi (zip) hazırlar: Confluence, paylaşılan klasör vb. üzerinden
// dağıtıp Kur.bat ile kurmak için. Git gerekmez.
//
//   npm run paket            → hafif paket (kurulumda paketler npm'den indirilir)
//   npm run paket:tam        → tam paket (node_modules dahil, npm erişimi gerekmez;
//                              Windows'ta hazırlanmalıdır, içindeki Claude Code dosyası Windows içindir)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--tam');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* git yoksa sürüm bilgisi commit'siz olur */
}

const name = `Atolye-${pkg.version}${full ? '-tam' : ''}`;
const dist = path.join(ROOT, 'dist');
const stage = path.join(dist, 'stage', 'Atolye');
const zip = path.join(dist, `${name}.zip`);

fs.rmSync(path.join(dist, 'stage'), { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(stage, { recursive: true });

const FILES = ['src', 'public', 'atolye.ps1', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.env.example'];
for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(stage, f), { recursive: true });

if (full) {
  if (process.platform !== 'win32') console.warn('Uyarı: tam paket Windows dışında hazırlanıyor; içindeki Claude Code dosyası Windows için olmayabilir.');
  console.log('node_modules kopyalanıyor…');
  fs.cpSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true });
}

// Kurulum script'i bu dosyadan paketten kurulduğunu anlar
fs.writeFileSync(path.join(stage, '.paket'), JSON.stringify({
  version: pkg.version, commit, tam: full, tarih: new Date().toISOString(),
}, null, 2));

// Çift tıklanarak çalıştırılan kurulum dosyası (Windows satır sonları, sadece ASCII)
fs.writeFileSync(path.join(stage, 'Kur.bat'), [
  '@echo off',
  'chcp 65001 >nul',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atolye.ps1" kur',
  'echo.',
  'pause',
  '',
].join('\r\n'));

// Kald\u0131rma: kurulum klas\u00F6r\u00FCnden de \u00E7al\u0131\u015Ft\u0131r\u0131labilir, yani .bat kendi klas\u00F6r\u00FCn\u00FC siler.
// \u00D6nce ge\u00E7ici klas\u00F6re ge\u00E7ilir (silinecek klas\u00F6r kilitlenmesin); komut ve "exit" ayn\u0131 sat\u0131rdad\u0131r,
// \u00E7\u00FCnk\u00FC cmd .bat dosyas\u0131n\u0131 sat\u0131r sat\u0131r okur ve dosya silindikten sonra sonraki sat\u0131r\u0131 bulamaz.
// "Kapatmak i\u00E7in Enter" beklemesi PowerShell i\u00E7inde yap\u0131l\u0131r (-Bekle).
fs.writeFileSync(path.join(stage, 'Kaldir.bat'), [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%TEMP%" & powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atolye.ps1" kaldir -Bekle & exit /b',
  '',
].join('\r\n'));

const BOM = '\uFEFF';
fs.writeFileSync(path.join(stage, 'KURULUM.txt'), BOM + [
  `Atölye ${pkg.version}${commit ? ` (${commit})` : ''}${full ? ' — tam paket' : ''}`,
  '',
  'Kurulum',
  '  1. Node.js kurulu değilse https://nodejs.org adresinden LTS sürümünü kurun.',
  '  2. Bu zip dosyasını herhangi bir klasöre çıkarın.',
  '  3. Kur.bat dosyasına çift tıklayın.',
  '     (Windows "bilinmeyen yayımcı" uyarısı verirse "Ek bilgi" > "Yine de çalıştır".)',
  '',
  'Atölye %LOCALAPPDATA%\\Atolye klasörüne kurulur, masaüstüne "Atölye" kısayolu eklenir',
  've Windows açılışında arka planda başlar. Kurulumdan sonra çıkardığınız klasörü silebilirsiniz.',
  '',
  'Güncelleme',
  '  Yeni paketi indirip aynı şekilde Kur.bat ile kurun. Ayarlarınız (.env) korunur.',
  '',
  'Kaldırma',
  '  Kaldir.bat dosyasına çift tıklayın (bu klasördeki ya da %LOCALAPPDATA%\\Atolye içindeki).',
  '  Atölye durdurulur, kısayollar ve kurulum klasörü silinir. Sohbet geçmişi (~/.claude)',
  '  Claude Code ile ortak olduğu için silinmez.',
  '',
  'Ayarlar',
  '  Claude Code (claude) bu bilgisayarda çalışıyorsa ek ayar gerekmez; gateway adresi ve',
  '  token ~/.claude/settings.json dosyasından okunur. Gerekirse kurulum klasöründeki .env',
  '  dosyasını düzenleyin.',
  '',
  'Komutlar (kurulum klasöründe)',
  '  atolye.ps1 baslat | durdur | durum | otomatik-ac | otomatik-kapat | kaldir',
  '',
].join('\r\n'));

// Zip: Windows'ta yerleşik bsdtar, diğerlerinde zip
console.log('Sıkıştırılıyor…');
const cwd = path.join(dist, 'stage');
if (process.platform === 'win32') {
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, 'Atolye'], { cwd, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, 'Atolye'], { cwd, stdio: 'inherit' });
}
fs.rmSync(path.join(dist, 'stage'), { recursive: true, force: true });

const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`\nHazır: ${path.relative(ROOT, zip)} (${mb} MB)`);
