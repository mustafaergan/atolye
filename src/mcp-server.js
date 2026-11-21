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
  graylog_search: { service: 'graylog', fn: 'search', description: 'TEST ortamındaki Graylog kayıtlarında (log) arama yapar. Canlı (prod) ortam için graylog_prod_search kullanılır. Sorgu Graylog söz dizimindedir (ör. "level:3 AND source:uygulama-adi", "\"NullPointerException\""). Sonuçlar en yeniden eskiye gelir.', properties: { query: str('Graylog sorgusu; hepsi için *'), minutes: num('Son kaç dakika (varsayılan 15)'), limit: num('En fazla kaç kayıt (varsayılan 50, en çok 200)'), stream: str('Akış (stream) kimliği; graylog_list_streams ile bulunur (isteğe bağlı)'), fields: str('Virgülle ayrılmış alanlar (varsayılan: timestamp,source,message)') }, required: ['query'] },
  graylog_list_streams: { service: 'graylog', fn: 'listStreams', description: 'TEST ortamındaki Graylog akışlarını (stream) kimlikleriyle listeler.', properties: {}, required: [] },
  graylog_prod_search: { service: 'graylogprod', fn: 'search', description: 'CANLI (PROD) ortamdaki Graylog kayıtlarında (log) arama yapar; yalnızca okur. Kullanıcı açıkça canlı ortamı sormadıysa önce test ortamına (graylog_search) bakılır. Sorgu Graylog söz dizimindedir (ör. "level:3 AND source:uygulama-adi"). Sonuçlar en yeniden eskiye gelir; canlı kayıtlar kişisel veri içerebilir, yanıtta yalnızca gerekeni aktar.', properties: { query: str('Graylog sorgusu; hepsi için *'), minutes: num('Son kaç dakika (varsayılan 15)'), limit: num('En fazla kaç kayıt (varsayılan 50, en çok 200)'), stream: str('Akış (stream) kimliği; graylog_prod_list_streams ile bulunur (isteğe bağlı)'), fields: str('Virgülle ayrılmış alanlar (varsayılan: timestamp,source,message)') }, required: ['query'] },
  graylog_prod_list_streams: { service: 'graylogprod', fn: 'listStreams', description: 'CANLI (PROD) ortamdaki Graylog akışlarını (stream) kimlikleriyle listeler.', properties: {}, required: [] },
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
  teams_list_chats: { service: 'teams', fn: 'listChats', description: 'Microsoft Teams sohbetlerini (birebir, grup, toplantı) en son yazışılandan eskiye listeler: kimlik, tür, ad ya da kişiler ve son mesajın kısa önizlemesi. "query" verilirse sohbet adında ve kişi adlarında arar.', properties: { query: str('Sohbet adında ya da kişi adında aranacak metin (isteğe bağlı)'), limit: num('En fazla kaç sohbet (varsayılan 20, en çok 50)') }, required: [] },
  teams_get_messages: { service: 'teams', fn: 'getMessages', description: 'Bir Teams sohbetinin mesajlarını eskiden yeniye getirir: tarih, gönderen, metin ve ek adları. Yalnızca okur; mesaj göndermez. Mesajlar kişisel ya da gizli bilgi içerebilir; yanıtta yalnızca gerekeni aktar.', properties: { chat: str('Sohbet kimliği (teams_list_chats çıktısının ilk sütunu) ya da sohbetin / kişinin adı'), limit: num('En fazla kaç mesaj (varsayılan 30, en çok 200)'), before: str('Yalnızca bu tarihten önceki mesajlar: yyyy-aa-gg ya da ISO tarih (isteğe bağlı; daha eskilere gitmek için)') }, required: ['chat'] },
  teams_list_channels: { service: 'teams', fn: 'listChannels', description: 'Üyesi olunan Teams ekiplerini ve kanallarını kimlikleriyle listeler.', properties: { query: str('Ekip adında aranacak metin (isteğe bağlı)') }, required: [] },
  teams_get_channel_messages: { service: 'teams', fn: 'getChannelMessages', description: 'Bir Teams kanalındaki son gönderileri yanıtlarıyla getirir. Yalnızca okur. Erişim anahtarında ChannelMessage.Read.All ya da Group.Read.All izni gerekir; yoksa birebir ve grup sohbetleri için teams_get_messages kullanılır.', properties: { team: str('Ekip kimliği (teams_list_channels ile bulunur)'), channel: str('Kanal kimliği (teams_list_channels ile bulunur)'), limit: num('En fazla kaç gönderi (varsayılan 10, en çok 50)') }, required: ['team', 'channel'] },
  desktop_app_status: { service: 'uygulama', fn: 'status', description: 'Kullanıcının Atölye\'de tanımladığı masaüstü uygulamasının durumunu getirir: ayar dosyasındaki başlangıç adresi, izinli adresler, Atölye\'nin başlattığı sürecin açık olup olmadığı ve bu adla çalışan süreç sayısı. Uygulamanın penceresi ve giriş durumu görülemez.', properties: {}, required: [] },
  desktop_app_set_start_url: { service: 'uygulama', fn: 'setUrl', write: true, description: 'Masaüstü uygulamasının ayar dosyasındaki başlangıç adresini (InitialPage) değiştirir; yalnızca izinli adresler kabul edilir, dosyanın diğer satırlarına dokunulmaz. Uygulama açıkken değiştirilmez (önce kapatılmalı). Uygulamayı başlatmaz.', properties: { url: str('Yeni başlangıç adresi (izinli adresler desktop_app_status çıktısındadır)') }, required: ['url'] },
  desktop_app_open: { service: 'uygulama', fn: 'open', write: true, description: 'Masaüstü uygulamasını kendi penceresinde başlatır (ayarı değiştirmez). Giriş ve sonraki işlemleri kullanıcı uygulamanın içinde yapar.', properties: { unverified: { type: 'boolean', description: 'Başlangıç adresi dosyadan okunamıyorsa (ayar uygulamanın kendi arayüzündeyse) yine de açmak için true' } }, required: [] },
  desktop_app_close: { service: 'uygulama', fn: 'close', write: true, description: 'Çalışan masaüstü uygulamasını kapatır (önce kapanma isteği, kapanmazsa sonlandırma). Açık bir görüşme ya da kaydedilmemiş iş varsa kesilir; kullanıcı istemedikçe kullanma.', properties: { all: { type: 'boolean', description: 'true: bu adla çalışan bütün örnekler (elle açılanlar dahil); varsayılan yalnızca Atölye\'nin başlattığı' } }, required: [] },
  desktop_app_network: { service: 'uygulama', fn: 'network', description: 'Masaüstü uygulamasının içindeki sayfanın yaptığı son ağ isteklerini listeler: saat, yöntem, durum kodu, süre ve adres. Hangi servisin çağrıldığını ve hangisinin hata verdiğini görmek için. Yalnızca uygulama Atölye\'den, ağ incelemesi açıkken başlatıldıysa çalışır; sayfa dışındaki (ör. çağrı tarafı) bağlantılar görülmez.', properties: { search: str('Adreste ya da gövdelerde aranacak metin (isteğe bağlı; ör. bir servis adı)'), failed: { type: 'boolean', description: 'true: yalnızca hatalı istekler (4xx / 5xx ya da ağ hatası)' }, limit: num('En fazla kaç istek (varsayılan 50, en çok 200)') }, required: [] },
  desktop_app_network_detail: { service: 'uygulama', fn: 'networkDetail', description: 'Bir ağ isteğinin ayrıntısını getirir: gönderilen gövde ve dönen cevabın başı (parola, PIN, kart ve anahtar alanları gizlenir). Cevaplar kişisel veri içerebilir; yanıtta yalnızca gerekeni aktar.', properties: { id: num('İstek numarası (desktop_app_network çıktısının ilk sütunu)') }, required: ['id'] },
  desktop_app_page: { service: 'uygulama', fn: 'page', description: 'Masaüstü uygulamasının içinde açık olan sayfaların adresini, başlığını ve görünen metnini getirir (ekran görüntüsü değil). Yalnızca ağ incelemesi açıkken çalışır.', properties: {}, required: [] },
  desktop_app_list_logs: { service: 'uygulama', fn: 'logs', description: 'Masaüstü uygulamasının klasöründeki log dosyalarını (en yenisi üstte) boyut ve tarihleriyle listeler.', properties: {}, required: [] },
  desktop_app_read_log: { service: 'uygulama', fn: 'readLog', description: 'Masaüstü uygulamasının bir log dosyasının son satırlarını getirir; uygulamanın hangi servislere gittiğini ve hataları incelemek için. "search" ile yalnızca belirli bir metni (ör. http, error, bir servis adı) içeren satırlar alınır. Loglar kişisel veri içerebilir; yanıtta yalnızca gerekeni aktar.', properties: { file: str('Dosya (desktop_app_list_logs çıktısının ilk sütunu); boşsa en yeni log'), lines: num('Sondan kaç satır (varsayılan 200, en çok 1000)'), search: str('Yalnızca bu metni içeren satırlar (isteğe bağlı)') }, required: [] },
  bitbucket_my_review_prs: { service: 'bitbucket', fn: 'myReviewPrs', description: 'Kullanıcının gözden geçiren (reviewer) olarak atandığı AÇIK çekme isteklerini listeler: depo, başlık, yazar, dallar ve kullanıcının kendi onay durumu. Şirket içi Bitbucket\'ta bütün depolardan gelir; proje/depo verilirse onlarla sınırlanır.', properties: { project: str(PROJECT + ' (isteğe bağlı)'), repo: str('Depo adı (isteğe bağlı; Bitbucket Cloud\'da gerekli)'), limit: num('En fazla kaç kayıt (varsayılan 50)') }, required: [] },
  bitbucket_pr_build_status: { service: 'bitbucket', fn: 'prBuildStatus', description: 'Bir çekme isteğinin (PR) son commit\'i için derleme (CI, ör. Jenkins) sonuçlarını getirir: başarılı, başarısız ya da sürüyor.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), id: str('Çekme isteği numarası') }, required: ['repo', 'id'] },
  oracle_query: { service: 'oracle', fn: 'query', description: 'Oracle veritabanında YALNIZCA OKUMA sorgusu çalıştırır (salt okunur işlem içinde, 30 sn sınırı). Önce oracle_list_tables / oracle_describe_table ile tablo ve kolonları öğrenin. Canlı veri kişisel bilgi içerebilir; gerekmedikçe kişisel kolonları seçmeyin ve yanıtta yalnızca gerekeni aktarın.', properties: { sql: str('Yalnızca SELECT ya da WITH ... SELECT sorgusu (tek ifade). Değişiklik yapan ifadeler reddedilir.'), limit: num('En fazla kaç satır (varsayılan 100, en çok 1000)') }, required: ['sql'] },
  oracle_list_tables: { service: 'oracle', fn: 'listTables', description: 'Oracle veritabanında erişilebilen tablo ve görünümleri (sistem şemaları hariç) listeler.', properties: { schema: str('Şema (kullanıcı) adı (isteğe bağlı)'), name: str('Adında aranacak metin (isteğe bağlı)'), limit: num('En fazla kaç kayıt (varsayılan 200)') }, required: [] },
  oracle_describe_table: { service: 'oracle', fn: 'describeTable', description: 'Oracle tablosunun kolonlarını tür, zorunluluk ve kolon açıklamalarıyla (comment) getirir.', properties: { table: str('Tablo adı'), schema: str('Şema adı (isteğe bağlı)') }, required: ['table'] },
  postgres_query: { service: 'postgres', fn: 'query', description: 'PostgreSQL veritabanında YALNIZCA OKUMA sorgusu çalıştırır (salt okunur işlem içinde, 30 sn sınırı). Önce postgres_list_tables / postgres_describe_table ile tablo ve kolonları öğrenin. Canlı veri kişisel bilgi içerebilir; gerekmedikçe kişisel kolonları seçmeyin ve yanıtta yalnızca gerekeni aktarın.', properties: { sql: str('Yalnızca SELECT ya da WITH ... SELECT sorgusu (tek ifade). Değişiklik yapan ifadeler reddedilir.'), limit: num('En fazla kaç satır (varsayılan 100, en çok 1000)') }, required: ['sql'] },
  postgres_list_tables: { service: 'postgres', fn: 'listTables', description: 'PostgreSQL veritabanındaki tablo ve görünümleri (sistem şemaları hariç) listeler.', properties: { schema: str('Şema adı (isteğe bağlı)'), name: str('Adında aranacak metin (isteğe bağlı)'), limit: num('En fazla kaç kayıt (varsayılan 200)') }, required: [] },
  postgres_describe_table: { service: 'postgres', fn: 'describeTable', description: 'PostgreSQL tablosunun kolonlarını tür, zorunluluk ve kolon açıklamalarıyla getirir.', properties: { table: str('Tablo adı'), schema: str('Şema adı (isteğe bağlı)') }, required: ['table'] },
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

/**
 * Tek seferlik çalışma (--once): standart girdiden tek bir istek okunur, sonuç tek satır JSON olarak yazılır ve süreç biter.
 * { op: 'whoami', service } -> { ok, user } | { ok: false, error };  { op: 'call', name, args } -> araç sonucu.
 * Atölye sunucusu Oracle işlemlerini bununla ayrı bir süreçte çalıştırır (bkz. integrations.js oneShot).
 */
export async function runOnce(m, env = process.env) {
  if (m?.op === 'whoami') {
    const cfg = SERVICES.includes(m.service) ? configFromEnv(m.service, env) : null;
    if (!cfg) return { ok: false, error: 'not-configured' };
    try { return { ok: true, user: await clients[m.service].whoami(cfg) }; } catch (err) { return { ok: false, error: err.message }; }
  }
  if (m?.op === 'call') return callTool(String(m.name || ''), m.args && typeof m.args === 'object' ? m.args : {}, env);
  return { ok: false, isError: true, error: 'Bilinmeyen işlem', content: [{ type: 'text', text: 'Bilinmeyen işlem' }] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--once')) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', async () => {
    let out;
    try { out = await runOnce(JSON.parse(raw)); } catch (err) { out = { ok: false, isError: true, error: err.message, content: [{ type: 'text', text: err.message }] }; }
    process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));
  });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
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
