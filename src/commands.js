// Öğretilen komutlar: kullanıcı ne yapılmasını istediğini kendi cümleleriyle anlatır; yapay zekâ bunu adı, yönergesi
// ve kullanılacak bağlantılarıyla tekrar kullanılabilir bir komuta derler. Komutlar boş oturum ekranında düğme olarak
// görünür, sonradan düzenlenebilir ya da silinebilir. Bu bilgisayara ait oldukları için Atölye'nin kendi klasöründe
// tutulur: ~/.atolye/komutlar.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { oneShot, shortTitle } from './title.js';

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

const fail = (code) => Object.assign(new Error(code), { code });

/** Tarifte adı geçen bağlantılar (yapay zekâ derleyemezse ilk öneri olarak kullanılır) */
export function guessLinks(text) {
  const t = String(text || '');
  return LINK_IDS.filter((id) => LINK_WORDS[id].test(t)).slice(0, MAX_LINKS);
}

const cleanLinks = (links) => [...new Set((Array.isArray(links) ? links : []).filter((id) => LINK_IDS.includes(id)))].slice(0, MAX_LINKS);

const cleanColor = (c) => (COLORS.includes(c) ? c : '');

/** Kaydedilecek komutu denetler ve sadeleştirir */
export function clean(input = {}) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const prompt = String(input.prompt || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_PROMPT);
  if (!name) throw fail('no-name');
  if (!prompt) throw fail('no-prompt');
  return { name, prompt, links: cleanLinks(input.links), fill: Boolean(input.fill), color: cleanColor(input.color) };
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
  if (at >= 0) all[at] = { ...all[at], ...c, updated: new Date().toISOString() };
  else {
    if (all.length >= MAX_COMMANDS) throw fail('too-many');
    all.push({ id: crypto.randomBytes(6).toString('hex'), ...c, created: new Date().toISOString() });
  }
  return write(all, file);
}

export function remove(id, file = defaultFile()) {
  return write(list(file).filter((c) => c.id !== id), file);
}

/** Yapay zekâya giden derleme isteği */
export function compileRequest(lang, description) {
  const tr = lang !== 'en';
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
    tr
      ? 'Yalnızca şu biçimde tek bir JSON nesnesi döndür, başka hiçbir şey yazma: {"name": "en fazla 4 kelimelik ad", "prompt": "yönerge", "links": ["jira"], "fill": false}'
      : 'Reply with a single JSON object in exactly this form and nothing else: {"name": "name of at most 4 words", "prompt": "instruction", "links": ["jira"], "fill": false}',
    '',
    tr ? 'Kullanıcının tarifi:' : 'The user\'s description:',
    String(description || '').trim().slice(0, 4000),
  ].join('\n');
}

/** Yapay zekânın yanıtından komutu çıkarır; çıkaramazsa tarifi olduğu gibi kullanır (ai: false) */
export function parseCompiled(raw, description) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const c = clean({ name: obj.name, prompt: obj.prompt, links: cleanLinks(obj.links).length ? obj.links : guessLinks(description), fill: obj.fill });
      return { ...c, ai: true };
    } catch { /* aşağıdaki yedeğe düş */ }
  }
  const desc = String(description || '').trim();
  return { name: shortTitle(desc).replace(/…$/, '').slice(0, MAX_NAME).trim(), prompt: desc.slice(0, MAX_PROMPT), links: guessLinks(desc), fill: false, ai: false };
}

/** Tarifi yapay zekâya derletir. ask: test için (varsayılan: seçili motora tek seferlik istek) */
export async function compile({ engine, cwd, model, description, lang = 'tr', ask = oneShot }) {
  const desc = String(description || '').trim();
  if (!desc) throw fail('no-description');
  let raw = '';
  try { raw = await ask({ engine, cwd, model, text: compileRequest(lang, desc), timeoutMs: 120_000 }); } catch { /* yedek kullanılır */ }
  return parseCompiled(raw, desc);
}
