// Jira, Confluence ve Bitbucket için küçük REST istemcisi. Hem Cloud (atlassian.net / bitbucket.org)
// hem şirket içi (Data Center / Server) kurulumlarla çalışır:
//   - E-posta verilmişse: Basic (e-posta + API anahtarı) — Cloud
//   - Verilmemişse: Bearer (kişisel erişim anahtarı) — şirket içi
import tls from 'node:tls';

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

export const SERVICES = ['jira', 'confluence', 'bitbucket', 'graylog'];
export const envKey = (service, field) => `${service.toUpperCase()}_${field.toUpperCase()}`;

/** Ortam değişkenlerinden bağlantı ayarı: { url, email, token } ya da null */
export function configFromEnv(service, env = process.env) {
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

async function call(cfg, url, { method = 'GET', body, text = false } = {}) {
  trustSystemCertificates();
  const basic = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
  const bearer = `Bearer ${cfg.token}`;
  const cloud = isCloud(cfg.url);
  // Şirket içi kurulumda erişim belirteci Bearer ile gönderilir; e-posta doldurulmuşsa (kullanıcı adı + belirteç)
  // Basic de denenir. Cloud'da e-posta + API belirteci (Basic) kullanılır.
  const schemes = cfg.basicOnly ? [basic] : cloud ? [cfg.email ? basic : bearer] : (cfg.email ? [bearer, basic] : [bearer]);
  let res; let raw;
  for (const auth of schemes) {
    try {
      res = await fetch(url, {
        method,
        headers: { authorization: auth, accept: text ? 'text/plain, */*' : 'application/json', 'x-requested-by': 'atolye', ...(body ? { 'content-type': 'application/json' } : {}) },
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
    const i = await call(cfg, `${cfg.url}/rest/api/2/issue/${enc(key)}?fields=summary,status,assignee,reporter,priority,issuetype,description,comment,labels,created,updated`);
    const f = i.fields || {};
    const comments = (f.comment?.comments || []).slice(-10)
      .map((c) => `- ${c.author?.displayName || '?'} (${String(c.created || '').slice(0, 10)}): ${typeof c.body === 'string' ? c.body : JSON.stringify(c.body)}`);
    return cut([
      `${i.key}: ${f.summary || ''}`,
      `Adres: ${cfg.url}/browse/${i.key}`,
      `Durum: ${f.status?.name || '?'} | Tür: ${f.issuetype?.name || '?'} | Öncelik: ${f.priority?.name || '?'}`,
      `Atanan: ${f.assignee?.displayName || 'atanmamış'} | Bildiren: ${f.reporter?.displayName || '?'}`,
      `Oluşturma: ${String(f.created || '').slice(0, 10)} | Güncelleme: ${String(f.updated || '').slice(0, 10)}${f.labels?.length ? ` | Etiketler: ${f.labels.join(', ')}` : ''}`,
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
      return cut(`#${p.id} [${p.state}] ${p.title}\nYazar: ${p.author?.display_name || '?'} | ${p.source?.branch?.name} → ${p.destination?.branch?.name}\nAdres: ${p.links?.html?.href || ''}\n\n${p.description || ''}\n\n--- Değişiklikler ---\n${diff}`);
    }
    const base = `${cfg.url}/rest/api/1.0/projects/${enc(need(project, 'project'))}/repos/${enc(repo)}/pull-requests/${enc(id)}`;
    const p = await call(cfg, base);
    const diff = await call(cfg, `${base}.diff`, { text: true });
    const reviewers = (p.reviewers || []).map((r) => `${r.user?.displayName}${r.approved ? ' ✓' : ''}`).join(', ');
    return cut(`#${p.id} [${p.state}] ${p.title}\nYazar: ${p.author?.user?.displayName || '?'} | ${p.fromRef?.displayId} → ${p.toRef?.displayId}${reviewers ? `\nGözden geçirenler: ${reviewers}` : ''}\nAdres: ${p.links?.self?.[0]?.href || ''}\n\n${p.description || ''}\n\n--- Değişiklikler ---\n${diff}`);
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

export const clients = { jira, confluence, bitbucket, graylog };
