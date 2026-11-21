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
function fakeSpawner({ failWith = null } = {}) {
  const calls = [];
  const children = [];
  L.setSpawner((exe, cwd) => {
    calls.push([exe, cwd]);
    const child = Object.assign(new EventEmitter(), { pid: 4242, unref() {} });
    children.push(child);
    setImmediate(() => (failWith ? child.emit('error', Object.assign(new Error('x'), { code: failWith })) : child.emit('spawn')));
    return child;
  });
  return { calls, children };
}

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
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(process.env.ATOLYE_LAUNCHER_FILE, 'utf8'))).sort(), ['definition', 'exe']);
});

test('kaydet: yalnızca başlangıç adresi değişir; diğer satırlar, yorumlar, satır sonları, tırnak ve kodlama korunur; başlatmaz', WIN, () => {
  const { calls } = fakeSpawner();
  L.resetProcess();
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
  L.resetProcess();
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
  L.resetProcess();
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
  children[0].emit('exit', 0);
  st = L.status();
  assert.equal(st.process, 'unknown');
  st = L.save({ url: 'https://uygulama.example.com/sonra', rev: st.target.rev });
  assert.equal(st.target.value, 'https://uygulama.example.com/sonra');
});

test('başlatılmaz: diskteki adres izinli değilse, EXE yerinde değilse; adres okunamıyorsa yalnızca açık onayla', WIN, async () => {
  L.resetProcess();
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
  L.resetProcess();

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
  L.resetProcess();
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
  L.resetProcess();
});

test('tanım değişince başka uygulamaya ait seçim düşer; uygulama hiçbir sohbet aracında yer almaz', WIN, async () => {
  L.setDefinition(DEF);
  const p = pack('tanim', INI);
  L.selectExe(p.exe);
  assert.equal(L.setDefinition({ ...DEF, title: 'Yeni Ad' }).exe, p.exe, 'aynı uygulama: seçim kalır');
  assert.equal(L.setDefinition({ ...DEF, exeName: 'Baska.exe' }).exe, '', 'başka uygulama: seçim düşer');
  assert.equal(L.clearDefinition().definition, null);
  const { TOOLS } = await import('../src/mcp-server.js');
  const { SERVICES } = await import('../src/atlassian.js');
  assert.deepEqual(SERVICES.filter((s) => /launcher|uygulama/.test(s)), [], 'bağlantı listesinde (sohbette seçilebilir) yer almaz');
  assert.deepEqual(Object.entries(TOOLS).filter(([n, t]) => /launcher|uygulama/.test(`${n} ${t.service} ${t.fn}`)), [], 'yapay zekâ aracı yoktur');
});

test.after(() => { L.setSpawner(null); L.resetProcess(); fs.rmSync(tmp, { recursive: true, force: true }); });
