#!/usr/bin/env node
// Atölye'nin Jira / Confluence / Bitbucket araçlarını Claude Code ve GitHub Copilot CLI'a sunan
// küçük MCP sunucusu (stdio, satır başına bir JSON-RPC mesajı). Bağlantı bilgileri ortam
// değişkenlerinden gelir; onları CLI'ların kendi ayar dosyalarına integrations.js yazar.
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { clients, configFromEnv, SERVICES } from './atlassian.js';

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const PROJECT = 'Proje anahtarı (şirket içi Bitbucket) ya da çalışma alanı (Bitbucket Cloud)';

// name -> { service, fn, write, description, properties, required }
export const TOOLS = {
  jira_search: { service: 'jira', fn: 'search', description: 'Jira kayıtlarını JQL ile arar (ör. "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC").', properties: { jql: str('JQL sorgusu'), limit: num('En fazla kaç kayıt (varsayılan 20)') }, required: ['jql'] },
  jira_get_issue: { service: 'jira', fn: 'getIssue', description: 'Bir Jira kaydının ayrıntılarını, açıklamasını ve son yorumlarını getirir.', properties: { key: str('Kayıt anahtarı, ör. ABC-123') }, required: ['key'] },
  jira_add_comment: { service: 'jira', fn: 'addComment', write: true, description: 'Bir Jira kaydına yorum ekler.', properties: { key: str('Kayıt anahtarı, ör. ABC-123'), body: str('Yorum metni') }, required: ['key', 'body'] },
  confluence_search: { service: 'confluence', fn: 'search', description: 'Confluence sayfalarında arama yapar. Düz metin ya da CQL (ör. space = ABC and title ~ "kurulum") verilebilir.', properties: { query: str('Aranacak metin ya da CQL'), limit: num('En fazla kaç sonuç (varsayılan 10)') }, required: ['query'] },
  confluence_get_page: { service: 'confluence', fn: 'getPage', description: 'Bir Confluence sayfasının içeriğini düz metin olarak getirir.', properties: { id: str('Sayfa kimliği (aramadan ya da adresteki pageId değerinden)') }, required: ['id'] },
  bitbucket_list_repos: { service: 'bitbucket', fn: 'listRepos', description: 'Bitbucket depolarını listeler.', properties: { project: str(PROJECT), limit: num('En fazla kaç depo (varsayılan 50)') }, required: [] },
  bitbucket_list_pull_requests: { service: 'bitbucket', fn: 'listPullRequests', description: 'Bir deponun çekme isteklerini (pull request) listeler.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), state: str('OPEN (varsayılan), MERGED ya da DECLINED'), limit: num('En fazla kaç kayıt (varsayılan 25)') }, required: ['repo'] },
  bitbucket_get_pull_request: { service: 'bitbucket', fn: 'getPullRequest', description: 'Bir çekme isteğinin açıklamasını ve değişikliklerini (diff) getirir.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), id: str('Çekme isteği numarası') }, required: ['repo', 'id'] },
  graylog_search: { service: 'graylog', fn: 'search', description: 'Graylog kayıtlarında (log) arama yapar. Sorgu Graylog söz dizimindedir (ör. "level:3 AND source:uygulama-adi", "\"NullPointerException\""). Sonuçlar en yeniden eskiye gelir.', properties: { query: str('Graylog sorgusu; hepsi için *'), minutes: num('Son kaç dakika (varsayılan 15)'), limit: num('En fazla kaç kayıt (varsayılan 50, en çok 200)'), stream: str('Akış (stream) kimliği; graylog_list_streams ile bulunur (isteğe bağlı)'), fields: str('Virgülle ayrılmış alanlar (varsayılan: timestamp,source,message)') }, required: ['query'] },
  graylog_list_streams: { service: 'graylog', fn: 'listStreams', description: 'Graylog akışlarını (stream) kimlikleriyle listeler.', properties: {}, required: [] },
  jenkins_list_jobs: { service: 'jenkins', fn: 'listJobs', description: 'Jenkins işlerini (job) son derleme durumlarıyla listeler. Klasör verilirse onun içindekileri listeler.', properties: { folder: str('Klasör yolu, ör. takim/proje (isteğe bağlı)') }, required: [] },
  jenkins_get_build: { service: 'jenkins', fn: 'getBuild', description: 'Bir Jenkins derlemesinin sonucunu, süresini, sebebini ve içerdiği değişiklikleri getirir.', properties: { job: str('İş yolu, ör. takim/proje/main'), build: str('Derleme numarası (boş: son derleme)') }, required: ['job'] },
  jenkins_get_console: { service: 'jenkins', fn: 'getConsole', description: 'Bir Jenkins derlemesinin konsol çıktısının son satırlarını getirir (derleme neden kırıldı sorusu için).', properties: { job: str('İş yolu, ör. takim/proje/main'), build: str('Derleme numarası (boş: son derleme)'), lines: num('Sondan kaç satır (varsayılan 200)') }, required: ['job'] },
  jenkins_trigger_build: { service: 'jenkins', fn: 'triggerBuild', write: true, description: 'Bir Jenkins işini çalıştırır (derleme başlatır).', properties: { job: str('İş yolu, ör. takim/proje/main'), parameters: { type: 'object', description: 'Parametreli işler için ad-değer çiftleri (isteğe bağlı)' } }, required: ['job'] },
  fortify_list_versions: { service: 'fortify', fn: 'listVersions', description: 'Fortify SSC uygulama sürümlerini kimlikleriyle listeler.', properties: { query: str('Uygulama ya da sürüm adında aranacak metin (isteğe bağlı)'), limit: num('En fazla kaç kayıt (varsayılan 50)') }, required: [] },
  fortify_list_issues: { service: 'fortify', fn: 'listIssues', description: 'Bir Fortify uygulama sürümündeki güvenlik bulgularını önem sırasına göre listeler.', properties: { versionId: str('Uygulama sürümü kimliği (fortify_list_versions ile bulunur)'), severity: str('Critical, High, Medium ya da Low (isteğe bağlı)'), limit: num('En fazla kaç bulgu (varsayılan 50)') }, required: ['versionId'] },
  fortify_get_issue: { service: 'fortify', fn: 'getIssue', description: 'Bir Fortify bulgusunun ayrıntısını, dosya/satırını ve düzeltme önerisini getirir.', properties: { id: str('Bulgu kimliği') }, required: ['id'] },
  weblogic_servers: { service: 'weblogic', fn: 'servers', description: 'WebLogic alanındaki çalışan sunucuları durum ve sağlık bilgisiyle listeler.', properties: {}, required: [] },
  weblogic_applications: { service: 'weblogic', fn: 'applications', description: 'Bir WebLogic sunucusunda çalışan uygulamaları sağlık durumlarıyla listeler.', properties: { server: str('Sunucu adı (weblogic_servers ile bulunur)') }, required: ['server'] },
  weblogic_deployments: { service: 'weblogic', fn: 'deployments', description: 'WebLogic alanındaki uygulama dağıtımlarını ve hedeflerini listeler.', properties: {}, required: [] },
  weblogic_datasources: { service: 'weblogic', fn: 'datasources', description: 'Bir WebLogic sunucusundaki JDBC veri kaynaklarının durumunu ve bağlantı sayılarını getirir.', properties: { server: str('Sunucu adı') }, required: ['server'] },
  sonarqube_list_projects: { service: 'sonarqube', fn: 'listProjects', description: 'SonarQube projelerini anahtarlarıyla listeler.', properties: { query: str('Proje adında aranacak metin (isteğe bağlı)'), limit: num('En fazla kaç proje (varsayılan 50)') }, required: [] },
  sonarqube_quality_gate: { service: 'sonarqube', fn: 'qualityGate', description: 'Bir SonarQube projesinin kalite kapısı (quality gate) durumunu ve geçemeyen koşulları getirir.', properties: { project: str('Proje anahtarı (sonarqube_list_projects ile bulunur)'), branch: str('Dal adı (isteğe bağlı; Community sürümünde yalnızca ana dal taranır)') }, required: ['project'] },
  sonarqube_measures: { service: 'sonarqube', fn: 'measures', description: 'Bir SonarQube projesinin ölçümlerini getirir: hata, güvenlik açığı, kod kokusu, test kapsamı, tekrar oranı, notlar.', properties: { project: str('Proje anahtarı (sonarqube_list_projects ile bulunur)'), branch: str('Dal adı (isteğe bağlı; Community sürümünde yalnızca ana dal taranır)'), metrics: str('Virgülle ayrılmış ölçüm anahtarları (isteğe bağlı; ör. coverage,bugs)') }, required: ['project'] },
  sonarqube_list_issues: { service: 'sonarqube', fn: 'listIssues', description: 'Bir SonarQube projesindeki açık bulguları önem sırasına göre listeler (dosya, satır, kural).', properties: { project: str('Proje anahtarı (sonarqube_list_projects ile bulunur)'), branch: str('Dal adı (isteğe bağlı; Community sürümünde yalnızca ana dal taranır)'), severities: str('BLOCKER, CRITICAL, MAJOR, MINOR, INFO (virgülle; isteğe bağlı)'), types: str('BUG, VULNERABILITY, CODE_SMELL (virgülle; isteğe bağlı)'), limit: num('En fazla kaç bulgu (varsayılan 30)') }, required: ['project'] },
  sonarqube_list_hotspots: { service: 'sonarqube', fn: 'listHotspots', description: 'Bir SonarQube projesindeki incelenmeyi bekleyen güvenlik sıcak noktalarını (security hotspot) listeler.', properties: { project: str('Proje anahtarı (sonarqube_list_projects ile bulunur)'), branch: str('Dal adı (isteğe bağlı; Community sürümünde yalnızca ana dal taranır)'), limit: num('En fazla kaç kayıt (varsayılan 30)') }, required: ['project'] },
  bitbucket_get_file: { service: 'bitbucket', fn: 'getFile', description: 'Depodaki bir dosyanın içeriğini getirir.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), path: str('Dosya yolu'), ref: str('Dal, etiket ya da commit (varsayılan: ana dal)') }, required: ['repo', 'path'] },
};

/** Yalnızca bağlantısı kurulmuş servislerin araçları sunulur */
export function availableTools(env = process.env) {
  const configured = Object.fromEntries(SERVICES.map((s) => [s, configFromEnv(s, env)]));
  return Object.entries(TOOLS).filter(([, t]) => configured[t.service]).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: { type: 'object', properties: t.properties, required: t.required },
    annotations: { readOnlyHint: !t.write },
  }));
}

export async function callTool(name, args = {}, env = process.env) {
  const tool = TOOLS[name];
  const cfg = tool && configFromEnv(tool.service, env);
  if (!cfg) return { isError: true, content: [{ type: 'text', text: `Araç kullanılamıyor: ${name}` }] };
  try {
    for (const r of tool.required) if (args[r] === undefined || args[r] === '') throw new Error(`"${r}" gerekli`);
    const text = await clients[tool.service][tool.fn](cfg, args);
    return { content: [{ type: 'text', text: String(text) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `${tool.service}: ${err.message}` }] };
  }
}

export async function handleMessage(m, env = process.env) {
  if (m.id === undefined || m.id === null) return null; // bildirim: cevap yok
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return ok({ protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'atolye', version: '1' } });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: availableTools(env) });
    case 'tools/call': return ok(await callTool(m.params?.name, m.params?.arguments || {}, env));
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Bilinmeyen yöntem: ${m.method}` } };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const res = await handleMessage(m);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
  rl.on('close', () => process.exit(0));
}
