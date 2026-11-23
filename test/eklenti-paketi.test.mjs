// Chrome eklentisinin mağaza paketi: zip yazıcısı ve mağazanın reddedeceği manifest hataları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { crc32, makeZip, checkManifest, listFiles } from '../scripts/eklenti-paketi.mjs';

const DIR = new URL('../chrome-eklentisi/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', DIR), 'utf8'));

test('crc32 bilinen değeri verir', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip: her dosya geri açılır ve aynı içeriği verir', () => {
  const files = [{ name: 'a.txt', data: Buffer.from('merhaba') }, { name: 'klasör/b.json', data: Buffer.from('{"x":1}') }];
  const zip = makeZip(files);
  let at = 0;
  for (const f of files) {
    assert.equal(zip.readUInt32LE(at), 0x04034b50);
    const size = zip.readUInt32LE(at + 18);
    const nameLen = zip.readUInt16LE(at + 26);
    assert.equal(zip.slice(at + 30, at + 30 + nameLen).toString('utf8'), f.name);
    const data = zlib.inflateRawSync(zip.slice(at + 30 + nameLen, at + 30 + nameLen + size));
    assert.deepEqual(data, f.data);
    assert.equal(zip.readUInt32LE(at + 14), crc32(f.data));
    at += 30 + nameLen + size;
  }
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), files.length);
});

test('eklentinin manifest\'i mağaza denetiminden geçer', () => {
  assert.deepEqual(checkManifest(manifest, listFiles(DIR.pathname.replace(/^\/(\w:)/, '$1'))), []);
});

test('eklenti bütün sitelere kurulumda erişim istemez; site izni kullanıcıdan istenir', () => {
  assert.ok(!(manifest.host_permissions || []).includes('<all_urls>'));
  assert.ok(!manifest.permissions.includes('tabs'));
  assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
  assert.deepEqual(checkManifest({ ...manifest, host_permissions: ['<all_urls>'] }, ['arka-plan.js', 'acilir.html', 'simge/16.png', 'simge/32.png', 'simge/48.png', 'simge/128.png']), ['host_permissions bütün siteleri istememeli (optional_host_permissions kullanılır)']);
  assert.match(checkManifest({ ...manifest, description: 'x'.repeat(133) }, [])[0], /132/);
});
