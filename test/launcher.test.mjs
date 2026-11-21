// Masaüstü uygulaması bağlantısı: yalnızca üretilmiş (sentetik) dosyalar ve sahte başlatıcı kullanılır.
// Gerçek bir uygulama başlatılmaz, gerçek bir ayar dosyası okunmaz ya da değiştirilmez.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-uygulama-'));
process.env.ATOLYE_LAUNCHER_FILE = path.join(tmp, 'kayit', 'uygulama.json');
const L = await import('../src/launcher.js');
// Sahte süreç araçları: gerçek süreç listesi okunmaz, hiçbir süreç sonlandırılmaz, beklenmez
const live = new Set();
const killed = [];
L.setProcessTools({ alive: (pid) => live.has(pid), list: async () => [...live], kill: async (pid, force) => { killed.push([pid, force]); live.delete(pid); }, wait: async () => {} });
const reset = () => { live.clear(); killed.length = 0; L.resetProcess(); };
const WIN = { skip: process.platform !== 'win32' && 'yalnızca Windows' };

const DEF = { title: 'Deneme Uygulaması', exeName: 'Ornek.exe', allowedHosts: ['uygulama.example.com', 'test.example.com:8443'], allowLoopbackHttp: true, note: 'Çağrı tarafı canlı olabilir.' };
const INI = ['; örnek ayar dosyası', '[GENEL]', 'Ad=Örnek', '', '[POPUP]', 'InitialPage="http://localhost:1453/eski"', 'Field=PopUpField', ';InitialPage="https://yorum.example.com"', 'PopUpType=X', ''].join('\r\n');
const code = (fn) => { try { fn(); return null; } catch (err) { return err.code; } };
const rejects = async (p) => { try { await p; return null; } catch (err) { return err.code; } };

/** Sentetik paket klasörü: Ornek.exe (boş dosya) ve istenirse Ornek.ini */
function pack(name, ini, { enc = 'utf8', exe = 'Ornek.exe' } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exe), '');
  if (ini !== null) fs.writeFileSync(path.join(dir, 'Ornek.ini'), Buffer.isBuffer(ini) ? ini : Buffer.from(ini, enc));
  return { dir, exe: path.join(dir, exe), ini: path.join(dir, 'Ornek.ini') };
}
/** Sahte başlatıcı: çağrıları kaydeder; "spawn" ya da "error" olayı yayar */
let nextPid = 4242;
function fakeSpawner({ failWith = null, exitsAtOnce = false } = {}) {
  const calls = [];
  const children = [];
  const args = [];
  L.setSpawner((exe, cwd, extra = []) => {
    calls.push([exe, cwd]);
    args.push(extra);
    const child = Object.assign(new EventEmitter(), { pid: (nextPid += 1), unref() {} });
    children.push(child);
    setImmediate(() => {
      if (failWith) return child.emit('error', Object.assign(new Error('x'), { code: failWith }));
      if (!exitsAtOnce) live.add(child.pid);
      child.emit('spawn');
      if (exitsAtOnce) child.emit('exit', 0);
    });
    return child;
  });
  return { calls, children, args };
}
/** Uygulama kapandı: süreç listeden düşer ve çıkış olayı gelir */
const exited = (child) => { live.delete(child.pid); child.emit('exit', 0); };

test('tanım dosyası: başlık, .exe adı ve izinli adres zorunlu; yol ya da geçersiz sunucu adı kabul edilmez', () => {
  assert.deepEqual(L.parseDefinition(JSON.stringify(DEF)), DEF);
  assert.deepEqual(L.parseDefinition({ ...DEF, allowedHosts: ['A.Example.com', 'a.example.com'], note: undefined }).allowedHosts, ['a.example.com']);
  for (const bad of ['{', '[]', { ...DEF, title: '' }, { ...DEF, exeName: 'Ornek.bat' }, { ...DEF, exeName: '..\\Ornek.exe' }, { ...DEF, exeName: 'C:\\x\\Ornek.exe' },
    { ...DEF, allowedHosts: ['https://a.example.com'] }, { ...DEF, allowedHosts: ['a b'] }, { ...DEF, allowedHosts: [], allowLoopbackHttp: false }]) {
    assert.equal(code(() => L.parseDefinition(bad)), 'bad-definition', JSON.stringify(bad));
  }
});

test('adres doğrulama: yalnızca izinli sunuculara https; http yalnızca izin varsa ve yalnızca localhost', () => {
  const ok = (u, d = DEF) => L.checkUrl(u, d);
  assert.equal(ok(' https://uygulama.example.com/giris?x=1 '), 'https://uygulama.example.com/giris?x=1');
  assert.equal(ok('https://test.example.com:8443/'), 'https://test.example.com:8443/');
  assert.equal(ok('http://localhost:1453/uygulama'), 'http://localhost:1453/uygulama');
  assert.equal(ok('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  const why = (u, d = DEF) => code(() => L.checkUrl(u, d));
  assert.equal(why('https://baska.example.com/'), 'url-not-allowed');
  assert.equal(why('https://test.example.com/'), 'url-not-allowed', 'port tanımdakiyle aynı olmalı');
  assert.equal(why('https://uygulama.example.com.kotu.example.net/'), 'url-not-allowed');
  assert.equal(why('http://uygulama.example.com/'), 'http-not-allowed');
  assert.equal(why('http://localhost:1453/', { ...DEF, allowLoopbackHttp: false }), 'http-not-allowed');
  assert.equal(why('https://kullanici:parola@uygulama.example.com/'), 'url-credentials');
  for (const bad of ['', 'uygulama.example.com', 'ftp://uygulama.example.com/', 'file:///C:/x', 'https://uygulama.example.com/a b', 'https://uygulama.example.com/\r\nKomut=1', 'https://uygulama.example.com/"x', 'https://uygulama.example.com/ö', `https://uygulama.example.com/${'a'.repeat(2100)}`]) {
    assert.equal(why(bad), 'bad-url', bad.slice(0, 40));
  }
});

test('anahtar arama: yorum satırı sayılmaz; tırnaklı ve tırnaksız değer; konumlar değeri gösterir', () => {
  const hits = L.findKey(INI);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].value, hits[0].quoted], ['http://localhost:1453/eski', true]);
  assert.equal(INI.slice(hits[0].start, hits[0].end), '"http://localhost:1453/eski"');
  assert.deepEqual(L.findKey('  initialpage =  https://a.example.com/x  \nB=1').map((h) => [h.value, h.quoted]), [['https://a.example.com/x', false]]);
  assert.equal(L.findKey('InitialPage=a\r\n[B]\r\nInitialPage=b').length, 2);
  assert.equal(L.findKey('InitialPageX=a\nXInitialPage=b\n#InitialPage=c').length, 0);
});

test('desteklenmeyen işletim sisteminde ve tanım yokken hiçbir işlem yapılmaz', async () => {
  L.clearDefinition();
  assert.equal(L.status('linux').supported, false);
  assert.equal(code(() => L.selectExe('C:\\x\\Ornek.exe', 'linux')), 'unsupported');
  assert.equal(code(() => L.save({ url: 'https://uygulama.example.com/', rev: 'x' }, 'linux')), 'unsupported');
  assert.equal(await rejects(L.launch({}, 'linux')), 'unsupported');
  assert.equal(code(() => L.selectExe('C:\\x\\Ornek.exe', 'win32')), 'no-definition');
  assert.equal(await rejects(L.launch({}, 'win32')), 'no-definition');
});

test('EXE seçimi: yalnızca tanımdaki adla, bu bilgisayardaki normal bir dosya; seçmek başlatmaz ve ayarı değiştirmez', WIN, () => {
  const { calls } = fakeSpawner();
  L.setDefinition(DEF);
  const p = pack('secim', INI);
  fs.writeFileSync(path.join(p.dir, 'Ornek_original.exe'), '');
  assert.equal(code(() => L.selectExe('\\\\sunucu\\paylasim\\Ornek.exe')), 'bad-path', 'ağ yolu');
  assert.equal(code(() => L.selectExe('Ornek.exe')), 'bad-path', 'göreli yol');
  assert.equal(code(() => L.selectExe(path.join(p.dir, 'Ornek_original.exe'))), 'not-exe');
  assert.equal(code(() => L.selectExe(path.join(p.dir, 'Ornek.ini'))), 'not-exe');
  assert.equal(code(() => L.selectExe(path.join(tmp, 'yok', 'Ornek.exe'))), 'no-exe');
  fs.mkdirSync(path.join(tmp, 'klasor', 'Ornek.exe'), { recursive: true });
  assert.equal(code(() => L.selectExe(path.join(tmp, 'klasor', 'Ornek.exe'))), 'no-exe', 'klasör dosya sayılmaz');

  const before = fs.readFileSync(p.ini);
  const st = L.selectExe(p.exe);
  assert.equal(st.exe, p.exe);
  assert.deepEqual([st.target.value, st.target.allowed, st.process], ['http://localhost:1453/eski', true, 'unknown']);
  assert.match(st.target.rev, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(st).includes('PopUpField'), 'ayar dosyasının diğer satırları arayüze verilmez');
  assert.deepEqual(fs.readFileSync(p.ini), before);
  assert.deepEqual(calls, []);
  // Kayıt dosyasında yalnızca tanım ve seçilen yol durur
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(process.env.ATOLYE_LAUNCHER_FILE, 'utf8'))).sort(), ['ai', 'definition', 'exe']);
});

test('kaydet: yalnızca başlangıç adresi değişir; diğer satırlar, yorumlar, satır sonları, tırnak ve kodlama korunur; başlatmaz', WIN, () => {
  const { calls } = fakeSpawner();
  reset();
  L.setDefinition(DEF);
  const p = pack('kaydet', INI);
  let st = L.selectExe(p.exe);
  st = L.save({ url: 'https://uygulama.example.com/yeni', rev: st.target.rev });
  assert.equal(st.target.value, 'https://uygulama.example.com/yeni');
  assert.equal(fs.readFileSync(p.ini, 'utf8'), INI.replace('"http://localhost:1453/eski"', '"https://uygulama.example.com/yeni"'));
  assert.deepEqual(fs.readdirSync(p.dir).sort(), ['Ornek.exe', 'Ornek.ini'], 'geçici dosya kalmaz');
  assert.deepEqual(calls, [], 'kaydetmek uygulamayı açmaz');

  // Tırnaksız değer tırnaksız kalır; yalnızca LF satır sonu korunur
  const plain = pack('duz', 'A=1\nInitialPage=https://uygulama.example.com/a\nB=2\n');
  st = L.selectExe(plain.exe);
  L.save({ url: 'https://test.example.com:8443/b', rev: st.target.rev });
  assert.equal(fs.readFileSync(plain.ini, 'utf8'), 'A=1\nInitialPage=https://test.example.com:8443/b\nB=2\n');

  // UTF-16 (BOM'lu) ve UTF-8 BOM'lu dosya aynı kodlamayla yazılır
  const u16 = pack('utf16', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(INI, 'utf16le')]));
  st = L.selectExe(u16.exe);
  L.save({ url: 'https://uygulama.example.com/u16', rev: st.target.rev });
  const b16 = fs.readFileSync(u16.ini);
  assert.deepEqual([...b16.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(b16.subarray(2).toString('utf16le'), INI.replace('http://localhost:1453/eski', 'https://uygulama.example.com/u16'));
  const bom = pack('bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(INI, 'utf8')]));
  st = L.selectExe(bom.exe);
  L.save({ url: 'https://uygulama.example.com/bom', rev: st.target.rev });
  assert.deepEqual([...fs.readFileSync(bom.ini).subarray(0, 3)], [0xef, 0xbb, 0xbf]);

  // Windows kod sayfasıyla (UTF-8 olmayan) yazılmış satırların baytları değişmez
  const ansi = Buffer.concat([Buffer.from('Ad='), Buffer.from([0xd6, 0x72, 0x6e, 0x65, 0x6b, 0xfe]), Buffer.from('\r\nInitialPage="https://uygulama.example.com/a"\r\n')]);
  const a = pack('ansi', ansi);
  st = L.selectExe(a.exe);
  L.save({ url: 'https://uygulama.example.com/b', rev: st.target.rev });
  assert.deepEqual(fs.readFileSync(a.ini), Buffer.concat([ansi.subarray(0, 9), Buffer.from('\r\nInitialPage="https://uygulama.example.com/b"\r\n')]));
});

test('kaydet reddedilir: izin dışı adres, belirsiz ya da eksik anahtar, eksik dosya, desteklenmeyen kodlama, dışarıdan değişmiş dosya', WIN, () => {
  fakeSpawner();
  reset();
  L.setDefinition(DEF);
  const good = pack('red', INI);
  const st = L.selectExe(good.exe);
  const before = fs.readFileSync(good.ini);
  const save = (url, rev = st.target.rev) => code(() => L.save({ url, rev }));
  assert.equal(save('https://baska.example.com/'), 'url-not-allowed');
  assert.equal(save('http://uygulama.example.com/'), 'http-not-allowed');
  assert.equal(save('https://uygulama.example.com/x\r\nField=y'), 'bad-url');
  assert.equal(save('https://uygulama.example.com/', 'eski-surum'), 'stale');
  assert.equal(save('https://uygulama.example.com/', ''), 'stale', 'sürüm özeti olmadan yazılmaz');
  assert.deepEqual(fs.readFileSync(good.ini), before, 'reddedilen kayıtta dosya değişmez');
  // Dosya dışarıdan değiştiyse ekrandaki eski veriyle üzerine yazılmaz
  fs.writeFileSync(good.ini, INI.replace('PopUpType=X', 'PopUpType=Y'));
  assert.equal(save('https://uygulama.example.com/'), 'stale');
  assert.ok(fs.readFileSync(good.ini, 'utf8').includes('PopUpType=Y'));

  const cases = [
    ['iki', 'InitialPage=https://uygulama.example.com/a\r\n[B]\r\nInitialPage=https://uygulama.example.com/b\r\n', 'many-keys'],
    ['yok-anahtar', '[POPUP]\r\nField=1\r\n', 'no-key'],
    ['yok-dosya', null, 'no-ini'],
    ['utf16be', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('InitialPage=x')]), 'bad-encoding'],
    ['bomsuz16', Buffer.from('InitialPage=https://uygulama.example.com/', 'utf16le'), 'bad-encoding'],
  ];
  for (const [name, ini, expected] of cases) {
    const p = pack(name, ini);
    const s = L.selectExe(p.exe);
    assert.equal(s.target.error, expected, name);
    assert.equal(code(() => L.save({ url: 'https://uygulama.example.com/', rev: 'x' })), expected, name);
    if (ini === null) assert.ok(!fs.existsSync(p.ini), 'ayar dosyası oluşturulmaz');
    else assert.deepEqual(fs.readFileSync(p.ini), Buffer.isBuffer(ini) ? ini : Buffer.from(ini), `${name}: dosya değişmez`);
  }
});

test('başlat: doğrulanmış EXE, kendi klasöründe, bir kez; eşzamanlı istek ikinci kez başlatmaz; açıkken ayar değişmez', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('baslat', INI);
  let st = L.selectExe(p.exe);
  const { calls, children } = fakeSpawner();
  const [a, b] = await Promise.all([L.launch(), L.launch()]);
  assert.deepEqual(calls, [[p.exe, p.dir]], 'çift tıklama tek başlatma üretir');
  assert.equal(a.process, 'started');
  assert.equal(b.process, 'started');
  assert.ok(a.startedAt > 0);
  assert.equal(fs.readFileSync(p.ini, 'utf8'), INI, 'başlatmak ayarı değiştirmez');
  // Atölye'nin başlattığı örnek açıkken: yeniden başlatılmaz, ayar yazılmaz
  assert.equal(await rejects(L.launch()), 'already-running');
  assert.equal(code(() => L.save({ url: 'https://uygulama.example.com/', rev: st.target.rev })), 'running');
  assert.equal(fs.readFileSync(p.ini, 'utf8'), INI);
  assert.equal(calls.length, 1);
  // Uygulama kapanınca durum "bilinmiyor"a döner (çalışmıyor diye kesin bir şey söylenmez) ve ayar yazılabilir
  exited(children[0]);
  st = L.status();
  assert.equal(st.process, 'unknown');
  st = L.save({ url: 'https://uygulama.example.com/sonra', rev: st.target.rev });
  assert.equal(st.target.value, 'https://uygulama.example.com/sonra');
});

test('başlatılmaz: diskteki adres izinli değilse, EXE yerinde değilse; adres okunamıyorsa yalnızca açık onayla', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const { calls } = fakeSpawner();
  const bad = pack('izinsiz', INI.replace('http://localhost:1453/eski', 'https://baska.example.com/'));
  let st = L.selectExe(bad.exe);
  assert.equal(st.target.allowed, false);
  assert.equal(await rejects(L.launch()), 'url-not-allowed', 'eski/izinsiz adresle sessizce açılmaz');

  const noKey = pack('arayuzden', '[POPUP]\r\nField=1\r\n');
  L.selectExe(noKey.exe);
  assert.equal(await rejects(L.launch()), 'no-key');
  assert.equal(await rejects(L.launch({ unverified: false })), 'no-key');
  assert.deepEqual(calls, []);
  st = await L.launch({ unverified: true });
  assert.equal(st.process, 'started');
  assert.deepEqual(calls, [[noKey.exe, noKey.dir]]);
  assert.equal(fs.readFileSync(noKey.ini, 'utf8'), '[POPUP]\r\nField=1\r\n', 'anahtar eklenmez');
  reset();

  // Belirsiz anahtar onayla da açılmaz
  const two = pack('belirsiz', 'InitialPage=a\r\nInitialPage=b\r\n');
  L.selectExe(two.exe);
  assert.equal(await rejects(L.launch({ unverified: true })), 'many-keys');

  const gone = pack('silinen', INI);
  L.selectExe(gone.exe);
  fs.rmSync(gone.exe);
  assert.equal(L.status().exeError, 'no-exe');
  assert.equal(await rejects(L.launch()), 'no-exe');
  assert.equal(calls.length, 1);
});

test('ayar kaydedilir ama uygulama açılamazsa iki sonuç ayrıdır: kayıt yerinde kalır, hata ayrıca bildirilir', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('acilamaz', INI);
  let st = L.selectExe(p.exe);
  const { calls } = fakeSpawner({ failWith: 'EACCES' });
  st = L.save({ url: 'https://uygulama.example.com/kayitli', rev: st.target.rev });
  assert.equal(st.target.value, 'https://uygulama.example.com/kayitli');
  let err;
  try { await L.launch(); } catch (e) { err = e; }
  assert.deepEqual([err.code, err.detail], ['launch-failed', 'EACCES']);
  assert.equal(calls.length, 1);
  assert.equal(L.status().process, 'unknown');
  assert.ok(fs.readFileSync(p.ini, 'utf8').includes('"https://uygulama.example.com/kayitli"'), 'başlatma hatası kaydı geri almaz');
  // Hatadan sonra yeniden denenebilir
  fakeSpawner();
  assert.equal((await L.launch()).process, 'started');
  reset();
});

test('tanım değişince başka uygulamaya ait seçim düşer', WIN, async () => {
  L.setDefinition(DEF);
  const p = pack('tanim', INI);
  L.selectExe(p.exe);
  assert.equal(L.setDefinition({ ...DEF, title: 'Yeni Ad' }).exe, p.exe, 'aynı uygulama: seçim kalır');
  assert.equal(L.setDefinition({ ...DEF, exeName: 'Baska.exe' }).exe, '', 'başka uygulama: seçim düşer');
  assert.equal(L.clearDefinition().definition, null);
});

test('kapatılıp yeniden açma: arka planda kalan süreç saptanır, kapatılır ve uygulama yeniden açılır', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('yeniden', INI);
  L.selectExe(p.exe);
  const { calls, children } = fakeSpawner();
  let st = await L.launch();
  assert.deepEqual([st.process, st.pid, st.instances], ['started', children[0].pid, 1]);
  // Pencere kapandı ama süreç arka planda kaldı: ikinci kez başlatılmaz, nedeni söylenir
  assert.equal(await rejects(L.launch()), 'already-running');
  st = await L.close();
  assert.deepEqual(killed, [[children[0].pid, false]], 'önce kapanma isteği gönderilir');
  assert.deepEqual([st.process, st.instances], ['unknown', 0]);
  st = await L.launch();
  assert.equal(st.process, 'started');
  assert.equal(calls.length, 2);

  // Çıkış olayı gelmeden süreç ölmüşse (ör. Görev Yöneticisi'nden kapatıldı) durum kendiliğinden düzelir
  live.delete(children[1].pid);
  assert.equal(L.status().process, 'unknown');
  assert.equal((await L.launch()).process, 'started');
  assert.equal(calls.length, 3);

  // Elle açılmış örnekler: Atölye başlatmadıysa yalnızca "hepsi" ile kapatılır
  reset();
  live.add(111); live.add(222);
  assert.equal(await rejects(L.close()), 'not-running');
  st = await L.close({ all: true });
  assert.deepEqual(killed.map((k) => k[0]).sort(), [111, 222]);
  assert.equal(st.instances, 0);
});

test('hemen kapanan uygulama: başka örnek yoksa hata, zaten çalışan bir örnek varsa ayrıca bildirilir', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('hemen', INI);
  L.selectExe(p.exe);
  fakeSpawner({ exitsAtOnce: true });
  assert.equal(await rejects(L.launch()), 'exited-early');
  live.add(999); // uygulama zaten açıkmış: yeni süreç ona devredip kapanır
  const st = await L.launch();
  assert.deepEqual([st.early, st.process, st.instances], [true, 'unknown', 1]);
});

test('loglar: yalnızca log dosyaları listelenir ve sondan okunur; ayar dosyası ve klasör dışı okunmaz', WIN, () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('loglu', INI);
  L.selectExe(p.exe);
  fs.mkdirSync(path.join(p.dir, 'Logs', 'eski'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, 'Logs', 'uygulama.log'), Array.from({ length: 500 }, (_, i) => `2026-11-21 10:00:${String(i % 60).padStart(2, '0')} INFO satır ${i} GET https://servis.example.com/api/${i % 3 ? 'veri' : 'giris'}`).join('\r\n'));
  fs.writeFileSync(path.join(p.dir, 'Logs', 'eski', 'dun.log'), 'ERROR bağlantı koptu\n');
  fs.writeFileSync(path.join(p.dir, 'Logs', 'iz'), 'uzantısız iz dosyası\n');
  fs.writeFileSync(path.join(p.dir, 'Logs', 'ayar.config'), '<gizli/>');
  fs.writeFileSync(path.join(p.dir, 'kitaplik.dll'), 'x');
  fs.writeFileSync(path.join(p.dir, 'notlar.txt'), 'kurulum notu\n');
  const names = L.listLogs().map((l) => l.file).sort();
  assert.deepEqual(names, [path.join('Logs', 'eski', 'dun.log'), path.join('Logs', 'iz'), path.join('Logs', 'uygulama.log'), 'notlar.txt'].sort());
  const r = L.readLog({ file: path.join('Logs', 'uygulama.log'), lines: 3 });
  assert.deepEqual([r.total, r.lines.length], [500, 3]);
  assert.match(r.lines[2], /satır 499 /);
  const f = L.readLog({ file: path.join('Logs', 'uygulama.log'), search: 'API/GIRIS', lines: 1000 });
  assert.equal(f.total, 167);
  assert.ok(f.lines.every((l) => l.includes('/api/giris')));
  for (const bad of ['Ornek.ini', path.join('..', 'loglu', 'Ornek.ini'), path.join('Logs', 'ayar.config'), 'kitaplik.dll', path.join(p.dir, 'Ornek.ini'), 'yok.log']) {
    assert.equal(code(() => L.readLog({ file: bad })), 'no-log', bad);
  }
});

test('yapay zekâ: yalnızca kullanıcı izin verdiyse; iç kapı anahtarsız ya da izinsiz çalışmaz', WIN, async () => {
  reset();
  L.setDefinition(DEF);
  const p = pack('yz', INI);
  L.selectExe(p.exe);
  const { calls } = fakeSpawner();
  const ok = `Bearer ${L.gate.secret}`;
  assert.equal((await L.gateRequest('Bearer yanlis', { op: 'status' })).status, 401);
  L.setAi(false);
  assert.match((await L.gateRequest(ok, { op: 'open' })).body.error, /izin vermemiş/);
  assert.deepEqual(calls, [], 'izin yokken hiçbir şey başlatılmaz');
  assert.equal(L.setAi(true).ai, true);
  assert.equal((await L.gateRequest(ok, { op: 'selectExe', args: { path: 'C:\\x' } })).status, 400, 'araç olmayan işlem çağrılamaz');
  const text = async (op, args) => { const r = await L.gateRequest(ok, { op, args }); return r.body.text || `HATA: ${r.body.error}`; };
  assert.match(await text('status'), /Başlangıç adresi \(dosyada\): http:\/\/localhost:1453\/eski\n.*İzinli adresler: https:\/\/uygulama\.example\.com/s);
  assert.match(await text('setUrl', { url: 'https://baska.example.com/' }), /^HATA: Bu adres izinli adresler arasında değil/);
  assert.match(await text('setUrl', { url: 'https://uygulama.example.com/yz' }), /kaydedildi ve dosyadan geri okunarak doğrulandı/);
  assert.ok(fs.readFileSync(p.ini, 'utf8').includes('InitialPage="https://uygulama.example.com/yz"'));
  assert.match(await text('open'), /^Uygulama başlatıldı\./);
  assert.match(await text('setUrl', { url: 'https://uygulama.example.com/acikken' }), /^HATA: Uygulama açıkken ayar değiştirilmez/);
  assert.match(await text('close'), /^Uygulama kapatıldı\./);
  assert.match(await text('network'), /^HATA: Ağ trafiği izlenmiyor/);
  fs.mkdirSync(path.join(p.dir, 'log'));
  fs.writeFileSync(path.join(p.dir, 'log', 'a.log'), 'INFO başladı\nERROR servis cevap vermedi\n');
  assert.match(await text('logs'), /^dosya \| boyut \| son değişiklik\nlog\\a\.log \| 1 KB/);
  assert.match(await text('readLog', { search: 'error' }), /1 satırdan son 1:\nERROR servis cevap vermedi$/);
  assert.equal(calls.length, 1);

  // Araçlar yalnızca izin işareti ve Atölye'nin iç adresi varsa sunulur
  const { availableTools } = await import('../src/mcp-server.js');
  const env = { UYGULAMA_ENABLED: '1', ATOLYE_UYGULAMA_URL: 'http://127.0.0.1:1/ic/uygulama', ATOLYE_UYGULAMA_ANAHTAR: 'x' };
  const names = (e) => availableTools(e).map((t) => t.name).filter((n) => n.startsWith('desktop_app_'));
  assert.equal(names(env).length, 9);
  assert.deepEqual(names({ ...env, UYGULAMA_ENABLED: undefined }), []);
  assert.deepEqual(names({ UYGULAMA_ENABLED: '1' }), []);
  const write = availableTools(env).filter((t) => t.name.startsWith('desktop_app_') && !t.annotations.readOnlyHint).map((t) => t.name).sort();
  assert.deepEqual(write, ['desktop_app_close', 'desktop_app_open', 'desktop_app_set_start_url'], 'değişiklik yapan araçlar onay ister');
  L.setAi(false);
});

test('ağ incelemesi: tanımda açıksa uygulama hata ayıklama kapısıyla başlatılır; istekler, cevaplar ve sayfa metni okunur', WIN, async () => {
  const insp = await import('../src/inspector.js');
  assert.equal(insp.mask('{"kullanici":"ayse","password":"gizli","pin":1234,"not":"pin yok"}'), '{"kullanici":"ayse","password":"***","pin":"***","not":"pin yok"}');
  assert.equal(insp.mask('user=a&password=gizli&x=1'), 'user=a&password=***&x=1');

  // Sahte hata ayıklama kapısı (Chromium yerine): /json/list ve bir sayfa soketi
  const { WebSocketServer } = await import('ws');
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ id: 'S1', type: 'page', title: 'Deneme', url: 'http://localhost:1453/uygulama', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/S1` },
      { id: 'D1', type: 'page', title: 'Dış', url: 'x', webSocketDebuggerUrl: 'ws://kotu.example.com:9/devtools/page/D1' }]));
  });
  const wss = new WebSocketServer({ server });
  let sock;
  wss.on('connection', (ws) => {
    sock = ws;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      const result = m.method === 'Network.getResponseBody' ? { body: '{"ad":"Ayşe","token":"abc"}', base64Encoded: false }
        : m.method === 'Runtime.evaluate' ? { result: { value: 'Hoş geldiniz' } } : {};
      ws.send(JSON.stringify({ id: m.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal(code(() => insp.list()), 'not-watching');
    insp.watch(port);
    for (let i = 0; i < 100 && !sock; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.ok(sock, 'yalnızca bu bilgisayardaki sayfaya bağlanılır');
    await new Promise((r) => setTimeout(r, 50));
    const ev = (method, params) => sock.send(JSON.stringify({ method, params }));
    ev('Network.requestWillBeSent', { requestId: 'r1', timestamp: 10, type: 'Fetch', request: { method: 'POST', url: 'https://servis.example.com/api/giris', postData: '{"password":"gizli"}', headers: { Authorization: 'Bearer çok-gizli' } } });
    ev('Network.responseReceived', { requestId: 'r1', type: 'Fetch', response: { status: 200, mimeType: 'application/json' } });
    ev('Network.loadingFinished', { requestId: 'r1', timestamp: 10.25 });
    ev('Network.requestWillBeSent', { requestId: 'r2', timestamp: 11, type: 'XHR', request: { method: 'GET', url: 'https://servis.example.com/api/yok' } });
    ev('Network.responseReceived', { requestId: 'r2', type: 'XHR', response: { status: 500, mimeType: 'text/plain' } });
    ev('Network.requestWillBeSent', { requestId: 'r3', timestamp: 12, type: 'Fetch', request: { method: 'GET', url: 'https://baska.example.com/x' } });
    ev('Network.loadingFailed', { requestId: 'r3', errorText: 'net::ERR_CONNECTION_REFUSED' });
    ev('Network.requestWillBeSent', { requestId: 'r4', timestamp: 13, type: 'Image', request: { method: 'GET', url: 'data:image/png;base64,AAAA' } });
    await new Promise((r) => setTimeout(r, 150));
    const all = insp.list({});
    assert.deepEqual(all.rows.map((e) => [e.n, e.method, e.status, e.failed, e.ms]), [[1, 'POST', 200, '', 250], [2, 'GET', 500, '', null], [3, 'GET', null, 'net::ERR_CONNECTION_REFUSED', null]]);
    assert.deepEqual(insp.list({ failed: true }).rows.map((e) => e.n), [2, 3]);
    assert.deepEqual(insp.list({ search: 'GIRIS' }).rows.map((e) => e.n), [1]);
    const d = insp.detail(1);
    assert.deepEqual([d.post, d.body], ['{"password":"***"}', '{"ad":"Ayşe","token":"***"}']);
    assert.ok(!JSON.stringify(d).includes('çok-gizli'), 'başlıklar saklanmaz');
    assert.equal(code(() => insp.detail(99)), 'no-request');
    assert.deepEqual(await insp.pages(), [{ url: 'http://localhost:1453/uygulama', title: 'Deneme', text: 'Hoş geldiniz' }]);
    assert.deepEqual([insp.info().attached, insp.info().requests], [1, 3]);
  } finally { insp.stop(); wss.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  assert.equal(insp.info().watching, false);

  // Tanımda "inspect" varsa başlatma argümanı sunucuda üretilir; yoksa argüman verilmez
  reset();
  L.setDefinition({ ...DEF, inspect: true });
  const p = pack('incele', INI);
  L.selectExe(p.exe);
  const a = fakeSpawner();
  const st = await L.launch();
  assert.match(a.args[0].join(' '), /^--remote-debugging-port=\d{4,5}$/);
  assert.deepEqual([st.inspect.enabled, st.inspect.watching], [true, true]);
  await L.close();
  assert.equal(L.status().inspect.watching, false, 'uygulama kapanınca izleme durur');
  L.setDefinition(DEF);
  L.selectExe(p.exe);
  const b = fakeSpawner();
  await L.launch();
  assert.deepEqual(b.args[0], []);
  reset();
});

test.after(() => { L.setSpawner(null); L.setProcessTools(null); L.resetProcess(); fs.rmSync(tmp, { recursive: true, force: true }); });
