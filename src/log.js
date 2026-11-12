// Son kayıt satırlarını bellekte tutar; arayüzdeki "Kayıtlar" penceresi buradan okur.
// Atölye nasıl başlatılmış olursa olsun (kısayol, terminal) çalışır; satırlar ayrıca eskisi gibi konsola da gider.
import util from 'node:util';

const MAX = 500;
const lines = [];

/** Kayıtlara yanlışlıkla düşebilecek anahtarları gizler */
export const mask = (s) => String(s)
  .replace(/(\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1***@')
  .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
  .replace(/((?:token|api[_-]?key|authorization|password|secret)["']?\s*[:=]\s*["']?)(?!Bearer|Basic|\*\*\*)[^\s"',;]{6,}/gi, '$1***');

export function record(level, args) {
  const text = mask(util.format(...args)).replace(/\s+$/, '');
  if (!text) return;
  const stamp = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  for (const l of text.split(/\r?\n/)) lines.push(`${stamp} ${level === 'error' ? 'HATA ' : level === 'warn' ? 'UYARI ' : ''}${l}`);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

let installed = false;
export function installLogCapture() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { try { record(level, args); } catch { /* kayıt asla uygulamayı düşürmesin */ } original(...args); };
  }
}

export const recentLog = (n = MAX) => lines.slice(-Math.min(Math.max(Number(n) || MAX, 1), MAX));

/**
 * Son güncelleme denemesinin çıktısını (atolye-guncelle.log; arayüzden başlatılan güncelleme gizli pencerede
 * çalışır) kayıtlara ekler. Böylece güncelleme yarıda kaldıysa sebebi Kayıtlar sayfasında görünür.
 */
export function recordUpdateLog(file, readFile) {
  let raw;
  try { raw = readFile(file); } catch { return 0; }
  // PowerShell kaydı UTF-16 ya da UTF-8 olabilir
  let text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\*+$/.test(l) && !/^(Windows PowerShell transcript|Transcript started|Start time|End time|Username|RunAs User|Configuration Name|Machine|Host Application|Process ID|PS\w*Version|PSEdition|PSCompatibleVersions|BuildVersion|CLRVersion|WSManStackVersion|PSRemotingProtocolVersion|SerializationVersion)\b/i.test(l));
  const tail = lines.slice(-25);
  for (const l of tail) record('log', [`[güncelleme kaydı] ${l}`]);
  return tail.length;
}
