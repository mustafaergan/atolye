// Dil desteği (Türkçe / İngilizce). Arayüz metinleri Türkçe yazılır ve anahtar olarak
// kullanılır; İngilizce karşılıkları aşağıdaki sözlüktedir. Çevirisi olmayan metin
// olduğu gibi (Türkçe) gösterilir. {ad} biçimindeki yer tutucular t(metin, { ad }) ile doldurulur.

export const EN = {
  // Genel
  'Kopyala': 'Copy',
  'Kopyalandı': 'Copied',
  'şimdi': 'now',
  '{n} dk': '{n}m',
  '{n} sa': '{n}h',
  '{n} g': '{n}d',
  '[görsel]': '[image]',
  'Bağlanıyor': 'Connecting',
  'Bağlı': 'Connected',
  'Bağlantı koptu': 'Disconnected',
  'Sunucuya bağlı değil. Yeniden bağlanılıyor…': 'Not connected to the server. Reconnecting…',
  'Çalışıyor…': 'Working…',
  'Konuşma özetlendi (compact). Eski mesajlar bağlamdan çıkarıldı.': 'Conversation compacted. Older messages were removed from the context.',
  'Gateway yanıt vermedi, yeniden deneniyor ({n}. deneme)…': 'Gateway did not respond, retrying (attempt {n})…',
  'Konuşma özetleniyor…': 'Compacting conversation…',
  'Düşünüyor': 'Thinking',
  "Kimlik doğrulama başarısız. Şirket gateway token'ını (ANTHROPIC_AUTH_TOKEN) ~/.claude/settings.json ya da .env içinde kontrol edin.":
    'Authentication failed. Check the gateway token (ANTHROPIC_AUTH_TOKEN) in ~/.claude/settings.json or .env.',
  'Ek görsel': 'Attached image',
  'Tur sınırına ulaşıldı': 'Turn limit reached',
  'Bütçe sınırına ulaşıldı': 'Budget limit reached',
  'Bir hata oluştu': 'An error occurred',
  'Durduruldu': 'Stopped',
  '{n} sn': '{n}s',
  '{n} tur': '{n} turns',
  'oturum ≈ ${n}': 'session ≈ ${n}',
  'Oturum': 'Session',
  'Yeni oturum': 'New session',

  // Bağlam ve metrikler
  'Bağlam: {used} / {max} token (ayrıntı için tıklayın)': 'Context: {used} / {max} tokens (click for details)',
  '{used} / {max} token': '{used} / {max} tokens',
  'Otomatik özetleme {n} token civarında devreye girer.': 'Auto-compact kicks in around {n} tokens.',
  'Bağlam dolmak üzere; "Özetle" ile yer açabilirsiniz.': 'Context is almost full; use "Compact" to free up space.',
  'CLAUDE.md ve bellek dosyaları': 'CLAUDE.md and memory files',
  'MCP sunucuları': 'MCP servers',
  '{name} ({n} araç)': '{name} ({n} tools)',
  'Mesajların dağılımı': 'Message breakdown',
  'Araç sonuçları': 'Tool results',
  'Araç çağrıları': 'Tool calls',
  "Claude'un mesajları": "Claude's messages",
  'Sizin mesajlarınız': 'Your messages',
  'Ekler': 'Attachments',
  'En çok yer tutan araçlar': 'Largest tools',
  'Giriş': 'Input',
  'Çıkış': 'Output',
  'Önbellekten okunan': 'Cache read',
  'Önbelleğe yazılan': 'Cache write',
  'Tur': 'Turns',
  'Süre': 'Duration',
  'Tahmini maliyet': 'Estimated cost',
  'Web araması': 'Web search',
  '{m} dk {s} sn': '{m}m {s}s',
  '{h} sa {m} dk': '{h}h {m}m',

  // Araç kartları
  'Okundu': 'Read',
  'Yazıldı': 'Write',
  'Düzenlendi': 'Edit',
  'Komut': 'Command',
  'Arama': 'Search',
  'Dosya arama': 'Find files',
  'Web': 'Web',
  'Yapılacaklar': 'To-dos',
  'Alt ajan': 'Subagent',
  'Plan': 'Plan',
  'Not defteri': 'Notebook',
  '{done}/{total} tamamlandı': '{done}/{total} done',
  'Görev': 'Task',
  'Hata': 'Error',
  'Çıktı': 'Output',

  // İzin ve soru kartları
  'Plan hazır. Uygulamaya geçilsin mi?': 'The plan is ready. Proceed with implementation?',
  'Onayla, düzenlemeleri otomatik kabul et': 'Approve and auto-accept edits',
  'Onayla, her adımda sor': 'Approve, ask at each step',
  'Planlamaya devam et': 'Keep planning',
  'Kullanıcı planı henüz onaylamadı; planlamaya devam et.': 'The user has not approved the plan yet; keep planning.',
  '{tool} için izin gerekiyor': 'Permission required: {tool}',
  "Reddederken Claude'a ne yapmasını istediğinizi yazın (isteğe bağlı)": 'When denying, tell Claude what to do instead (optional)',
  'Erişilmek istenen yol: {path}': 'Requested path: {path}',
  'İzin ver': 'Allow',
  'Reddet': 'Deny',
  'Enter izin ver · Esc reddet': 'Enter allow · Esc deny',
  'Bu oturumda hep izin ver': 'Always allow in this session',
  'Bu oturumda tüm komutlara izin ver': 'Allow all commands in this session',
  'Bu oturumda tüm düzenlemelere izin ver': 'Allow all edits in this session',
  'Diğer…': 'Other…',
  'Soru': 'Question',
  'Claude bir şey soruyor': 'Claude has a question',
  'Cevapla': 'Answer',
  'Atla': 'Skip',
  'Kullanıcı soruyu cevaplamadı.': 'The user did not answer the question.',
  'Bu oturum boyunca izin verildi': 'Allowed for this session',
  'İzin verildi': 'Allowed',
  'Reddedildi': 'Denied',
  'İptal edildi': 'Cancelled',

  // Mesaj kutusu
  'Durdur (Esc)': 'Stop (Esc)',
  'Gönder': 'Send',
  'Varsayılan model': 'Default model',
  'İzinleri atla modunda Claude dosya düzenleme ve komut çalıştırma işlemlerini SORMADAN yapar. Emin misiniz?':
    'In bypass mode Claude edits files and runs commands WITHOUT asking. Are you sure?',
  'Bu görsele bak.': 'Look at this image.',
  "{name} 5 MB'tan büyük, eklenmedi.": '{name} is larger than 5 MB and was not attached.',
  'Kaldır': 'Remove',
  'Yeni oturum başlat': 'Start a new session',

  // Projeler ve oturum listesi
  'Klasörsüz sohbet': 'No-folder chat',
  'Klasörsüz': 'No folder',
  '{folder} klasöründe çalışan {n} oturum var. Yine de listeden kaldırılsın mı? (Çalışmaya devam ederler.)':
    '{folder} has {n} running session(s). Remove it from the list anyway? (They keep running.)',
  'Liste alınamadı': 'Could not load the list',
  '{folder} oturumları yüklenemedi: {error}': 'Could not load sessions for {folder}: {error}',
  'Onayınızı bekliyor': 'Waiting for your approval',
  'onay': 'approve',
  'Çalışıyor': 'Running',
  'Yeniden adlandır': 'Rename',
  'Sil': 'Delete',
  '{dir}\nSeçmek için tıklayın': '{dir}\nClick to select',
  'Aç': 'Expand',
  'Kapat': 'Collapse',
  '{n} oturum çalışıyor': '{n} session(s) running',
  '{project} içinde yeni oturum': 'New session in {project}',
  'Projeyi listeden kaldır': 'Remove project from list',
  'Henüz oturum yok': 'No sessions yet',
  'Yükleniyor…': 'Loading…',
  'Daha az göster': 'Show less',
  '{n} oturum daha': '{n} more',
  'Oturumun yeni adı:': 'New session name:',
  '"{title}" oturumu kalıcı olarak silinsin mi?': 'Permanently delete the session "{title}"?',
  'Oturum açılıyor…': 'Opening session…',
  'Projeye bağlı olmayan yeni oturum': 'New session not tied to a project',
  '{dir} içinde yeni oturum aç': 'New session in {dir}',
  'Klasörsüz sohbet · proje bağlamı yok': 'No-folder chat · no project context',

  // Boş ekran
  'Ne üzerinde çalışalım?': 'What shall we work on?',
  'Kodunuzu okuyabilir, düzenleyebilir ve komut çalıştırabilirim. Değişiklik yapmadan önce izninizi isterim.':
    'I can read and edit your code and run commands. I ask for your permission before making changes.',
  'Projeyi özetle': 'Summarize the project',
  'Bu projenin yapısını incele ve kısaca özetle.': "Explore this project's structure and summarize it briefly.",
  'Testleri çalıştır': 'Run the tests',
  'Projedeki testleri çalıştır ve hata varsa düzelt.': 'Run the tests in this project and fix any failures.',
  'Kodu incele': 'Review the code',
  'Son değişiklikleri incele ve olası hataları bul.': 'Review the recent changes and look for possible bugs.',
  'Ne sormak istersiniz?': 'What would you like to ask?',
  'Bu sohbet bir projeye bağlı değil. Genel sorular sorabilir, ağ ya da sistem sorunlarını birlikte teşhis edebiliriz; gerekirse izninizle komut çalıştırırım.':
    'This chat is not tied to a project. Ask general questions or let us diagnose network or system issues together; I can run commands with your permission.',
  'Ağ bağlantımı kontrol et': 'Check my network',
  'Ağ bağlantımı kontrol et: DNS, varsayılan ağ geçidi, proxy ayarları ve internete erişimi test et; sorun varsa açıkla.':
    'Check my network connection: test DNS, the default gateway, proxy settings and internet access; explain any problems.',
  'Bir hatayı açıkla': 'Explain an error',
  'Şu hata mesajını açıklar mısın, olası sebepleri ve çözümleri neler?\n\n': 'Can you explain this error message, its likely causes and fixes?\n\n',
  'Komut yaz': 'Write a command',
  'Şu iş için bir PowerShell komutu yaz: ': 'Write a PowerShell command for this task: ',

  // Harcama
  'Güncelleniyor…': 'Updating…',
  'Harcama alınamadı': 'Could not load spend',
  'Harcama': 'Spend',
  'Claude Code harcama': 'Claude Code spend',
  'Son güncelleme: {time}': 'Last updated: {time}',
  'Bilinmeyen hata': 'Unknown error',
  'Gateway: {host}': 'Gateway: {host}',
  'Gateway: Claude Code ayarlarından': 'Gateway: from Claude Code settings',

  // Sayfadaki sabit metinler (index.html)
  'Tema değiştir': 'Toggle theme',
  'Projeler': 'Projects',
  'Proje klasörü ekle': 'Add project folder',
  'Klasör ekle': 'Add folder',
  'Projeler ve oturumlar': 'Projects and sessions',
  'Menü': 'Menu',
  'Claude harcaması ve bütçesi (ayrıntı için tıklayın)': 'Claude spend and budget (click for details)',
  'Yenile': 'Refresh',
  'Bağlantı durumu': 'Connection status',
  'Bağlam': 'Context',
  'Bu oturum': 'This session',
  '(Atölye açtığından beri)': '(since Atölye opened it)',
  'Konuşmayı özetleyip bağlamı boşaltır': 'Summarizes the conversation to free up context',
  'Özetle (/compact)': 'Compact (/compact)',
  'Bir şey sorun ya da görev verin…  ( / komutlar, @ dosyalar )': 'Ask anything or give a task…  ( / commands, @ files )',
  'Görsel ekle': 'Attach image',
  'İzin modu (Shift+Tab)': 'Permission mode (Shift+Tab)',
  'İzin modu': 'Permission mode',
  'Her işlemde sor': 'Ask every time',
  'Düzenlemeleri kabul et': 'Accept edits',
  'Plan modu': 'Plan mode',
  'İzinleri atla': 'Bypass permissions',
  'Model': 'Model',
  'Enter gönder · Shift+Enter yeni satır': 'Enter to send · Shift+Enter for new line',
  'Bağlam kullanımı (ayrıntı için tıklayın)': 'Context usage (click for details)',
  'Klasör yolu': 'Folder path',
  'Git': 'Go',
  'Vazgeç': 'Cancel',
  'Ekle ve yeni oturum aç': 'Add and start a session',
  'Dil': 'Language',
  'Pencereyi kapat': 'Close',
  'Oturum açılamadı: sunucudan cevap gelmedi.': 'The session could not be opened: no response from the server.',
  'Tekrar dene': 'Try again',
  'Yeni oturumların çalışacağı yapay zekâ motoru': 'AI engine for new sessions',
  'Yapay zekâ motoru': 'AI engine',
  'GitHub Copilot (kurulu değil)': 'GitHub Copilot (not installed)',
  'Bağlantılar': 'Connections',
  'İlk repom': 'My first repo',
  '{name} bağlantısını kurma': 'setting up the {name} connection',
  'Jira bağlantısını kurmak istiyorum ama teknik biri değilim. Jira adresimi nereden bulurum ve kişisel erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.':
    'I want to set up the Jira connection but I am not a technical person. Where do I find my Jira address and how do I create a personal access token (API key)? Explain step by step in plain language; I will ask when I get stuck.',
  'Confluence bağlantısını kurmak istiyorum ama teknik biri değilim. Confluence adresimi nereden bulurum ve kişisel erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.':
    'I want to set up the Confluence connection but I am not a technical person. Where do I find my Confluence address and how do I create a personal access token (API key)? Explain step by step in plain language; I will ask when I get stuck.',
  'Bitbucket bağlantısını kurmak istiyorum ama teknik biri değilim. Bitbucket adresimi nereden bulurum ve HTTP erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.':
    'I want to set up the Bitbucket connection but I am not a technical person. Where do I find my Bitbucket address and how do I create an HTTP access token (API key)? Explain step by step in plain language; I will ask when I get stuck.',
  'İlk kez bir depoyu (repository) bilgisayarıma indireceğim ve teknik biri değilim. Depo nedir, adresini nereden bulurum, indirdikten sonra dosyalara nasıl bakarım ve değişiklikleri nasıl güncel tutarım? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.':
    'I am about to download a repository to my computer for the first time and I am not a technical person. What is a repository, where do I find its address, how do I look at the files afterwards and how do I keep them up to date? Explain step by step in plain language; I will ask when I get stuck.',
  'Yapay zekâdan yardım al': 'Get help from AI',
  'Hazır bir soruyla yeni bir sohbet açar; göndermeden önce düzenleyebilirsiniz': 'Opens a new chat with a prepared question; you can edit it before sending',
  'Bu hatayı yapay zekâya sor': 'Ask AI about this error',
  '{what} sırasında şu hatayı aldım, teknik biri değilim. Sebebi ne olabilir ve nasıl düzeltirim? Adım adım anlat.\n\nHata: {error}':
    'I got the following error during: {what}. I am not a technical person. What could be the cause and how do I fix it? Explain step by step.\n\nError: {error}',
  'proje anahtarı (isteğe bağlı), ör. ABC': 'project key (optional), e.g. ABC',
  'Depo seçin ({n} depo)': 'Choose a repository ({n} repositories)',
  'Önce "Depoları listele" deyin': 'Click "List repositories" first',
  'Depoları listele': 'List repositories',
  'Depo listesini alma': 'listing the repositories',
  "Bağlı Bitbucket'tan seçin": 'Choose from the connected Bitbucket',
  'Depoyu indir': 'Download repository',
  'Depo indiriliyor… Büyük depolarda birkaç dakika sürebilir.': 'Downloading the repository… Large repositories can take a few minutes.',
  'Bu depoyu yeni indirdim ve teknik biri değilim. Ne işe yaradığını, klasör yapısını ve nereden başlamam gerektiğini sade bir dille özetle.':
    'I have just downloaded this repository and I am not a technical person. Summarize in plain language what it does, how its folders are organized and where I should start.',
  'Depo indirme': 'downloading the repository',
  'Depo (repository), bir projenin dosyalarının ve değişiklik geçmişinin tutulduğu yerdir. "İndirmek" (clone), onun bir kopyasını bilgisayarınıza alır; asıl depoya dokunmaz.':
    'A repository is where a project\'s files and change history are kept. "Downloading" (cloning) puts a copy of it on your computer; it does not touch the original.',
  'Aşağıdan depoyu seçin ya da depo sayfasındaki "Clone" (Kopyala) düğmesinden HTTPS adresini kopyalayıp yapıştırın.':
    'Choose the repository below, or copy the HTTPS address from the "Clone" button on the repository page and paste it.',
  'Depo sayfasındaki "Clone" (Kopyala) düğmesinden HTTPS adresini kopyalayıp aşağıya yapıştırın. Bitbucket sekmesinden bağlantı kurarsanız depolar burada listelenir ve giriş otomatik yapılır.':
    'Copy the HTTPS address from the "Clone" button on the repository page and paste it below. If you connect Bitbucket in its tab, repositories are listed here and sign-in is automatic.',
  '"Depoyu indir" deyin: depo aşağıdaki klasöre iner, solda proje olarak eklenir ve o klasörde yeni bir oturum açılır.':
    'Click "Download repository": it is downloaded into the folder below, added as a project on the left, and a new session opens in that folder.',
  "Git kurulu değil. Depo indirmek için gerekir; şu adresten kurup Atölye'yi yeniden başlatın:": 'Git is not installed. It is needed to download repositories; install it from this address and restart Atölye:',
  'Depo adresi': 'Repository address',
  'İndirileceği klasör': 'Download folder',
  'Depo bu klasörün içinde kendi adıyla bir alt klasöre iner.': 'The repository goes into a subfolder with its own name inside this folder.',
  'Olmadı: {error}': 'It did not work: {error}',
  'İndirme, bilgisayarınızdaki Git ile yapılır. Bitbucket bağlıysa kayıtlı API anahtarı yalnızca bu indirme için kullanılır; sonraki çekme/gönderme işlemlerinde Git kendi giriş penceresini açabilir.':
    'The download is done with the Git on your computer. If Bitbucket is connected, the saved API key is used only for this download; later pulls and pushes may make Git open its own sign-in window.',
  'Güncelleme var': 'Update available',
  'Şimdi güncelle': 'Update now',
  'Not: şirketinizin Copilot politikası üçüncü taraf MCP sunucularını kapatmışsa bu araçlar yalnızca Claude Code oturumlarında kullanılabilir.': 'Note: if your organization\'s Copilot policy disables third-party MCP servers, these tools are only available in Claude Code sessions.',
  "Copilot'a bağlanılıyor… Hazır olunca mesajınız gönderilir; bu, şirket ağında bir dakikaya kadar sürebilir.": 'Connecting to Copilot… Your message is sent once it is ready; on a company network this can take up to a minute.',
  '"Şimdi güncelle" son sürümü indirir, kurar ve Atölye\'yi yeniden başlatır. Ayarlarınız ve oturumlarınız korunur.': '"Update now" downloads and installs the latest version and restarts Atölye. Your settings and sessions are kept.',
  'Kayıtlar': 'Logs',
  'Atölye kayıtları': 'Atölye logs',
  "Atölye'nin son çalışma kayıtları: oturum açılışları, süreler, bağlantı ve güncelleme denetimleri, hatalar. Konuşma içeriği ve anahtarlar burada yer almaz.":
    'Recent Atölye activity: session starts, timings, connection and update checks, errors. Conversation content and keys are not included.',
  'Kendiliğinden yenile': 'Auto-refresh',
  'Tümünü kopyala': 'Copy all',
  'Teams için kopyala': 'Copy for Teams',
  'Son satırları, bir Teams mesajına sığacak uzunlukta ve kod bloğu olarak kopyalar': 'Copies the last lines as a code block, short enough to fit in a Teams message',
  '{n} satır · son yenileme {time}': '{n} lines · last refreshed {time}',
  "Atölye'ye ulaşılamadı; çalıştığından emin olun.": 'Could not reach Atölye; make sure it is running.',
  'Atölye {version} kayıtları (son {n} satır)': 'Atölye {version} logs (last {n} lines)',
  'Henüz kayıt yok.': 'No log entries yet.',
  'Kopyalanamadı': 'Could not copy',
  'Güncellemeleri denetle': 'Check for updates',
  'Denetleniyor…': 'Checking…',
  'Güncel (sürüm {current})': 'Up to date (version {current})',
  'Şu an denetlenemedi': 'Could not check right now',
  "Çalışan oturumlar var; güncelleme Atölye'yi yeniden başlatır ve bu işleri yarıda keser. Devam edilsin mi?": 'Some sessions are still working; updating restarts Atölye and interrupts them. Continue?',
  'Güncelleniyor… Atölye birazdan yeniden başlayacak.': 'Updating… Atölye will restart shortly.',
  'Güncelleme tamamlanamadı. Kurulum klasöründe PowerShell ile ".\\atolye.ps1 guncelle" komutunu çalıştırıp çıktıya bakın.': 'The update could not be completed. Run ".\\atolye.ps1 guncelle" with PowerShell in the installation folder and check the output.',
  "Atölye'nin yeni sürümü var (ayrıntı için tıklayın)": 'A new version of Atölye is available (click for details)',
  'Atölye {latest} yayımlandı (kurulu sürüm: {current}).': 'Atölye {latest} has been released (installed version: {current}).',
  'Güncellemek için kurulum klasöründe PowerShell ile şunu çalıştırın:': 'To update, run this with PowerShell in the installation folder:',
  "Güncellemek için yeni paketi indirip içindeki Kur.bat'ı çalıştırın. Ayarlarınız ve oturumlarınız korunur.": 'To update, download the new package and run the Kur.bat inside it. Your settings and sessions are kept.',
  'Güncellemeden sonra bu sayfayı yenileyin.': 'Refresh this page after updating.',
  'optona.tr tarafından yazılmıştır': 'Written by optona.tr',
  'Jira, Confluence ve Bitbucket bağlantıları': 'Jira, Confluence and Bitbucket connections',
  'Jira, Confluence ve Bitbucket bağlantılarını buradan kurun; Claude Code ve Copilot oturumları kayıtları, sayfaları ve çekme isteklerini okuyabilsin. Bağlantı yeni açılan oturumlarda kullanılır.':
    'Set up Jira, Confluence and Bitbucket here so Claude Code and Copilot sessions can read issues, pages and pull requests. A connection is used by sessions opened after it is saved.',
  'Oluşan anahtarı kopyalayıp aşağıya yapıştırın (yalnızca bir kez gösterilir) ve "Kaydet ve sına" deyin.':
    'Copy the generated key (it is shown only once), paste it below and click "Save and test".',
  "Jira'yı tarayıcıda açın ve adres çubuğundaki ana adresi kopyalayın (ör. https://jira.sirket.com ya da https://sirket.atlassian.net).":
    'Open Jira in your browser and copy the base address from the address bar (e.g. https://jira.company.com or https://company.atlassian.net).',
  'Şirket içi Jira (Data Center): sağ üstteki profil resmi → Profil → Kişisel Erişim Belirteçleri (Personal Access Tokens) → Belirteç oluştur. E-posta alanını boş bırakın.':
    'Self-hosted Jira (Data Center): profile picture at the top right → Profile → Personal Access Tokens → Create token. Leave the email field empty.',
  'Jira Cloud (atlassian.net): şu sayfada "API belirteci oluştur" deyin ve e-posta alanına Atlassian hesabınızın e-postasını yazın:':
    'Jira Cloud (atlassian.net): click "Create API token" on this page and enter your Atlassian account email in the email field:',
  'Örnek: "Bana atanmış açık Jira kayıtlarını listele" ya da "ABC-123 kaydını oku ve çözüm öner".':
    'Example: "List the open Jira issues assigned to me" or "Read ABC-123 and suggest a fix".',
  "Confluence'ı tarayıcıda açın ve ana adresi kopyalayın (ör. https://confluence.sirket.com ya da https://sirket.atlassian.net/wiki).":
    'Open Confluence in your browser and copy the base address (e.g. https://confluence.company.com or https://company.atlassian.net/wiki).',
  'Şirket içi Confluence (Data Center): sağ üstteki profil resmi → Ayarlar → Kişisel Erişim Belirteçleri (Personal Access Tokens) → Belirteç oluştur. E-posta alanını boş bırakın.':
    'Self-hosted Confluence (Data Center): profile picture at the top right → Settings → Personal Access Tokens → Create token. Leave the email field empty.',
  'Confluence Cloud: Jira ile aynı API belirteci kullanılır; şu sayfadan oluşturun ve e-posta alanına Atlassian hesabınızın e-postasını yazın:':
    'Confluence Cloud: the same API token as Jira is used; create it on this page and enter your Atlassian account email in the email field:',
  'Örnek: "Confluence içinde kurulum dokümanını bul ve özetle".': 'Example: "Find the installation guide in Confluence and summarize it".',
  "Bitbucket'ı tarayıcıda açın ve ana adresi kopyalayın (ör. https://bitbucket.sirket.com; Cloud için https://bitbucket.org/calisma-alaniniz).":
    'Open Bitbucket in your browser and copy the base address (e.g. https://bitbucket.company.com; for Cloud https://bitbucket.org/your-workspace).',
  'Şirket içi Bitbucket (Data Center): sağ üstteki profil resmi → Hesabı yönet → HTTP erişim belirteçleri (HTTP access tokens) → Belirteç oluştur. Depo için "okuma" izni yeterlidir. E-posta alanını boş bırakın.':
    'Self-hosted Bitbucket (Data Center): profile picture at the top right → Manage account → HTTP access tokens → Create token. Repository "read" permission is enough. Leave the email field empty.',
  'Bitbucket Cloud: şu sayfada "Kapsamlı API belirteci oluştur" deyip Bitbucket ile depo ve çekme isteği okuma izinlerini seçin; e-posta alanına Atlassian hesabınızın e-postasını yazın:':
    'Bitbucket Cloud: click "Create API token with scopes" on this page, choose Bitbucket and the repository and pull request read scopes, and enter your Atlassian account email in the email field:',
  'Örnek: "ABC projesindeki depo-adi deposunun açık çekme isteklerini listele ve 42 numaralıyı incele".':
    'Example: "List the open pull requests of the repo-name repository in project ABC and review number 42".',
  'yalnızca Cloud (atlassian.net / bitbucket.org) için': 'only for Cloud (atlassian.net / bitbucket.org)',
  'kayıtlı (değiştirmek için yenisini yapıştırın)': 'saved (paste a new one to replace it)',
  'API anahtarını yapıştırın': 'Paste the API key',
  'Bağlantı sınanıyor…': 'Testing the connection…',
  'Bağlantı başarılı: {user} olarak giriş yapıldı.': 'Connected: signed in as {user}.',
  'Bağlanılamadı: {error}': 'Could not connect: {error}',
  'Kaydet ve sına': 'Save and test',
  'Bağlantıyı kaldır': 'Remove connection',
  '{name} bağlantısı ve kayıtlı API anahtarı silinsin mi?': 'Delete the {name} connection and its saved API key?',
  'Adres': 'Address',
  'E-posta': 'Email',
  'Şirket içi kurulumda (kişisel erişim belirteci) boş bırakın.': 'Leave empty for a self-hosted installation (personal access token).',
  'API anahtarı': 'API key',
  'Bağlantıyı sına': 'Test connection',
  'Bilgiler yalnızca bu bilgisayarda, Claude Code ve Copilot CLI ayar dosyalarında saklanır: {claude} ve {copilot}. API anahtarı bu dosyalarda düz metin olarak durur; anahtara gereğinden geniş izin vermeyin.':
    'The details are stored only on this computer, in the Claude Code and Copilot CLI settings files: {claude} and {copilot}. The API key is kept there as plain text, so do not give the key more permissions than it needs.',
};

const STORE_KEY = 'atolye:lang';

function detect() {
  if (typeof window === 'undefined') return 'tr'; // testlerde (Node)
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch { /* yoksay */ }
  return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-US' : 'tr-TR');

/** Dili değiştirir; arayüz yeniden kurulsun diye sayfa yenilenir (oturumlar sunucuda sürer). */
export function setLang(next) {
  if (next !== 'tr' && next !== 'en') return;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* yoksay */ }
  location.reload();
}

export function t(key, vars) {
  let s = lang === 'en' ? (EN[key] ?? key) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/**
 * index.html'deki sabit metinleri çevirir:
 *   data-i18n                → içindeki metin
 *   data-i18n-attr="title,…" → adı verilen öznitelikler
 */
export function translatePage(root = document) {
  if (lang === 'tr') return;
  for (const node of root.querySelectorAll('[data-i18n]')) {
    // Sadece metin düğümlerini çevir (içindeki simgeler ve alt öğeler korunsun)
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        const key = child.textContent.trim();
        child.textContent = child.textContent.replace(key, t(key));
      }
    }
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const attr of node.dataset.i18nAttr.split(',')) {
      const v = node.getAttribute(attr.trim());
      if (v) node.setAttribute(attr.trim(), t(v));
    }
  }
}
