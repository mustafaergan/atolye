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
