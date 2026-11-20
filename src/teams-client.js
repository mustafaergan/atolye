// Teams araçlarının araç sunucusu (MCP) tarafı. İşi kendisi yapmaz: isteği Atölye sunucusuna iletir (bkz. teams.js).
// Erişim anahtarı yalnızca Atölye sunucusunun belleğindedir; bu sürece, ayar dosyalarına ya da yapay zekâya verilmez.
// cfg: { url: Atölye'nin iç adresi, token: yalnızca yerel LLM oturumlarına verilen iç anahtar } (bkz. atlassian.js configFromEnv)
import http from 'node:http';

const OPS = ['listChats', 'getMessages', 'listChannels', 'getChannelMessages'];

/** Atölye bu bilgisayardadır: istek doğrudan (proxy'siz) node:http ile yapılır */
function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', agent: false, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
      res.on('error', reject);
    });
    req.setTimeout(90_000, () => req.destroy(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })));
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

export const teamsClient = Object.fromEntries(OPS.map((op) => [op, (cfg, args) => forward(cfg, op, args)]));
