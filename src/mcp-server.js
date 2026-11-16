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
  jira_get_issue: { service: 'jira', fn: 'getIssue', description: 'Bir Jira kaydının ayrıntılarını (üst kayıt, alt görevler ve bağlantılı kayıtlar dahil), açıklamasını ve son yorumlarını getirir.', properties: { key: str('Kayıt anahtarı, ör. ABC-123') }, required: ['key'] },
  jira_add_comment: { service: 'jira', fn: 'addComment', write: true, description: 'Bir Jira kaydına yorum ekler.', properties: { key: str('Kayıt anahtarı, ör. ABC-123'), body: str('Yorum metni') }, required: ['key', 'body'] },
  confluence_search: { service: 'confluence', fn: 'search', description: 'Confluence sayfalarında arama yapar. Düz metin ya da CQL (ör. space = ABC and title ~ "kurulum") verilebilir.', properties: { query: str('Aranacak metin ya da CQL'), limit: num('En fazla kaç sonuç (varsayılan 10)') }, required: ['query'] },
  confluence_get_page: { service: 'confluence', fn: 'getPage', description: 'Bir Confluence sayfasının içeriğini düz metin olarak getirir.', properties: { id: str('Sayfa kimliği (aramadan ya da adresteki pageId değerinden)') }, required: ['id'] },
  bitbucket_list_repos: { service: 'bitbucket', fn: 'listRepos', description: 'Bitbucket depolarını listeler.', properties: { project: str(PROJECT), limit: num('En fazla kaç depo (varsayılan 50)') }, required: [] },
  bitbucket_list_pull_requests: { service: 'bitbucket', fn: 'listPullRequests', description: 'Bir deponun çekme isteklerini (pull request) listeler.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), state: str('OPEN (varsayılan), MERGED ya da DECLINED'), limit: num('En fazla kaç kayıt (varsayılan 25)') }, required: ['repo'] },
  bitbucket_get_pull_request: { service: 'bitbucket', fn: 'getPullRequest', description: 'Bir çekme isteğinin değişiklik boyutunu (dosya sayısı, eklenen/silinen satır), açıklamasını ve değişikliklerini (diff) getirir.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), id: str('Çekme isteği numarası') }, required: ['repo', 'id'] },
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
  reportportal_list_projects: { service: 'reportportal', fn: 'listProjects', description: 'ReportPortal\'da erişilebilen projeleri listeler.', properties: {}, required: [] },
  reportportal_list_launches: { service: 'reportportal', fn: 'listLaunches', description: 'ReportPortal test koşularını (launch) en yeniden eskiye, sonuç sayılarıyla listeler.', properties: { project: str('Proje adı (boşsa bağlantıda kayıtlı varsayılan proje)'), name: str('Koşu adında aranacak metin (isteğe bağlı)'), status: str('PASSED, FAILED, IN_PROGRESS, STOPPED (isteğe bağlı)'), limit: num('En fazla kaç koşu (varsayılan 15)') }, required: [] },
  reportportal_get_launch: { service: 'reportportal', fn: 'getLaunch', description: 'Bir ReportPortal test koşusunun özetini getirir: durum, süre, başarılı/başarısız sayıları, hata sınıfları, etiketler.', properties: { project: str('Proje adı (boşsa bağlantıda kayıtlı varsayılan proje)'), id: str('Koşu kimliği (reportportal_list_launches çıktısının ilk sütunu)') }, required: ['id'] },
  reportportal_list_items: { service: 'reportportal', fn: 'listItems', description: 'Bir ReportPortal koşusundaki testleri listeler (varsayılan: başarısız olanlar); hata sınıfı, bağlı kayıt numarası ve inceleme notuyla.', properties: { project: str('Proje adı (boşsa bağlantıda kayıtlı varsayılan proje)'), launch: str('Koşu kimliği'), status: str('FAILED (varsayılan), PASSED, SKIPPED ya da ALL'), limit: num('En fazla kaç test (varsayılan 30)') }, required: ['launch'] },
  reportportal_get_logs: { service: 'reportportal', fn: 'getLogs', description: 'Bir ReportPortal testinin kayıtlarını (log) getirir; test neden başarısız oldu sorusu için hata mesajı ve yığın izi.', properties: { project: str('Proje adı (boşsa bağlantıda kayıtlı varsayılan proje)'), item: str('Test kimliği (reportportal_list_items çıktısının ilk sütunu)'), level: str('En düşük seviye: ERROR (varsayılan), WARN, INFO, DEBUG ya da ALL'), limit: num('En fazla kaç satır (varsayılan 30)') }, required: ['item'] },
  outlook_list_folders: { service: 'outlook', fn: 'listFolders', description: 'Bilgisayardaki Outlook\'un e-posta klasörlerini e-posta ve okunmamış sayılarıyla listeler.', properties: {}, required: [] },
  outlook_search_mail: { service: 'outlook', fn: 'searchMail', description: 'Bilgisayardaki Outlook\'ta e-posta arar (en yeniden eskiye). Konu, gönderen adı ve metinde arar; sonuçta her e-postanın kimliği, tarihi, göndereni, konusu ve kısa önizlemesi gelir.', properties: { query: str('Aranacak metin (isteğe bağlı)'), folder: str('Klasör adı ya da yolu (ör. jira, Gelen Kutusu/jira, Gönderilmiş); boşsa Gelen Kutusu'), days: num('Son kaç gün (varsayılan 7, en çok 365)'), from: str('Gönderen adında aranacak metin (isteğe bağlı)'), unread: str('true: yalnızca okunmamışlar'), limit: num('En fazla kaç e-posta (varsayılan 20)') }, required: [] },
  outlook_get_mail: { service: 'outlook', fn: 'getMail', description: 'Bir e-postanın tamamını getirir: gönderen, alıcılar, tarih, ek adları ve metin. Okundu işareti değişmez.', properties: { id: str('E-posta kimliği (outlook_search_mail çıktısının ilk sütunu)') }, required: ['id'] },
  outlook_list_events: { service: 'outlook', fn: 'listEvents', description: 'Bilgisayardaki Outlook takviminden toplantıları listeler (tekrarlayanlar dahil).', properties: { start: str('Başlangıç günü yyyy-aa-gg (boşsa bugün)'), days: num('Kaç gün (varsayılan 1, en çok 60)') }, required: [] },
  bitbucket_my_review_prs: { service: 'bitbucket', fn: 'myReviewPrs', description: 'Kullanıcının gözden geçiren (reviewer) olarak atandığı AÇIK çekme isteklerini listeler: depo, başlık, yazar, dallar ve kullanıcının kendi onay durumu. Şirket içi Bitbucket\'ta bütün depolardan gelir; proje/depo verilirse onlarla sınırlanır.', properties: { project: str(PROJECT + ' (isteğe bağlı)'), repo: str('Depo adı (isteğe bağlı; Bitbucket Cloud\'da gerekli)'), limit: num('En fazla kaç kayıt (varsayılan 50)') }, required: [] },
  bitbucket_pr_build_status: { service: 'bitbucket', fn: 'prBuildStatus', description: 'Bir çekme isteğinin (PR) son commit\'i için derleme (CI, ör. Jenkins) sonuçlarını getirir: başarılı, başarısız ya da sürüyor.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), id: str('Çekme isteği numarası') }, required: ['repo', 'id'] },
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
