// Klasör seçicideki kısayollar: Masaüstü, Belgeler, İndirilenler
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseShellFolders, setRegReader, userPlaces } from '../src/places.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-yerler-'));
const mk = (...parts) => { const p = path.join(tmp, ...parts); fs.mkdirSync(p, { recursive: true }); return p; };

test('kayıt defteri çıktısı: Masaüstü, Belgeler ve İndirilenler okunur, ortam değişkenleri açılır', () => {
  const text = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    '    AppData    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Roaming',
    '    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Desktop',
    '    Personal    REG_EXPAND_SZ    D:\\Belgelerim',
    '    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    %userprofile%\\Downloads',
    '',
  ].join('\r\n');
  assert.deepEqual(parseShellFolders(text, { USERPROFILE: 'C:\\Users\\ali' }), {
    desktop: 'C:\\Users\\ali\\OneDrive\\Desktop',
    documents: 'D:\\Belgelerim',
    downloads: 'C:\\Users\\ali\\Downloads',
  });
  assert.deepEqual(parseShellFolders('', {}), {});
});

test('kısayollar: kayıt defterindeki yer önceliklidir; yoksa bilinen adlar denenir; olmayan klasör listelenmez', async () => {
  const home = mk('ev');
  const tasinmis = mk('bulut', 'Desktop');
  mk('ev', 'Desktop');
  mk('ev', 'Documents');
  // İndirilenler hiç yok
  setRegReader(async () => `    Desktop    REG_EXPAND_SZ    ${tasinmis}\r\n    Personal    REG_EXPAND_SZ    ${path.join(tmp, 'yok')}\r\n`);
  const a = await userPlaces({ home, env: {}, fresh: true });
  assert.deepEqual(a, [{ id: 'home', path: home }, { id: 'desktop', path: tasinmis }, { id: 'documents', path: path.join(home, 'Documents') }]);

  // Kayıt defteri okunamazsa: OneDrive kökündeki yerelleştirilmiş ad da bulunur
  const bulut = mk('onedrive');
  mk('onedrive', 'Belgeler');
  fs.rmSync(path.join(home, 'Documents'), { recursive: true });
  setRegReader(async () => { throw new Error('reg yok'); });
  const b = await userPlaces({ home, env: { OneDrive: bulut }, fresh: true });
  assert.deepEqual(b.map((p) => [p.id, p.path]), [['home', home], ['desktop', path.join(home, 'Desktop')], ['documents', path.join(bulut, 'Belgeler')]]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
