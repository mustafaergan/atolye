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
  'Cevap JSON olarak okunamadı': 'The response could not be parsed as JSON',
  'Beklenmeyen cevap biçimi ({ items: [...] } bekleniyordu)': 'Unexpected response format (expected { items: [...] })',
};

export const normalizeLang = (lang) => (lang === 'en' ? 'en' : 'tr');

export function msg(lang, key, vars) {
  let s = normalizeLang(lang) === 'en' ? (EN[key] ?? key) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
