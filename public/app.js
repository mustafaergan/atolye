// Atölye arayüzü: oturum listesi, akış halinde sohbet, araç kartları,
// izin onayları, sorular, slash komutları ve @dosya önerileri.
import { lineDiff, renderDiff } from './diff.js';
import { t as T, getLang, setLang, locale, translatePage } from './i18n.js';

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
};
// İç içe dizileri düzleştirip boş değerleri atlayarak ekler
const put = (parent, ...children) => {
  for (const c of children.flat(Infinity)) if (c != null && c !== false) parent.append(c);
  return parent;
};
const icon = (paths) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = paths;
  return s;
};

const ICONS = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  term: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  plan: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  spark: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3.5 21l1.4-4.6A8.5 8.5 0 1 1 21 12z"/>',
};

const MODE_LABEL = {
  default: 'Her işlemde sor',
  acceptEdits: 'Düzenlemeleri kabul et',
  plan: 'Plan modu',
  bypassPermissions: 'İzinleri atla',
};
const MODE_CYCLE = ['default', 'acceptEdits', 'plan'];

// ---------- Durum ----------
const state = {
  config: null,
  cwd: '',
  sessionId: null,      // aktif oturumun Claude Code kimliği (ilk mesajdan sonra oluşur)
  liveId: null,         // sunucuda çalışan oturumun kimliği
  sessions: [],         // diskteki oturumlar
  running: [],          // sunucuda çalışan oturumlar
  ws: null,
  connected: false,
  busy: false,
  mode: 'default',
  model: '',
  commands: [],
  attachments: [],      // { mediaType, data, url }
  tools: new Map(),     // tool_use_id -> kart
  live: new Map(),      // message.id -> [{ type, el, raw }]
  liveByIndex: new Map(), // `${msgId}:${index}` -> live kayıt
  streamMsgId: null,
  prompts: new Map(),   // izin/soru id -> kart
  cost: 0,
};

// ---------- DOM ----------
const dom = {
  app: $('#app'),
  messages: $('#messages'),
  transcript: $('#transcript'),
  empty: $('#emptyState'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  modeSelect: $('#modeSelect'),
  modelSelect: $('#modelSelect'),
  sessionList: $('#sessionList'),
  sessionTitle: $('#sessionTitle'),
  sessionCwd: $('#sessionCwd'),
  conn: $('#connState'),
  statusline: $('#statusline'),
  popup: $('#popup'),
  attachments: $('#attachments'),
  fileInput: $('#fileInput'),
  composer: $('#composer'),
  gatewayInfo: $('#gatewayInfo'),
};

// ---------- Yardımcılar ----------
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* yoksay */ } },
};

marked.setOptions({ gfm: true, breaks: false });
function renderMarkdown(target, text) {
  target.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
  for (const a of target.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  for (const pre of target.querySelectorAll('pre')) {
    const btn = el('button', { class: 'copy-code', type: 'button', text: T('Kopyala') });
    btn.onclick = () => {
      navigator.clipboard?.writeText(pre.querySelector('code')?.innerText ?? pre.innerText);
      btn.textContent = T('Kopyalandı');
      setTimeout(() => (btn.textContent = T('Kopyala')), 1200);
    };
    pre.append(btn);
  }
}

function relPath(p) {
  if (!p || typeof p !== 'string') return p ?? '';
  const cwd = state.cwd.replace(/[\\/]+$/, '');
  if (cwd && p.toLowerCase().startsWith(cwd.toLowerCase())) return p.slice(cwd.length).replace(/^[\\/]/, '') || '.';
  return p;
}

function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return T('şimdi');
  const m = Math.round(s / 60);
  if (m < 60) return T('{n} dk', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return T('{n} sa', { n: h });
  const d = Math.round(h / 24);
  if (d < 30) return T('{n} g', { n: d });
  return new Date(ms).toLocaleDateString(locale());
}

let stickToBottom = true;
dom.transcript.addEventListener('scroll', () => {
  const t = dom.transcript;
  stickToBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 80;
});
function scrollDown(force = false) {
  if (force || stickToBottom) dom.transcript.scrollTop = dom.transcript.scrollHeight;
}

function append(node) {
  dom.empty.hidden = true;
  const working = $('.working', dom.messages);
  if (working) dom.messages.insertBefore(node, working);
  else dom.messages.append(node);
  scrollDown();
  return node;
}

function notice(text, kind = 'error') {
  append(el('div', { class: `notice ${kind === 'info' ? 'info' : ''}`, text }));
}

function toolResultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? T('[görsel]') : '')).join('\n');
  return JSON.stringify(content, null, 2);
}

function clip(text, max = 20000) {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} karakter daha)` : text;
}

// ---------- WebSocket ----------
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws = ws;
  setConn('wait', T('Bağlanıyor'));
  ws.onopen = () => {
    state.connected = true;
    setConn('ok', T('Bağlı'));
    // Sayfa yenilense ya da bağlantı kopsa da sunucudaki oturuma geri bağlan
    openLive({ liveId: state.liveId, sessionId: state.sessionId, isNew: !state.liveId && !state.sessionId });
  };
  ws.onclose = () => {
    state.connected = false;
    setBusy(false);
    setConn('err', T('Bağlantı koptu'));
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleEvent(ev);
  };
}

function setConn(kind, label) {
  dom.conn.className = `conn ${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''}`;
  $('.label', dom.conn).textContent = label;
}

function wsSend(obj) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
  else notice(T('Sunucuya bağlı değil. Yeniden bağlanılıyor…'));
}

function openLive({ liveId = null, sessionId = null, isNew = false, cwd = state.cwd }) {
  wsSend({ type: 'open', new: isNew, liveId, sessionId, cwd, mode: state.mode, model: state.model || null, lang: getLang() });
}

function rememberOpen() {
  store.set('atolye:open', JSON.stringify({ liveId: state.liveId, sessionId: state.sessionId, cwd: state.cwd }));
}

// Sunucu oturumu açtığında ekranı baştan kurar: önce diskteki eski geçmiş,
// sonra bu çalışmada oluşan olaylar (akış, araçlar, bekleyen izinler).
function applyOpened(ev) {
  state.liveId = ev.liveId;
  state.sessionId = ev.sessionId;
  if (ev.cwd && !samePath(ev.cwd, state.cwd)) setCwdLabel(ev.cwd);
  rememberOpen();
  resetTranscript();
  if (ev.capabilities) setCapabilities(ev.capabilities);
  setMode(ev.mode, false);
  if (ev.model) { state.model = ev.model; dom.modelSelect.value = ev.model; }

  for (const m of ev.history || []) {
    if (m.type === 'assistant') renderAssistant(m, true);
    else if (m.type === 'user') renderUserFromSdk(m, true);
  }
  for (const e of ev.events || []) handleEvent(e);
  requestContext();
  setBusy(ev.busy);

  const s = sessionsOf(state.cwd).find((x) => x.id === state.sessionId);
  dom.sessionTitle.textContent = s?.title || ev.title || T(state.sessionId ? 'Oturum' : 'Yeni oturum');
  renderSessions();
  scrollDown(true);
}

// ---------- Olaylar ----------
function handleEvent(ev) {
  switch (ev.type) {
    case 'sdk': return handleSdk(ev.msg);
    case 'busy': return setBusy(ev.busy);
    case 'permission': return renderPermission(ev);
    case 'question': return renderQuestion(ev);
    case 'permission_resolved': return resolvePrompt(ev.id, ev.behavior, ev.always);
    case 'mode': return setMode(ev.mode, false);
    case 'model': return;
    case 'capabilities': return setCapabilities(ev);
    case 'error': setBusy(false); return notice(ev.message);
    case 'opened': return applyOpened(ev);
    case 'context': return onContext(ev);
    case 'live': return onLiveList(ev.sessions || []);
    case 'user_prompt':
      return renderUserBubble(ev.text, (ev.images || []).map((i) => `data:${i.mediaType};base64,${i.data}`));
    case 'session_ended': return;
  }
}

function handleSdk(msg) {
  // Yeniden deneme / özetleme sonrası yanıt gelmeye başlayınca göstergeyi sıfırla
  if (state.busy && (msg.type === 'stream_event' || msg.type === 'assistant')) setWorking(T('Çalışıyor…'));
  if (msg.type === 'system') {
    if (msg.subtype === 'init') {
      const isNew = state.sessionId !== msg.session_id;
      state.sessionId = msg.session_id;
      setMode(msg.permissionMode, false);
      dom.statusline.dataset.model = msg.model;
      updateStatus();
      if (isNew) { rememberOpen(); renderSessions(); }
    } else if (msg.subtype === 'local_command_output') {
      const node = el('div', { class: 'msg-text' });
      renderMarkdown(node, msg.content);
      append(node);
    } else if (msg.subtype === 'compact_boundary') {
      notice(T('Konuşma özetlendi (compact). Eski mesajlar bağlamdan çıkarıldı.'), 'info');
      requestContext();
    } else if (msg.subtype === 'api_retry') {
      setWorking(T('Gateway yanıt vermedi, yeniden deneniyor ({n}. deneme)…', { n: msg.attempt }));
    } else if (msg.subtype === 'status' && msg.status === 'compacting') {
      setWorking(T('Konuşma özetleniyor…'));
    }
    return;
  }
  if (msg.type === 'stream_event') return msg.parent_tool_use_id ? null : handleStream(msg.event);
  if (msg.type === 'assistant') return renderAssistant(msg, false);
  if (msg.type === 'user') return renderUserFromSdk(msg, false);
  if (msg.type === 'result') return renderResult(msg);
}

// Akış halinde gelen metin ve düşünce blokları
let renderQueued = new Set();
function scheduleRender(rec) {
  renderQueued.add(rec);
  if (renderQueued.size > 1) return;
  requestAnimationFrame(() => {
    for (const r of renderQueued) {
      if (r.type === 'text') renderMarkdown(r.el, r.raw);
      else $('.body', r.el).textContent = r.raw;
    }
    renderQueued = new Set();
    scrollDown();
  });
}

function handleStream(event) {
  switch (event.type) {
    case 'message_start':
      state.streamMsgId = event.message?.id;
      break;
    case 'content_block_start': {
      const t = event.content_block?.type;
      if (t !== 'text' && t !== 'thinking') break;
      const node = t === 'text' ? el('div', { class: 'msg-text streaming' }) : thinkingEl('', true);
      const rec = { type: t, el: node, raw: '' };
      const id = state.streamMsgId;
      if (!state.live.has(id)) state.live.set(id, []);
      state.live.get(id).push(rec);
      state.liveByIndex.set(`${id}:${event.index}`, rec);
      append(node);
      break;
    }
    case 'content_block_delta': {
      const rec = state.liveByIndex.get(`${state.streamMsgId}:${event.index}`);
      if (!rec) break;
      const d = event.delta;
      if (d.type === 'text_delta') rec.raw += d.text;
      else if (d.type === 'thinking_delta') rec.raw += d.thinking;
      else break;
      scheduleRender(rec);
      break;
    }
    case 'content_block_stop': {
      const rec = state.liveByIndex.get(`${state.streamMsgId}:${event.index}`);
      rec?.el.classList.remove('streaming');
      break;
    }
  }
}

function takeLive(msgId, type) {
  const list = state.live.get(msgId);
  if (!list) return null;
  const i = list.findIndex((r) => r.type === type);
  if (i < 0) return null;
  return list.splice(i, 1)[0];
}

function thinkingEl(text, open = false) {
  const d = el('details', { class: 'thinking' },
    el('summary', {}, icon(ICONS.chevron), T('Düşünüyor')),
    el('div', { class: 'body', text }));
  d.open = open;
  return d;
}

function renderAssistant(msg, fromHistory) {
  const message = msg.message || {};
  const content = Array.isArray(message.content) ? message.content : [];

  if (msg.parent_tool_use_id) {
    // Alt ajanın adımları, ana Task kartının içinde gösterilir
    const parent = state.tools.get(msg.parent_tool_use_id);
    if (!parent) return;
    for (const b of content) {
      if (b.type === 'tool_use') {
        parent.subSteps.hidden = false;
        parent.subSteps.append(el('div', { class: 'sub-step' }, el('b', { text: b.name }), toolSummary(b.name, b.input)));
      }
    }
    return;
  }

  for (const b of content) {
    if (b.type === 'text') {
      if (!b.text?.trim()) continue;
      const rec = fromHistory ? null : takeLive(message.id, 'text');
      const node = rec?.el || append(el('div', { class: 'msg-text' }));
      node.classList.remove('streaming');
      renderMarkdown(node, b.text);
    } else if (b.type === 'thinking') {
      const rec = fromHistory ? null : takeLive(message.id, 'thinking');
      if (rec) { $('.body', rec.el).textContent = b.thinking; rec.el.open = false; }
      else if (b.thinking?.trim()) append(thinkingEl(b.thinking));
    } else if (b.type === 'tool_use') {
      renderToolCard(b, fromHistory);
    }
  }
  if (msg.error === 'authentication_failed' && !fromHistory)
    notice(T("Kimlik doğrulama başarısız. Şirket gateway token'ını (ANTHROPIC_AUTH_TOKEN) ~/.claude/settings.json ya da .env içinde kontrol edin."));
  scrollDown();
}

function renderUserFromSdk(msg, fromHistory) {
  if (msg.parent_tool_use_id) return;
  const c = msg.message?.content;
  if (typeof c === 'string') {
    if (fromHistory) renderUserBubble(cleanUserText(c), []);
    return;
  }
  if (!Array.isArray(c)) return;
  const texts = [];
  const images = [];
  for (const b of c) {
    if (b.type === 'tool_result') applyToolResult(b, msg.tool_use_result);
    else if (b.type === 'text') texts.push(b.text);
    else if (b.type === 'image' && b.source?.type === 'base64') images.push(`data:${b.source.media_type};base64,${b.source.data}`);
  }
  if (fromHistory && (texts.length || images.length)) renderUserBubble(cleanUserText(texts.join('\n')), images);
}

// Oturum dosyalarında model için eklenmiş meta metinleri ayıkla
function cleanUserText(text) {
  if (!text) return '';
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/);
  if (cmd) return `${cmd[1]} ${cmd[2] || ''}`.trim();
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, '')
    .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, '')
    .trim();
}

function renderUserBubble(text, images = []) {
  if (!text && !images.length) return;
  append(el('div', { class: 'msg-user' },
    images.length ? el('div', { class: 'imgs' }, images.map((src) => el('img', { src, alt: T('Ek görsel') }))) : null,
    text ? el('div', { class: 'bubble', text }) : null));
}

function renderResult(msg) {
  for (const list of state.live.values()) for (const r of list) r.el.classList.remove('streaming');
  state.live.clear();
  state.liveByIndex.clear();
  if (typeof msg.total_cost_usd === 'number') state.cost = msg.total_cost_usd;
  trackResult(msg);
  const secs = (msg.duration_ms / 1000).toFixed(1);
  const parts = [T('{n} sn', { n: secs })];
  if (msg.num_turns) parts.push(T('{n} tur', { n: msg.num_turns }));
  if (msg.total_cost_usd) parts.push(`≈ $${msg.total_cost_usd.toFixed(3)}`);
  if (msg.subtype === 'success' && msg.is_error) {
    // API hatası zaten asistan metni olarak gösterildi
    append(el('div', { class: 'result-line err', text: parts.join(' · ') }));
  } else if (msg.subtype !== 'success') {
    const reason =
      msg.subtype === 'error_max_turns' ? T('Tur sınırına ulaşıldı')
      : msg.subtype === 'error_max_budget_usd' ? T('Bütçe sınırına ulaşıldı')
      : msg.result || (msg.errors || []).join('\n') || T('Bir hata oluştu');
    if (!/interrupt/i.test(String(msg.terminal_reason || '')) && !/abort/i.test(reason)) notice(reason);
    else append(el('div', { class: 'result-line', text: T('Durduruldu') }));
  } else {
    append(el('div', { class: 'result-line', text: parts.join(' · ') }));
  }
  updateStatus();
  requestContext();
  loadSessions();
  loadSpend(); // sunucu 1 dk önbelleklediği için her turda script çalışmaz
}

function updateStatus() {
  const bits = [];
  if (dom.statusline.dataset.model) bits.push(dom.statusline.dataset.model);
  if (state.cost) bits.push(T('oturum ≈ ${n}', { n: state.cost.toFixed(3) }));
  dom.statusline.replaceChildren(...bits.map((b) => el('span', { text: b })));
}

// ---------- Bağlam ve oturum metrikleri ----------
// Bağlam verisi Claude Code'un /context komutundakiyle aynıdır (SDK getContextUsage).
// Oturum metrikleri ise "result" mesajlarındaki SDK sayaçlarından toplanır.
const ctx = {
  btn: $('#ctxBtn'), fill: $('#ctxFill'), text: $('#ctxText'), pop: $('#ctxPop'),
  sub: $('#ctxSub'), big: $('#ctxBig'), bar: $('#ctxBar'), note: $('#ctxNote'),
  cats: $('#ctxCats'), details: $('#ctxDetails'), metrics: $('#ctxMetrics'),
};
const CTX_COLORS = ['#c96442', '#5b8def', '#3f9d6b', '#b07cd8', '#d6a13a', '#4bb3c2', '#d26a8f', '#8a8f3a', '#7a8794'];
const CTX_NAMES = {
  'System prompt': 'Sistem talimatları',
  'System tools': 'Sistem araçları',
  'MCP tools': 'MCP araçları',
  'Custom agents': 'Özel ajanlar',
  'Memory files': 'CLAUDE.md / bellek dosyaları',
  Skills: 'Skill\'ler',
  Messages: 'Mesajlar',
  'Autocompact buffer': 'Otomatik özetleme payı',
  'Free space': 'Boş alan',
};
const ctxName = (n) => (getLang() === 'tr' ? CTX_NAMES[n] || n : n);
const newMetrics = () => ({ turns: 0, durationMs: 0, usage: null, cost: 0 });
state.context = null;
state.metrics = newMetrics();

const fmtTokens = (n) => {
  if (n == null || !Number.isFinite(n)) return '–';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
};
const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return T('{n} sn', { n: s });
  const m = Math.floor(s / 60);
  return m < 60 ? T('{m} dk {s} sn', { m, s: s % 60 }) : T('{h} sa {m} dk', { h: Math.floor(m / 60), m: m % 60 });
};

let ctxTimer = null;
function requestContext() {
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(() => {
    if (state.ws?.readyState === WebSocket.OPEN && state.liveId) state.ws.send(JSON.stringify({ type: 'get_context' }));
  }, 400);
}

function trackResult(msg) {
  const m = state.metrics;
  m.turns += msg.num_turns || 0;
  m.durationMs += msg.duration_ms || 0;
  if (msg.modelUsage && Object.keys(msg.modelUsage).length) m.usage = msg.modelUsage; // SDK'da birikimli
  if (typeof msg.total_cost_usd === 'number') m.cost = msg.total_cost_usd;
}

function onContext(ev) {
  if (ev.liveId !== state.liveId) return;
  if (ev.data?.error) {
    // Yeni açılan oturumda Claude Code henüz hazır olmayabilir: birkaç kez yeniden dene
    if (!state.context && (state.ctxRetries = (state.ctxRetries || 0) + 1) <= 4) setTimeout(requestContext, 2500);
    return;
  }
  state.ctxRetries = 0;
  state.context = ev.data;
  renderContext();
}

function renderContext() {
  const d = state.context;
  if (!d) { ctx.btn.hidden = true; return; }
  const max = d.maxTokens || d.rawMaxTokens || 0;
  const pct = Math.max(0, Math.min(100, Math.round(d.percentage ?? (max ? (d.totalTokens / max) * 100 : 0))));
  const level = pct >= 90 ? 'err' : pct >= 70 ? 'warn' : '';

  ctx.btn.hidden = false;
  ctx.btn.className = `ctx-btn ${level}`;
  ctx.fill.setAttribute('stroke-dasharray', `${pct} 100`);
  ctx.text.textContent = `%${pct}`;
  ctx.btn.title = T('Bağlam: {used} / {max} token (ayrıntı için tıklayın)', { used: fmtTokens(d.totalTokens), max: fmtTokens(max) });

  ctx.big.textContent = `%${pct}`;
  ctx.sub.textContent = `${d.model || ''}${d.model ? ' · ' : ''}${T('{used} / {max} token', { used: fmtTokens(d.totalTokens), max: fmtTokens(max) })}`;

  const cats = (d.categories || []).filter((c) => c.kind !== 'deferred' && c.tokens > 0);
  const used = cats.filter((c) => c.kind === 'used');
  const colorOf = new Map(used.map((c, i) => [c.name, CTX_COLORS[i % CTX_COLORS.length]]));
  const share = (t) => (max ? (t / max) * 100 : 0);
  ctx.bar.replaceChildren(...cats.filter((c) => c.kind !== 'free').map((c) =>
    el('span', { title: `${ctxName(c.name)}: ${fmtTokens(c.tokens)}`, style: `width:${share(c.tokens)}%;background:${colorOf.get(c.name) || 'var(--border-strong)'}` })));
  ctx.cats.replaceChildren(...cats.map((c) =>
    el('div', { class: `ctx-cat ${c.kind === 'free' ? 'free' : ''}` },
      el('span', { class: 'dot', style: `background:${c.kind === 'free' ? 'var(--surface-2)' : colorOf.get(c.name) || 'var(--border-strong)'}` }),
      el('span', { class: 'n', text: ctxName(c.name), title: c.name }),
      el('span', { class: 't', text: fmtTokens(c.tokens) }),
      el('span', { class: 'p', text: `%${share(c.tokens).toFixed(1)}` }))));

  ctx.note.className = `ctx-note ${level}`;
  const notes = [];
  if (d.isAutoCompactEnabled && d.autoCompactThreshold)
    notes.push(T('Otomatik özetleme {n} token civarında devreye girer.', { n: fmtTokens(d.autoCompactThreshold) }));
  if (level) notes.push(T('Bağlam dolmak üzere; "Özetle" ile yer açabilirsiniz.'));
  ctx.note.textContent = notes.join(' ');

  // Ayrıntılar: bellek dosyaları, MCP araçları, mesaj dağılımı
  const sections = [];
  const listSection = (title, rows, open = false) => {
    if (!rows.length) return;
    const s = el('details', { class: 'ctx-section' },
      el('summary', {}, icon(ICONS.chevron), title),
      el('div', { class: 'ctx-list' }, rows.map(([n, t, tip]) =>
        el('div', { class: 'ctx-row' }, el('span', { class: 'n', text: n, title: tip || n }), el('span', { class: 't', text: fmtTokens(t) })))));
    s.open = open;
    sections.push(s);
  };
  listSection(T('CLAUDE.md ve bellek dosyaları'), (d.memoryFiles || []).map((f) => [relPath(f.path), f.tokens, f.path]));
  const mcp = new Map();
  for (const t of d.mcpTools || []) {
    const e = mcp.get(t.serverName) || { tokens: 0, count: 0 };
    e.tokens += t.tokens; e.count++;
    mcp.set(t.serverName, e);
  }
  listSection(T('MCP sunucuları'), [...mcp].sort((a, b) => b[1].tokens - a[1].tokens).map(([n, e]) => [T('{name} ({n} araç)', { name: n, n: e.count }), e.tokens]));
  const mb = d.messageBreakdown;
  if (mb) {
    listSection(T('Mesajların dağılımı'), [
      [T('Araç sonuçları'), mb.toolResultTokens], [T('Araç çağrıları'), mb.toolCallTokens],
      [T("Claude'un mesajları"), mb.assistantMessageTokens], [T('Sizin mesajlarınız'), mb.userMessageTokens],
      [T('Ekler'), mb.attachmentTokens],
    ].filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]));
    listSection(T('En çok yer tutan araçlar'), (mb.toolCallsByType || [])
      .map((t) => [t.name, (t.callTokens || 0) + (t.resultTokens || 0)])
      .sort((a, b) => b[1] - a[1]).slice(0, 8));
  }
  ctx.details.replaceChildren(...sections);
  renderMetrics();
}

function renderMetrics() {
  const m = state.metrics;
  const sum = (k) => Object.values(m.usage || {}).reduce((a, u) => a + (u[k] || 0), 0);
  const rows = [
    [T('Giriş'), fmtTokens(sum('inputTokens'))],
    [T('Çıkış'), fmtTokens(sum('outputTokens'))],
    [T('Önbellekten okunan'), fmtTokens(sum('cacheReadInputTokens'))],
    [T('Önbelleğe yazılan'), fmtTokens(sum('cacheCreationInputTokens'))],
    [T('Tur'), String(m.turns)],
    [T('Süre'), fmtDuration(m.durationMs)],
    [T('Tahmini maliyet'), m.cost ? `≈ $${m.cost.toFixed(3)}` : '–'],
  ];
  const web = sum('webSearchRequests');
  if (web) rows.push([T('Web araması'), String(web)]);
  ctx.metrics.replaceChildren(...rows.map(([k, v]) => el('div', {}, el('span', { text: k }), el('b', { text: v }))));
}

ctx.btn.addEventListener('click', (e) => {
  e.stopPropagation();
  ctx.pop.hidden = !ctx.pop.hidden;
  if (!ctx.pop.hidden) requestContext();
});
ctx.pop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { ctx.pop.hidden = true; });
$('#ctxRefresh').onclick = () => requestContext();
$('#ctxCompact').onclick = () => {
  ctx.pop.hidden = true;
  wsSend({ type: 'send', text: '/compact', images: [] });
  setBusy(true);
};

// ---------- Araç kartları ----------
function toolIcon(name) {
  if (/^(Read|NotebookRead)$/.test(name)) return ICONS.file;
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return ICONS.edit;
  if (/^(Bash|PowerShell|BashOutput|KillShell|KillBash)$/.test(name)) return ICONS.term;
  if (/^(Grep|Glob|LS)$/.test(name)) return ICONS.search;
  if (/^Web/.test(name)) return ICONS.globe;
  if (/^(TodoWrite|TaskCreate|TaskUpdate)$/.test(name)) return ICONS.list;
  if (/^(Task|Agent)$/.test(name)) return ICONS.bot;
  if (name === 'ExitPlanMode') return ICONS.plan;
  return ICONS.tool;
}

const TOOL_LABEL = {
  Read: T('Okundu'), Write: T('Yazıldı'), Edit: T('Düzenlendi'), MultiEdit: T('Düzenlendi'), Bash: T('Komut'), PowerShell: 'PowerShell',
  Grep: T('Arama'), Glob: T('Dosya arama'), WebFetch: T('Web'), WebSearch: T('Web araması'), TodoWrite: T('Yapılacaklar'),
  Task: T('Alt ajan'), Agent: T('Alt ajan'), ExitPlanMode: T('Plan'), NotebookEdit: T('Not defteri'),
};

function toolSummary(name, input = {}) {
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return relPath(input.file_path || input.notebook_path);
    case 'Bash': case 'PowerShell': return input.description ? `${input.description} — ${input.command}` : input.command;
    case 'Grep': return `${input.pattern}${input.path ? `  (${relPath(input.path)})` : ''}`;
    case 'Glob': return input.pattern;
    case 'WebFetch': return input.url;
    case 'WebSearch': return input.query;
    case 'Task': case 'Agent': return input.description || input.subagent_type || '';
    case 'TodoWrite': {
      const t = input.todos || [];
      return T('{done}/{total} tamamlandı', { done: t.filter((x) => x.status === 'completed').length, total: t.length });
    }
    default: {
      const s = JSON.stringify(input);
      return s && s !== '{}' ? s.slice(0, 140) : '';
    }
  }
}

function editPairs(name, input) {
  if (name === 'Edit') return [{ a: input.old_string ?? '', b: input.new_string ?? '' }];
  if (name === 'MultiEdit') return (input.edits || []).map((e) => ({ a: e.old_string ?? '', b: e.new_string ?? '' }));
  if (name === 'Write') return [{ a: '', b: input.content ?? '' }];
  return null;
}

function diffBlock(name, input) {
  const pairs = editPairs(name, input);
  if (!pairs) return null;
  let add = 0, del = 0;
  const nodes = pairs.map(({ a, b }) => {
    const ops = lineDiff(a, b);
    for (const o of ops) { if (o.t === '+') add++; else if (o.t === '-') del++; }
    return renderDiff(ops, { context: name === 'Write' ? Infinity : 3, maxLines: 600 });
  });
  return { node: el('div', { class: 'diff-wrap' }, nodes), add, del };
}

function toolInputBody(name, input) {
  const parts = [];
  if (name === 'Bash' || name === 'PowerShell') {
    parts.push(el('pre', { class: 'out', text: input.command || '' }));
  } else if (name === 'TodoWrite') {
    parts.push(el('ul', { class: 'todos' }, (input.todos || []).map((t) =>
      el('li', { class: t.status }, el('span', { class: 'box' }), el('span', { text: t.status === 'in_progress' ? t.activeForm || t.content : t.content })))));
  } else if (name === 'Task' || name === 'Agent') {
    parts.push(el('div', { class: 't-label', text: T('Görev') }), el('pre', { class: 'out', text: input.prompt || '' }));
  } else if (name === 'ExitPlanMode') {
    const p = el('div', { class: 'msg-text' });
    renderMarkdown(p, input.plan || '');
    parts.push(p);
  } else {
    const d = diffBlock(name, input);
    if (d) parts.push(d.node);
    else if (name !== 'Read' && name !== 'Glob' && name !== 'Grep')
      parts.push(el('pre', { class: 'out', text: JSON.stringify(input, null, 2) }));
  }
  return parts;
}

function renderToolCard(block, fromHistory) {
  if (state.tools.has(block.id)) return;
  const { name, input = {} } = block;
  const stat = el('span', { class: 't-stat' });
  const d = editPairs(name, input) ? diffBlock(name, input) : null;
  if (d) stat.append(el('span', { class: 'add', text: `+${d.add}` }), el('span', { class: 'del', text: `−${d.del}` }));

  const subSteps = el('div', { class: 'sub-steps', hidden: true });
  const resultBox = el('div', { class: 'result-box' });
  const body = el('div', { class: 't-body' }, d ? d.node : toolInputBody(name, input), subSteps, resultBox);
  const card = el('details', { class: `tool ${fromHistory ? 'ok' : 'running'}` },
    el('summary', {},
      el('span', { class: 't-state' }),
      el('span', { class: 't-icon' }, icon(toolIcon(name))),
      el('span', { class: 't-name', text: TOOL_LABEL[name] || name }),
      el('span', { class: 't-summary', text: toolSummary(name, input) || '', title: toolSummary(name, input) || '' }),
      stat),
    body);
  if (name === 'TodoWrite' || name === 'ExitPlanMode') card.open = !fromHistory || name === 'TodoWrite';
  state.tools.set(block.id, { el: card, name, input, subSteps, resultBox });
  append(card);
}

function applyToolResult(block, structured) {
  const t = state.tools.get(block.tool_use_id);
  if (!t) return;
  const text = toolResultText(block.content);
  const denied = block.is_error && /permission|izin|reddet|denied|rejected|İptal|doesn't want/i.test(text);
  t.el.classList.remove('running');
  t.el.classList.add(denied ? 'denied' : block.is_error ? 'error' : 'ok');
  t.resultBox.replaceChildren();
  if (t.name === 'TodoWrite' || (t.name === 'ExitPlanMode' && !block.is_error)) return;
  if (!text.trim()) return;
  if (!block.is_error && /^(Edit|MultiEdit|Write)$/.test(t.name)) return; // diff zaten gösteriliyor
  t.resultBox.append(
    el('div', { class: 't-label', text: T(block.is_error ? 'Hata' : 'Çıktı') }),
    el('pre', { class: `out ${block.is_error ? 'err' : ''}`, text: clip(text) }));
  if (block.is_error && !denied) t.el.open = true;
}

// ---------- İzin kartları ----------
function renderPermission(ev) {
  const { id, toolName, input = {}, title, decisionReason, blockedPath, canAlways, alwaysGroup } = ev;
  const card = el('div', { class: 'prompt-card', 'data-id': id });

  if (toolName === 'ExitPlanMode') {
    const plan = el('div', { class: 'plan msg-text' });
    renderMarkdown(plan, input.plan || '');
    put(card, 
      el('h3', {}, icon(ICONS.plan), T('Plan hazır. Uygulamaya geçilsin mi?')),
      plan,
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', text: T('Onayla, düzenlemeleri otomatik kabul et'),
          onclick: () => answer(id, { behavior: 'allow', nextMode: 'acceptEdits' }) }),
        el('button', { class: 'btn', type: 'button', text: T('Onayla, her adımda sor'),
          onclick: () => answer(id, { behavior: 'allow', nextMode: 'default' }) }),
        el('button', { class: 'btn ghost', type: 'button', text: T('Planlamaya devam et'),
          onclick: () => answer(id, { behavior: 'deny', message: T('Kullanıcı planı henüz onaylamadı; planlamaya devam et.') }) })));
  } else {
    const heading = title || T('{tool} için izin gerekiyor', { tool: TOOL_LABEL[toolName] || toolName });
    const note = el('input', { type: 'text', placeholder: T("Reddederken Claude'a ne yapmasını istediğinizi yazın (isteğe bağlı)") });
    put(card, 
      el('h3', {}, icon(ICONS.shield), heading),
      decisionReason ? el('p', { class: 'why', text: decisionReason }) : null,
      blockedPath ? el('p', { class: 'why', text: T('Erişilmek istenen yol: {path}', { path: blockedPath }) }) : null,
      permissionSubtitle(toolName, input),
      toolInputBody(toolName, input),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', text: T('İzin ver'), onclick: () => answer(id, { behavior: 'allow' }) }),
        canAlways ? el('button', { class: 'btn', type: 'button', text: T(ALWAYS_LABEL[alwaysGroup] || 'Bu oturumda hep izin ver'),
          onclick: () => answer(id, { behavior: 'allow', always: true }) }) : null,
        el('button', { class: 'btn ghost', type: 'button', text: T('Reddet'),
          onclick: () => answer(id, { behavior: 'deny', message: note.value.trim() || undefined }) }),
        el('span', { class: 'kbd', text: T('Enter izin ver · Esc reddet') })),
      el('div', { class: 'deny-note' }, note));
  }
  state.prompts.set(id, card);
  append(card);
  scrollDown(true);
}

const ALWAYS_LABEL = {
  shell: 'Bu oturumda tüm komutlara izin ver',
  edits: 'Bu oturumda tüm düzenlemelere izin ver',
};

// Komutlarda komutun kendisi zaten kutuda gösterildiği için sadece açıklamayı yaz
function permissionSubtitle(toolName, input) {
  const text = toolName === 'Bash' || toolName === 'PowerShell' ? input.description : toolSummary(toolName, input);
  return text ? el('div', { class: 'diff-file', text }) : null;
}

function renderQuestion(ev) {
  const { id, input = {} } = ev;
  const card = el('div', { class: 'prompt-card', 'data-id': id });
  const blocks = (input.questions || []).map((q, qi) => {
    const name = `q-${id}-${qi}`;
    const type = q.multiSelect ? 'checkbox' : 'radio';
    const other = el('input', { type: 'text', placeholder: T('Diğer…') });
    const opts = (q.options || []).map((o) =>
      el('label', { class: 'q-opt' },
        el('input', { type, name, value: o.label }),
        el('div', {}, el('div', { text: o.label }), o.description ? el('div', { class: 'd', text: o.description }) : null)));
    other.addEventListener('input', () => {
      if (other.value && type === 'radio') for (const r of card.querySelectorAll(`input[name="${name}"]`)) r.checked = false;
    });
    return { q, name, other, node: el('div', { class: 'q-block' },
      el('div', { class: 'q-head', text: q.header || T('Soru') }),
      el('div', { class: 'q-text', text: q.question }),
      opts, other) };
  });
  const submit = () => {
    const answers = {};
    for (const b of blocks) {
      const picked = [...card.querySelectorAll(`input[name="${b.name}"]:checked`)].map((i) => i.value);
      if (b.other.value.trim()) picked.push(b.other.value.trim());
      if (picked.length) answers[b.q.question] = picked.join(', ');
    }
    answer(id, { behavior: 'allow', answers });
  };
  put(card, 
    el('h3', {}, icon(ICONS.question), T('Claude bir şey soruyor')),
    blocks.map((b) => b.node),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', text: T('Cevapla'), onclick: submit }),
      el('button', { class: 'btn ghost', type: 'button', text: T('Atla'), onclick: () => answer(id, { behavior: 'deny', message: T('Kullanıcı soruyu cevaplamadı.') }) })));
  state.prompts.set(id, card);
  append(card);
  scrollDown(true);
}

function answer(id, decision) {
  wsSend({ type: 'answer', id, decision });
}

function resolvePrompt(id, behavior, always = false) {
  const card = state.prompts.get(id);
  if (!card) return;
  state.prompts.delete(id);
  card.classList.add('resolved');
  for (const b of card.querySelectorAll('button, input')) b.disabled = true;
  const label = T(behavior === 'allow' ? (always ? 'Bu oturum boyunca izin verildi' : 'İzin verildi') : behavior === 'deny' ? 'Reddedildi' : 'İptal edildi');
  $('.actions', card)?.replaceChildren(el('span', { class: 'result-note', text: label }));
  $('.deny-note', card)?.remove();
}

function activePrompt() {
  const ids = [...state.prompts.keys()];
  return ids.length ? { id: ids[0], card: state.prompts.get(ids[0]) } : null;
}

// ---------- Meşguliyet / çalışıyor göstergesi ----------
function setBusy(busy) {
  state.busy = busy;
  if (busy) setWorking(T('Çalışıyor…'));
  else $('.working', dom.messages)?.remove();
  updateSendBtn();
}

function setWorking(text) {
  let w = $('.working', dom.messages);
  if (!w) {
    w = el('div', { class: 'working' }, el('span', { class: 'spark' }, icon(ICONS.spark)), el('span', { class: 'w-text' }));
    dom.messages.append(w);
  }
  const label = $('.w-text', w);
  if (label.textContent === text) return;
  label.textContent = text;
  dom.empty.hidden = true;
  scrollDown();
}

function updateSendBtn() {
  const hasText = dom.input.value.trim() || state.attachments.length;
  const stop = state.busy && !hasText;
  dom.sendBtn.classList.toggle('stop', stop);
  dom.sendBtn.title = T(stop ? 'Durdur (Esc)' : 'Gönder');
  dom.sendBtn.disabled = !stop && !hasText;
}

// ---------- Mod ve model ----------
function setMode(mode, notifyServer = true) {
  if (!MODE_LABEL[mode]) return;
  state.mode = mode;
  dom.modeSelect.value = mode;
  dom.modeSelect.className = `m-${mode}`;
  if (notifyServer) wsSend({ type: 'set_mode', mode });
}

function setCapabilities({ models = [], commands = [] }) {
  state.commands = commands;
  const current = state.model;
  dom.modelSelect.replaceChildren(el('option', { value: '', text: T('Varsayılan model') }),
    ...models.filter((m) => m.value && m.value !== 'default').map((m) => el('option', { value: m.value, text: m.name || m.value, title: m.description || '' })));
  if (current && ![...dom.modelSelect.options].some((o) => o.value === current))
    dom.modelSelect.append(el('option', { value: current, text: current }));
  dom.modelSelect.value = current;
}

dom.modeSelect.addEventListener('change', () => {
  const mode = dom.modeSelect.value;
  if (mode === 'bypassPermissions' && !confirm(T('İzinleri atla modunda Claude dosya düzenleme ve komut çalıştırma işlemlerini SORMADAN yapar. Emin misiniz?'))) {
    dom.modeSelect.value = state.mode;
    return;
  }
  setMode(mode);
});
dom.modelSelect.addEventListener('change', () => {
  state.model = dom.modelSelect.value;
  store.set('atolye:model', state.model);
  wsSend({ type: 'set_model', model: state.model || null });
});

// ---------- Gönderme ----------
function send() {
  const text = dom.input.value.trim();
  if (!text && !state.attachments.length) return;
  if (text === '/clear' || text === '/new') { newSession(); dom.input.value = ''; autoGrow(); return; }
  const images = state.attachments.map(({ mediaType, data }) => ({ mediaType, data }));
  // Mesaj balonu sunucudan "user_prompt" olarak geri gelince çizilir;
  // böylece sayfa yenilenince de aynı sırayla yeniden oluşur.
  wsSend({ type: 'send', text: text || T('Bu görsele bak.'), images });
  dom.input.value = '';
  state.attachments = [];
  renderAttachments();
  autoGrow();
  hidePopup();
  setBusy(true);
  scrollDown(true);
}

dom.sendBtn.addEventListener('click', () => {
  if (dom.sendBtn.classList.contains('stop')) wsSend({ type: 'interrupt' });
  else send();
});

function autoGrow() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 280)}px`;
  updateSendBtn();
}
dom.input.addEventListener('input', () => { autoGrow(); updatePopup(); });

dom.input.addEventListener('keydown', (e) => {
  if (!dom.popup.hidden && popupKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); }
});

function cycleMode() {
  const i = MODE_CYCLE.indexOf(state.mode);
  setMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length]);
}

document.addEventListener('keydown', (e) => {
  const inField = e.target.matches?.('input, textarea, select');
  const p = activePrompt();
  if (e.key === 'Escape') {
    if (!dom.popup.hidden) return hidePopup();
    if (!ctx.pop.hidden) { ctx.pop.hidden = true; return; }
    if (p && !$('.q-block', p.card)) { answer(p.id, { behavior: 'deny' }); return; }
    if (state.busy) wsSend({ type: 'interrupt' });
  } else if (e.key === 'Enter' && p && !inField && !$('.q-block', p.card) && !e.target.closest?.('button')) {
    e.preventDefault();
    $('.btn.primary', p.card)?.click();
  } else if (e.key === 'Tab' && e.shiftKey && !inField) {
    e.preventDefault();
    cycleMode();
  }
});

// ---------- Görsel ekleri ----------
function addImageFile(file) {
  if (!file.type.startsWith('image/')) return;
  if (file.size > 5 * 1024 * 1024) return notice(T("{name} 5 MB'tan büyük, eklenmedi.", { name: file.name }));
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    state.attachments.push({ mediaType: file.type, data: String(url).split(',')[1], url });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}
function renderAttachments() {
  dom.attachments.replaceChildren(...state.attachments.map((a, i) =>
    el('div', { class: 'att' }, el('img', { src: a.url, alt: '' }),
      el('button', { type: 'button', text: '×', 'aria-label': T('Kaldır'), onclick: () => { state.attachments.splice(i, 1); renderAttachments(); } }))));
  updateSendBtn();
}
$('#attachBtn').onclick = () => dom.fileInput.click();
dom.fileInput.onchange = () => { [...dom.fileInput.files].forEach(addImageFile); dom.fileInput.value = ''; };
dom.input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
});
for (const ev of ['dragenter', 'dragover']) dom.composer.addEventListener(ev, (e) => { e.preventDefault(); dom.composer.classList.add('drag'); });
for (const ev of ['dragleave', 'drop']) dom.composer.addEventListener(ev, () => dom.composer.classList.remove('drag'));
dom.composer.addEventListener('drop', (e) => { e.preventDefault(); [...e.dataTransfer.files].forEach(addImageFile); });

// ---------- / komutları ve @ dosyaları ----------
const popup = { items: [], sel: 0, kind: null, range: null };
let fileReq = 0;

async function updatePopup() {
  const v = dom.input.value;
  const caret = dom.input.selectionStart;
  const before = v.slice(0, caret);

  const slash = before.match(/^\/(\S*)$/);
  if (slash) {
    const q = slash[1].toLowerCase();
    const items = [{ name: 'clear', description: T('Yeni oturum başlat') }, ...state.commands]
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, 40)
      .map((c) => ({ label: `/${c.name}`, desc: c.description, insert: `/${c.name} ` }));
    return showPopup('slash', items, [0, caret]);
  }

  const at = before.match(/(^|\s)@([^\s@]*)$/);
  if (at) {
    const start = caret - at[2].length - 1;
    const req = ++fileReq;
    const files = await fetch(`/api/fs/files?dir=${encodeURIComponent(state.cwd)}&q=${encodeURIComponent(at[2])}`).then((r) => r.json()).catch(() => []);
    if (req !== fileReq) return;
    return showPopup('file', files.map((f) => ({ label: f, insert: `@${f} ` })), [start, caret]);
  }
  hidePopup();
}

function showPopup(kind, items, range) {
  if (!items.length) return hidePopup();
  Object.assign(popup, { kind, items, range, sel: 0 });
  dom.popup.replaceChildren(...items.map((it, i) =>
    el('div', { class: `item ${i === 0 ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); pick(i); } },
      el('span', { class: 'n', text: it.label }), it.desc ? el('span', { class: 'd', text: it.desc }) : null)));
  dom.popup.hidden = false;
}
function hidePopup() { dom.popup.hidden = true; popup.items = []; }
function pick(i) {
  const it = popup.items[i];
  if (!it) return;
  const v = dom.input.value;
  const [s, e] = popup.range;
  dom.input.value = v.slice(0, s) + it.insert + v.slice(e);
  const pos = s + it.insert.length;
  dom.input.setSelectionRange(pos, pos);
  dom.input.focus();
  hidePopup();
  autoGrow();
}
function popupKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    popup.sel = (popup.sel + (e.key === 'ArrowDown' ? 1 : -1) + popup.items.length) % popup.items.length;
    [...dom.popup.children].forEach((c, i) => c.classList.toggle('sel', i === popup.sel));
    dom.popup.children[popup.sel]?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(popup.sel); return true; }
  return false;
}

// ---------- Projeler ve oturum listesi ----------
// Kenar çubuğunda birden fazla proje klasörü alt alta durur; her birinin
// altında o klasörün oturumları listelenir. Farklı projelerdeki oturumlar
// aynı anda çalışabilir.
const samePath = (a, b) => pathKey(a) === pathKey(b);
const pathKey = (p) => (p || '').replace(/[\\/]+$/, '').toLowerCase();
const folderOf = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
// Klasörsüz sohbet: hiçbir projeye bağlı olmayan oturumlar (sunucudaki boş klasörde çalışır)
const isGeneral = (p) => Boolean(state.config?.generalDir) && samePath(p, state.config.generalDir);
const projectLabel = (p) => (isGeneral(p) ? T('Klasörsüz sohbet') : folderOf(p));
const SESSIONS_PER_PROJECT = 6;

function readJson(key, fallback) {
  try { return JSON.parse(store.get(key, '')) ?? fallback; } catch { return fallback; }
}
state.projects = readJson('atolye:projects', []);
state.collapsed = new Set(readJson('atolye:collapsed', []));
state.expanded = new Set(); // "daha fazla göster" açılan projeler
state.sessionsByDir = new Map(); // pathKey -> oturumlar

const sessionsOf = (dir) => state.sessionsByDir.get(pathKey(dir)) || [];
const saveProjects = () => {
  store.set('atolye:projects', JSON.stringify(state.projects));
  store.set('atolye:collapsed', JSON.stringify([...state.collapsed]));
};

function addProject(dir, { load = true } = {}) {
  if (!dir || state.projects.some((p) => samePath(p, dir))) return false;
  state.projects.push(dir);
  saveProjects();
  if (load) loadSessions(dir);
  return true;
}

function removeProject(dir) {
  const running = state.running.filter((r) => samePath(r.cwd, dir) && (r.busy || r.waiting)).length;
  if (running && !confirm(T('{folder} klasöründe çalışan {n} oturum var. Yine de listeden kaldırılsın mı? (Çalışmaya devam ederler.)', { folder: folderOf(dir), n: running }))) return;
  state.projects = state.projects.filter((p) => !samePath(p, dir));
  saveProjects();
  if (samePath(dir, state.selectedProject) && !samePath(dir, state.cwd)) selectProject(state.cwd, { render: false });
  if (samePath(dir, state.cwd)) {
    if (state.projects.length) newSession(state.projects[0]);
    else openFolderDialog();
  }
  renderSessions();
}

async function loadSessions(dir = state.cwd) {
  let list;
  try {
    list = await fetch(`/api/sessions?dir=${encodeURIComponent(dir)}&lang=${getLang()}`).then((r) => r.json());
    if (!Array.isArray(list)) throw new Error(list?.error || T('Liste alınamadı'));
  } catch (err) {
    list = [];
    notice(T('{folder} oturumları yüklenemedi: {error}', { folder: folderOf(dir), error: err.message }));
  }
  state.sessionsByDir.set(pathKey(dir), list);
  renderSessions();
}

const loadAllSessions = () => Promise.all(state.projects.map((p) => loadSessions(p)));

// Arka planda çalışan bir oturum bitip bellekten silinince ya da yeni bir
// oturum diske yazılınca ilgili projenin listesini tazele
const refreshTimers = new Map();
function refreshDirSoon(dir) {
  const k = pathKey(dir);
  clearTimeout(refreshTimers.get(k));
  refreshTimers.set(k, setTimeout(() => loadSessions(dir), 600));
}
function onLiveList(sessions) {
  const prev = state.running;
  state.running = sessions;
  const now = new Set(sessions.map((r) => `${r.liveId}:${r.sessionId}:${r.busy}`));
  for (const r of prev) if (!now.has(`${r.liveId}:${r.sessionId}:${r.busy}`)) refreshDirSoon(r.cwd);
  for (const r of sessions) {
    if (addProject(r.cwd)) continue;
    if (r.sessionId && !sessionsOf(r.cwd).some((s) => s.id === r.sessionId)) refreshDirSoon(r.cwd);
  }
  renderSessions();
}

function sessionRows(dir) {
  const disk = sessionsOf(dir);
  const diskIds = new Set(disk.map((s) => s.id));
  const running = state.running.filter((r) => samePath(r.cwd, dir));
  const runningBySession = new Map(running.filter((r) => r.sessionId).map((r) => [r.sessionId, r]));
  const rows = [];
  for (const r of running) {
    if (r.sessionId && diskIds.has(r.sessionId)) continue;
    rows.push({ id: r.sessionId, liveId: r.liveId, title: r.title || 'Yeni oturum', lastModified: r.lastActivity, run: r, cwd: dir });
  }
  for (const s of disk) rows.push({ ...s, run: runningBySession.get(s.id), cwd: dir });
  rows.sort((a, b) => (b.run ? 1 : 0) - (a.run ? 1 : 0)); // kararlı sıralama: çalışanlar üste

  // Henüz mesaj yazılmamış yeni oturum da listede hemen görünsün
  if (samePath(dir, state.cwd) && !state.sessionId) {
    const listed = rows.some((r) => state.liveId && (r.liveId === state.liveId || r.run?.liveId === state.liveId));
    if (!listed) rows.unshift({ id: null, liveId: state.liveId, title: T('Yeni oturum'), lastModified: Date.now(), cwd: dir, draft: true });
  }
  return rows;
}

function sessionRow(s) {
  const active = s.draft || (s.liveId && s.liveId === state.liveId) || (s.id && s.id === state.sessionId) || (s.run && s.run.liveId === state.liveId);
  const status = s.run
    ? s.run.waiting
      ? el('span', { class: 's-badge wait', title: T('Onayınızı bekliyor'), text: T('onay') })
      : s.run.busy
        ? el('span', { class: 's-badge run', title: T('Çalışıyor') }, el('span', { class: 'spin' }))
        : null
    : null;
  const item = el('button', { class: `session-item ${active ? 'active' : ''}`, type: 'button', title: s.title },
    status,
    el('span', { class: 's-title', text: s.title }),
    el('span', { class: 's-time', text: timeAgo(s.lastModified) }),
    s.id && !s.run?.busy ? el('span', { class: 's-actions' },
      el('span', { title: T('Yeniden adlandır'), onclick: (e) => { e.stopPropagation(); renameSession(s); } }, icon(ICONS.pencil)),
      el('span', { title: T('Sil'), onclick: (e) => { e.stopPropagation(); removeSession(s); } }, icon(ICONS.trash))) : null);
  item.onclick = () => (s.draft ? dom.input.focus() : openSession({ sessionId: s.id, liveId: s.run?.liveId || s.liveId, cwd: s.cwd }));
  return item;
}

function renderSessions() {
  for (const r of state.running) addProject(r.cwd);
  if (state.cwd) addProject(state.cwd);

  dom.sessionList.replaceChildren(...state.projects.map((dir) => {
    const k = pathKey(dir);
    const rows = sessionRows(dir);
    const collapsed = state.collapsed.has(k);
    const runningCount = state.running.filter((r) => samePath(r.cwd, dir) && (r.busy || r.waiting)).length;
    const isSelected = samePath(dir, state.selectedProject);
    const toggle = (e) => {
      e.stopPropagation();
      collapsed ? state.collapsed.delete(k) : state.collapsed.add(k);
      saveProjects();
      renderSessions();
    };

    // Klasör adına tıklamak projeyi seçer (üstteki "Yeni oturum" burada açar); ok simgesi açar/kapatır
    const head = el('div', { class: `project-head ${isSelected ? 'current' : ''}` },
      el('button', { class: 'p-toggle', type: 'button', title: T('{dir}\nSeçmek için tıklayın', { dir }), 'aria-pressed': String(isSelected),
        onclick: () => { selectProject(dir); if (collapsed) { state.collapsed.delete(k); saveProjects(); renderSessions(); } } },
        el('span', { class: `p-chevron ${collapsed ? '' : 'open'}`, role: 'button', title: T(collapsed ? 'Aç' : 'Kapat'),
          'aria-expanded': String(!collapsed), onclick: toggle }, icon(ICONS.chevron)),
        icon(isGeneral(dir) ? ICONS.chat : ICONS.folder),
        el('span', { class: 'p-name', text: projectLabel(dir) }),
        collapsed && runningCount ? el('span', { class: 's-badge run', title: T('{n} oturum çalışıyor', { n: runningCount }) }, el('span', { class: 'spin' })) : null),
      el('span', { class: 'p-actions' },
        el('button', { class: 'p-btn', type: 'button', title: T('{project} içinde yeni oturum', { project: projectLabel(dir) }), onclick: () => newSession(dir) }, icon('<path d="M12 5v14M5 12h14"/>')),
        isGeneral(dir) ? null : el('button', { class: 'p-btn', type: 'button', title: T('Projeyi listeden kaldır'), onclick: () => removeProject(dir) }, icon('<path d="M6 6l12 12M18 6L6 18"/>'))));

    const group = el('div', { class: 'project' }, head);
    if (collapsed) return group;
    if (!rows.length) {
      group.append(el('div', { class: 'list-empty', text: T(state.sessionsByDir.has(k) ? 'Henüz oturum yok' : 'Yükleniyor…') }));
      return group;
    }
    const showAll = state.expanded.has(k);
    // Aktif ve çalışan oturumlar sınırın dışında kalsa da görünür
    const visible = showAll ? rows : rows.filter((r, i) => i < SESSIONS_PER_PROJECT || r.run || r.draft || r.id === state.sessionId);
    group.append(...visible.map(sessionRow));
    if (rows.length > visible.length || showAll) {
      group.append(el('button', { class: 'more-btn', type: 'button',
        text: showAll ? T('Daha az göster') : T('{n} oturum daha', { n: rows.length - visible.length }),
        onclick: () => { showAll ? state.expanded.delete(k) : state.expanded.add(k); renderSessions(); } }));
    }
    return group;
  }));

  const cur = sessionsOf(state.cwd).find((s) => s.id === state.sessionId);
  if (cur) dom.sessionTitle.textContent = cur.title;
}

async function renameSession(s) {
  const title = prompt(T('Oturumun yeni adı:'), s.title);
  if (!title?.trim()) return;
  await fetch(`/api/sessions/${s.id}/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim(), dir: s.cwd }) });
  loadSessions(s.cwd);
}

async function removeSession(s) {
  if (!confirm(T('"{title}" oturumu kalıcı olarak silinsin mi?', { title: s.title }))) return;
  await fetch(`/api/sessions/${s.id}?dir=${encodeURIComponent(s.cwd)}`, { method: 'DELETE' });
  if (s.id === state.sessionId) newSession(s.cwd);
  loadSessions(s.cwd);
}

function resetTranscript() {
  dom.messages.replaceChildren();
  state.tools.clear();
  state.live.clear();
  state.liveByIndex.clear();
  state.prompts.clear();
  state.cost = 0;
  state.metrics = newMetrics();
  state.context = null;
  state.ctxRetries = 0;
  ctx.btn.hidden = true;
  ctx.pop.hidden = true;
  dom.empty.hidden = false;
  dom.statusline.replaceChildren();
  setBusy(false);
}

// Yeni oturum açmak çalışan oturumu durdurmaz; o sunucuda sürer ve listeden geri açılabilir.
function newSession(dir = state.cwd) {
  if (typeof dir !== 'string') dir = state.cwd; // tıklama olayıyla çağrıldıysa
  state.sessionId = null;
  state.liveId = null;
  setCwdLabel(dir);
  resetTranscript();
  dom.sessionTitle.textContent = T('Yeni oturum');
  renderSessions();
  openLive({ isNew: true, cwd: dir });
  dom.input.focus();
  closeMenu();
}

function openSession({ sessionId, liveId, cwd }) {
  closeMenu();
  if ((liveId && liveId === state.liveId) || (!liveId && sessionId && sessionId === state.sessionId)) return;
  // Seçimi hemen göster; sunucudan "opened" gelince ekran doldurulur
  state.liveId = liveId || null;
  state.sessionId = sessionId || null;
  setCwdLabel(cwd || state.cwd);
  resetTranscript();
  renderSessions();
  setWorking(T('Oturum açılıyor…'));
  openLive({ sessionId, liveId, cwd: state.cwd });
}

$('#newSessionBtn').onclick = () => newSession(state.selectedProject || state.cwd);

// Seçili proje: kenar çubuğunda vurgulanır, üstteki "Yeni oturum" düğmesi burada oturum açar.
// Bir oturuma geçince o oturumun klasörü otomatik seçilir.
function selectProject(dir, { render = true } = {}) {
  state.selectedProject = dir;
  store.set('atolye:selected', dir);
  $('#newSessionFolder').textContent = isGeneral(dir) ? T('Klasörsüz') : folderOf(dir);
  $('#newSessionBtn').title = isGeneral(dir) ? T('Projeye bağlı olmayan yeni oturum') : T('{dir} içinde yeni oturum aç', { dir });
  if (render) renderSessions();
}
// Boş ekran: proje oturumunda kod önerileri, klasörsüz sohbette genel öneriler.
// "doldur" önerileri gönderilmez, kullanıcı devamını yazsın diye mesaj kutusuna yazılır.
const EMPTY = {
  project: {
    title: 'Ne üzerinde çalışalım?',
    text: 'Kodunuzu okuyabilir, düzenleyebilir ve komut çalıştırabilirim. Değişiklik yapmadan önce izninizi isterim.',
    tips: [
      ['Projeyi özetle', 'Bu projenin yapısını incele ve kısaca özetle.'],
      ['Testleri çalıştır', 'Projedeki testleri çalıştır ve hata varsa düzelt.'],
      ['Kodu incele', 'Son değişiklikleri incele ve olası hataları bul.'],
    ],
  },
  general: {
    title: 'Ne sormak istersiniz?',
    text: 'Bu sohbet bir projeye bağlı değil. Genel sorular sorabilir, ağ ya da sistem sorunlarını birlikte teşhis edebiliriz; gerekirse izninizle komut çalıştırırım.',
    tips: [
      ['Ağ bağlantımı kontrol et', 'Ağ bağlantımı kontrol et: DNS, varsayılan ağ geçidi, proxy ayarları ve internete erişimi test et; sorun varsa açıkla.'],
      ['Bir hatayı açıkla', 'Şu hata mesajını açıklar mısın, olası sebepleri ve çözümleri neler?\n\n', true],
      ['Komut yaz', 'Şu iş için bir PowerShell komutu yaz: ', true],
    ],
  },
};
function updateEmptyState(cwd) {
  const e = isGeneral(cwd) ? EMPTY.general : EMPTY.project;
  $('h1', dom.empty).textContent = T(e.title);
  $('p', dom.empty).textContent = T(e.text);
  $('.suggestions', dom.empty).replaceChildren(...e.tips.map(([label, key, fillOnly]) =>
    el('button', { type: 'button', text: T(label), onclick: () => {
      const prompt = T(key);
      dom.input.value = prompt;
      autoGrow();
      if (fillOnly) { dom.input.focus(); dom.input.setSelectionRange(prompt.length, prompt.length); } else send();
    } })));
  const logo = $('.empty-logo', dom.empty);
  logo.classList.toggle('general', isGeneral(cwd));
}

// ---------- Klasör seçici ----------
const dlg = $('#folderDialog');
const pathInput = $('#pathInput');
const dirList = $('#dirList');

let browseReq = 0;
async function browse(p) {
  const req = ++browseReq;
  try {
    const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}`).then((r) => r.json());
    if (req !== browseReq) return; // daha yeni bir istek var, eski cevabı yazma
    if (res.error) throw new Error(res.error);
    pathInput.value = res.path;
    const items = [];
    if (res.parent !== null && res.parent !== undefined)
      items.push(el('button', { class: 'dir-item', type: 'button', onclick: () => browse(res.parent) }, icon(ICONS.up), '..'));
    for (const d of res.dirs) items.push(el('button', { class: 'dir-item', type: 'button', ondblclick: () => browse(d.path), onclick: () => browse(d.path) }, icon(ICONS.folder), d.name));
    dirList.replaceChildren(...items);
  } catch (err) {
    if (req !== browseReq) return;
    dirList.replaceChildren(el('div', { class: 'list-empty', text: err.message }));
  }
}
function openFolderDialog() { browse(state.cwd); dlg.showModal(); }
$('#folderBtn').onclick = openFolderDialog;
$('#pathGo').onclick = () => browse(pathInput.value);
pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browse(pathInput.value); } });
// Seçilen klasör projelere eklenir ve içinde yeni bir oturum açılır
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok' || !pathInput.value) return;
  const dir = pathInput.value;
  state.collapsed.delete(pathKey(dir));
  addProject(dir);
  newSession(dir);
});

// Aktif oturumun klasörü: başlıkta gösterilir, yeni oturumlar varsayılan olarak burada açılır
function setCwdLabel(cwd) {
  state.cwd = cwd;
  store.set('atolye:cwd', cwd);
  dom.sessionCwd.textContent = isGeneral(cwd) ? T('Klasörsüz sohbet · proje bağlamı yok') : cwd;
  updateEmptyState(cwd);
  addProject(cwd);
  selectProject(cwd, { render: false });
}

// ---------- Dil ----------
translatePage();
for (const b of document.querySelectorAll('.lang-switch button')) {
  b.classList.toggle('on', b.dataset.lang === getLang());
  b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  // Dil değişince sayfa yenilenir; oturumlar sunucuda çalışmaya devam eder
  b.onclick = () => { if (b.dataset.lang !== getLang()) setLang(b.dataset.lang); };
}

// ---------- Tema ve mobil menü ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store.get('atolye:theme', ''));
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store.set('atolye:theme', next);
};
$('#menuBtn').onclick = () => dom.app.classList.toggle('menu-open');
function closeMenu() { dom.app.classList.remove('menu-open'); }

// ---------- Harcama göstergesi (ATOLYE_SPEND_CMD ayarlıysa) ----------
const spend = {
  wrap: $('#spendWrap'), btn: $('#spendBtn'), text: $('#spendText'), pop: $('#spendPop'),
  out: $('#spendOutput'), table: $('#spendTable'), title: $('#spendTitle'), time: $('#spendTime'),
};
let spendLoading = null;

async function loadSpend(force = false) {
  if (spendLoading) return;
  if (force) spend.text.textContent = T('Güncelleniyor…');
  spendLoading = fetch(`/api/spend?lang=${getLang()}${force ? '&refresh=1' : ''}`).then((r) => r.json()).catch((err) => ({ enabled: true, ok: false, error: err.message }));
  const res = await spendLoading;
  spendLoading = null;
  // Gateway harcama özeti sunmuyorsa gösterge hiç görünmez
  spend.wrap.hidden = !res.enabled;
  if (!res.enabled) return;
  spend.btn.classList.remove('warn', 'err');
  if (!res.ok) {
    spend.text.textContent = T('Harcama alınamadı');
    spend.btn.classList.add('err');
    spend.out.textContent = res.error || T('Bilinmeyen hata');
    spend.out.hidden = false;
    spend.table.hidden = true;
    spend.title.textContent = T('Harcama alınamadı');
    spend.time.textContent = '';
    return;
  }
  spend.text.textContent = res.summary || T('Harcama');
  if (res.percent >= 90) spend.btn.classList.add('err');
  else if (res.percent >= 75) spend.btn.classList.add('warn');
  spend.table.replaceChildren(...(res.items || []).map((i) => el('tr', {}, el('th', { text: i.label }), el('td', { text: i.value }))));
  spend.table.hidden = false;
  spend.out.hidden = true;
  spend.title.textContent = T(res.title || 'Harcama');
  spend.time.textContent = T('Son güncelleme: {time}', { time: new Date(res.at).toLocaleTimeString(locale()) });
}

spend.btn.onclick = (e) => { e.stopPropagation(); spend.pop.hidden = !spend.pop.hidden; };
$('#spendRefresh').onclick = (e) => { e.stopPropagation(); loadSpend(true); };
spend.pop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { spend.pop.hidden = true; });
setInterval(() => loadSpend(), 5 * 60_000);

// Geliştirme için: ?debug ile açıldığında olaylar konsoldan elle verilebilir
if (new URLSearchParams(location.search).has('debug')) window.atolyeDebug = { handleEvent, state };

// ---------- Başlangıç ----------
(async function init() {
  state.config = await fetch('/api/config').then((r) => r.json());
  state.model = store.get('atolye:model', '');
  // Klasörsüz sohbet her zaman listenin en üstünde
  if (state.config.generalDir) {
    state.projects = [state.config.generalDir, ...state.projects.filter((p) => !samePath(p, state.config.generalDir))];
    saveProjects();
  }
  setCwdLabel(store.get('atolye:cwd', '') || state.projects[0] || state.config.defaultCwd);
  // Sayfa yenilendiyse en son bakılan oturuma dön
  const last = readJson('atolye:open', null);
  if (last && samePath(last.cwd, state.cwd)) { state.liveId = last.liveId; state.sessionId = last.sessionId; }
  dom.gatewayInfo.textContent = state.config.gateway
    ? T('Gateway: {host}', { host: new URL(state.config.gateway).host })
    : T('Gateway: Claude Code ayarlarından');
  dom.gatewayInfo.title = state.config.gateway || '';
  renderSessions();
  loadAllSessions();
  loadSpend();
  updateSendBtn();
  connect();
  dom.input.focus();
})();
