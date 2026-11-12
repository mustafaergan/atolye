// Kurumsal proxy ayarı: adres kurma/çözme, kalıcı yazmadan uygulama ve sahte bir proxy'ye karşı sınama.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

process.env.ATOLYE_PROXY_STORE = 'none'; // gerçek ortam değişkenlerine / .env dosyasına dokunma
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']) delete process.env[k];
const proxy = await import('../src/proxy.js');
const { mask } = await import('../src/log.js');

test('adres kurma ve çözme: kullanıcı adındaki ve paroladaki özel karakterler dönüştürülür', () => {
  const url = proxy.buildProxyUrl({ host: 'proxy.ornek.com', port: 8081, username: 'kullanici@alan.ornek.com', password: 'p@ss:w/rd' });
  assert.equal(url, 'http://kullanici%40alan.ornek.com:p%40ss%3Aw%2Frd@proxy.ornek.com:8081');
  assert.deepEqual(proxy.parseProxy(url), { protocol: 'http', host: 'proxy.ornek.com', port: 8081, username: 'kullanici@alan.ornek.com', password: 'p@ss:w/rd' });
  assert.equal(proxy.parseProxy('proxy.ornek.com:3128').port, 3128);
  assert.equal(proxy.parseProxy(''), null);
  assert.equal(proxy.normalizeNoProxy('.ornek.com; localhost  10.0.0.1'), 'localhost,127.0.0.1,.ornek.com,10.0.0.1');
});

test('kaydet: ortam değişkenleri uygulanır, parola arayüze dönmez; boş parola eskisini korur; kaldır temizler', async () => {
  const st = await proxy.save({ address: 'proxy.ornek.com:8081', username: 'biri@ornek.com', password: 'gizli', noProxy: '.ornek.com' });
  assert.deepEqual(st, { configured: true, address: 'proxy.ornek.com:8081', username: 'biri@ornek.com', hasPassword: true, noProxy: 'localhost,127.0.0.1,.ornek.com', store: st.store });
  assert.equal(JSON.stringify(st).includes('gizli'), false);
  assert.equal(process.env.HTTPS_PROXY, 'http://biri%40ornek.com:gizli@proxy.ornek.com:8081');
  assert.equal(process.env.HTTP_PROXY, process.env.HTTPS_PROXY);

  await proxy.save({ address: 'proxy.ornek.com:9000', username: 'biri@ornek.com', password: '' });
  assert.equal(process.env.HTTPS_PROXY, 'http://biri%40ornek.com:gizli@proxy.ornek.com:9000');
  // Kullanıcı değişirse eski parola taşınmaz
  await proxy.save({ address: 'proxy.ornek.com:9000', username: 'baskasi', password: '' });
  assert.equal(process.env.HTTPS_PROXY, 'http://baskasi@proxy.ornek.com:9000');

  await assert.rejects(proxy.save({ address: 'adres değil', username: '', password: '' }), { code: 'bad-address' });
  await assert.rejects(proxy.save({ address: 'proxy.ornek.com:99999' }), { code: 'bad-address' });

  assert.equal((await proxy.remove()).configured, false);
  assert.equal(process.env.HTTPS_PROXY, undefined);
  assert.deepEqual(await proxy.test(), { ok: false, code: 'not-configured' });
});

test('sınama: proxy üzerinden tünel açılır; yanlış parola ve ulaşılamayan sunucu ayırt edilir', async () => {
  const expected = `Basic ${Buffer.from('biri@ornek.com:gizli').toString('base64')}`;
  const requests = [];
  const server = net.createServer((sock) => {
    sock.on('error', () => {}); // istemci cevabı alınca bağlantıyı kapatır
    sock.once('data', (d) => {
      const text = d.toString();
      requests.push(text.split('\r\n')[0]);
      const ok = text.includes(`Proxy-Authorization: ${expected}`);
      sock.end(ok ? 'HTTP/1.1 200 Connection established\r\n\r\n' : 'HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const address = `127.0.0.1:${server.address().port}`;
  try {
    await proxy.save({ address, username: 'biri@ornek.com', password: 'gizli' });
    assert.deepEqual(await proxy.test(), { ok: true });
    assert.equal(requests[0], 'CONNECT api.github.com:443 HTTP/1.1');
    await proxy.save({ address, username: 'biri@ornek.com', password: 'yanlis' });
    assert.deepEqual(await proxy.test(), { ok: false, code: 'auth', status: 407 });
  } finally {
    server.close();
  }
  await proxy.save({ address: '127.0.0.1:9', username: '', password: '' });
  assert.equal((await proxy.test({ timeoutMs: 3000 })).ok, false);
  await proxy.remove();
});

test('kayıtlarda adres içindeki kullanıcı adı ve parola gizlenir', () => {
  assert.equal(mask('HTTPS_PROXY=http://biri%40ornek.com:gizli@proxy.ornek.com:8081 kullanılıyor'), 'HTTPS_PROXY=http://***@proxy.ornek.com:8081 kullanılıyor');
  assert.equal(mask('https://github.com/ornek/depo.git'), 'https://github.com/ornek/depo.git');
});
