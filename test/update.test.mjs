// Güncelleme bildirimi: depodaki sürüm kurulu olandan yeniyse haber verilir; ağ yoksa sessiz kalınır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdate, compareVersions } from '../src/update.js';

test('sürüm karşılaştırma sayısaldır', () => {
  assert.ok(compareVersions('0.10.0', '0.9.2') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.6.1', '0.6.1'), 0);
  assert.ok(compareVersions('0.6.0', '0.6.1') < 0);
});

test('yeni sürüm varsa bildirilir; eski/aynı sürümde ya da ağ hatasında bildirilmez', async () => {
  process.env.ATOLYE_UPDATE_URL = 'data:application/json,{"version":"99.0.0"}';
  const u = await checkUpdate({ force: true });
  assert.equal(u.available, true);
  assert.equal(u.latest, '99.0.0');
  process.env.ATOLYE_UPDATE_URL = 'data:application/json,{"version":"0.0.1"}';
  assert.equal((await checkUpdate({ force: true })).available, false);
  process.env.ATOLYE_UPDATE_URL = 'http://127.0.0.1:9/yok';
  assert.deepEqual({ ...(await checkUpdate({ force: true })), current: 'x', how: 'x', canApply: 'x' }, { current: 'x', latest: null, available: false, how: 'x', canApply: 'x' });
  process.env.ATOLYE_UPDATE_CHECK = '0';
  process.env.ATOLYE_UPDATE_URL = 'data:application/json,{"version":"99.0.0"}';
  assert.equal((await checkUpdate({ force: true })).available, false);
});

test('kayıtlar: son satırlar tutulur, anahtarlar gizlenir', async () => {
  const { mask, record, recentLog } = await import('../src/log.js');
  assert.equal(mask('Authorization: Bearer abcdef1234567890'), 'Authorization: Bearer ***');
  assert.equal(mask('token=supersecretvalue123 kaldı'), 'token=*** kaldı');
  record('error', ['bağlanamadı %s', 'Basic QWxhZGRpbjpvcGVu']);
  const last = recentLog(1)[0];
  assert.match(last, /HATA bağlanamadı Basic \*\*\*$/);
  for (let i = 0; i < 600; i++) record('log', [`satır ${i}`]);
  assert.equal(recentLog().length, 500);
  assert.match(recentLog().at(-1), /satır 599$/);
});

test('Teams için kopyalama: sondan, mesaja sığacak kadar satır alınır', async () => {
  const { tailForChat, TEAMS_MAX_CHARS } = await import('../public/log.js');
  const all = Array.from({ length: 500 }, (_, i) => `12:00:00 [oturum] satır ${i} ${'x'.repeat(60)}`);
  const tail = tailForChat(all);
  assert.ok(tail.join('\n').length <= TEAMS_MAX_CHARS);
  assert.ok(tail.length > 50 && tail.length < 500);
  assert.equal(tail.at(-1), all.at(-1)); // en yeni satır her zaman dahil
  assert.equal(tail[0], all[all.length - tail.length]); // aradan satır atlanmaz
  assert.deepEqual(tailForChat(['a', 'b']), ['a', 'b']);
  assert.equal(tailForChat(['y'.repeat(20000)])[0].length, 601); // tek dev satır kısaltılır
});

test('güncelleme denemesinin çıktısı kayıtlara eklenir (başlık satırları atılır)', async () => {
  const { recordUpdateLog, recentLog } = await import('../src/log.js');
  const text = ['**********************', 'Windows PowerShell transcript start', 'Start time: 20261113', 'Username: x', '**********************',
    '  > Son sürüm indiriliyor…', '  ! Güncelleme sırasında hata oluştu: Dosyalar kopyalanamadı', '  ✓ Eski sürüm geri yüklendi', '**********************', 'End time: 20261113'].join('\r\n');
  assert.equal(recordUpdateLog('x', () => Buffer.from(text, 'utf8')), 3);
  const last = recentLog(3);
  assert.match(last[0], /\[güncelleme kaydı\] > Son sürüm indiriliyor/);
  assert.match(last[2], /Eski sürüm geri yüklendi/);
  // UTF-16 kayıt da okunur; dosya yoksa sessizce geçilir
  assert.equal(recordUpdateLog('x', () => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('  > deneme satırı', 'utf16le')])), 1);
  assert.equal(recordUpdateLog('x', () => { throw new Error('yok'); }), 0);
});

test('oturum başlığı: yalnızca kullanıcının yazdığı ilk paragraf, kısa; yapay zekâ başlığı temizlenir', async () => {
  const { shortTitle, cleanAiTitle } = await import('../src/title.js');
  // Atölye'nin eklediği bağlantı notu başlığa karışmaz
  assert.equal(shortTitle('test sayfasını aç ve kontrol et\n\n(Tarayıcı bağlantısını kullan; araçlar: browser_navigate, browser_snapshot)'), 'test sayfasını aç ve kontrol et');
  const long = shortTitle('bu çok uzun bir soru cümlesi ve içinde pek çok kelime var ki başlık olarak hiç uygun değil gerçekten');
  assert.ok(long.length <= 61 && long.endsWith('…'), long);
  assert.ok(!long.includes('  '));
  assert.equal(shortTitle(''), '');
  assert.equal(cleanAiTitle('"Graylog Hata Kayıtları İncelemesi."'), 'Graylog Hata Kayıtları İncelemesi');
  assert.equal(cleanAiTitle('Başlık: Test Ortamı Erişim Sorunu\nAçıklama: ...'), 'Test Ortamı Erişim Sorunu');
  assert.equal(cleanAiTitle('**Port Düzeltmesi**'), 'Port Düzeltmesi');
  assert.equal(cleanAiTitle(''), '');
  assert.ok(cleanAiTitle('a'.repeat(200)).length <= 61);
});
