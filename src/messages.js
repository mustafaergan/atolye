// Sunucudan arayüze (ve Claude'a reddetme sebebi olarak) giden mesajlar.
// Türkçe metin anahtardır; İngilizce karşılığı aşağıdadır (bkz. public/i18n.js).
export const EN = {
  'Adsız oturum': 'Untitled session',
  'Klasör bulunamadı: {dir}': 'Folder not found: {dir}',
  'Aktif oturum yok': 'No active session',
  'Oturum kapandı, yeniden açın': 'The session was closed, please reopen it',
  'Oturum kapandı': 'Session closed',
  'Oturum kapalı': 'Session is closed',
  'Kullanıcı durdurdu': 'Stopped by the user',
  'Kullanıcı reddetti': 'Denied by the user',
  'İptal edildi': 'Cancelled',
  'Görsel': 'Image',
  'Claude Code çalıştırılamadı: {error}': 'Could not start Claude Code: {error}',
  'Kimlik doğrulama hatası. ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY değerini kontrol edin. ({error})':
    'Authentication error. Check ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY. ({error})',
  "Gateway'e bağlanılamadı. ANTHROPIC_BASE_URL, HTTPS_PROXY ve NODE_EXTRA_CA_CERTS ayarlarını kontrol edin. ({error})":
    'Could not reach the gateway. Check ANTHROPIC_BASE_URL, HTTPS_PROXY and NODE_EXTRA_CA_CERTS. ({error})',
  'İstek başarısız': 'Request failed',
  "Model değiştirilemedi: Claude Code '{model}' modelini doğrulamak için gateway'e ulaşamadı. Bağlantı anlık kesilmiş ya da bu model gateway'de tanımlı olmayabilir. Önceki modelle devam ediliyor. ({error})":
    "Could not change the model: Claude Code could not reach the gateway to validate '{model}'. The connection may have dropped for a moment, or this model may not be available on the gateway. Continuing with the previous model. ({error})",
  "Model değiştirilemedi: '{model}' bu bağlantıda kullanılamıyor. Önceki modelle devam ediliyor. ({error})":
    "Could not change the model: '{model}' cannot be used on this connection. Continuing with the previous model. ({error})",
  'GitHub Copilot CLI bulunamadı. Kurmak için: npm install -g @github/copilot ({error})':
    'GitHub Copilot CLI was not found. To install: npm install -g @github/copilot ({error})',
  "Copilot'a giriş yapılmamış. Bir terminalde 'copilot login' çalıştırıp tarayıcıdan giriş yapın, sonra yeni bir Copilot oturumu açın. ({error})":
    "Not signed in to Copilot. Run 'copilot login' in a terminal, sign in in the browser, then start a new Copilot session. ({error})",
  "GitHub hesabınızın Copilot kullanma yetkisi yok (lisans tanımlı değil ya da yanlış hesapla giriş yapılmış). Bir terminalde 'copilot login' ile Copilot lisansı olan hesabınızla giriş yapın. ({error})":
    "Your GitHub account is not allowed to use Copilot (no license assigned, or signed in with the wrong account). Run 'copilot login' in a terminal and sign in with the account that has a Copilot license. ({error})",
  "Copilot, GitHub sunucularına ulaşamadı (zaman aşımı). Şirket ağı ya da proxy engelliyor olabilir: bir terminalde 'copilot' çalıştırıp aynı sorunun orada da olup olmadığına bakın; proxy gerekiyorsa Atölye'nin .env dosyasına HTTPS_PROXY ekleyip Atölye'yi yeniden başlatın. ({error})":
    "Copilot could not reach the GitHub servers (timed out). The company network or proxy may be blocking it: run 'copilot' in a terminal and see whether the same problem occurs there; if a proxy is required, add HTTPS_PROXY to Atölye's .env file and restart Atölye. ({error})",
  'Copilot bu oturumu artık bulamıyor; önceki konuşma ekranda duruyor ama yeni mesajlarınız yeni bir Copilot oturumuyla devam edecek.':
    'Copilot can no longer find this session; the earlier conversation stays on screen, but your new messages will continue in a new Copilot session.',
  'Copilot CLI beklenmedik şekilde kapandı': 'Copilot CLI exited unexpectedly',
  'Bu Copilot sürümü eski oturumu yüklemeyi desteklemiyor; yeni bir oturum açıldı.':
    'This Copilot version cannot load the previous session; a new session was started.',
  'Copilot durdu: {reason}': 'Copilot stopped: {reason}',
  'Oturum yanıt vermiyordu ve kapatıldı. Listeden yeniden açabilirsiniz.': 'The session was not responding and was closed. You can reopen it from the list.',
  'Geçerli bir adres girin (https://… ile başlamalı)': 'Enter a valid address (it must start with https://…)',
  'API anahtarı gerekli': 'An API key is required',
  'Bağlantı bilgileri eksik': 'The connection details are incomplete',
  'Geçersiz tarayıcı seçimi': 'Invalid browser choice',
  'Önce Playwright MCP kurulmalı': 'Playwright MCP must be installed first',
  'Geçerli bir proxy adresi girin (ör. proxy.sirket.com:8080)': 'Enter a valid proxy address (e.g. proxy.company.com:8080)',
  'Proxy kullanıcı adını ya da parolayı kabul etmedi (407).': 'The proxy rejected the username or password (407).',
  'Proxy sunucusuna ulaşılamadı; adresi ve portu kontrol edin.': 'Could not reach the proxy server; check the address and port.',
  'Proxy cevap vermedi (zaman aşımı).': 'The proxy did not respond (timed out).',
  'Proxy ayarı yok.': 'No proxy is configured.',
  "Proxy GitHub'a bağlanmayı reddetti (HTTP {status}).": 'The proxy refused the connection to GitHub (HTTP {status}).',
  'Geçerli bir depo adresi girin (ör. https://…/depo-adi.git)': 'Enter a valid repository address (e.g. https://…/repo-name.git)',
  "Git kurulu değil. https://git-scm.com adresinden kurup Atölye'yi yeniden başlatın.": 'Git is not installed. Install it from https://git-scm.com and restart Atölye.',
  'Bu klasör zaten var: {dir}. Depo daha önce indirilmiş olabilir; soldan "Klasör ekle" ile açabilirsiniz.':
    'This folder already exists: {dir}. The repository may have been downloaded before; you can open it with "Add folder" on the left.',
  'Cevap JSON olarak okunamadı': 'The response could not be parsed as JSON',
  'Beklenmeyen cevap biçimi ({ items: [...] } bekleniyordu)': 'Unexpected response format (expected { items: [...] })',
};

export const normalizeLang = (lang) => (lang === 'en' ? 'en' : 'tr');

export function msg(lang, key, vars) {
  let s = normalizeLang(lang) === 'en' ? (EN[key] ?? key) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
