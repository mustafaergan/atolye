// GitHub Copilot kalan kotası. Copilot CLI, hesabın plan ve kota bilgisini kendi yerel önbelleğinde tutar
// (copilot-user-cache.json; "safe to delete, managed automatically"). Atölye yalnızca bu dosyayı okur:
// GitHub'a istek atmaz, token'a dokunmaz. Bilgi, Copilot önbelleği yeniledikçe güncellenir.
//   COPILOT_USER_CACHE: dosyanın yeri (testler ve alışılmadık kurulumlar için)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function cacheFiles(env = process.env) {
  if (env.COPILOT_USER_CACHE) return [env.COPILOT_USER_CACHE];
  const name = 'copilot-user-cache.json';
  const home = os.homedir();
  return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'copilot', name),
    env.XDG_CACHE_HOME && path.join(env.XDG_CACHE_HOME, 'copilot', name),
    path.join(home, 'Library', 'Caches', 'copilot', name),
    path.join(home, '.cache', 'copilot', name),
  ].filter(Boolean);
}

/** Dosya başındaki // açıklama satırları atılarak okunur */
function readJsonc(file) {
  const raw = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return JSON.parse(raw);
}

/** Copilot'a en son giriş yapan kullanıcı (birden fazla hesabın önbelleği varsa doğru olanı seçmek için) */
function lastLogin(env = process.env) {
  try {
    const dir = env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
    return readJsonc(path.join(dir, 'config.json')).lastLoggedInUser?.login || null;
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Önbellekteki kayıtlardan kota özeti: { available: false } ya da plan, kalan, toplam, yüzde, sıfırlanma tarihi */
export function summarize(cache, login = null) {
  const entries = Object.values(cache?.copilotUserCache || {}).filter((e) => e?.response);
  const mine = login ? entries.filter((e) => e.response.login === login) : [];
  // Hesabın EN YENİ kaydı esas alınır: o kayıtta kota yoksa (ör. lisans kaldırılmış) eski bir kaydın kotası gösterilmez
  const pool = (mine.length ? mine : entries).slice().sort((a, b) => String(b.retrievedAt || '').localeCompare(String(a.retrievedAt || '')));
  const q = pool[0]?.response.quota_snapshots?.premium_interactions;
  if (!q) return { available: false };
  const { response, retrievedAt } = pool[0];
  return {
    available: true,
    plan: response.copilot_plan || null,
    unlimited: q.unlimited === true,
    total: num(q.entitlement),
    remaining: num(q.remaining ?? q.quota_remaining),
    percentRemaining: num(q.percent_remaining),
    overage: num(q.overage_count) || 0,
    resetDate: response.quota_reset_date_utc || response.quota_reset_date || null,
    retrievedAt: retrievedAt || null,
  };
}

export function copilotQuota(env = process.env) {
  for (const file of cacheFiles(env)) {
    try {
      return summarize(readJsonc(file), lastLogin(env));
    } catch { /* dosya yok ya da okunamadı: sıradakine bak */ }
  }
  return { available: false };
}
