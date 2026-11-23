// Uygulama sunucusu (Tomcat) araçlarının araç sunucusu (MCP) tarafı. İşi kendisi yapmaz: isteği Atölye sunucusuna
// iletir (bkz. tomcat.js). Tomcat süreçleri Atölye sunucusunun alt süreçleridir; böylece oturum kapansa da yönetilebilir,
// Atölye kapanınca kapatılır. cfg: { url: Atölye'nin iç adresi, token: iç anahtar } (bkz. atlassian.js configFromEnv)
import http from 'node:http';

export const OPS = ['list', 'start', 'status', 'logs', 'stop'];

function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
      res.on('error', reject);
    });
    // Başlatma, derleme ve açılışı bekler (en çok ~5 dk)
    req.setTimeout(330_000, () => req.destroy(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

async function forward(cfg, op, args) {
  let res;
  try {
    res = await post(cfg.url, cfg.token, JSON.stringify({ op, args }));
  } catch (err) {
    throw new Error(`Atölye sunucusuna ulaşılamadı (${err.code || err.message}). Atölye yeniden başlatıldıysa yeni bir oturum açın.`);
  }
  let j = {};
  try { j = JSON.parse(res.raw || '{}'); } catch { /* aşağıda durum koduna bakılır */ }
  if (res.status === 401) throw new Error('Atölye bu oturumu tanımadı (Atölye yeniden başlatılmış olabilir). Yeni bir oturum açın.');
  if (res.status !== 200 || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j.text;
}

export const tomcatClient = Object.fromEntries(OPS.map((op) => [op, (cfg, args) => forward(cfg, op, args)]));
