// Oracle istemcisi: bulma, indirme (sahte sunucu), doğrulama ve arşiv açma. Oracle'ın sitesine gidilmez.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const oc = await import('../src/oracle-client.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-oracle-'));
const LIB = process.platform === 'win32' ? 'oci.dll' : process.platform === 'darwin' ? 'libclntsh.dylib' : 'libclntsh.so';
const KEY = `${process.platform}-${process.arch}`;

/** Küçük bir zip üretir: [ad, içerik, sıkıştır] (klasör için içerik null) */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const nameBuf = Buffer.from(name);
    const raw = content === null ? Buffer.alloc(0) : Buffer.from(content);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32 ? zlib.crc32(raw) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

const big = 'Oracle istemcisi deneme verisi. '.repeat(5000);
const goodZip = makeZip([
  ['META-INF/', null, false],
  ['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\n', false],
  ['instantclient_19_33/', null, false],
  [`instantclient_19_33/${LIB}`, big, true],
  ['instantclient_19_33/bos.txt', '', false],
  ['instantclient_19_33/network/admin/README', 'ağ ayarları', true],
]);

test('arşiv açma: klasörler, sıkıştırılmış ve düz dosyalar; klasör dışına çıkan ad reddedilir', async () => {
  const file = path.join(tmp, 'iyi.zip');
  fs.writeFileSync(file, goodZip);
  const dest = path.join(tmp, 'acik');
  assert.equal(await oc.extractZip(file, dest), 4);
  assert.equal(fs.readFileSync(path.join(dest, 'instantclient_19_33', LIB), 'utf8'), big);
  assert.equal(fs.readFileSync(path.join(dest, 'instantclient_19_33', 'network', 'admin', 'README'), 'utf8'), 'ağ ayarları');
  assert.equal(fs.statSync(path.join(dest, 'instantclient_19_33', 'bos.txt')).size, 0);

  const evil = path.join(tmp, 'kotu.zip');
  fs.writeFileSync(evil, makeZip([['../disari.txt', 'x', false]]));
  await assert.rejects(oc.extractZip(evil, path.join(tmp, 'kotu')), /klasör dışına çıkan ad/);
  assert.ok(!fs.existsSync(path.join(tmp, 'disari.txt')));
  fs.writeFileSync(evil, Buffer.from('bu bir zip değil, yalnızca düz metin '.repeat(3)));
  await assert.rejects(oc.extractZip(evil, path.join(tmp, 'kotu')), /zip arşivi değil/);
});

test('istemci arama: elle gösterilen klasör, Atölye\'nin indirdiği, ORACLE_HOME ve PATH sırasıyla', () => {
  const none = { ATOLYE_ORACLE_CLIENT_DIR: path.join(tmp, 'yok') };
  const has = (...files) => (f) => files.includes(f);
  const j = path.join;
  assert.equal(oc.findOracleClient({ ...none, PATH: 'C:\\a;"C:\\ora\\ic";C:\\b' }, has(j('C:\\ora\\ic', 'oci.dll')), 'win32'), 'C:\\ora\\ic');
  assert.equal(oc.findOracleClient({ ...none, Path: 'C:\\x', ORACLE_HOME: 'C:\\oracle' }, has(j('C:\\oracle', 'bin', 'oci.dll')), 'win32'), j('C:\\oracle', 'bin'));
  assert.equal(oc.findOracleClient({ ...none, ORACLE_CLIENT_LIB_DIR: 'D:\\ic', PATH: 'C:\\ora' }, has(j('D:\\ic', 'oci.dll'), j('C:\\ora', 'oci.dll')), 'win32'), 'D:\\ic', 'elle gösterilen önce gelir');
  assert.equal(oc.findOracleClient({ ...none, PATH: 'C:\\a;C:\\b' }, has(), 'win32'), null);
  assert.equal(oc.findOracleClient({ ...none, LD_LIBRARY_PATH: '/opt/a:/opt/ic' }, has(j('/opt/ic', 'libclntsh.so')), 'linux'), '/opt/ic');

  // Atölye'nin indirdiği: en yeni sürüm klasörü, arşivin üst klasörüyle birlikte
  const root = path.join(tmp, 'kurulu');
  for (const v of ['19.9', '19.33', '19.40.tmp']) { fs.mkdirSync(path.join(root, v, 'instantclient_x'), { recursive: true }); fs.writeFileSync(path.join(root, v, 'instantclient_x', LIB), ''); }
  const env = { ATOLYE_ORACLE_CLIENT_DIR: root };
  assert.equal(oc.installedClient(env), path.join(root, '19.33', 'instantclient_x'), 'yarım kalmış (.tmp) klasör sayılmaz');
  assert.equal(oc.findOracleClient({ ...env, PATH: 'C:\\ora' }, (f) => f === j('C:\\ora', LIB) || fs.existsSync(f)), path.join(root, '19.33', 'instantclient_x'), 'PATH\'tekinden önce gelir');
});

test('indirme: ilerleme, özet doğrulama, açma; hata durumunda yarım dosya kalmaz', { skip: !oc.PACKAGES[KEY] && 'bu işletim sistemi için paket tanımlı değil' }, async () => {
  const root = path.join(tmp, 'indir');
  const sha = crypto.createHash('sha256').update(goodZip).digest('hex');
  const env = { ATOLYE_ORACLE_CLIENT_DIR: root, ORACLE_CLIENT_URL: 'https://ornek.example.com/istemci.zip', ORACLE_CLIENT_SHA256: sha };
  const reply = (statusCode, body) => Object.assign(Readable.from(body ? [body.subarray(0, 1000), body.subarray(1000)] : []), { statusCode, headers: body ? { 'content-length': String(body.length) } : {} });
  const asked = [];
  oc.setGetter(async (url) => { asked.push(url); return reply(200, goodZip); });
  oc.reset();
  assert.equal(oc.status(env).installed, null);
  const { status, done } = oc.start(env);
  assert.equal(status.phase, 'download');
  assert.equal(oc.start(env).done, done, 'sürerken ikinci indirme başlatılmaz');
  const st = await done;
  assert.deepEqual(asked, [env.ORACLE_CLIENT_URL]);
  assert.deepEqual([st.phase, st.received, st.total, st.error], ['done', goodZip.length, goodZip.length, '']);
  assert.equal(st.installed, path.join(root, oc.PACKAGES[KEY].version, 'instantclient_19_33'));
  assert.equal(st.found, st.installed);
  assert.deepEqual(fs.readdirSync(root), [oc.PACKAGES[KEY].version], 'inen arşiv ve geçici klasör silinir');

  // Özeti tutmayan dosya açılmaz
  const bad = { ...env, ATOLYE_ORACLE_CLIENT_DIR: path.join(tmp, 'bozuk'), ORACLE_CLIENT_SHA256: 'f'.repeat(64) };
  const r2 = await oc.start(bad).done;
  assert.equal(r2.phase, 'error');
  assert.match(r2.error, /doğrulanamadı/);
  assert.equal(r2.installed, null);
  assert.deepEqual(fs.readdirSync(bad.ATOLYE_ORACLE_CLIENT_DIR), []);

  // Sunucu hata verirse anlaşılır mesaj
  oc.setGetter(async () => reply(404));
  assert.match((await oc.start(bad).done).error, /HTTP 404.*adresi değişmiş olabilir/);
  oc.setGetter(async () => { throw Object.assign(new Error('getaddrinfo'), { cause: { code: 'ENOTFOUND' } }); });
  assert.equal((await oc.start(bad).done).error, 'ENOTFOUND');
  oc.setGetter(null);
  oc.reset();
});

test('paket tanımı: Oracle\'ın kendi sitesi, https ve SHA-256 özeti', () => {
  for (const p of Object.values(oc.PACKAGES)) {
    assert.match(p.url, /^https:\/\/download\.oracle\.com\//);
    assert.match(p.sha256, /^[0-9a-f]{64}$/);
    assert.ok(p.size > 1_000_000);
  }
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
