// Tempo Timesheets (Jira Server / Data Center eklentisi): iş kaydı (timesheet) okuma ve girme.
// Ayrı bir hesap yoktur: Jira bağlantısının adresi ve kişisel erişim anahtarı kullanılır (bkz. atlassian.js
// configFromEnv 'tempo'). Kuruma özel hiçbir şey kodda durmaz: zorunlu alanlar (ör. "hizmet", "hesap"), bunların
// değerleri ve açıklama kalıbı kullanıcının geçmiş kayıtlarından çalışma anında öğrenilir.
//   Okuma : POST /rest/tempo-timesheets/4/worklogs/search, GET /rest/tempo-core/1/work-attribute,
//           POST /rest/tempo-core/2/user/schedule/search (çalışma takvimi; yoksa hafta içi 8 saat varsayılır)
//   Yazma : POST /rest/tempo-timesheets/4/worklogs/, DELETE /rest/tempo-timesheets/4/worklogs/{id}

// İstekler Jira bağlantısının istemcisiyle (kimlik doğrulama, sertifikalar, hata metinleri) yapılır; atlassian.js
// tempoClient(call) ile verir. Doğrudan içe aktarılmaz: atlassian.js bu dosyayı içe aktardığı için döngü oluşurdu.
let call = () => { throw new Error('Tempo istemcisi hazır değil'); };

const LEARN_DAYS = 90;
const DAY = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setTime(d.getTime() + n * DAY); return isoDate(d); };
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T12:00:00`).getTime());
const hours = (secs) => Math.round((secs / 3600) * 100) / 100;
const fmtH = (secs) => `${hours(secs)} sa`;
const dayOf = (started) => String(started || '').slice(0, 10);
const weekday = (iso) => ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'][new Date(`${iso}T12:00:00`).getDay()];

/** Bu ayın başı ve sonu (yerel saat) */
export function monthRange(today = new Date()) {
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

// ---------- Sunucu çağrıları ----------
const meCache = new Map(); // adres → { key, name, displayName }
async function me(cfg) {
  if (!meCache.has(cfg.url)) {
    const u = await call(cfg, `${cfg.url}/rest/api/2/myself`);
    meCache.set(cfg.url, { key: u.key || u.name, name: u.name, displayName: u.displayName || u.name });
  }
  return meCache.get(cfg.url);
}

async function search(cfg, from, to) {
  const user = await me(cfg);
  const list = await call(cfg, `${cfg.url}/rest/tempo-timesheets/4/worklogs/search`, { method: 'POST', body: { from, to, worker: [user.key] } });
  return Array.isArray(list) ? list : [];
}

const attributes = (cfg) => call(cfg, `${cfg.url}/rest/tempo-core/1/work-attribute`).then((a) => (Array.isArray(a) ? a : []));

/** Gün gün zorunlu süre: { 'yyyy-aa-gg': saniye }. Takvim okunamazsa hafta içi 8 saat. */
async function schedule(cfg, from, to) {
  const user = await me(cfg);
  try {
    const data = await call(cfg, `${cfg.url}/rest/tempo-core/2/user/schedule/search`, { method: 'POST', body: { from, to, userKeys: [user.key] } });
    const days = (Array.isArray(data) ? data[0]?.schedule?.days : data?.schedule?.days) || [];
    if (days.length) return Object.fromEntries(days.map((d) => [d.date, Number(d.requiredSeconds) || 0]));
  } catch { /* aşağıda varsayılan */ }
  const out = {};
  for (let d = from; d <= to; d = addDays(d, 1)) out[d] = [0, 6].includes(new Date(`${d}T12:00:00`).getDay()) ? 0 : 8 * 3600;
  return out;
}

// ---------- Geçmişten öğrenme ----------
const issueKey = (w) => w.issue?.key || String(w.originTaskId || '');
const projectKey = (w) => w.issue?.projectKey || issueKey(w).split('-')[0];
const attrValues = (w) => Object.fromEntries(Object.entries(w.attributes || {}).map(([k, a]) => [k, a && typeof a === 'object' ? a.value : a]));

/** En sık geçen değer */
function mostCommon(values) {
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) || 0) + 1);
  let best; let n = 0;
  for (const [v, c] of count) if (c > n) { best = v; n = c; }
  return { value: best, count: n };
}

/**
 * Açıklama kalıbı: kayıtların çoğu iş anahtarını içeren aynı cümleyse ("ABC-1 üzerinde çalışıldı" gibi) anahtar {key}
 * ile değiştirilmiş hâli döner; kayıtların en az yarısı aynı kalıptaysa kullanılır.
 */
export function commentTemplate(worklogs) {
  const forms = worklogs.map((w) => { const k = issueKey(w); const c = String(w.comment || '').trim(); return k && c.includes(k) ? c.split(k).join('{key}') : c; }).filter(Boolean);
  const top = mostCommon(forms);
  return top.value && top.count >= Math.max(2, forms.length / 2) ? top.value : '';
}

/**
 * Geçmiş kayıtlardan öğrenilenler: iş başına toplam süre ve son kullanım, iş/proje başına en sık kullanılan alan
 * değerleri, açıklama kalıbı, tipik kayıt süreleri.
 */
export function learn(worklogs) {
  const issues = new Map();
  for (const w of worklogs) {
    const k = issueKey(w);
    if (!k) continue;
    const it = issues.get(k) || { key: k, project: projectKey(w), summary: w.issue?.summary || '', seconds: 0, count: 0, last: '', attrs: [] };
    it.seconds += Number(w.timeSpentSeconds) || 0;
    it.count += 1;
    if (dayOf(w.started) > it.last) it.last = dayOf(w.started);
    it.attrs.push(attrValues(w));
    issues.set(k, it);
  }
  const sizes = mostCommonList(worklogs.map((w) => hours(Number(w.timeSpentSeconds) || 0)), 5);
  return { issues: [...issues.values()].sort((a, b) => b.seconds - a.seconds), template: commentTemplate(worklogs), sizes, all: worklogs };
}
function mostCommonList(values, n) {
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
}

/**
 * Bir iş için alan değerleri: önce aynı işin, yoksa aynı projenin, yoksa bütün kayıtların en sık kullandığı değer.
 * Yalnızca bilinen alanlar (work-attribute listesindekiler) döner.
 */
export function defaultsFor(key, learned, known) {
  const project = key.split('-')[0];
  const pools = [
    learned.all.filter((w) => issueKey(w) === key),
    learned.all.filter((w) => projectKey(w) === project),
    learned.all,
  ];
  const out = {};
  for (const a of known) {
    for (const pool of pools) {
      const vals = pool.map((w) => attrValues(w)[a.key]).filter((v) => v !== undefined && v !== null && v !== '');
      if (vals.length) { out[a.key] = mostCommon(vals).value; break; }
    }
  }
  return out;
}

const attrBody = (known, values) => Object.fromEntries(Object.entries(values).map(([key, value]) => {
  const a = known.find((x) => x.key === key) || {};
  return [key, { workAttributeId: a.id, key, name: a.name || key, type: a.type?.value || a.type, value: String(value) }];
}));

// ---------- Araçlar ----------
/** atlassian.js'in istek fonksiyonuyla Tempo araçları */
export function tempoClient(request) { call = request; return tempo; }
export const tempo = {
  async whoami(cfg) {
    const user = await me(cfg);
    const known = await attributes(cfg); // Tempo kurulu değilse burada 404 döner
    return `${user.displayName} (Tempo; ${known.length} iş kaydı alanı)`;
  },

  /** Geçmiş örüntü: hangi işlere, ne kadar, hangi alan değerleriyle, hangi açıklamayla kayıt giriliyor */
  async profile(cfg, { days } = {}) {
    const n = Math.min(Math.max(Number(days) || LEARN_DAYS, 7), 365);
    const to = isoDate(new Date());
    const from = addDays(to, -n);
    const [worklogs, known] = await Promise.all([search(cfg, from, to), attributes(cfg)]);
    const L = learn(worklogs);
    const lines = [`Son ${n} gün (${from} – ${to}): ${worklogs.length} kayıt, toplam ${fmtH(worklogs.reduce((s, w) => s + (Number(w.timeSpentSeconds) || 0), 0))}.`];
    const req = known.filter((a) => a.required);
    lines.push('', `Zorunlu alanlar: ${req.length ? req.map((a) => `${a.name} (${a.key})`).join(', ') : 'yok'}. Diğer alanlar: ${known.filter((a) => !a.required).map((a) => `${a.name} (${a.key})`).join(', ') || 'yok'}.`);
    lines.push('tempo_log_work bu alanları her iş için geçmişteki en sık değerle kendisi doldurur; kullanıcı başka değer istemedikçe alan verme.');
    lines.push('', L.template ? `Açıklama kalıbı (kayıtların çoğunda): "${L.template}" ({key} = iş anahtarı). Açıklama verilmezse bu kullanılır.` : 'Belirgin bir açıklama kalıbı yok: her kayıt için kısa bir açıklama yaz (kullanıcıya sor ya da yapılan işten çıkar).');
    lines.push(`Sık kullanılan kayıt süreleri (saat): ${L.sizes.join(', ') || '-'}.`);
    lines.push('', '| İş | Başlık | Toplam | Kayıt | Son kayıt |', '|---|---|---|---|---|');
    for (const it of L.issues.slice(0, 25)) lines.push(`| ${it.key} | ${it.summary.replace(/\|/g, '/').slice(0, 70)} | ${fmtH(it.seconds)} | ${it.count} | ${it.last} |`);
    // Son iki haftanın gün gün dağılımı: kullanıcının olağan günü nasıl böldüğü
    const recentFrom = addDays(to, -14);
    const byDay = new Map();
    for (const w of worklogs.filter((x) => dayOf(x.started) >= recentFrom)) {
      const d = dayOf(w.started);
      byDay.set(d, [...(byDay.get(d) || []), `${issueKey(w)} ${hours(w.timeSpentSeconds)}`]);
    }
    if (byDay.size) {
      lines.push('', 'Son iki hafta, gün gün:');
      for (const d of [...byDay.keys()].sort()) lines.push(`- ${d} ${weekday(d)}: ${byDay.get(d).join(', ')}`);
    }
    const notes = String(cfg.notes || '').trim();
    if (notes) lines.push('', `Kullanıcının kendi kuralları (Bağlantılar > Tempo): ${notes}`);
    return lines.join('\n');
  },

  /** Gün gün zorunlu / girilen / eksik süre ve kayıtlar (varsayılan: bu ay) */
  async status(cfg, { from, to } = {}) {
    const m = monthRange();
    const a = validDate(from) ? from : m.from;
    const b = validDate(to) ? to : (validDate(from) ? from : m.to);
    if (b < a) throw new Error('"to", "from" tarihinden önce olamaz');
    if ((new Date(b) - new Date(a)) / DAY > 62) throw new Error('En fazla 62 günlük aralık sorulabilir');
    const [worklogs, required] = await Promise.all([search(cfg, a, b), schedule(cfg, a, b)]);
    const today = isoDate(new Date());
    const lines = ['| Gün | Gerekli | Girilen | Eksik | Kayıtlar (kimlik: iş süre) |', '|---|---|---|---|---|'];
    let need = 0; let done = 0; let missing = 0;
    for (let d = a; d <= b; d = addDays(d, 1)) {
      const reqS = required[d] || 0;
      const day = worklogs.filter((w) => dayOf(w.started) === d);
      const got = day.reduce((s, w) => s + (Number(w.timeSpentSeconds) || 0), 0);
      if (!reqS && !got) continue;
      const lack = Math.max(0, reqS - got);
      need += reqS; done += got;
      if (d <= today) missing += lack;
      lines.push(`| ${d} ${weekday(d)}${d === today ? ' (bugün)' : ''} | ${hours(reqS)} | ${hours(got)} | ${lack ? hours(lack) : '-'} | ${day.map((w) => `${w.tempoWorklogId}: ${issueKey(w)} ${hours(w.timeSpentSeconds)}`).join(', ') || '-'} |`);
    }
    return [`${a} – ${b}: gerekli ${fmtH(need)}, girilen ${fmtH(done)}, bugüne kadar eksik ${fmtH(missing)}.`, '', ...lines].join('\n');
  },

  /**
   * Kayıt girer. entries: [{ issue, date, hours, comment?, attributes? }]. Zorunlu alanlar verilmezse geçmişten
   * doldurulur; açıklama verilmezse öğrenilen kalıp kullanılır. Hepsi önce denetlenir, biri bile hatalıysa hiçbiri girilmez.
   */
  async logWork(cfg, { entries } = {}) {
    let list = entries;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch { throw new Error('"entries" bir liste olmalı'); } }
    if (!Array.isArray(list) || !list.length) throw new Error('"entries" boş');
    if (list.length > 40) throw new Error('Tek seferde en fazla 40 kayıt girilir');
    const user = await me(cfg);
    const [known, history] = await Promise.all([attributes(cfg), search(cfg, addDays(isoDate(new Date()), -LEARN_DAYS), isoDate(new Date()))]);
    const L = learn(history);
    const prepared = list.map((e, i) => {
      const where = `${i + 1}. kayıt`;
      const issue = String(e?.issue || '').trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issue)) throw new Error(`${where}: iş anahtarı geçersiz (${e?.issue})`);
      if (!validDate(e?.date)) throw new Error(`${where}: tarih yyyy-aa-gg biçiminde olmalı (${e?.date})`);
      const h = Number(e?.hours);
      if (!(h > 0 && h <= 24)) throw new Error(`${where}: süre 0 ile 24 saat arasında olmalı (${e?.hours})`);
      const values = { ...defaultsFor(issue, L, known), ...Object.fromEntries(Object.entries(e?.attributes || {}).map(([k, v]) => [k, v && typeof v === 'object' ? v.value : v])) };
      const lack = known.filter((a) => a.required && (values[a.key] === undefined || values[a.key] === ''));
      if (lack.length) throw new Error(`${where} (${issue}): zorunlu alan için geçmişte değer bulunamadı: ${lack.map((a) => `${a.name} (${a.key})`).join(', ')}. Kullanıcıya sorup "attributes" ile ver.`);
      const comment = String(e?.comment || '').trim() || (L.template ? L.template.split('{key}').join(issue) : '');
      if (!comment) throw new Error(`${where} (${issue}): açıklama gerekli`);
      const seconds = Math.round(h * 3600);
      return { issue, date: e.date, seconds, comment, values };
    });
    const done = [];
    for (const p of prepared) {
      try {
        const r = await call(cfg, `${cfg.url}/rest/tempo-timesheets/4/worklogs/`, { method: 'POST', body: {
          worker: user.key, originTaskId: p.issue, started: p.date, timeSpentSeconds: p.seconds, billableSeconds: p.seconds,
          comment: p.comment, includeNonWorkingDays: false, attributes: attrBody(known, p.values),
        } });
        const w = Array.isArray(r) ? r[0] : r;
        done.push(`- ${w?.tempoWorklogId ?? '?'}: ${p.date} ${p.issue} ${hours(p.seconds)} sa — "${p.comment}"`);
      } catch (err) {
        const rest = prepared.slice(done.length + 1).map((x) => `${x.date} ${x.issue}`).join(', ');
        throw new Error(`${done.length ? `Girilenler:\n${done.join('\n')}\n` : ''}${p.date} ${p.issue} girilemedi: ${err.message}${rest ? `. Girilmeyenler: ${rest}` : ''}`);
      }
    }
    return `${done.length} kayıt girildi (Tempo kimliği: tarih iş süre):\n${done.join('\n')}`;
  },

  async deleteWorklog(cfg, { id } = {}) {
    const n = String(id || '').trim();
    if (!/^\d+$/.test(n)) throw new Error('Kayıt kimliği sayı olmalı (tempo_status çıktısındaki kimlik)');
    await call(cfg, `${cfg.url}/rest/tempo-timesheets/4/worklogs/${n}`, { method: 'DELETE' });
    return `${n} numaralı kayıt silindi.`;
  },
};
