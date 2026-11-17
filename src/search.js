// Bütün sohbetlerde arama: Claude Code oturum dosyalarında (~/.claude/projects/<proje>/<oturum>.jsonl) ve
// Copilot konuşmalarının yerel kopyasında (bkz. transcript.js) kullanıcı ve yapay zekâ mesajlarının metni aranır.
// Araç çıktıları ve Atölye'nin mesaja eklediği gizli yönergeler aranmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_FILE = 20 * 1024 * 1024; // çok büyük oturum dosyaları atlanır

/** Büyük/küçük harf ve Türkçe I/İ/ı farkı gözetmeden karşılaştırmak için (uzunluk korunur) */
export const fold = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase();

const projectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

/** Oturum kimliği → Claude Code oturum dosyası */
export function claudeFiles(root = projectsDir()) {
  const map = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return map; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, d.name)); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl')) map.set(f.slice(0, -6), path.join(root, d.name, f));
  }
  return map;
}

const clean = (text) => String(text || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
function messageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return clean(c);
  if (!Array.isArray(c)) return '';
  return clean(c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n'));
}

/** Claude Code oturum dosyasının bir satırından aranacak metin ("kullanıcı" ya da "yanıt") */
export function claudeLineText(line) {
  let m;
  try { m = JSON.parse(line); } catch { return null; }
  if (!m || m.isMeta || m.isSidechain || (m.type !== 'user' && m.type !== 'assistant')) return null;
  const text = messageText(m.message);
  return text.trim() ? { role: m.type, text } : null;
}

/** Copilot yerel kopyasındaki bir olaydan aranacak metin */
export function copilotEventText(ev) {
  if (ev?.type === 'user_prompt') return ev.text ? { role: 'user', text: clean(ev.text) } : null;
  if (ev?.type === 'sdk' && ev.msg?.type === 'assistant') {
    const text = messageText(ev.msg.message);
    return text.trim() ? { role: 'assistant', text } : null;
  }
  return null;
}

/** Eşleşmenin çevresinden kısa bir alıntı; eşleşen bölümün yeri de döner (arayüz vurgular) */
export function snippet(text, at, length, around = 70) {
  const flat = text.replace(/\s/g, ' ');
  const start = Math.max(0, at - around);
  const end = Math.min(flat.length, at + length + around);
  const before = (start > 0 ? '…' : '') + flat.slice(start, at);
  return { before, match: flat.slice(at, at + length), after: flat.slice(at + length, end) + (end < flat.length ? '…' : '') };
}

function searchParts(parts, needle) {
  let count = 0;
  let first = null;
  for (const p of parts) {
    if (!p) continue;
    const hay = fold(p.text);
    let at = hay.indexOf(needle);
    if (at < 0) continue;
    if (!first) first = { role: p.role, ...snippet(p.text, at, needle.length) };
    while (at >= 0) { count++; at = hay.indexOf(needle, at + needle.length); }
  }
  return first ? { count, first } : null;
}

/**
 * sessions: [{ id, engine, cwd, title, lastModified }] — aranacak oturumlar (en yeniler önce verilmelidir)
 * readCopilot(id): Copilot konuşmasının olayları. Sonuç: eşleşen oturumlar, en yeni üstte.
 */
export function searchSessions({ q, sessions, readCopilot = () => [], files = claudeFiles(), limit = 60 }) {
  const needle = fold(String(q || '').trim());
  if (needle.length < 2) return [];
  const out = [];
  for (const s of sessions) {
    if (out.length >= limit) break;
    let hit = null;
    const titleAt = fold(s.title || '').indexOf(needle);
    if (s.engine === 'copilot') {
      hit = searchParts(readCopilot(s.id).map(copilotEventText), needle);
    } else {
      const file = files.get(s.id);
      if (file) {
        try {
          if (fs.statSync(file).size <= MAX_FILE) {
            const raw = fs.readFileSync(file, 'utf8');
            // Ucuz ön eleme: aranan metin dosyada hiç geçmiyorsa satırlar ayrıştırılmaz
            if (fold(raw).includes(needle)) hit = searchParts(raw.split('\n').map(claudeLineText), needle);
          }
        } catch { /* okunamayan dosya atlanır */ }
      }
    }
    if (!hit && titleAt < 0) continue;
    out.push({ id: s.id, engine: s.engine, cwd: s.cwd, title: s.title, lastModified: s.lastModified, count: hit?.count || 0, snippet: hit?.first || null, inTitle: titleAt >= 0 });
  }
  return out;
}
