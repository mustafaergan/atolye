// Teams araçlarının araç sunucusu (MCP) tarafı. İşi kendisi yapmaz: isteği Atölye sunucusuna iletir (bkz. teams.js).
// Erişim anahtarı yalnızca Atölye sunucusunun belleğindedir; bu sürece, ayar dosyalarına ya da yapay zekâya verilmez.
// cfg: { url: Atölye'nin iç adresi, token: yalnızca yerel LLM oturumlarına verilen iç anahtar } (bkz. atlassian.js configFromEnv)
import http from 'node:http';

const OPS = ['listChats', 'getMessages', 'listChannels', 'getChannelMessages'];
// Masaüstü uygulaması araçları da aynı yolla Atölye sunucusuna iletilir (bkz. launcher.js)
const APP_OPS = ['status', 'setUrl', 'open', 'close', 'logs', 'readLog', 'network', 'networkDetail', 'page'];

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

const client = (ops) => Object.fromEntries(ops.map((op) => [op, (cfg, args) => forward(cfg, op, args)]));
export const teamsClient = client(OPS);
export const appClient = client(APP_OPS);
