// Dosya ekleri (görsel dışındakiler): CSV, Excel, metin, JSON, PDF... Dosya bu bilgisayarda ~/.atolye/ekler altına
// kaydedilir; metne çevrilebilenlerin başı mesaja eklenir, tamamı için yapay zekâya dosyanın yolu verilir (kendi
// araçlarıyla okuyabilir). Excel (.xlsx) dosyaları ek bir kütüphane olmadan sayfa sayfa CSV'ye çevrilir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED = 80 * 1024 * 1024; // sıkıştırılmış bomba dosyalara karşı
const PREVIEW_PER_FILE = 30_000; // mesaja eklenen karakter (dosya başına)
const PREVIEW_TOTAL = 60_000;
const KEEP_DAYS = 30;

const TEXT_EXT = new Set(['csv', 'tsv', 'txt', 'md', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log', 'sql', 'html', 'htm', 'ini', 'properties', 'conf', 'env',
  'js', 'mjs', 'ts', 'tsx', 'jsx', 'java', 'py', 'cs', 'go', 'rb', 'php', 'kt', 'c', 'h', 'cpp', 'css', 'sh', 'ps1', 'bat', 'gradle', 'toml', 'rtf', 'har']);
const SHEET_EXT = new Set(['xlsx', 'xlsm']);

export const attachDir = () => path.join(os.homedir(), '.atolye', 'ekler');
const ext = (name) => path.extname(name).slice(1).toLowerCase();
const safeName = (name) => String(name || 'dosya').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'dosya';

// ---------- zip (xlsx bir zip arşividir) ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip değil');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error('dosya açıldığında çok büyük');
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED })).toString('utf8');
    });
  }
  return files;
}

// ---------- xlsx ----------
const unesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (m, e) => (
  { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e] ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const attr = (tag, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
const texts = (xml) => [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code) => /[dmyhs]/i.test(String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));

/** styles.xml: hangi hücre biçimleri tarih? (dizin: hücredeki s="..." değeri) */
function dateStyles(xml) {
  if (!xml) return [];
  const custom = new Map([...xml.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), unesc(attr(m[0], 'formatCode') || '')]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] || '';
  return [...xfs.matchAll(/<xf\s[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') || 0);
    return custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATE.has(id);
  });
}

function serialToDate(serial, date1904) {
  const ms = Math.round((serial - (date1904 ? 24107 : 25569)) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  if (serial < 1) return iso.slice(11, 19);
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

const colIndex = (ref) => { let n = 0; for (const ch of ref) { if (ch < 'A' || ch > 'Z') break; n = n * 26 + ch.charCodeAt(0) - 64; } return n - 1; };
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function sheetToCsv(xml, shared, dates, date1904) {
  const lines = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    for (const c of (row[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = attr(c[1], 't');
      const body = c[2] || '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 'inlineStr') value = texts(body);
      else if (raw === undefined) value = '';
      else if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = unesc(raw);
      else if (dates[Number(attr(c[1], 's') || -1)] && raw !== '' && !Number.isNaN(Number(raw))) value = serialToDate(Number(raw), date1904);
      else value = raw;
      const at = colIndex(attr(c[1], 'r') || '');
      cells[at >= 0 ? at : cells.length] = value;
    }
    const at = Number(attr(row[0].slice(0, row[0].indexOf('>') + 1), 'r')) - 1;
    const line = Array.from(cells, (v) => csvCell(v ?? '')).join(',');
    if (at >= lines.length && at < lines.length + 10_000) while (lines.length < at) lines.push('');
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1].replace(/,/g, '')) lines.pop();
  return lines;
}

/** .xlsx / .xlsm → [{ name, rows, csv }] */
export function xlsxSheets(buf) {
  const zip = unzip(buf);
  const read = (name) => zip.get(name)?.() || '';
  const wb = read('xl/workbook.xml');
  if (!wb) throw new Error('Excel çalışma kitabı bulunamadı');
  const rels = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => texts(m[1] || ''));
  const dates = dateStyles(read('xl/styles.xml'));
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(wb);
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id')) || '';
    const file = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (!/worksheets\//.test(file)) continue; // grafik sayfaları atlanır
    const lines = sheetToCsv(read(file), shared, dates, date1904);
    sheets.push({ name: unesc(attr(m[0], 'name') || `Sayfa${sheets.length + 1}`), rows: lines.length, csv: lines.join('\n') });
  }
  return sheets;
}

// ---------- metin ----------
/** UTF-8 değilse (Excel'in Türkçe Windows'ta kaydettiği CSV'ler gibi) Windows-1254 olarak okunur */
export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('windows-1254').decode(buf); } catch { return buf.toString('latin1'); }
  }
}
const looksText = (buf) => { const head = buf.subarray(0, 4000); return !head.includes(0) || (head[0] === 0xff && head[1] === 0xfe); };

// ---------- kaydetme ----------
function cleanOld(dir) {
  try {
    const limit = Date.now() - KEEP_DAYS * 86_400_000;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory() && /^\d{8}-\d{6}-/.test(d.name) && fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* yoksay */ }
}

/**
 * files: [{ name, data (base64) }] → [{ name, size, path, kind, parts: [{ label, path, text }], note }]
 * kind: 'text' | 'sheet' | 'binary'. Hatalı bir dosya ötekileri engellemez (note alanında nedeni yazar).
 */
export function saveAttachments(files, { dir = attachDir(), now = new Date() } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.data === 'string').slice(0, 10);
  if (!list.length) return [];
  cleanOld(dir);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const folder = path.join(dir, `${stamp}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(folder, { recursive: true });
  const used = new Set();
  const unique = (name) => { let n = name; for (let i = 2; used.has(n.toLowerCase()); i++) n = `${path.parse(name).name}-${i}${path.extname(name)}`; used.add(n.toLowerCase()); return n; };
  return list.map((f) => {
    const name = unique(safeName(f.name));
    const buf = Buffer.from(f.data, 'base64');
    const out = { name, size: buf.length, path: path.join(folder, name), kind: 'binary', parts: [], note: '' };
    if (buf.length > MAX_FILE_BYTES) return { ...out, path: '', note: 'too_big' };
    fs.writeFileSync(out.path, buf);
    const e = ext(name);
    try {
      if (SHEET_EXT.has(e)) {
        out.kind = 'sheet';
        for (const s of xlsxSheets(buf)) {
          const p = path.join(folder, unique(`${path.parse(name).name}.${safeName(s.name)}.csv`));
          fs.writeFileSync(p, `﻿${s.csv}`);
          out.parts.push({ label: s.name, rows: s.rows, path: p, text: s.csv });
        }
      } else if (e === 'xls') {
        out.note = 'old_xls';
      } else if (TEXT_EXT.has(e) || (!['pdf', 'docx', 'pptx', 'zip', 'ods'].includes(e) && looksText(buf))) {
        out.kind = 'text';
        out.parts.push({ label: '', path: out.path, text: decodeText(buf) });
      }
    } catch (err) {
      out.note = `unreadable:${err.message}`;
    }
    return out;
  });
}

/** Yapay zekâya giden mesaja eklenecek bölüm: dosya yolları ve içeriğin başı */
export function attachmentPrompt(saved, lang = 'tr') {
  if (!saved.length) return '';
  const tr = lang !== 'en';
  const out = [tr
    ? '[Ekli dosyalar: kullanıcı bu dosyaları ekledi, Atölye bu bilgisayara kaydetti. Aşağıda içeriklerin başı var; bir dosyanın tamamı gerekiyorsa verilen yoldan kendi araçlarınla oku.]'
    : '[Attached files: the user attached these files and Atölye saved them on this computer. The beginning of each is below; if you need a whole file, read it from the given path with your own tools.]'];
  let budget = PREVIEW_TOTAL;
  for (const f of saved) {
    if (f.note === 'too_big') { out.push(`- ${f.name}: ${tr ? 'çok büyük olduğu için eklenmedi' : 'too large, not attached'}`); continue; }
    out.push(`- ${f.name} (${f.size} bayt): ${f.path}`);
    if (f.note === 'old_xls') out.push(tr ? '  Eski Excel biçimi (.xls) Atölye tarafından metne çevrilemedi; dosyayı yoldan kendin okumayı dene ya da kullanıcıdan .xlsx / .csv olarak kaydetmesini iste.' : '  The legacy Excel format (.xls) could not be converted to text by Atölye; try reading the file yourself or ask the user to save it as .xlsx / .csv.');
    else if (f.note) out.push(tr ? `  İçerik okunamadı (${f.note.replace('unreadable:', '')}); dosyayı yoldan kendin okumayı dene.` : `  The content could not be read (${f.note.replace('unreadable:', '')}); try reading the file from its path.`);
    else if (!f.parts.length) out.push(tr ? '  İkili dosya: içerik mesaja eklenmedi, gerekiyorsa yoldan oku.' : '  Binary file: content not included, read it from the path if needed.');
    for (const p of f.parts) {
      const take = Math.max(0, Math.min(PREVIEW_PER_FILE, budget));
      const cut = p.text.length > take;
      const text = cut ? p.text.slice(0, p.text.lastIndexOf('\n', take) > take / 2 ? p.text.lastIndexOf('\n', take) : take) : p.text;
      budget -= text.length;
      if (p.label) out.push(tr ? `  Sayfa "${p.label}" (${p.rows} satır), CSV olarak: ${p.path}` : `  Sheet "${p.label}" (${p.rows} rows), as CSV: ${p.path}`);
      if (!text) { out.push(tr ? '  (içerik mesaja sığmadı; yoldan oku)' : '  (content did not fit; read it from the path)'); continue; }
      out.push('```', text, '```');
      if (cut) out.push(tr ? `  (kısaltıldı: toplam ${p.text.length} karakterin ilk ${text.length} karakteri; tamamı: ${p.path})` : `  (truncated: first ${text.length} of ${p.text.length} characters; full content: ${p.path})`);
    }
  }
  return out.join('\n');
}
