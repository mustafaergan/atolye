// Kurulum betikleri (atolye.ps1 ve kurulum sihirbazı) sözdizimi hatası içermemeli: tek bir hata kurulumu,
// güncellemeyi ve kaldırmayı tümüyle durdurur. Betikler çalıştırılmaz, yalnızca PowerShell'in ayrıştırıcısından geçirilir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['atolye.ps1', 'src/masaustu/sihirbaz.ps1'];

test('PowerShell betikleri ayrıştırılabilir (sözdizimi hatası yok)', { skip: process.platform !== 'win32' }, () => {
  for (const f of FILES) {
    const file = path.join(ROOT, f);
    const script = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); $e | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }`;
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
    assert.equal(out, '', `${f} içinde sözdizimi hatası:\n${out}`);
  }
});

test('PowerShell betikleri UTF-8 imzasıyla (BOM) başlar: Windows PowerShell 5.1 Türkçe harfleri ancak böyle doğru okur', () => {
  for (const f of FILES) {
    const head = fs.readFileSync(path.join(ROOT, f)).subarray(0, 3);
    assert.deepEqual([...head], [0xef, 0xbb, 0xbf], f);
  }
});

test('masaüstü uygulamasının dosyaları pakete girecek yerde (src altında) durur', () => {
  for (const f of ['Atolye.cs', 'Atolye.manifest', 'webview2/Microsoft.Web.WebView2.Core.dll', 'webview2/Microsoft.Web.WebView2.WinForms.dll', 'webview2/WebView2Loader.dll', 'webview2/LICENSE.txt'])
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'masaustu', f)), f);
});
