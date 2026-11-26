// Öğretilen komutlar: kullanıcı ne yapılmasını istediğini kendi cümleleriyle anlatır; yapay zekâ bunu adı, yönergesi
// ve kullanılacak bağlantılarıyla tekrar kullanılabilir bir komuta derler. Komutlar boş oturum ekranında düğme olarak
// görünür, sonradan düzenlenebilir ya da silinebilir. Bu bilgisayara ait oldukları için Atölye'nin kendi klasöründe
// tutulur: ~/.atolye/komutlar.json
//
// Örnek belgeler: kullanıcı öğretirken dosya ekleyebilir (ör. bir şablon, bir rapor örneği). Dosyalar saklanmaz ve
// komut her çalıştığında yeniden okunmaz; derlerken yapay zekâ onlardan komut için gereken bir özet çıkarır (notes),
// komut çalıştırıldığında bu özet yapay zekâya gizli bilgi olarak gider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { oneShot, shortTitle } from './title.js';
import { extractText, MAX_FILE_BYTES } from './attachments.js';

export const defaultFile = () => path.join(os.homedir(), '.atolye', 'komutlar.json');

// Komuta bağlanabilecek bağlantılar ve tarifte geçtiğinde onları ele veren sözcükler
const LINK_WORDS = {
  jira: /\bjira/i,
  confluence: /\b(confluence|konfluens|wiki|dok[uü]man)/i,
  bitbucket: /\b(bitbucket|pull request|çekme iste[gğ]|\bpr\b)/i,
  graylog: /\b(graylog|log)/i,
  graylogprod: /\bgraylog\s*(prod|canl[ıi])/i,
  reportportal: /\breport\s*portal/i,
  testotomasyon: /\btest otomasyon/i,
  jenkins: /\bjenkins/i,
  fortify: /\bfortify/i,
  sonarqube: /\bsonar/i,
  weblogic: /\bweblogic/i,
  oracle: /\boracle/i,
  postgres: /\bpostgre/i,
};
export const LINK_IDS = Object.keys(LINK_WORDS);
export const MAX_LINKS = 4;
export const MAX_COMMANDS = 30;
export const COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'pink', 'gray'];
const MAX_NAME = 40;
const MAX_PROMPT = 8000;
export const MAX_NOTES = 6000;
export const MAX_DOC_FILES = 5;
const DOC_PER_FILE = 30_000;
const DOC_TOTAL = 60_000;

const fail = (code) => Object.assign(new Error(code), { code });

/** Tarifte adı geçen bağlantılar (yapay zekâ derleyemezse ilk öneri olarak kullanılır) */
export function guessLinks(text) {
  const t = String(text || '');
  return LINK_IDS.filter((id) => LINK_WORDS[id].test(t)).slice(0, MAX_LINKS);
}

const cleanLinks = (links) => [...new Set((Array.isArray(links) ? links : []).filter((id) => LINK_IDS.includes(id)))].slice(0, MAX_LINKS);

const cleanColor = (c) => (COLORS.includes(c) ? c : '');

const cleanSources = (s) => (Array.isArray(s) ? s : []).map((n) => String(n || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, MAX_DOC_FILES);

/** Kaydedilecek komutu denetler ve sadeleştirir */
export function clean(input = {}) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const prompt = String(input.prompt || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_PROMPT);
  if (!name) throw fail('no-name');
  if (!prompt) throw fail('no-prompt');
  // Örnek belgelerin özeti ve hangi dosyalardan çıkarıldığı (yalnızca adlar): yalnızca özet varsa saklanır
  const notes = String(input.notes || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTES);
  return { name, prompt, links: cleanLinks(input.links), fill: Boolean(input.fill), color: cleanColor(input.color), ...(notes ? { notes, sources: cleanSources(input.sources) } : {}) };
}

export function list(file = defaultFile()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(data?.commands) ? data.commands : []).filter((c) => c && c.id && c.name && c.prompt);
  } catch {
    return [];
  }
}

/** Hazır (Atölye ile gelen) komutlara kullanıcının yaptığı değişiklikler: { "<hazır komutun adı>": { hidden, name, prompt, links, fill, color } } */
export function builtins(file = defaultFile()) {
  try {
    const b = JSON.parse(fs.readFileSync(file, 'utf8'))?.builtins;
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

function write(commands, file, builtinMap = builtins(file)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ commands, builtins: builtinMap }, null, 2)}\n`);
  return commands;
}

/**
 * Hazır bir komutu değiştirir ya da gizler. Yalnızca verilen alanlar saklanır; ad ve yönerge verilmediyse
 * Atölye'nin kendi metni kullanılmaya devam eder (dil değişince çevirisi de değişir).
 */
export function saveBuiltin(key, input = {}, file = defaultFile()) {
  const k = String(key || '').trim().slice(0, 200);
  if (!k) throw fail('not-found');
  const o = {};
  if (input.hidden) o.hidden = true;
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const prompt = String(input.prompt || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_PROMPT);
  if (name) o.name = name;
  if (prompt) o.prompt = prompt;
  if (Array.isArray(input.links)) o.links = cleanLinks(input.links);
  if (typeof input.fill === 'boolean') o.fill = input.fill;
  if (cleanColor(input.color)) o.color = input.color;
  const map = builtins(file);
  if (Object.keys(o).length) map[k] = o; else delete map[k];
  write(list(file), file, map);
  return map;
}

/** Hazır komutu Atölye'nin kendi hâline döndürür */
export function resetBuiltin(key, file = defaultFile()) {
  const map = builtins(file);
  delete map[String(key || '')];
  write(list(file), file, map);
  return map;
}

/** Yeni komut ekler ya da (id verilmişse) var olanı günceller; güncel listeyi döndürür */
export function save(input = {}, file = defaultFile()) {
  const c = clean(input);
  const all = list(file);
  const at = input.id ? all.findIndex((x) => x.id === input.id) : -1;
  if (input.id && at < 0) throw fail('not-found');
  if (at >= 0) {
    // Özet kaldırıldıysa eskisi kalmasın
    const { notes: _n, sources: _s, ...rest } = all[at];
    all[at] = { ...rest, ...c, updated: new Date().toISOString() };
  }
  else {
    if (all.length >= MAX_COMMANDS) throw fail('too-many');
    all.push({ id: crypto.randomBytes(6).toString('hex'), ...c, created: new Date().toISOString() });
  }
  return write(all, file);
}

export function remove(id, file = defaultFile()) {
  return write(list(file).filter((c) => c.id !== id), file);
}

/**
 * Eklenen dosyaların metni: { docs: [{ name, text, cut }], unread: [ad] }. Metne çevrilemeyenler (görsel, taranmış PDF,
 * eski Office biçimleri) unread listesine girer. Dosyalar diske yazılmaz.
 */
export function readDocs(files) {
  const docs = [];
  const unread = [];
  let budget = DOC_TOTAL;
  for (const f of (Array.isArray(files) ? files : []).filter((x) => x && typeof x.data === 'string').slice(0, MAX_DOC_FILES)) {
    const name = String(f.name || 'dosya').replace(/[\r\n]+/g, ' ').slice(0, 120);
    const buf = Buffer.from(f.data, 'base64');
    const x = buf.length > MAX_FILE_BYTES ? { parts: [] } : extractText(name, buf, { pdf: true });
    let text = x.parts.map((p) => (p.label ? `[${p.label}]\n${p.text}` : p.text)).join('\n\n').trim();
    const take = Math.min(DOC_PER_FILE, budget);
    if (!text || take <= 0) { unread.push(name); continue; }
    const cut = text.length > take;
    if (cut) text = text.slice(0, take);
    budget -= text.length;
    docs.push({ name, text, cut });
  }
  return { docs, unread };
}

const NOTES_RULE = (tr) => (tr
  ? 'Özet, belgelerden komutun işi için gereken her şeyi içersin: belgenin ne olduğu, yapısı ve bölümleri, alanlar ve biçimleri, kurallar, önemli değerler ve kısa örnekler. Komutun işine yaramayan ayrıntıyı alma; en fazla 3000 karakter yaz.'
  : 'The summary must contain everything from the documents that the command needs: what the document is, its structure and sections, fields and formats, rules, important values and short examples. Leave out details the command does not need; at most 3000 characters.');

function docsSection(tr, docs) {
  return docs.flatMap((d) => [
    '', tr ? `--- Belge: ${d.name} ---` : `--- Document: ${d.name} ---`, d.text,
    ...(d.cut ? [tr ? '(belge uzun olduğu için kısaltıldı)' : '(truncated because the document is long)'] : []),
  ]);
}

/** Yapay zekâya giden derleme isteği. docs: kullanıcının eklediği örnek belgeler (bkz. readDocs) */
export function compileRequest(lang, description, docs = []) {
  const tr = lang !== 'en';
  const withDocs = docs.length > 0;
  return [
    tr
      ? 'Bir kullanıcı, yapay zekâ kodlama yardımcısında tekrar tekrar kullanacağı bir komutu kendi cümleleriyle tarif ediyor. Tarifi derleyip toparla: yardımcıya verilecek açık, numaralı adımlardan oluşan bir yönerge yaz.'
      : 'A user is describing, in their own words, a command they will reuse in an AI coding assistant. Compile it: write a clear instruction for the assistant as numbered steps.',
    tr
      ? 'Kurallar: Kullanıcının istemediği adım ekleme. Belirsiz kalan yeri tahmin etme; yönergede yardımcının kullanıcıya sormasını söyle. Kullanıcı açıkça istemediyse yönergeyi "Ben istemedikçe hiçbir yere yazma, hiçbir şeyi değiştirme." cümlesiyle bitir. Yönergeyi kullanıcının dilinde yaz.'
      : 'Rules: Do not add steps the user did not ask for. Do not guess where it is unclear; tell the assistant to ask the user. Unless the user explicitly asked for changes, end the instruction with "Do not write anywhere or change anything unless I ask." Write the instruction in the user\'s language.',
    tr
      ? `Kullanılabilir bağlantılar (yalnızca tarifte gerekenleri seç, en fazla ${MAX_LINKS}): ${LINK_IDS.join(', ')}.`
      : `Available connections (pick only the ones the description needs, at most ${MAX_LINKS}): ${LINK_IDS.join(', ')}.`,
    tr
      ? 'Komut her çalıştırıldığında kullanıcıdan ek bir bilgi gerekiyorsa (ör. Jira numarası) "fill": true yaz ve yönergeyi, kullanıcının bu bilgiyi sonuna yazacağı şekilde iki nokta ile bitir.'
      : 'If the command needs an extra piece of information from the user every time it runs (e.g. a Jira key), set "fill": true and end the instruction with a colon so the user can type that information after it.',
    ...(withDocs ? [
      tr
        ? 'Kullanıcı örnek belgeler de ekledi (aşağıda). Komut her çalıştırıldığında bu belgeler yeniden okunmayacak; onların yerine "notes" alanına yazacağın özet yapay zekâya verilecek. Yönergede bu bilgiye "komutla gelen belge özeti" diye atıf yap.'
        : 'The user also attached example documents (below). They will not be read again each time the command runs; instead the summary you write in "notes" will be given to the assistant. In the instruction, refer to it as "the document summary that comes with the command".',
      NOTES_RULE(tr),
    ] : []),
    withDocs
      ? (tr
        ? 'Yalnızca şu biçimde tek bir JSON nesnesi döndür, başka hiçbir şey yazma: {"name": "en fazla 4 kelimelik ad", "prompt": "yönerge", "links": ["jira"], "fill": false, "notes": "belgelerin özeti"}'
        : 'Reply with a single JSON object in exactly this form and nothing else: {"name": "name of at most 4 words", "prompt": "instruction", "links": ["jira"], "fill": false, "notes": "summary of the documents"}')
      : (tr
        ? 'Yalnızca şu biçimde tek bir JSON nesnesi döndür, başka hiçbir şey yazma: {"name": "en fazla 4 kelimelik ad", "prompt": "yönerge", "links": ["jira"], "fill": false}'
        : 'Reply with a single JSON object in exactly this form and nothing else: {"name": "name of at most 4 words", "prompt": "instruction", "links": ["jira"], "fill": false}'),
    ...docsSection(tr, docs),
    '',
    tr ? 'Kullanıcının tarifi:' : 'The user\'s description:',
    String(description || '').trim().slice(0, 4000),
  ].join('\n');
}

/** Yapay zekânın yanıtından komutu çıkarır; çıkaramazsa tarifi olduğu gibi kullanır (ai: false) */
export function parseCompiled(raw, description, docs = []) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const c = clean({
        name: obj.name, prompt: obj.prompt, links: cleanLinks(obj.links).length ? obj.links : guessLinks(description), fill: obj.fill,
        ...(docs.length && typeof obj.notes === 'string' ? { notes: obj.notes, sources: docs.map((d) => d.name) } : {}),
      });
      return { ...c, ai: true };
    } catch { /* aşağıdaki yedeğe düş */ }
  }
  const desc = String(description || '').trim();
  return { name: shortTitle(desc).replace(/…$/, '').slice(0, MAX_NAME).trim(), prompt: desc.slice(0, MAX_PROMPT), links: guessLinks(desc), fill: false, ai: false };
}

/**
 * Tarifi yapay zekâya derletir. files: [{ name, data (base64) }] örnek belgeler (özetleri notes alanına çıkarılır).
 * Dönen komutta unread: metne çevrilemeyen dosyaların adları. ask: test için (varsayılan: seçili motora tek seferlik istek)
 */
export async function compile({ engine, cwd, model, description, files = [], lang = 'tr', ask = oneShot }) {
  const desc = String(description || '').trim();
  if (!desc) throw fail('no-description');
  const { docs, unread } = readDocs(files);
  let raw = '';
  try { raw = await ask({ engine, cwd, model, text: compileRequest(lang, desc, docs), timeoutMs: docs.length ? 180_000 : 120_000 }); } catch { /* yedek kullanılır */ }
  const c = parseCompiled(raw, desc, docs);
  return { ...c, ...(files.length ? { unread, sources: c.sources || docs.map((d) => d.name) } : {}) };
}

/** Var olan bir komut için eklenen belgelerden yeniden özet çıkarır: { notes, sources, unread } */
export async function digest({ engine, cwd, model, prompt, files = [], lang = 'tr', ask = oneShot }) {
  const tr = lang !== 'en';
  const { docs, unread } = readDocs(files);
  if (!docs.length) throw Object.assign(fail('no-docs'), { unread });
  const text = [
    tr
      ? 'Bir yapay zekâ kodlama yardımcısında tekrar tekrar kullanılan bir komut var. Kullanıcı bu komut için örnek belgeler ekledi (aşağıda). Komut her çalıştırıldığında belgeler yeniden okunmayacak; onların yerine senin yazacağın özet yardımcıya verilecek.'
      : 'There is a command that is reused in an AI coding assistant. The user attached example documents for it (below). They will not be read again each time the command runs; instead the summary you write will be given to the assistant.',
    NOTES_RULE(tr),
    tr ? 'Yalnızca özetin kendisini yaz; giriş cümlesi ya da açıklama ekleme.' : 'Write only the summary itself; no introduction or explanation.',
    '',
    tr ? 'Komutun yönergesi:' : 'The command\'s instruction:',
    String(prompt || '').trim().slice(0, MAX_PROMPT),
    ...docsSection(tr, docs),
  ].join('\n');
  let raw = '';
  try { raw = await ask({ engine, cwd, model, text, timeoutMs: 180_000 }); } catch { /* aşağıda */ }
  const notes = String(raw || '').replace(/^```[a-z]*\n?|\n?```$/g, '').trim().slice(0, MAX_NOTES);
  if (!notes) throw Object.assign(fail('no-digest'), { unread });
  return { notes, sources: docs.map((d) => d.name), unread };
}
