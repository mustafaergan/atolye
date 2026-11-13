// Oturum başlıkları. Önce kullanıcının ilk mesajından kısa bir başlık çıkarılır; ilk cevap geldikten sonra aynı
// yapay zekâ motoruna ayrı, tek seferlik bir istekle konuşmayı özetleyen birkaç kelimelik bir başlık yazdırılır.
// ATOLYE_AI_TITLE=0: yapay zekâ başlığını kapatır (her oturumda küçük bir ek istek anlamına gelir).
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CopilotSession } from './copilot.js';

const MAX = 60;

/** Kullanıcının mesajından başlık: yalnızca ilk paragraf (Atölye'nin eklediği notlar ve getirilen veriler hariç) */
export function shortTitle(text) {
  const first = String(text || '').split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ').trim();
  if (first.length <= MAX) return first;
  const cut = first.slice(0, MAX);
  const at = cut.lastIndexOf(' ');
  return `${(at > 30 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

/** Yapay zekânın yazdığı başlığı temizler: tek satır, tırnak ve sondaki nokta olmadan, sınırı aşmadan */
export function cleanAiTitle(text) {
  const line = String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const t = line.replace(/^(başlık|title)\s*[:：-]\s*/i, '').replace(/^["'“”‘’«»*#\s]+|["'“”‘’«»*.\s]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length < 3) return '';
  return t.length > MAX ? shortTitle(t) : t;
}

const prompt = (lang, question, answer) => [
  lang === 'en'
    ? 'Write a short, descriptive title (at most 6 words) for the conversation below. Reply with the title only: no quotes, no trailing period, no explanation. Use the language of the conversation.'
    : 'Aşağıdaki konuşma için en fazla 6 kelimelik, kısa ve açıklayıcı bir başlık yaz. Yalnızca başlığı yaz: tırnak, sonda nokta ya da açıklama ekleme. Konuşmanın dilini kullan.',
  '',
  `Kullanıcı: ${shortTitle(question).slice(0, 400)}`,
  '',
  `Yanıt: ${String(answer || '').replace(/\s+/g, ' ').slice(0, 500)}`,
].join('\n');

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(''), ms))]);

async function claudeTitle({ cwd, model, text }) {
  let out = '';
  // Araçsız, tek turluk ve diske yazılmayan bir istek: oturum listesinde ayrı bir oturum olarak görünmez.
  // settingSources 'user': gateway adresi ve token ~/.claude/settings.json'dan gelir.
  const q = query({
    prompt: text,
    options: { cwd, model, maxTurns: 1, tools: [], persistSession: false, settingSources: ['user'], canUseTool: async () => ({ behavior: 'deny', message: 'başlık isteği' }) },
  });
  try {
    for await (const m of q) {
      if (m.type === 'assistant' && !m.parent_tool_use_id) out += (m.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (m.type === 'result') break;
    }
  } finally {
    try { q.close?.(); } catch { /* yoksay */ }
  }
  return out;
}

function copilotTitle({ cwd, text }) {
  return new Promise((resolve) => {
    let out = '';
    let sent = false;
    const s = new CopilotSession({
      cwd,
      emit: (ev) => {
        if (ev.type === 'permission') return s.answer(ev.id, { behavior: 'deny' });
        if (ev.type === 'error' || ev.type === 'session_ended') return finish();
        if (ev.type !== 'sdk') return;
        if (ev.msg.type === 'system' && ev.msg.subtype === 'init' && !sent) { sent = true; s.send(text); }
        if (ev.msg.type === 'assistant') out += (ev.msg.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
        if (ev.msg.type === 'result') finish();
      },
    });
    function finish() { try { s.close(); } catch { /* yoksay */ } resolve(out); }
    s.start();
  });
}

/** Konuşmaya yapay zekâdan başlık ister; olmazsa boş döner (başlık isteği asıl oturumu hiç etkilemez) */
export async function aiTitle({ engine, cwd, model, question, answer, lang = 'tr' }) {
  if (!question || !answer) return '';
  const text = prompt(lang, question, answer);
  try {
    const raw = await withTimeout(engine === 'copilot' ? copilotTitle({ cwd, text }) : claudeTitle({ cwd, model, text }), 60_000);
    return cleanAiTitle(raw);
  } catch {
    return '';
  }
}
