#!/usr/bin/env node
// Chrome Web Store / Edge Add-ons için eklenti paketi: chrome-eklentisi/ klasörünü dist/atolye-chrome-<sürüm>.zip olarak
// paketler. Ek bağımlılık gerektirmez (zip burada yazılır). Kullanım: npm run eklenti
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'chrome-eklentisi');
// Mağaza paketine yalnızca eklentinin çalışması için gereken dosyalar girer
const ALLOWED = /\.(json|js|html|css|png)$/i;

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Klasördeki dosyalar (göreli yol, '/' ayraçlı, sıralı) */
export function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]))
    .filter((f) => ALLOWED.test(f))
    .sort();
}

/** files: [{ name, data }] -> zip Buffer (deflate; sabit tarih, böylece aynı içerik aynı paketi verir) */
export function makeZip(files) {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 adlar
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Paketlemeden önce mağazanın reddedeceği hataları yakalar */
export function checkManifest(m, files) {
  const problems = [];
  if (m.manifest_version !== 3) problems.push('manifest_version 3 olmalı');
  if (!/^\d+(\.\d+){0,3}$/.test(String(m.version || ''))) problems.push('version geçersiz');
  if (String(m.description || '').length > 132) problems.push(`description en çok 132 karakter olmalı (${m.description.length})`);
  if (String(m.name || '').length > 75) problems.push('name en çok 75 karakter olmalı');
  if ((m.host_permissions || []).some((p) => p === '<all_urls>' || /^\*:\/\/\*\//.test(p))) problems.push('host_permissions bütün siteleri istememeli (optional_host_permissions kullanılır)');
  const needed = [m.background?.service_worker, m.action?.default_popup, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})].filter(Boolean);
  for (const f of needed) if (!files.includes(f)) problems.push(`eksik dosya: ${f}`);
  if (!m.icons?.['128']) problems.push('128 px simge gerekli');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = listFiles(SRC);
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const problems = checkManifest(manifest, files);
  if (problems.length) {
    console.error(`Paket üretilmedi:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const zip = makeZip(files.map((name) => ({ name, data: fs.readFileSync(path.join(SRC, name)) })));
  const out = path.join(ROOT, 'dist', `atolye-chrome-${manifest.version}.zip`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip);
  console.log(`${out} (${files.length} dosya, ${(zip.length / 1024).toFixed(1)} KB)`);
  for (const f of files) console.log(`  ${f}`);
}
