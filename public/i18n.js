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
  'Harcama ve bütçe (ayrıntı için tıklayın)': 'Spend and budget (click for details)',
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
