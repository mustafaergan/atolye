// Jira, Confluence ve Bitbucket için küçük REST istemcisi. Hem Cloud (atlassian.net / bitbucket.org)
// hem şirket içi (Data Center / Server) kurulumlarla çalışır:
//   - E-posta verilmişse: Basic (e-posta + API anahtarı) — Cloud
//   - Verilmemişse: Bearer (kişisel erişim anahtarı) — şirket içi
import tls from 'node:tls';
import { outlook } from './outlook.js';
import { oracle, postgres } from './database.js';

let systemCaAdded = false;
/** Kurumsal ağların TLS sertifikaları genelde yalnızca işletim sisteminin deposundadır */
function trustSystemCertificates() {
  if (systemCaAdded) return;
  systemCaAdded = true;
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]);
  } catch { /* eski Node */ }
}

export const SERVICES = ['jira', 'confluence', 'bitbucket', 'graylog', 'jenkins', 'fortify', 'weblogic', 'sonarqube', 'reportportal', 'outlook', 'graylogprod', 'oracle', 'postgres'];
export const envKey = (service, field) => `${service.toUpperCase()}_${field.toUpperCase()}`;

/** Ortam değişkenlerinden bağlantı ayarı: { url, email, token } ya da null */
export function configFromEnv(service, env = process.env) {
  // Outlook bilgisayardaki Outlook'u kullanır: adres ya da anahtar yoktur, yalnızca açık/kapalı.
  // Şimdilik pasif: ATOLYE_OUTLOOK=1 verilmedikçe araçları sunulmaz (arayüzde de sekmesi yok).
  if (service === 'outlook') return env.ATOLYE_OUTLOOK === '1' && env.OUTLOOK_ENABLED === '1' ? { url: 'outlook', token: '', email: '' } : null;
  const url = (env[envKey(service, 'url')] || '').trim().replace(/\/+$/, '');
  const token = (env[envKey(service, 'token')] || '').trim();
  if (!url || !token) return null;
  return { url, token, email: (env[envKey(service, 'email')] || '').trim() };
}

export const isCloud = (url) => /(^|\.)(atlassian\.net|bitbucket\.org)$/i.test(new URL(url).hostname);
const enc = encodeURIComponent;
const encPath = (p) => String(p).split('/').filter(Boolean).map(enc).join('/');
const clamp = (n, def, max) => Math.min(Math.max(Number(n) || def, 1), max);
const cut = (s, max = 60_000) => (s.length > max ? `${s.slice(0, max)}\n… (kısaltıldı: ${s.length - max} karakter daha var)` : s);

/** Confluence/Jira HTML gövdesini düz metne çevirir */
export function htmlToText(html = '') {
  return String(html)
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Hata cevabından kısa, okunur bir açıklama (HTML sayfasının betikleri/biçemleri atılır) */
export function errorSummary(raw = '') {
  const body = String(raw).trim();
  if (!body) return '';
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const j = JSON.parse(body);
      const parts = [...(j.errorMessages || []), j.message, j.error?.message, ...(Array.isArray(j.errors) ? j.errors : Object.values(j.errors || {})).map((e) => e?.message || e)].filter((x) => typeof x === 'string' && x);
      if (parts.length) return parts.join('; ').slice(0, 300);
    } catch { /* düz metin gibi ele alınır */ }
  }
  if (/<html|<!doctype|<body|<script/i.test(body)) {
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) return htmlToText(title).slice(0, 150);
    return htmlToText(body.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')).split('\n')[0].slice(0, 150);
  }
  return body.slice(0, 300);
}

async function call(cfg, url, { method = 'GET', body, text = false, headers = {} } = {}) {
  trustSystemCertificates();
  const basic = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
  const bearer = `Bearer ${cfg.token}`;
  const cloud = isCloud(cfg.url);
  // Şirket içi kurulumda erişim belirteci Bearer ile gönderilir; e-posta doldurulmuşsa (kullanıcı adı + belirteç)
  // Basic de denenir. Cloud'da e-posta + API belirteci (Basic) kullanılır.
  const schemes = cfg.authHeader ? [cfg.authHeader] : cfg.basicOnly ? [basic] : cloud ? [cfg.email ? basic : bearer] : (cfg.email ? [bearer, basic] : [bearer]);
  let res; let raw;
  for (const auth of schemes) {
    try {
      res = await fetch(url, {
        method,
        headers: { authorization: auth, accept: text ? 'text/plain, */*' : 'application/json', 'x-requested-by': 'atolye', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
    } catch (err) {
      throw new Error(`Sunucuya ulaşılamadı (${new URL(url).host}): ${err.cause?.code || err.cause?.message || err.message}`);
    }
    raw = await res.text();
    if (res.status !== 401) break;
  }
  if (!res.ok) {
    const hint = res.status === 401
      ? (cloud && !cfg.email
        ? ' — giriş kabul edilmedi. Cloud (atlassian.net / bitbucket.org) için e-posta alanı da doldurulmalı'
        : cloud
          ? ' — giriş kabul edilmedi. E-postanın Atlassian hesabınızın e-postası olduğundan ve API belirtecini eksiksiz kopyaladığınızdan emin olun'
          : ' — API anahtarı kabul edilmedi. Kişisel erişim belirtecini eksiksiz kopyaladığınızdan ve süresinin dolmadığından emin olun (hesap parolası anahtar olarak kullanılamaz); gerekirse yeni bir belirteç oluşturun')
      : res.status === 403 ? ' — bu işlem için yetki yok'
        : res.status === 404 ? ' — bulunamadı (adresi ve adları kontrol edin)' : '';
    const detail = errorSummary(raw);
    throw new Error(`HTTP ${res.status}${hint}${detail ? ` (${detail})` : ''}`);
  }
  // Oturum açma sayfasına yönlendirme: anahtar kabul edilmemiş demektir
  if (!text && /^\s*</.test(raw)) throw new Error('Sunucu JSON yerine bir sayfa döndürdü; API anahtarı kabul edilmemiş olabilir');
  if (text) return raw;
  return raw ? JSON.parse(raw) : {};
}

// ---------- Jira ----------
export const jira = {
  async whoami(cfg) {
    const me = await call(cfg, `${cfg.url}/rest/api/2/myself`);
    return me.displayName || me.name || me.emailAddress || 'bilinmiyor';
  },
  async search(cfg, { jql, limit }) {
    const fields = 'summary,status,assignee,priority,issuetype,updated';
    // Cloud'da eski arama ucu kaldırıldı; yenisi /search/jql
    const ep = isCloud(cfg.url) ? 'search/jql' : 'search';
    const data = await call(cfg, `${cfg.url}/rest/api/2/${ep}?jql=${enc(jql)}&maxResults=${clamp(limit, 20, 50)}&fields=${fields}`);
    const issues = data.issues || [];
    if (!issues.length) return 'Sonuç yok.';
    return issues.map((i) => {
      const f = i.fields || {};
      return `${i.key} [${f.status?.name || '?'}] ${f.summary || ''} — ${f.issuetype?.name || ''}, ${f.assignee?.displayName || 'atanmamış'}, ${String(f.updated || '').slice(0, 10)}`;
    }).join('\n');
  },
  async getIssue(cfg, { key }) {
    const i = await call(cfg, `${cfg.url}/rest/api/2/issue/${enc(key)}?fields=summary,status,assignee,reporter,priority,issuetype,description,comment,labels,created,updated,parent,subtasks,issuelinks,fixVersions`);
    const f = i.fields || {};
    // İlişkili kayıtlar: üst kayıt (alt görevse ya da epik altındaysa), alt görevler ve bağlantılar
    const brief = (x) => `${x.key} [${x.fields?.status?.name || '?'}] ${x.fields?.summary || ''}${x.fields?.issuetype?.name ? ` — ${x.fields.issuetype.name}` : ''}`;
    const related = [
      ...(f.parent ? [`Üst kayıt: ${brief(f.parent)}`] : []),
      ...((f.subtasks || []).length ? [`Alt görevler (${f.subtasks.length}):`, ...f.subtasks.map((x) => `- ${brief(x)}`)] : []),
      ...((f.issuelinks || []).length ? ['Bağlantılı kayıtlar:', ...f.issuelinks.map((l) => (l.outwardIssue ? `- ${l.type?.outward || 'bağlı'}: ${brief(l.outwardIssue)}` : l.inwardIssue ? `- ${l.type?.inward || 'bağlı'}: ${brief(l.inwardIssue)}` : '')).filter(Boolean)] : []),
    ];
    const comments = (f.comment?.comments || []).slice(-10)
      .map((c) => `- ${c.author?.displayName || '?'} (${String(c.created || '').slice(0, 10)}): ${typeof c.body === 'string' ? c.body : JSON.stringify(c.body)}`);
    return cut([
      `${i.key}: ${f.summary || ''}`,
      `Adres: ${cfg.url}/browse/${i.key}`,
      `Durum: ${f.status?.name || '?'} | Tür: ${f.issuetype?.name || '?'} | Öncelik: ${f.priority?.name || '?'}`,
      `Atanan: ${f.assignee?.displayName || 'atanmamış'} | Bildiren: ${f.reporter?.displayName || '?'}`,
      `Oluşturma: ${String(f.created || '').slice(0, 10)} | Güncelleme: ${String(f.updated || '').slice(0, 10)}${f.labels?.length ? ` | Etiketler: ${f.labels.join(', ')}` : ''}${f.fixVersions?.length ? ` | Sürüm: ${f.fixVersions.map((v) => v.name).join(', ')}` : ''}`,
      ...(related.length ? ['', ...related] : []),
      '',
      'Açıklama:',
      typeof f.description === 'string' ? f.description : f.description ? JSON.stringify(f.description) : '(yok)',
      ...(comments.length ? ['', `Son yorumlar (${comments.length}):`, ...comments] : []),
    ].join('\n'));
  },
  async addComment(cfg, { key, body }) {
    const c = await call(cfg, `${cfg.url}/rest/api/2/issue/${enc(key)}/comment`, { method: 'POST', body: { body } });
    return `Yorum eklendi: ${cfg.url}/browse/${key} (yorum ${c.id || ''})`;
  },
};

// ---------- Confluence ----------
// Cloud'da Confluence adresi .../wiki altındadır
const wiki = (cfg) => (isCloud(cfg.url) && !/\/wiki$/i.test(cfg.url) ? `${cfg.url}/wiki` : cfg.url);
export const confluence = {
  async whoami(cfg) {
    const me = await call(cfg, `${wiki(cfg)}/rest/api/user/current`);
    return me.displayName || me.username || me.publicName || 'bilinmiyor';
  },
  async search(cfg, { query, limit }) {
    // Düz metin verilirse CQL'e çevrilir; CQL (ör. space = ABC and title ~ "x") olduğu gibi kullanılır
    const cql = /[=~]/.test(query) ? query : `text ~ "${String(query).replace(/["\\]/g, ' ')}" and type = page`;
    const data = await call(cfg, `${wiki(cfg)}/rest/api/content/search?cql=${enc(cql)}&limit=${clamp(limit, 10, 25)}&expand=space,version`);
    const rows = data.results || [];
    if (!rows.length) return 'Sonuç yok.';
    return rows.map((r) => `${r.id} | ${r.title} | alan: ${r.space?.key || '?'} | ${String(r.version?.when || '').slice(0, 10)} | ${wiki(cfg)}${r._links?.webui || ''}`).join('\n');
  },
  async getPage(cfg, { id }) {
    let title; let html; let version; let link;
    if (isCloud(cfg.url)) {
      const p = await call(cfg, `${wiki(cfg)}/api/v2/pages/${enc(id)}?body-format=storage`);
      title = p.title; html = p.body?.storage?.value; version = p.version?.number; link = p._links?.webui;
    } else {
      const p = await call(cfg, `${wiki(cfg)}/rest/api/content/${enc(id)}?expand=body.storage,version,space`);
      title = p.title; html = p.body?.storage?.value; version = p.version?.number; link = p._links?.webui;
    }
    return cut(`${title} (sürüm ${version ?? '?'})\nAdres: ${wiki(cfg)}${link || ''}\n\n${htmlToText(html)}`);
  },
};

// ---------- Bitbucket ----------
// Şirket içi: "proje" = proje anahtarı (ör. ABC). Cloud: "proje" = çalışma alanı (workspace);
// adres https://bitbucket.org/<çalışma-alanı> biçiminde girildiyse varsayılan olarak o kullanılır.
const bbCloudApi = 'https://api.bitbucket.org/2.0';
const bbWorkspace = (cfg, project) => project || new URL(cfg.url).pathname.split('/').filter(Boolean)[0] || '';
const need = (v, name) => { if (!v) throw new Error(`"${name}" gerekli`); return v; };

/** Birleşik diff metninden değişiklik boyutu: dosya sayısı, eklenen/silinen satır ve dosya başına sayılar */
export function diffStats(diff) {
  const files = [];
  let cur = null;
  for (const line of String(diff || '').split(/\r?\n/)) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) { cur = { path: head[2], added: 0, removed: 0 }; files.push(cur); continue; }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      // Başlığı "diff --git" olmayan biçimlerde dosya adı +++ satırından alınır
      if (!cur && line.startsWith('+++ ')) { cur = { path: line.slice(4).replace(/^b\//, ''), added: 0, removed: 0 }; files.push(cur); }
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('+')) cur.added++;
    else if (line.startsWith('-')) cur.removed++;
  }
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return { files, added, removed };
}
const sizeLine = ({ files, added, removed }) => {
  const top = [...files].sort((a, b) => (b.added + b.removed) - (a.added + a.removed)).slice(0, 30);
  return [`Değişiklik boyutu: ${files.length} dosya, +${added} / -${removed} satır (toplam ${added + removed})`,
    ...top.map((f) => `  ${f.path} +${f.added} -${f.removed}`),
    ...(files.length > top.length ? [`  … ve ${files.length - top.length} dosya daha`] : [])].join('\n');
};
export const bitbucket = {
  async whoami(cfg) {
    if (isCloud(cfg.url)) {
      const me = await call(cfg, `${bbCloudApi}/user`);
      return me.display_name || me.username || 'bilinmiyor';
    }
    const name = (await call(cfg, `${cfg.url}/plugins/servlet/applinks/whoami`, { text: true })).trim();
    if (name) return name;
    // Proje/depo düzeyindeki erişim belirteçleri bir kullanıcıya bağlı değildir: ad dönmez ama depolara erişir.
    // Geçersiz belirteçte bu çağrı 401 verir (yukarıdaki ipucuyla); boş listede belirteç hiçbir depoyu görmüyordur.
    const repos = await call(cfg, `${cfg.url}/rest/api/1.0/repos?limit=1`);
    if ((repos.values || []).length) return 'erişim belirteci (kullanıcı adı yok)';
    throw new Error('Belirteç kabul edildi ama hiçbir depoya erişemiyor, ya da sunucu sizi tanımadı (anonim). '
      + 'Bitbucket\'ta profil resmi → Hesabı yönet → HTTP erişim belirteçleri\'nden, depo okuma izniyle yeni bir belirteç oluşturup yalnızca onu yapıştırın; e-posta alanını boş bırakın');
  },
  /** Depolar, indirme (clone) adresleriyle: [{ name, cloneUrl }] */
  async repos(cfg, { project } = {}) {
    if (isCloud(cfg.url)) {
      const ws = need(bbWorkspace(cfg, project), 'project (çalışma alanı)');
      const data = await call(cfg, `${bbCloudApi}/repositories/${enc(ws)}?pagelen=100`);
      return (data.values || []).map((r) => {
        const href = (r.links?.clone || []).find((c) => c.name === 'https')?.href || '';
        return { name: r.full_name, cloneUrl: href.replace(/\/\/[^@/]+@/, '//') }; // adresteki kullanıcı adı atılır
      }).filter((r) => r.cloneUrl);
    }
    const data = await call(cfg, project
      ? `${cfg.url}/rest/api/1.0/projects/${enc(project)}/repos?limit=500`
      : `${cfg.url}/rest/api/1.0/repos?limit=500`);
    return (data.values || []).map((r) => ({
      name: `${r.project?.key || '?'} / ${r.name || r.slug}`,
      cloneUrl: (r.links?.clone || []).find((c) => /^https?$/.test(c.name))?.href || '',
    })).filter((r) => r.cloneUrl);
  },
  async listRepos(cfg, { project, limit }) {
    const n = clamp(limit, 50, 100);
    if (isCloud(cfg.url)) {
      const ws = need(bbWorkspace(cfg, project), 'project (çalışma alanı)');
      const data = await call(cfg, `${bbCloudApi}/repositories/${enc(ws)}?pagelen=${n}`);
      return (data.values || []).map((r) => `${r.full_name} — ${r.description || r.name}`).join('\n') || 'Depo yok.';
    }
    const data = await call(cfg, project
      ? `${cfg.url}/rest/api/1.0/projects/${enc(project)}/repos?limit=${n}`
      : `${cfg.url}/rest/api/1.0/repos?limit=${n}`);
    return (data.values || []).map((r) => `${r.project?.key}/${r.slug} — ${r.name}`).join('\n') || 'Depo yok.';
  },
  async listPullRequests(cfg, { project, repo, state = 'OPEN', limit }) {
    need(repo, 'repo');
    const n = clamp(limit, 25, 50);
    if (isCloud(cfg.url)) {
      const ws = need(bbWorkspace(cfg, project), 'project (çalışma alanı)');
      const data = await call(cfg, `${bbCloudApi}/repositories/${enc(ws)}/${enc(repo)}/pullrequests?state=${enc(state)}&pagelen=${n}`);
      return (data.values || []).map((p) => `#${p.id} [${p.state}] ${p.title} — ${p.author?.display_name || '?'}, ${p.source?.branch?.name} → ${p.destination?.branch?.name}`).join('\n') || 'Çekme isteği yok.';
    }
    const data = await call(cfg, `${cfg.url}/rest/api/1.0/projects/${enc(need(project, 'project'))}/repos/${enc(repo)}/pull-requests?state=${enc(state)}&limit=${n}`);
    return (data.values || []).map((p) => `#${p.id} [${p.state}] ${p.title} — ${p.author?.user?.displayName || '?'}, ${p.fromRef?.displayId} → ${p.toRef?.displayId}`).join('\n') || 'Çekme isteği yok.';
  },
  async getPullRequest(cfg, { project, repo, id }) {
    need(repo, 'repo'); need(id, 'id');
    if (isCloud(cfg.url)) {
      const base = `${bbCloudApi}/repositories/${enc(need(bbWorkspace(cfg, project), 'project (çalışma alanı)'))}/${enc(repo)}/pullrequests/${enc(id)}`;
      const p = await call(cfg, base);
      const diff = await call(cfg, `${base}/diff`, { text: true });
      return cut(`#${p.id} [${p.state}] ${p.title}\nYazar: ${p.author?.display_name || '?'} | ${p.source?.branch?.name} → ${p.destination?.branch?.name}\nAdres: ${p.links?.html?.href || ''}\n${sizeLine(diffStats(diff))}\n\n${p.description || ''}\n\n--- Değişiklikler ---\n${diff}`);
    }
    const base = `${cfg.url}/rest/api/1.0/projects/${enc(need(project, 'project'))}/repos/${enc(repo)}/pull-requests/${enc(id)}`;
    const p = await call(cfg, base);
    const diff = await call(cfg, `${base}.diff`, { text: true });
    const reviewers = (p.reviewers || []).map((r) => `${r.user?.displayName}${r.approved ? ' ✓' : ''}`).join(', ');
    return cut(`#${p.id} [${p.state}] ${p.title}\nYazar: ${p.author?.user?.displayName || '?'} | ${p.fromRef?.displayId} → ${p.toRef?.displayId}${reviewers ? `\nGözden geçirenler: ${reviewers}` : ''}\nAdres: ${p.links?.self?.[0]?.href || ''}\n${sizeLine(diffStats(diff))}\n\n${p.description || ''}\n\n--- Değişiklikler ---\n${diff}`);
  },
  /**
   * Kullanıcının gözden geçiren (reviewer) olarak atandığı AÇIK çekme istekleri. Şirket içi Bitbucket'ta bütün
   * depolardan gelir (proje/depo verilirse onlarla sınırlanır); Bitbucket Cloud'da depo adı gerekir.
   */
  async myReviewPrs(cfg, { project, repo, limit } = {}) {
    const n = clamp(limit, 50, 100);
    const MY = { APPROVED: 'onayladım', NEEDS_WORK: 'değişiklik istedim', UNAPPROVED: 'henüz bakmadım', approved: 'onayladım', changes_requested: 'değişiklik istedim' };
    const when = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    if (isCloud(cfg.url)) {
      const ws = need(bbWorkspace(cfg, project), 'project (çalışma alanı)');
      need(repo, 'repo');
      const me = await call(cfg, `${bbCloudApi}/user`);
      const q = `state="OPEN" AND reviewers.uuid="${me.uuid}"`;
      const data = await call(cfg, `${bbCloudApi}/repositories/${enc(ws)}/${enc(repo)}/pullrequests?pagelen=${Math.min(n, 50)}&q=${enc(q)}&fields=${enc('+values.participants')}`);
      const rows = data.values || [];
      if (!rows.length) return 'Gözden geçiren olarak atandığınız açık çekme isteği yok.';
      return rows.map((p) => {
        const mine = (p.participants || []).find((x) => x.user?.uuid === me.uuid);
        return `#${p.id} | ${ws}/${repo} | ${p.title} | ${p.author?.display_name || '?'} | ${p.source?.branch?.name} → ${p.destination?.branch?.name} | ${MY[mine?.state] || (mine?.approved ? 'onayladım' : 'henüz bakmadım')} | güncelleme ${when(p.updated_on)}`;
      }).join('\n');
    }
    let data;
    try {
      data = await call(cfg, `${cfg.url}/rest/api/1.0/dashboard/pull-requests?role=REVIEWER&state=OPEN&limit=${n}`);
    } catch (err) {
      if (/HTTP 40[13]/.test(err.message)) throw new Error(`${err.message}. Bu liste kişisel erişim belirteci ister; proje ya da depo belirteci bir kullanıcıya bağlı olmadığı için "benim PR'larım" bilinemez. Bitbucket'ta profil resmi → Hesabı yönet → HTTP erişim belirteçleri'nden kişisel bir belirteç oluşturun`);
      throw err;
    }
    const me = (await call(cfg, `${cfg.url}/plugins/servlet/applinks/whoami`, { text: true }).catch(() => '')).trim().toLowerCase();
    const rows = (data.values || []).filter((p) => {
      const r = p.toRef?.repository || {};
      return (!project || String(r.project?.key || '').toLowerCase() === String(project).toLowerCase()) && (!repo || String(r.slug || '').toLowerCase() === String(repo).toLowerCase());
    });
    if (!rows.length) return `Gözden geçiren olarak atandığınız açık çekme isteği yok${project || repo ? ` (${[project, repo].filter(Boolean).join('/')})` : ''}.`;
    return [`Gözden geçiren olarak atandığınız açık çekme istekleri (${rows.length}):`, ...rows.map((p) => {
      const r = p.toRef?.repository || {};
      const mine = (p.reviewers || []).find((x) => [x.user?.name, x.user?.slug].some((v) => v && String(v).toLowerCase() === me));
      return `#${p.id} | ${r.project?.key || '?'}/${r.slug || '?'} | ${p.title} | ${p.author?.user?.displayName || '?'} | ${p.fromRef?.displayId} → ${p.toRef?.displayId} | ${MY[mine?.status] || 'henüz bakmadım'} | güncelleme ${when(p.updatedDate)}`;
    })].join('\n');
  },
  /** Çekme isteğinin son commit'i için derleme (CI) sonuçları */
  async prBuildStatus(cfg, { project, repo, id }) {
    need(repo, 'repo'); need(id, 'id');
    const STATE = { SUCCESSFUL: 'BAŞARILI', FAILED: 'BAŞARISIZ', INPROGRESS: 'SÜRÜYOR', STOPPED: 'DURDURULDU', CANCELLED: 'İPTAL', UNKNOWN: 'BİLİNMİYOR' };
    let hash; let builds;
    if (isCloud(cfg.url)) {
      const base = `${bbCloudApi}/repositories/${enc(need(bbWorkspace(cfg, project), 'project (çalışma alanı)'))}/${enc(repo)}`;
      const p = await call(cfg, `${base}/pullrequests/${enc(id)}`);
      hash = p.source?.commit?.hash;
      if (!hash) throw new Error('Çekme isteğinin son commit\'i okunamadı');
      builds = ((await call(cfg, `${base}/commit/${enc(hash)}/statuses?pagelen=50`)).values || []).map((b) => ({ state: b.state, name: b.name || b.key, url: b.url, date: b.updated_on || b.created_on }));
    } else {
      const p = await call(cfg, `${cfg.url}/rest/api/1.0/projects/${enc(need(project, 'project'))}/repos/${enc(repo)}/pull-requests/${enc(id)}`);
      hash = p.fromRef?.latestCommit;
      if (!hash) throw new Error('Çekme isteğinin son commit\'i okunamadı');
      builds = ((await call(cfg, `${cfg.url}/rest/build-status/1.0/commits/${enc(hash)}?limit=50`)).values || []).map((b) => ({ state: b.state, name: b.name || b.key, url: b.url, date: b.dateAdded }));
    }
    const short = String(hash).slice(0, 10);
    if (!builds.length) return `#${id} (commit ${short}): derleme sonucu yok — bu commit için çalışmış bir CI derlemesi bildirilmemiş.`;
    const states = builds.map((b) => b.state);
    const overall = states.includes('FAILED') ? 'BAŞARISIZ' : states.includes('INPROGRESS') ? 'SÜRÜYOR' : states.every((x) => x === 'SUCCESSFUL') ? 'BAŞARILI' : 'KARIŞIK';
    const when = (d) => (d ? new Date(typeof d === 'number' ? d : d).toISOString().replace('T', ' ').slice(0, 16) : '');
    return [`#${id} (commit ${short}): ${overall}`, ...builds.map((b) => `- ${STATE[b.state] || b.state} | ${b.name || '?'}${b.date ? ` | ${when(b.date)}` : ''}${b.url ? ` | ${b.url}` : ''}`)].join('\n');
  },
  async getFile(cfg, { project, repo, path, ref }) {
    need(repo, 'repo'); need(path, 'path');
    if (isCloud(cfg.url)) {
      const ws = need(bbWorkspace(cfg, project), 'project (çalışma alanı)');
      return cut(await call(cfg, `${bbCloudApi}/repositories/${enc(ws)}/${enc(repo)}/src/${enc(ref || 'HEAD')}/${encPath(path)}`, { text: true }));
    }
    return cut(await call(cfg, `${cfg.url}/rest/api/1.0/projects/${enc(need(project, 'project'))}/repos/${enc(repo)}/raw/${encPath(path)}${ref ? `?at=${enc(ref)}` : ''}`, { text: true }));
  },
};

// ---------- Graylog ----------
// Graylog erişim belirteci Basic ile gönderilir: kullanıcı adı = belirteç, parola = "token"
const gl = (cfg) => ({ url: cfg.url.replace(/\/api$/i, ''), email: cfg.token, token: 'token', basicOnly: true });
const glRange = (minutes) => `${clamp(minutes, 15, 60 * 24 * 30)}m`;
const oneLine = (v) => String(v ?? '').replace(/\s*\r?\n\s*/g, ' ⏎ ');
export const graylog = {
  async whoami(cfg) {
    const sys = await call(gl(cfg), `${gl(cfg).url}/api/system`);
    return `Graylog ${sys.version || ''}`.trim();
  },
  async listStreams(cfg) {
    const data = await call(gl(cfg), `${gl(cfg).url}/api/streams`);
    const rows = (data.streams || []).filter((s) => !s.disabled);
    return rows.map((s) => `${s.id} | ${s.title}${s.description ? ` — ${oneLine(s.description).slice(0, 100)}` : ''}`).join('\n') || 'Akış (stream) yok.';
  },
  async search(cfg, { query, minutes, limit, stream, fields }) {
    const c = gl(cfg);
    const n = clamp(limit, 50, 200);
    const cols = String(fields || 'timestamp,source,message').split(',').map((f) => f.trim()).filter(Boolean);
    let rows;
    try {
      // Graylog 5.2+ arama ucu
      const data = await call(c, `${c.url}/api/search/messages?query=${enc(query || '*')}&timerange=${glRange(minutes)}&limit=${n}&fields=${enc(cols.join(','))}${stream ? `&streams=${enc(stream)}` : ''}`);
      const names = (data.schema || []).map((s) => s.field || s.name);
      rows = (data.datarows || []).map((r) => Object.fromEntries(r.map((v, i) => [names[i], v])));
    } catch (err) {
      if (!/HTTP 404/.test(err.message)) throw err;
      // Eski sürümler
      const data = await call(c, `${c.url}/api/search/universal/relative?query=${enc(query || '*')}&range=${clamp(minutes, 15, 60 * 24 * 30) * 60}&limit=${n}&fields=${enc(cols.join(','))}${stream ? `&filter=${enc(`streams:${stream}`)}` : ''}`);
      rows = (data.messages || []).map((m) => m.message || {});
    }
    if (!rows.length) return 'Sonuç yok.';
    const rest = cols.filter((f) => !['timestamp', 'source', 'message'].includes(f));
    return cut(rows.map((r) => {
      const extra = rest.map((f) => `${f}=${oneLine(r[f])}`).join(' ');
      return `${r.timestamp || ''} ${r.source || ''}: ${oneLine(r.message).slice(0, 1500)}${extra ? ` [${extra}]` : ''}`.trim();
    }).join('\n'));
  },
};

// ---------- Jenkins ----------
// Kullanıcı adı + API belirteci (Basic). İş yolu "klasor/is-adi" biçiminde verilir.
const jk = (cfg) => ({ ...cfg, basicOnly: true });
const jobPath = (job) => String(job || '').split('/').map((s) => s.trim()).filter((s) => s && s !== 'job').map((s) => `/job/${enc(s)}`).join('');
const buildRef = (b) => (b === undefined || b === null || b === '' ? 'lastBuild' : enc(String(b)));
const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');
export const jenkins = {
  async whoami(cfg) {
    const me = await call(jk(cfg), `${cfg.url}/whoAmI/api/json`);
    if (me.anonymous || me.authenticated === false) throw new Error('Jenkins girişi kabul etmedi (anonim). Kullanıcı adını ve API belirtecini kontrol edin');
    return me.name || 'bilinmiyor';
  },
  async listJobs(cfg, { folder } = {}) {
    const data = await call(jk(cfg), `${cfg.url}${jobPath(folder)}/api/json?tree=${enc('jobs[name,color,lastBuild[number,result,timestamp]]')}`);
    const rows = data.jobs || [];
    if (!rows.length) return 'İş (job) yok.';
    return rows.map((j) => {
      const b = j.lastBuild;
      const kind = j.color === undefined ? 'klasör' : (b ? `#${b.number} ${b.result || 'sürüyor'} ${when(b.timestamp)}` : 'hiç çalışmamış');
      return `${folder ? `${folder}/` : ''}${j.name} — ${kind}`;
    }).join('\n');
  },
  async getBuild(cfg, { job, build }) {
    const tree = 'number,result,building,duration,timestamp,url,fullDisplayName,changeSets[items[msg,author[fullName]]],actions[causes[shortDescription]]';
    const b = await call(jk(cfg), `${cfg.url}${jobPath(job)}/${buildRef(build)}/api/json?tree=${enc(tree)}`);
    const causes = (b.actions || []).flatMap((a) => a.causes || []).map((c) => c.shortDescription).filter(Boolean);
    const changes = (b.changeSets || []).flatMap((c) => c.items || []).slice(0, 20).map((i) => `- ${oneLine(i.msg).slice(0, 160)} (${i.author?.fullName || '?'})`);
    return [
      `${b.fullDisplayName || `${job} #${b.number}`}: ${b.building ? 'SÜRÜYOR' : b.result || '?'}`,
      `Başlangıç: ${when(b.timestamp)} | Süre: ${Math.round((b.duration || 0) / 1000)} sn`,
      `Adres: ${b.url || ''}`,
      ...(causes.length ? [`Sebep: ${causes.join('; ')}`] : []),
      ...(changes.length ? ['', 'Değişiklikler:', ...changes] : []),
    ].join('\n');
  },
  async getConsole(cfg, { job, build, lines }) {
    const text = await call(jk(cfg), `${cfg.url}${jobPath(job)}/${buildRef(build)}/consoleText`, { text: true });
    const all = text.split(/\r?\n/);
    const n = clamp(lines, 200, 2000);
    return cut(`${all.length > n ? `… (${all.length - n} satır atlandı; son ${n} satır)\n` : ''}${all.slice(-n).join('\n')}`);
  },
  async triggerBuild(cfg, { job, parameters }) {
    const c = jk(cfg);
    // CSRF koruması açıksa "crumb" gerekir (API belirtecinde çoğu kurulumda gerekmez; yoksa yok sayılır)
    let headers = {};
    try {
      const crumb = await call(c, `${cfg.url}/crumbIssuer/api/json`);
      if (crumb.crumbRequestField && crumb.crumb) headers = { [crumb.crumbRequestField]: crumb.crumb };
    } catch { /* crumb kapalı */ }
    const params = parameters && typeof parameters === 'object' ? Object.entries(parameters) : [];
    const qs = params.map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&');
    await call(c, `${cfg.url}${jobPath(job)}/${params.length ? `buildWithParameters?${qs}` : 'build'}`, { method: 'POST', text: true, headers });
    return `Derleme sıraya alındı: ${job}${params.length ? ` (${params.map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`;
  },
};

// ---------- OpenText Fortify (Software Security Center) ----------
// SSC istekleri "FortifyToken" şemasındaki bir erişim belirteciyle yapılır. Adres genelde https://sunucu/ssc biçimindedir.
// İki giriş biçimi desteklenir:
//   - Erişim belirteci (kullanıcı adı boş): belirteç doğrudan kullanılır
//   - Kullanıcı adı + parola: SSC'den kullanıcı adına geçici bir belirteç (UnifiedLoginToken) alınır ve bellekte
//     tutulur; süresi dolunca (401) yenisi alınır. Parola yalnızca bu belirteci almak için gönderilir.
const fyTokens = new Map(); // "adres|kullanıcı" -> belirteç

// SSC genelde /ssc yolunun altında çalışır. Kullanıcı yalnızca sunucu adresini ya da tarayıcıdaki uzun sayfa
// adresini (…/ssc/html/ssc/dashboard/…) yapıştırmış olabilir: denenecek kök adresler buna göre çıkarılır.
export function fortifyBases(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^(.*?\/ssc)(?:\/|$)/i);
  if (m) return [`${u.origin}${m[1]}`];
  const path = u.pathname.replace(/\/+$/, '');
  return path ? [`${u.origin}${path}`, `${u.origin}${path}/ssc`] : [`${u.origin}/ssc`, u.origin];
}
const fyWorking = new Map(); // girilen adres -> çalıştığı görülen kök adres
/** Girilen adresi çalışan kök adrese çevirerek isteği yapar (yanlış kökte sayfa/404 dönerse sıradakini dener) */
async function fyRequest(cfg, path, opts) {
  const known = fyWorking.get(cfg.url);
  const bases = known ? [known] : fortifyBases(cfg.url);
  let last;
  for (const base of bases) {
    try {
      const res = await fyCall({ ...cfg, url: base }, `${base}${path}`, opts);
      fyWorking.set(cfg.url, base);
      return res;
    } catch (err) {
      last = err;
      if (!/JSON yerine bir sayfa|HTTP 404/.test(err.message)) throw err;
    }
  }
  throw new Error(`${last.message}. Fortify adresinin /ssc ile biten kök adres olduğundan emin olun (ör. https://sunucu/ssc)`);
}
async function fyLogin(cfg) {
  const key = `${cfg.url}|${cfg.email}`;
  if (fyTokens.has(key)) return fyTokens.get(key);
  const res = await call({ ...cfg, basicOnly: true }, `${cfg.url}/api/v1/tokens`, { method: 'POST', body: { type: 'UnifiedLoginToken', description: 'Atolye' } });
  const token = res?.data?.token;
  if (!token) throw new Error('Fortify kullanıcı adı ve parolayla erişim belirteci vermedi');
  fyTokens.set(key, token);
  return token;
}
/** Fortify isteği: belirteç ya da kullanıcı adı/parola ile; geçici belirtecin süresi dolduysa bir kez yenilenir */
async function fyCall(cfg, url, opts) {
  if (!cfg.email) return call({ ...cfg, authHeader: `FortifyToken ${cfg.token}` }, url, opts);
  for (let attempt = 1; ; attempt++) {
    const token = await fyLogin(cfg);
    try {
      return await call({ ...cfg, authHeader: `FortifyToken ${token}` }, url, opts);
    } catch (err) {
      if (attempt > 1 || !/HTTP 401/.test(err.message)) throw err;
      fyTokens.delete(`${cfg.url}|${cfg.email}`);
    }
  }
}
export const fortify = {
  async whoami(cfg) {
    const data = await fyRequest(cfg, `/api/v1/projectVersions?limit=1&fields=id`);
    return `Fortify SSC (${data.count ?? (data.data || []).length} uygulama sürümü görünüyor)`;
  },
  async listVersions(cfg, { query, limit } = {}) {
    const data = await fyRequest(cfg, `/api/v1/projectVersions?limit=200&fields=${enc('id,name,project,currentState')}`);
    const q = String(query || '').toLowerCase();
    const rows = (data.data || []).filter((v) => !q || `${v.project?.name} ${v.name}`.toLowerCase().includes(q)).slice(0, clamp(limit, 50, 200));
    return rows.map((v) => `${v.id} | ${v.project?.name || '?'} / ${v.name}`).join('\n') || 'Eşleşen uygulama sürümü yok.';
  },
  async listIssues(cfg, { versionId, severity, limit }) {
    const fields = 'id,issueName,friority,primaryLocation,lineNumber,kingdom,audited,issueStatus';
    const data = await fyRequest(cfg, `/api/v1/projectVersions/${enc(versionId)}/issues?limit=${clamp(limit, 50, 200)}&orderby=friority&fields=${enc(fields)}`);
    const sev = String(severity || '').toLowerCase();
    const rows = (data.data || []).filter((i) => !sev || String(i.friority || '').toLowerCase() === sev);
    if (!rows.length) return 'Bulgu yok.';
    return `Toplam ${data.count ?? rows.length} bulgu (gösterilen ${rows.length}):\n${rows.map((i) => `${i.id} | ${i.friority || '?'} | ${i.issueName} | ${i.primaryLocation || ''}${i.lineNumber ? `:${i.lineNumber}` : ''}${i.audited ? ' | incelendi' : ''}`).join('\n')}`;
  },
  async getIssue(cfg, { id }) {
    const d = (await fyRequest(cfg, `/api/v1/issueDetails/${enc(id)}`)).data || {};
    return cut([
      `${d.issueName || id} [${d.friority || '?'}]`,
      `Dosya: ${d.fullFileName || d.primaryLocation || '?'}${d.lineNumber ? `:${d.lineNumber}` : ''}`,
      `Kategori: ${d.kingdom || '?'} | Durum: ${d.issueStatus || d.primaryTag || '?'}`,
      ...(d.brief ? ['', 'Özet:', htmlToText(d.brief)] : []),
      ...(d.detail ? ['', 'Ayrıntı:', htmlToText(d.detail)] : []),
      ...(d.recommendation ? ['', 'Öneri:', htmlToText(d.recommendation)] : []),
    ].join('\n'));
  },
};

// ---------- Oracle WebLogic Server (REST yönetim arayüzü) ----------
// Kullanıcı adı + parola (Basic). Yalnızca okuma yapılır; "Monitor" rolündeki bir kullanıcı yeterlidir.
const wl = (cfg) => ({ ...cfg, basicOnly: true });
const wlBase = (cfg) => `${cfg.url.replace(/\/(console|management.*)$/i, '')}/management/weblogic/latest`;
const health = (h) => (typeof h === 'string' ? h : h?.state || '?');
export const weblogic = {
  async whoami(cfg) {
    const d = await call(wl(cfg), `${wlBase(cfg)}/domainRuntime?fields=name&links=none`);
    return `WebLogic alanı: ${d.name || '?'}`;
  },
  async servers(cfg) {
    const d = await call(wl(cfg), `${wlBase(cfg)}/domainRuntime/serverRuntimes?fields=${enc('name,state,healthState,weblogicVersion,openSocketsCurrentCount')}&links=none`);
    const rows = d.items || [];
    if (!rows.length) return 'Çalışan sunucu görünmüyor.';
    return rows.map((s) => `${s.name} — ${s.state} | sağlık: ${health(s.healthState)}${s.weblogicVersion ? ` | ${oneLine(s.weblogicVersion).slice(0, 60)}` : ''}`).join('\n');
  },
  async applications(cfg, { server }) {
    const d = await call(wl(cfg), `${wlBase(cfg)}/domainRuntime/serverRuntimes/${enc(server)}/applicationRuntimes?fields=${enc('name,healthState,overallHealthState,activeVersionState')}&links=none`);
    return (d.items || []).map((a) => `${a.name} — sağlık: ${health(a.overallHealthState ?? a.healthState)}`).join('\n') || 'Uygulama yok.';
  },
  async deployments(cfg) {
    const d = await call(wl(cfg), `${wlBase(cfg)}/domainConfig/appDeployments?fields=${enc('name,targets,sourcePath')}&links=none`);
    return (d.items || []).map((a) => `${a.name} → ${(a.targets || []).map((t) => (t.identity || []).at(-1)).filter(Boolean).join(', ') || '?'}${a.sourcePath ? ` (${a.sourcePath})` : ''}`).join('\n') || 'Dağıtım yok.';
  },
  async datasources(cfg, { server }) {
    const fields = 'name,state,activeConnectionsCurrentCount,waitingForConnectionCurrentCount,failuresToReconnectCount,connectionsTotalCount';
    const d = await call(wl(cfg), `${wlBase(cfg)}/domainRuntime/serverRuntimes/${enc(server)}/JDBCServiceRuntime/JDBCDataSourceRuntimeMBeans?fields=${enc(fields)}&links=none`);
    return (d.items || []).map((s) => `${s.name} — ${s.state} | etkin bağlantı: ${s.activeConnectionsCurrentCount ?? '?'} | bekleyen: ${s.waitingForConnectionCurrentCount ?? '?'} | yeniden bağlanma hatası: ${s.failuresToReconnectCount ?? '?'}`).join('\n') || 'Veri kaynağı yok.';
  },
};

// ---------- SonarQube ----------
// Kullanıcı belirteci Basic ile gönderilir: kullanıcı adı = belirteç, parola boş (bütün sürümlerde geçerlidir).
// Yalnızca okuma yapılır.
const sq = (cfg) => ({ url: cfg.url, email: cfg.token, token: '', basicOnly: true });
const SQ_METRICS = 'alert_status,bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density,ncloc,reliability_rating,security_rating,sqale_rating';
const SQ_LABELS = { alert_status: 'Kalite kapısı', bugs: 'Hata', vulnerabilities: 'Güvenlik açığı', security_hotspots: 'Güvenlik sıcak noktası', code_smells: 'Kod kokusu', coverage: 'Test kapsamı (%)', duplicated_lines_density: 'Tekrarlanan satır (%)', ncloc: 'Kod satırı', reliability_rating: 'Güvenilirlik notu', security_rating: 'Güvenlik notu', sqale_rating: 'Bakım notu' };
const sqRating = (v) => 'ABCDE'[Math.round(Number(v)) - 1] || v;
const sqFile = (component) => String(component || '').split(':').slice(1).join(':') || component || '';
const sqBranch = (branch) => (branch ? `&branch=${enc(branch)}` : '');
export const sonarqube = {
  async whoami(cfg) {
    const c = sq(cfg);
    const v = await call(c, `${cfg.url}/api/authentication/validate`);
    if (!v.valid) throw new Error('SonarQube belirteci kabul etmedi. Belirteci eksiksiz kopyaladığınızdan ve süresinin dolmadığından emin olun');
    const version = await call(c, `${cfg.url}/api/server/version`, { text: true }).catch(() => '');
    return `SonarQube ${String(version).trim().slice(0, 30)}`.trim();
  },
  async listProjects(cfg, { query, limit } = {}) {
    const data = await call(sq(cfg), `${cfg.url}/api/components/search?qualifiers=TRK&ps=${clamp(limit, 50, 200)}${query ? `&q=${enc(query)}` : ''}`);
    const rows = data.components || [];
    return rows.map((p) => `${p.key} | ${p.name}`).join('\n') || 'Proje bulunamadı.';
  },
  async qualityGate(cfg, { project, branch }) {
    const st = (await call(sq(cfg), `${cfg.url}/api/qualitygates/project_status?projectKey=${enc(project)}${sqBranch(branch)}`)).projectStatus || {};
    const failed = (st.conditions || []).filter((c) => c.status !== 'OK');
    return [
      `Kalite kapısı: ${st.status === 'OK' ? 'GEÇTİ' : st.status === 'ERROR' ? 'KALDI' : st.status || '?'}`,
      ...failed.map((c) => `- ${c.metricKey}: ${c.actualValue} (eşik: ${c.comparator === 'LT' ? 'en az' : 'en çok'} ${c.errorThreshold}) — ${c.status}`),
    ].join('\n');
  },
  async measures(cfg, { project, branch, metrics }) {
    const keys = String(metrics || SQ_METRICS).split(',').map((m) => m.trim()).filter(Boolean).join(',');
    const data = await call(sq(cfg), `${cfg.url}/api/measures/component?component=${enc(project)}&metricKeys=${enc(keys)}${sqBranch(branch)}`);
    const rows = data.component?.measures || [];
    if (!rows.length) return 'Ölçüm yok (proje henüz taranmamış olabilir).';
    const order = keys.split(',');
    return [`${data.component.name || project}:`, ...rows.sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric)).map((m) => {
      const value = m.value ?? m.period?.value ?? '';
      return `- ${SQ_LABELS[m.metric] || m.metric}: ${/_rating$/.test(m.metric) ? sqRating(value) : m.metric === 'alert_status' ? (value === 'OK' ? 'GEÇTİ' : value === 'ERROR' ? 'KALDI' : value) : value}`;
    })].join('\n');
  },
  async listIssues(cfg, { project, branch, severities, types, limit }) {
    const rest = `&resolved=false&ps=${clamp(limit, 30, 100)}&s=SEVERITY&asc=false${severities ? `&severities=${enc(String(severities).toUpperCase())}` : ''}${types ? `&types=${enc(String(types).toUpperCase())}` : ''}${sqBranch(branch)}`;
    let data;
    try {
      data = await call(sq(cfg), `${cfg.url}/api/issues/search?componentKeys=${enc(project)}${rest}`);
    } catch (err) {
      if (!/HTTP 400/.test(err.message)) throw err;
      // Yeni sürümlerde parametrenin adı "components"
      data = await call(sq(cfg), `${cfg.url}/api/issues/search?components=${enc(project)}${rest}`);
    }
    const rows = data.issues || [];
    if (!rows.length) return 'Açık bulgu yok.';
    const total = data.paging?.total ?? data.total ?? rows.length;
    return cut([`Toplam ${total} açık bulgu (gösterilen ${rows.length}):`, ...rows.map((i) =>
      `${i.key} | ${i.severity || i.impacts?.[0]?.severity || '?'} | ${i.type || i.impacts?.[0]?.softwareQuality || '?'} | ${sqFile(i.component)}${i.line ? `:${i.line}` : ''} | ${oneLine(i.message).slice(0, 200)} [${i.rule}]`)].join('\n'));
  },
  async listHotspots(cfg, { project, branch, limit }) {
    const data = await call(sq(cfg), `${cfg.url}/api/hotspots/search?projectKey=${enc(project)}&status=TO_REVIEW&ps=${clamp(limit, 30, 100)}${sqBranch(branch)}`);
    const rows = data.hotspots || [];
    if (!rows.length) return 'İncelenecek güvenlik sıcak noktası yok.';
    return cut([`Toplam ${data.paging?.total ?? rows.length} incelenecek güvenlik sıcak noktası (gösterilen ${rows.length}):`, ...rows.map((h) =>
      `${h.key} | ${h.vulnerabilityProbability || '?'} | ${h.securityCategory || '?'} | ${sqFile(h.component)}${h.line ? `:${h.line}` : ''} | ${oneLine(h.message).slice(0, 200)}`)].join('\n'));
  },
};

// ---------- ReportPortal ----------
// API anahtarı Bearer ile gönderilir. "E-posta" alanı burada varsayılan proje adı olarak kullanılır (isteğe bağlı);
// araçlara proje verilmezse o kullanılır. Yalnızca okuma yapılır.
const rp = (cfg) => ({ url: cfg.url.replace(/\/(ui|api)(\/.*)?$/i, ''), token: cfg.token, email: '' });
const rpTime = (t) => { if (!t) return ''; const d = new Date(typeof t === 'number' || /^\d+$/.test(t) ? Number(t) : t); return Number.isNaN(d.getTime()) ? String(t) : d.toISOString().replace('T', ' ').slice(0, 16); };
const RP_DEFECTS = { pb: 'ürün hatası', ab: 'otomasyon hatası', si: 'sistem sorunu', ti: 'incelenecek', nd: 'hata değil' };
const RP_DEFECT_GROUPS = { product_bug: 'ürün hatası', automation_bug: 'otomasyon hatası', system_issue: 'sistem sorunu', to_investigate: 'incelenecek', no_defect: 'hata değil' };
const rpDefect = (type) => RP_DEFECTS[String(type || '').slice(0, 2).toLowerCase()] || type || '';
// "Ben kimim" ucu sürümden sürüme değişti; bazı sürümlerde eski adres yalnızca yöneticilere açıktır (403).
// Sırayla denenir; 401 (anahtar geçersiz) dışındaki hatalarda sıradakine geçilir.
async function rpUser(cfg) {
  const c = rp(cfg);
  let last;
  for (const p of ['/api/users/me', '/api/v1/users', '/api/v1/user']) {
    try {
      const me = await call(c, `${c.url}${p}`);
      if (me && !Array.isArray(me) && !Array.isArray(me.content)) return me; // sayfalı liste, kullanıcı değildir
    } catch (err) {
      if (/HTTP 401/.test(err.message)) throw err;
      last = err;
    }
  }
  throw last || new Error('Kullanıcı bilgisi okunamadı');
}
const rpProjects = (me) => Object.keys(me.assignedProjects || {}).concat((me.assigned_projects || me.projects || []).map((p) => p.project_name || p.name || p)).filter((p) => typeof p === 'string');
async function rpProject(cfg, project) {
  const name = String(project || cfg.email || '').trim();
  if (name) return name;
  const list = rpProjects(await rpUser(cfg).catch(() => ({})));
  if (list.length === 1) return list[0];
  throw new Error(list.length ? `Proje belirtilmedi. Erişebildiğiniz projeler: ${list.join(', ')}` : 'Proje belirtilmedi: project değerini verin ya da Bağlantılar > ReportPortal sekmesinde "Varsayılan proje" alanını doldurun');
}
const rpStats = (st = {}) => {
  const e = st.executions || {};
  const defects = Object.entries(st.defects || {}).map(([k, v]) => [k, v?.total || 0]).filter(([, n]) => n).map(([k, n]) => `${RP_DEFECT_GROUPS[k] || k} ${n}`);
  return `toplam ${e.total || 0}, başarılı ${e.passed || 0}, başarısız ${e.failed || 0}, atlanan ${e.skipped || 0}${defects.length ? ` | ${defects.join(', ')}` : ''}`;
};
export const reportportal = {
  async whoami(cfg) {
    let me;
    try { me = await rpUser(cfg); } catch (err) {
      if (/HTTP 401/.test(err.message)) throw err;
      // Kullanıcı bilgisi okunamıyorsa bağlantı, varsayılan projenin koşuları okunarak sınanır
      const c = rp(cfg);
      const project = String(cfg.email || '').trim();
      if (!project) throw new Error(`${err.message}. Bu ReportPortal sürümünde kullanıcı bilgisi bu anahtarla okunamıyor; "Varsayılan proje" alanına proje adını yazıp yeniden deneyin`);
      try { await call(c, `${c.url}/api/v1/${enc(project)}/launch?page.size=1`); } catch (e2) {
        throw new Error(`${e2.message}. Proje adını ("${project}") ve bu projeye erişiminizi kontrol edin; ad, ReportPortal adresindeki /ui/#proje-adi kısmıdır`);
      }
      return `bağlandı (proje: ${project})`;
    }
    const list = rpProjects(me);
    return `${me.userId || me.login || me.email || me.full_name || 'bilinmiyor'}${list.length ? ` (projeler: ${list.slice(0, 8).join(', ')}${list.length > 8 ? '…' : ''})` : ''}`;
  },
  async listProjects(cfg) {
    const me = await rpUser(cfg);
    const roles = me.assignedProjects || {};
    return rpProjects(me).map((p) => `${p}${roles[p]?.projectRole ? ` — ${roles[p].projectRole}` : ''}`).join('\n') || 'Atanmış proje yok.';
  },
  async listLaunches(cfg, { project, name, status, limit } = {}) {
    const c = rp(cfg);
    const p = await rpProject(cfg, project);
    const data = await call(c, `${c.url}/api/v1/${enc(p)}/launch?page.size=${clamp(limit, 15, 100)}&page.sort=${enc('startTime,desc')}${name ? `&filter.cnt.name=${enc(name)}` : ''}${status ? `&filter.eq.status=${enc(String(status).toUpperCase())}` : ''}`);
    const rows = data.content || [];
    if (!rows.length) return 'Koşu (launch) bulunamadı.';
    return rows.map((l) => `${l.id} | ${l.name} #${l.number} | ${l.status} | ${rpTime(l.startTime)} | ${rpStats(l.statistics)}`).join('\n');
  },
  async getLaunch(cfg, { project, id }) {
    const c = rp(cfg);
    const p = await rpProject(cfg, project);
    const l = await call(c, `${c.url}/api/v1/${enc(p)}/launch/${enc(id)}`);
    const attrs = (l.attributes || []).map((a) => (a.key ? `${a.key}:${a.value}` : a.value)).filter(Boolean);
    return [
      `${l.name} #${l.number}: ${l.status}`,
      `Başlangıç: ${rpTime(l.startTime)}${l.endTime ? ` | Bitiş: ${rpTime(l.endTime)}` : ''}${l.owner ? ` | Başlatan: ${l.owner}` : ''}`,
      `Sonuç: ${rpStats(l.statistics)}`,
      ...(attrs.length ? [`Etiketler: ${attrs.join(', ')}`] : []),
      ...(l.description ? ['', oneLine(l.description).slice(0, 1000)] : []),
    ].join('\n');
  },
  async listItems(cfg, { project, launch, status, limit }) {
    const c = rp(cfg);
    const p = await rpProject(cfg, project);
    const st = String(status || 'FAILED').toUpperCase();
    const data = await call(c, `${c.url}/api/v1/${enc(p)}/item?filter.eq.launchId=${enc(launch)}&filter.eq.hasChildren=false${st === 'ALL' ? '' : `&filter.eq.status=${enc(st)}`}&page.size=${clamp(limit, 30, 150)}&page.sort=${enc('startTime,asc')}`);
    const rows = data.content || [];
    if (!rows.length) return st === 'ALL' ? 'Test adımı yok.' : `Durumu ${st} olan test yok.`;
    const total = data.page?.totalElements ?? rows.length;
    return cut([`Toplam ${total} kayıt (gösterilen ${rows.length}):`, ...rows.map((i) => {
      const path = (i.pathNames?.itemPaths || []).map((x) => x.name).join(' > ');
      const tickets = (i.issue?.externalSystemIssues || []).map((t) => t.ticketId).filter(Boolean).join(', ');
      return `${i.id} | ${i.status} | ${path ? `${path} > ` : ''}${i.name}${i.issue?.issueType ? ` | ${rpDefect(i.issue.issueType)}` : ''}${tickets ? ` | ${tickets}` : ''}${i.issue?.comment ? ` | not: ${oneLine(i.issue.comment).slice(0, 150)}` : ''}`;
    })].join('\n'));
  },
  async getLogs(cfg, { project, item, level, limit }) {
    const c = rp(cfg);
    const p = await rpProject(cfg, project);
    const lv = String(level || 'ERROR').toUpperCase();
    const data = await call(c, `${c.url}/api/v1/${enc(p)}/log?filter.eq.item=${enc(item)}${lv === 'ALL' ? '' : `&filter.gte.level=${enc(lv)}`}&page.size=${clamp(limit, 30, 200)}&page.sort=${enc('logTime,asc')}`);
    const rows = data.content || [];
    if (!rows.length) return lv === 'ALL' ? 'Kayıt (log) yok.' : `${lv} ve üzeri seviyede kayıt yok (level: ALL ile hepsine bakılabilir).`;
    return cut(rows.map((r) => `${rpTime(r.time || r.logTime)} ${r.level || ''}: ${String(r.message || '').slice(0, 4000)}`).join('\n'));
  },
};

// Graylog iki ortamla bağlanır: 'graylog' test, 'graylogprod' canlı (prod); istemci aynıdır, adres ve belirteç ayrıdır
export const clients = { jira, confluence, bitbucket, graylog, graylogprod: graylog, jenkins, fortify, weblogic, sonarqube, reportportal, outlook, oracle, postgres };
