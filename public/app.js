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
  engineSelect: $('#engineSelect'),
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
  del(k) { try { localStorage.removeItem(k); } catch { /* yoksay */ } },
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
    openLive({ liveId: state.liveId, sessionId: state.sessionId, isNew: !state.liveId && !state.sessionId, engine: state.sessionEngine || state.engine });
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

// Bekçi: oturum belirli sürede açılmazsa sonsuz "açılıyor…" yerine uyarı ve "Tekrar dene"
let openWatch = null;
const OPEN_WATCH_MS = 30_000;
function openLive({ liveId = null, sessionId = null, isNew = false, cwd = state.cwd, engine = state.engine }) {
  const args = { liveId, sessionId, isNew, cwd, engine };
  clearTimeout(openWatch);
  openWatch = setTimeout(() => {
    $('.working', dom.messages)?.remove();
    const box = el('div', { class: 'notice info open-retry' },
      el('span', { text: T('Oturum açılamadı: sunucudan cevap gelmedi.') }),
      el('button', { class: 'btn', type: 'button', text: T('Tekrar dene'), onclick: () => {
        box.remove();
        setWorking(T('Oturum açılıyor…'));
        openLive(args);
      } }));
    append(box);
  }, OPEN_WATCH_MS);
  // Her motorun kendi model seçimi vardır: Claude modeli Copilot'a (ya da tersi) gönderilmez
  wsSend({ type: 'open', new: isNew, liveId, sessionId, cwd, mode: state.mode, model: modelFor(engine) || null, effort: store.get(effortKey(engine), '') || null, role: state.role, lang: getLang(), engine });
}

// ---------- Yapay zekâ motoru (Claude Code / GitHub Copilot) ----------
// Sağ üstteki seçici açık oturumun motorunu gösterir; değiştirmek o klasörde seçilen motorla
// yeni bir oturum açar (açık oturum kendi motoruyla listede çalışmaya devam eder).
state.engine = 'copilot';       // yeni oturumlar için seçilen (varsayılan Copilot; kullanıcının seçimi sunucuda saklanır)
state.sessionEngine = null;     // açık oturumun motoru
state.engines = { claude: { available: true }, copilot: { available: false } };

async function loadEngines(refresh = false) {
  state.engines = await fetch(`/api/engines${refresh ? '?refresh=1' : ''}`).then((r) => r.json()).catch(() => state.engines);
  const opt = dom.engineSelect.querySelector('option[value="copilot"]');
  const cp = state.engines.copilot || {};
  opt.disabled = !cp.available;
  opt.textContent = cp.available ? 'GitHub Copilot' : T('GitHub Copilot (kurulu değil)');
  opt.title = cp.available ? `Copilot CLI ${cp.version || ''}` : cp.error || '';
  if (!cp.available && state.engine === 'copilot') state.engine = 'claude';
  applyEngineUi();
}

function applyEngineUi() {
  const engine = state.sessionEngine || state.engine;
  dom.engineSelect.value = engine;
  dom.engineSelect.parentElement.classList.toggle('copilot', engine === 'copilot');
  const copilot = engine === 'copilot';
  // Model listesi seçili motorun kendi listesidir; Copilot model bildirmiyorsa seçici gizlenir (/model komutu kullanılır)
  dom.modelSelect.parentElement.hidden = copilot && dom.modelSelect.options.length < 2;
  // Harcama göstergesi Claude gateway'inin bütçesidir; Copilot oturumunda gösterilmez (Copilot'un kotası değildir)
  $('#spendWrap').classList.toggle('other-engine', copilot);
  if (copilot && !state.copilotQuota) loadCopilotQuota(); else renderCopilotCredit();
  // Copilot'ta plan modu /plan komutuyla kullanılır
  const planOpt = dom.modeSelect.querySelector('option[value="plan"]');
  planOpt.hidden = copilot;
  planOpt.disabled = copilot;
}

dom.engineSelect.addEventListener('change', () => {
  const engine = dom.engineSelect.value;
  state.engine = engine;
  remember({ engine });
  if (engine !== state.sessionEngine) newSession(state.cwd);
});

function rememberOpen() {
  remember({ open: { liveId: state.liveId, sessionId: state.sessionId, cwd: state.cwd, engine: state.sessionEngine } });
}

// Sunucu oturumu açtığında ekranı baştan kurar: önce diskteki eski geçmiş,
// sonra bu çalışmada oluşan olaylar (akış, araçlar, bekleyen izinler).
function applyOpened(ev) {
  clearTimeout(openWatch);
  state.liveId = ev.liveId;
  state.sessionEngine = ev.engine || 'claude';
  state.sessionId = ev.sessionId;
  if (ev.cwd && !samePath(ev.cwd, state.cwd)) setCwdLabel(ev.cwd);
  rememberOpen();
  resetTranscript();
  // Önceki motorun modelleri listede kalmasın: liste her açılışta bu oturumun motorundan kurulur
  state.model = ev.model || '';
  setCapabilities(ev.capabilities || {});
  setMode(ev.mode, false);
  renderSessions();

  for (const m of ev.history || []) {
    if (m.type === 'assistant') renderAssistant(m, true);
    else if (m.type === 'user') renderUserFromSdk(m, true);
  }
  for (const e of ev.events || []) handleEvent(e);
  // Copilot oturumu arka planda hazırlanırken (GitHub'a bağlanma, model listesi) bunu göster
  if (ev.engine === 'copilot' && ev.ready === false) append(el('div', { class: 'notice info boot-notice', text: T("Copilot'a bağlanılıyor… Hazır olunca mesajınız gönderilir; bu, şirket ağında bir dakikaya kadar sürebilir.") }));
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
    case 'model': setModelValue(ev.model || ''); store.set(modelKey(currentEngine()), ev.model || ''); return;
    case 'effort': $('#effortSelect').value = ev.effort || ''; return;
    case 'credits': state.credits = ev.credits; return updateStatus();
    case 'capabilities': return setCapabilities(ev);
    case 'error': clearTimeout(openWatch); setBusy(false); $('.boot-notice', dom.messages)?.remove(); return notice(ev.message);
    case 'opened': return applyOpened(ev);
    case 'context': return onContext(ev);
    case 'live': return onLiveList(ev.sessions || []);
    case 'state': return applyServerState(ev.state);
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
      $('.boot-notice', dom.messages)?.remove();
      const isNew = state.sessionId !== msg.session_id;
      state.sessionId = msg.session_id;
      setMode(msg.permissionMode, false);
      dom.statusline.dataset.model = msg.model;
      if (Array.isArray(msg.mcp_servers)) state.mcpServers = Object.fromEntries(msg.mcp_servers.map((m) => [m.name, m.status]));
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
  if (msg.type === 'assistant') {
    if (autoFetch.active && !msg.parent_tool_use_id) autoFetch.text += (msg.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return renderAssistant(msg, false);
  }
  if (msg.type === 'user') return renderUserFromSdk(msg, false);
  if (msg.type === 'result') {
    renderResult(msg);
    if (autoFetch.active) checkFetchRequest();
    return;
  }
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
  if (msg.copilot_credits) state.credits = msg.copilot_credits;
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
  if (currentEngine() === 'copilot') loadCopilotQuota();
}

// Sağ üstteki Copilot göstergesi: kalan kota (Copilot CLI'ın yerel önbelleğinden) ve bu oturumda harcanan kredi
function renderCopilotCredit() {
  const q = state.copilotQuota;
  const parts = [];
  const tips = [];
  if (q?.available) {
    if (q.unlimited) parts.push(T('Copilot: sınırsız'));
    else if (q.remaining != null && q.total != null) {
      // GitHub'ın kendi ekranlarındaki gibi "kullanılan / toplam" gösterilir; kalan miktar ipucunda yazar
      const fmt = (n) => Number(n.toFixed(1)).toLocaleString(locale());
      const used = Math.max(0, q.total - q.remaining);
      parts.push(T('Copilot: {used} / {total} kredi kullanıldı', { used: fmt(used), total: fmt(q.total) }));
      tips.push(T('Kalan: {remaining} kredi (%{pct})', { remaining: fmt(q.remaining), pct: q.percentRemaining != null ? Math.round(q.percentRemaining) : Math.round((q.remaining / q.total) * 100) }));
    }
    else if (q.percentRemaining != null) parts.push(T('Copilot: %{n} kaldı', { n: Math.round(q.percentRemaining) }));
    if (q.plan) tips.push(T('Plan: {plan}', q));
    if (q.overage) tips.push(T('Aşım: {n}', { n: q.overage }));
    if (q.resetDate) tips.push(T('Sıfırlanma: {date}', { date: String(q.resetDate).slice(0, 10) }));
    if (q.retrievedAt) tips.push(T('Copilot bu bilgiyi en son {time} tarihinde yeniledi', { time: new Date(q.retrievedAt).toLocaleString(locale()) }));
  }
  if (state.credits) parts.push(T('oturum: {n} {unit}', { n: Number(state.credits.amount.toFixed(2)), unit: creditUnit(state.credits.unit) }));
  const show = parts.length > 0 && currentEngine() === 'copilot';
  const box = $('#copilotCredit');
  box.hidden = !show;
  if (!show) return;
  $('#copilotCreditText').textContent = parts.join(' · ');
  const level = q?.available && !q.unlimited && q.percentRemaining != null ? (q.percentRemaining <= 10 ? 'err' : q.percentRemaining <= 30 ? 'warn' : '') : '';
  box.classList.toggle('err', level === 'err');
  box.classList.toggle('warn', level === 'warn');
  box.title = [...tips, T('Kalan kota Copilot CLI\'ın bu bilgisayardaki önbelleğinden okunur; Copilot yeniledikçe güncellenir.')].join('\n');
}
async function loadCopilotQuota() {
  state.copilotQuota = await fetch('/api/copilot/quota').then((r) => r.json()).catch(() => null);
  renderCopilotCredit();
}

const creditUnit = (u) => (!u || /^(aic|credits?)$/i.test(u) ? T('kredi') : u);

function updateStatus() {
  const bits = [];
  if (dom.statusline.dataset.model) bits.push(dom.statusline.dataset.model);
  if (state.cost) bits.push(T('oturum ≈ ${n}', { n: state.cost.toFixed(3) }));
  // Copilot: bu oturumda harcanan kredi (Copilot bildiriyorsa). Kalan kota Copilot tarafından bildirilmez.
  // Sağ üstteki gösterge: bu oturumda harcanan kredi (yalnızca Copilot oturumunda ve harcama bildirildiyse)
  renderCopilotCredit();
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

// Model seçimi motor başına saklanır
const currentEngine = () => state.sessionEngine || state.engine;
const modelKey = (engine) => (engine === 'copilot' ? 'atolye:model:copilot' : 'atolye:model');
const modelFor = (engine) => store.get(modelKey(engine), '');

function setCapabilities({ models = [], commands = [], effort = null }) {
  renderEffort(effort);
  state.commands = commands;
  const copilot = currentEngine() === 'copilot';
  const options = models.filter((m) => m.value && m.value !== 'default').map((m) => el('option', { value: m.value, text: m.name || m.value, title: m.description || '' }));
  // Claude'da "varsayılan" bir seçenektir; Copilot her zaman belirli bir model bildirir
  if (!copilot) options.unshift(el('option', { value: '', text: T('Varsayılan model') }));
  dom.modelSelect.replaceChildren(...options);
  setModelValue(state.model);
  applyEngineUi();
}

// Düşünme seviyesi: seçili motorun ve modelin sunduğu seviyeler (yoksa seçici gizlenir). Seçim motor başına saklanır.
const effortKey = (engine) => `atolye:effort:${engine === 'copilot' ? 'copilot' : 'claude'}`;
const EFFORT_NAMES = { none: 'kapalı', minimal: 'en düşük', low: 'düşük', medium: 'orta', high: 'yüksek', xhigh: 'çok yüksek', max: 'en yüksek' };
function renderEffort(effort) {
  const options = effort?.options || [];
  const sel = $('#effortSelect');
  $('#effortWrap').hidden = options.length < 2;
  sel.replaceChildren(
    ...(effort?.hasDefault ? [el('option', { value: '', text: T('Düşünme: varsayılan') })] : []),
    ...options.map((o) => el('option', { value: o.value, title: o.description || '', text: T('Düşünme: {level}', { level: EFFORT_NAMES[o.value] ? T(EFFORT_NAMES[o.value]) : o.name }) })));
  sel.value = effort?.current || '';
}
$('#effortSelect').addEventListener('change', () => {
  const effort = $('#effortSelect').value;
  store.set(effortKey(currentEngine()), effort);
  wsSend({ type: 'set_effort', effort });
});

function setModelValue(model) {
  state.model = model;
  if (model && ![...dom.modelSelect.options].some((o) => o.value === model)) {
    if (currentEngine() === 'copilot') return; // Copilot'un listesinde olmayan bir model gösterilmez
    dom.modelSelect.append(el('option', { value: model, text: model }));
  }
  dom.modelSelect.value = model;
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
  store.set(modelKey(currentEngine()), state.model);
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
  warnIfLinkUnavailable();
  const outgoing = text && !text.startsWith('/') && !text.includes(T('[veri sonu]')) && usesFetchProtocol() ? withFetchProtocol(text) : withLinkHint(text || T('Bu görsele bak.'));
  wsSend({ type: 'send', text: outgoing, images });
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
// Proje listesi, daraltılmış klasörler, son seçili klasör ve son açık oturum Atölye'nin
// kendisinde, diskte (~/.atolye/durum.json) tutulur — tarayıcının yerel deposunda değil.
// Böylece tarayıcı kapanışta site verilerini temizlese, port (adres) değişse ya da birden
// fazla sekme açık olsa da kaybolmaz. Değişiklikler hemen ekrana yansır, sunucuya yazılır ve
// sunucu diğer sekmelere "state" olayıyla duyurur.
function api(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());
}
function withGeneralFirst(list) {
  const g = state.config?.generalDir;
  return g ? [g, ...list.filter((p) => !samePath(p, g))] : list;
}
/** Sunucudaki durumu uygular (açılışta ve başka bir sekme değişiklik yaptığında) */
function applyServerState(st, { load = true, render = true } = {}) {
  if (!st || !Array.isArray(st.projects)) return;
  const before = new Set(state.projects.map(pathKey));
  state.projects = withGeneralFirst(st.projects);
  // Bu sekmede açık olan klasör listede kalsın (başka sekmede kaldırılmış olsa bile)
  if (state.cwd && !state.projects.some((p) => samePath(p, state.cwd))) state.projects.push(state.cwd);
  state.collapsed = new Set(Array.isArray(st.collapsed) ? st.collapsed : []);
  if (load) for (const p of state.projects) if (!before.has(pathKey(p))) loadSessions(p);
  if (render) renderSessions();
}
function setCollapsed(k, collapsed) {
  if (collapsed) state.collapsed.add(k);
  else state.collapsed.delete(k);
  api('/api/state/collapsed', { key: k, collapsed }).catch(() => {});
}
// Bir sonraki açılış için hatırlananlar (son klasör, seçili proje, açık oturum); kısa aralıkla toplanıp yazılır
const pendingRemember = {};
let rememberTimer = null;
function remember(fields) {
  Object.assign(pendingRemember, fields);
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => {
    const body = { ...pendingRemember };
    for (const k of Object.keys(pendingRemember)) delete pendingRemember[k];
    api('/api/state/remember', body).catch(() => {});
  }, 300);
}

state.projects = [];
state.collapsed = new Set();
state.expanded = new Set(); // "daha fazla göster" açılan projeler
state.sessionsByDir = new Map(); // pathKey -> oturumlar

const sessionsOf = (dir) => state.sessionsByDir.get(pathKey(dir)) || [];

/** Projeyi listeye ekler; yeni eklendiyse true döner. */
function addProject(dir, { load = true } = {}) {
  if (!dir || state.projects.some((p) => samePath(p, dir))) return false;
  state.projects = withGeneralFirst([...state.projects, dir]);
  if (!isGeneral(dir)) api('/api/state/projects', { op: 'add', dir }).catch(() => {});
  if (load) loadSessions(dir);
  return true;
}

function removeProject(dir) {
  const running = state.running.filter((r) => samePath(r.cwd, dir) && (r.busy || r.waiting)).length;
  if (running && !confirm(T('{folder} klasöründe çalışan {n} oturum var. Yine de listeden kaldırılsın mı? (Çalışmaya devam ederler.)', { folder: folderOf(dir), n: running }))) return;
  state.projects = state.projects.filter((p) => !samePath(p, dir));
  api('/api/state/projects', { op: 'remove', dir }).catch(() => {});
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
    rows.push({ id: r.sessionId, liveId: r.liveId, engine: r.engine, title: r.title || T('Yeni oturum'), lastModified: r.lastActivity, run: r, cwd: dir });
  }
  for (const s of disk) rows.push({ ...s, run: runningBySession.get(s.id), cwd: dir });
  // Liste seçili motorun oturumlarını gösterir; diğer motorda hâlâ çalışan/onay bekleyen oturum gizlenmez
  const engine = currentEngine();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const other = (r.engine || r.run?.engine || 'claude') !== engine;
    if (other && !(r.run && (r.run.busy || r.run.waiting))) rows.splice(i, 1);
  }
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
    // Liste zaten seçili motorun oturumlarını gösterir; etiket yalnızca diğer motorda hâlâ çalışan oturumda çıkar
    !s.draft && (s.engine || s.run?.engine || 'claude') !== currentEngine()
      ? el('span', { class: 's-engine', text: (s.engine || s.run?.engine) === 'copilot' ? 'Copilot' : 'Claude', title: (s.engine || s.run?.engine) === 'copilot' ? 'GitHub Copilot' : 'Claude Code' })
      : null,
    el('span', { class: 's-time', text: timeAgo(s.lastModified) }),
    s.id && !s.run?.busy ? el('span', { class: 's-actions' },
      el('span', { title: T('Yeniden adlandır'), onclick: (e) => { e.stopPropagation(); renameSession(s); } }, icon(ICONS.pencil)),
      el('span', { title: T('Sil'), onclick: (e) => { e.stopPropagation(); removeSession(s); } }, icon(ICONS.trash))) : null);
  item.onclick = () => (s.draft ? dom.input.focus() : openSession({ sessionId: s.id, liveId: s.run?.liveId || s.liveId, cwd: s.cwd, engine: s.engine || s.run?.engine }));
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
      setCollapsed(k, !state.collapsed.has(k));
      renderSessions();
    };

    // Klasör adına tıklamak projeyi seçer (üstteki "Yeni oturum" burada açar); ok simgesi açar/kapatır
    const head = el('div', { class: `project-head ${isSelected ? 'current' : ''}` },
      el('button', { class: 'p-toggle', type: 'button', title: T('{dir}\nSeçmek için tıklayın', { dir }), 'aria-pressed': String(isSelected),
        onclick: () => { selectProject(dir); if (collapsed) { setCollapsed(k, false); renderSessions(); } } },
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
  await fetch(`/api/sessions/${s.id}/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim(), dir: s.cwd, engine: s.engine }) });
  loadSessions(s.cwd);
}

async function removeSession(s) {
  if (!confirm(T('"{title}" oturumu kalıcı olarak silinsin mi?', { title: s.title }))) return;
  await fetch(`/api/sessions/${s.id}?dir=${encodeURIComponent(s.cwd)}&engine=${s.engine || 'claude'}`, { method: 'DELETE' });
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
  state.credits = null;
  autoFetch.active = false;
  autoFetch.allowed = false;
  state.mcpServers = null;
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
  state.sessionEngine = state.engine;
  applyEngineUi();
  openLive({ isNew: true, cwd: dir, engine: state.engine });
  dom.input.focus();
  closeMenu();
}

function openSession({ sessionId, liveId, cwd, engine = 'claude' }) {
  closeMenu();
  if ((liveId && liveId === state.liveId) || (!liveId && sessionId && sessionId === state.sessionId)) return;
  // Seçimi hemen göster; sunucudan "opened" gelince ekran doldurulur
  state.liveId = liveId || null;
  state.sessionId = sessionId || null;
  setCwdLabel(cwd || state.cwd);
  resetTranscript();
  renderSessions();
  setWorking(T('Oturum açılıyor…'));
  state.sessionEngine = engine;
  applyEngineUi();
  openLive({ sessionId, liveId, cwd: state.cwd, engine });
}

$('#newSessionBtn').onclick = () => newSession(state.selectedProject || state.cwd);

// Seçili proje: kenar çubuğunda vurgulanır, üstteki "Yeni oturum" düğmesi burada oturum açar.
// Bir oturuma geçince o oturumun klasörü otomatik seçilir.
function selectProject(dir, { render = true } = {}) {
  state.selectedProject = dir;
  remember({ selected: dir });
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
  analistProject: {
    title: 'Neyi anlamak istersiniz?',
    text: 'Bu projeyi sizin için okuyup sade bir dille anlatabilirim: ne işe yarar, hangi iş kuralları var, bir değişiklik nereleri etkiler. Siz istemedikçe hiçbir şeyi değiştirmem.',
    tips: [
      ['Projeyi sade dille anlat', 'Bu proje ne işe yarıyor? Teknik olmayan, sade bir dille anlat: ana işlevler, kullanıcılar ve dış sistemlerle bağlantıları.'],
      ['İş kurallarını çıkar', 'Bu projedeki iş kurallarını ve doğrulamaları koddan çıkar; madde madde, sade bir dille yaz ve her birinin hangi dosyada olduğunu belirt.'],
      ['Bir değişikliğin etkisi', 'Şu değişikliği yapmak istesek hangi ekranlar, servisler ve veriler etkilenir? Sade bir dille anlat: ', true],
    ],
  },
  analistGeneral: {
    title: 'Ne sormak istersiniz?',
    text: 'Bu sohbet bir projeye bağlı değil. Jira kayıtları, Confluence sayfaları ve loglar hakkında soru sorabilir ya da genel bir konuda yardım isteyebilirsiniz.',
    tips: [
      ['Jira kayıtlarım', 'Bana atanmış açık Jira kayıtlarını listele ve her birini bir cümleyle özetle.'],
      ['Doküman bul', "Confluence'ta şu konuyla ilgili sayfaları bul ve özetle: ", true],
      ['Bir hatayı açıkla', 'Şu hata mesajını teknik olmayan bir dille açıklar mısın, olası sebepleri neler ve kime iletmeliyim?\n\n', true],
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
  const r = currentRole();
  const e = isGeneral(cwd) ? (EMPTY[r.emptyGeneral] || EMPTY.general) : (EMPTY[r.emptyProject] || EMPTY.project);
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
  setCollapsed(pathKey(dir), false);
  addProject(dir);
  newSession(dir);
});

// Aktif oturumun klasörü: başlıkta gösterilir, yeni oturumlar varsayılan olarak burada açılır
function setCwdLabel(cwd) {
  state.cwd = cwd;
  remember({ cwd });
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

// ---------- Bağlantılar: Jira / Confluence / Bitbucket ----------
// Bilgiler sunucuda Claude Code ve Copilot CLI'ın kendi ayar dosyalarına yazılır (bkz. src/integrations.js).
const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';
const SAVE_STEP = () => T('Oluşan anahtarı kopyalayıp aşağıya yapıştırın (yalnızca bir kez gösterilir) ve "Kaydet ve sına" deyin.');
const LINKS = {
  jira: {
    name: 'Jira',
    urlHint: 'https://jira.sirket.com',
    steps: () => [
      T("Jira'yı tarayıcıda açın ve adres çubuğundaki ana adresi kopyalayın (ör. https://jira.sirket.com ya da https://sirket.atlassian.net)."),
      T('Şirket içi Jira (Data Center): sağ üstteki profil resmi → Profil → Kişisel Erişim Belirteçleri (Personal Access Tokens) → Belirteç oluştur. E-posta alanını boş bırakın.'),
      [T('Jira Cloud (atlassian.net): şu sayfada "API belirteci oluştur" deyin ve e-posta alanına Atlassian hesabınızın e-postasını yazın:'), TOKEN_PAGE],
      SAVE_STEP(),
    ],
    examples: () => T('Örnek: "Bana atanmış açık Jira kayıtlarını listele" ya da "ABC-123 kaydını oku ve çözüm öner".'),
  },
  confluence: {
    name: 'Confluence',
    urlHint: 'https://confluence.sirket.com',
    steps: () => [
      T("Confluence'ı tarayıcıda açın ve ana adresi kopyalayın (ör. https://confluence.sirket.com ya da https://sirket.atlassian.net/wiki)."),
      T('Şirket içi Confluence (Data Center): sağ üstteki profil resmi → Ayarlar → Kişisel Erişim Belirteçleri (Personal Access Tokens) → Belirteç oluştur. E-posta alanını boş bırakın.'),
      [T('Confluence Cloud: Jira ile aynı API belirteci kullanılır; şu sayfadan oluşturun ve e-posta alanına Atlassian hesabınızın e-postasını yazın:'), TOKEN_PAGE],
      SAVE_STEP(),
    ],
    examples: () => T('Örnek: "Confluence içinde kurulum dokümanını bul ve özetle".'),
  },
  bitbucket: {
    name: 'Bitbucket',
    urlHint: 'https://bitbucket.sirket.com',
    steps: () => [
      T("Bitbucket'ı tarayıcıda açın ve ana adresi kopyalayın (ör. https://bitbucket.sirket.com; Cloud için https://bitbucket.org/calisma-alaniniz)."),
      T('Şirket içi Bitbucket (Data Center): sağ üstteki profil resmi → Hesabı yönet → HTTP erişim belirteçleri (HTTP access tokens) → Belirteç oluştur. Depo için "okuma" izni yeterlidir. E-posta alanını boş bırakın.'),
      [T('Bitbucket Cloud: şu sayfada "Kapsamlı API belirteci oluştur" deyip Bitbucket ile depo ve çekme isteği okuma izinlerini seçin; e-posta alanına Atlassian hesabınızın e-postasını yazın:'), TOKEN_PAGE],
      SAVE_STEP(),
    ],
    examples: () => T('Örnek: "ABC projesindeki depo-adi deposunun açık çekme isteklerini listele ve 42 numaralıyı incele".'),
  },
};
LINKS.graylog = {
  name: 'Graylog',
  urlHint: 'https://graylog.sirket.com',
  noEmail: true,
  steps: () => [
    T("Graylog'u tarayıcıda açın ve ana adresi kopyalayın (ör. https://graylog.sirket.com)."),
    T('Sağ üstteki kullanıcı simgesi → "Edit Profile" (Profili düzenle) → "Edit Tokens" (Belirteçleri düzenle). Bir ad yazıp "Create Token" deyin.'),
    T('Listede yeni belirtecin yanındaki kopyalama düğmesiyle değeri kopyalayın. Menüyü göremiyorsanız belirteç oluşturma yetkiniz yoktur; Graylog yöneticinizden isteyin.'),
    SAVE_STEP(),
  ],
  examples: () => T('Örnek: "Graylog\'da son 30 dakikada uygulama-adi için hata kayıtlarını bul ve sebebini özetle".'),
};
LINKS.jenkins = {
  name: 'Jenkins',
  urlHint: 'https://jenkins.sirket.com',
  userLabel: () => T('Kullanıcı adı'),
  userHint: () => T('Jenkins kullanıcı adınız (sağ üstte görünen ad).'),
  tokenLabel: () => T('API belirteci'),
  steps: () => [
    T("Jenkins'i tarayıcıda açın ve ana adresi kopyalayın (ör. https://jenkins.sirket.com)."),
    T('Sağ üstteki adınıza tıklayın → "Configure" (Yapılandır) ya da "Security" → "API Token" bölümünde "Add new Token" deyip bir ad verin ve "Generate" ile oluşturun.'),
    T('Kullanıcı adı alanına Jenkins kullanıcı adınızı yazın; belirteci kopyalayıp API belirteci alanına yapıştırın (yalnızca bir kez gösterilir).'),
    T('"Kaydet ve sına" deyin.'),
  ],
  examples: () => T('Örnek: "takim/proje işinin son derlemesi neden kırıldı? Konsol çıktısına bakıp sebebini söyle".'),
};
LINKS.fortify = {
  name: 'Fortify',
  urlHint: 'https://fortify.sirket.com/ssc',
  userLabel: () => T('Kullanıcı adı'),
  userHint: () => T('Parolayla giriş yapacaksanız doldurun; erişim belirteci kullanacaksanız boş bırakın.'),
  tokenLabel: () => T('Parola ya da erişim belirteci'),
  steps: () => [
    T("Fortify Software Security Center'ı (SSC) tarayıcıda açın ve adres çubuğundaki adresi kopyalayın; Atölye /ssc ile biten kök adresi kendisi bulur (ör. https://fortify.sirket.com/ssc)."),
    T('Elinizde yalnızca kullanıcı adı ve parola varsa: ikisini de aşağıya yazın. Atölye her oturumda sizin adınıza geçici bir erişim belirteci alır; parola bilgisayarınızda düz metin olarak saklanır.'),
    T('Erişim belirteci oluşturabiliyorsanız ("Administration" → "Users" → "Token Management" → "New"): tür olarak listede varsa "UnifiedLoginToken" (kısa süreli), yoksa "AutomationToken" ya da "CIToken" seçin; oluşan "encoded token" değerini kopyalayın, kullanıcı adını boş bırakıp belirteci yapıştırın ve "Kaydet ve sına" ile deneyin. Parola saklamadığı için bu yol daha güvenlidir.'),
    T('"Kaydet ve sına" deyin.'),
  ],
  examples: () => T('Örnek: "Fortify\'da proje-adi sürümündeki kritik bulguları listele ve ilkinin nasıl düzeltileceğini anlat".'),
};
LINKS.weblogic = {
  name: 'WebLogic',
  urlHint: 'http://weblogic.sirket.com:7001',
  userLabel: () => T('Kullanıcı adı'),
  userHint: () => T('Yalnızca izleme (Monitor) yetkisi olan bir kullanıcı yeterlidir; yönetici hesabı kullanmayın.'),
  tokenLabel: () => T('Parola'),
  steps: () => [
    T('WebLogic yönetim sunucusunun (Admin Server) adresini yazın: konsol adresinin /console öncesindeki kısmı (ör. http://weblogic.sirket.com:7001).'),
    T('Atölye yalnızca okuma yapar (sunucu, uygulama ve veri kaynağı durumları). Bunun için "Monitor" rolünde bir kullanıcı yeterlidir; böyle bir kullanıcıyı WebLogic yöneticinizden isteyin.'),
    T('Kullanıcı adını ve parolayı girip "Kaydet ve sına" deyin. Parola bilgisayarınızda düz metin olarak saklanır; bu yüzden yönetici (admin) hesabını kullanmayın.'),
  ],
  examples: () => T('Örnek: "WebLogic sunucularının durumunu ve sağlıksız uygulama var mı kontrol et".'),
};
const links = { status: null, tab: 'jira', result: {} };
// Kayıtlı parola/anahtar alanda nokta nokta görünür; gerçek değer tarayıcıya hiç gelmez. Alan değiştirilmeden
// bırakılırsa sunucuya boş gönderilir ve kayıtlı değer korunur.
const SAVED_SECRET = '\u2022'.repeat(12);
const secretInput = (saved, placeholder) => {
  const input = el('input', { type: 'password', placeholder, autocomplete: 'new-password' });
  if (saved) {
    input.value = SAVED_SECRET;
    input.title = T('Kayıtlı. Değiştirmek için silip yenisini yazın.');
    input.addEventListener('focus', () => { if (input.value === SAVED_SECRET) input.select(); });
  }
  return input;
};
const secretValue = (input) => (input.value === SAVED_SECRET ? '' : input.value);
// Alanın altındaki küçük bilgi: değerin bilgisayarda nereye yazıldığı
const savedWhere = (text) => el('small', { class: 'links-where' }, el('span', { class: 'info-dot', text: 'i' }), el('span', { text }));

// ---------- Kullanım modu (rol) ----------
// Rol; görünen bağlantı sekmelerini, boş ekran önerilerini ve Claude'a verilen anlatım yönergesini belirler.
// Yeni bir rol (ör. yönetici, testçi) eklemek için buraya bir kayıt ve src/session.js içindeki ROLE_PROMPTS'a
// bir satır eklemek yeterlidir.
const ROLES = {
  analist: {
    name: () => T('Analist'),
    tabs: ['jira', 'confluence', 'bitbucket', 'graylog', 'tarayici', 'repo', 'proxy'],
    emptyProject: 'analistProject',
    emptyGeneral: 'analistGeneral',
    fetch: true, // "Veri getir": veriyi Atölye REST ile çeker (yalnızca bu modda; geliştirici modu MCP araçlarını kullanır)
  },
  gelistirici: {
    name: () => T('Geliştirici'),
    tabs: ['jira', 'confluence', 'bitbucket', 'graylog', 'jenkins', 'fortify', 'weblogic', 'tarayici', 'repo', 'proxy'],
    emptyProject: 'project',
    emptyGeneral: 'general',
  },
};
state.role = 'analist';
function currentRole() { return ROLES[state.role] || ROLES.analist; }
const roleTabs = () => currentRole().tabs;
function applyRole() {
  const sel = $('#roleSelect');
  sel.replaceChildren(...Object.entries(ROLES).map(([id, r]) => el('option', { value: id, text: r.name() })));
  if (!ROLES[state.role]) state.role = 'analist';
  sel.value = state.role;
  document.body.dataset.role = state.role;
  if (!roleTabs().includes(links.tab)) links.tab = roleTabs()[0];
  updateEmptyState(state.cwd);
  renderLinkSelect();
  renderLinksBadge();
}
$('#roleSelect').addEventListener('change', () => {
  state.role = $('#roleSelect').value;
  remember({ role: state.role });
  applyRole();
  // Yapay zekânın anlatım biçimi oturum açılırken belirlenir: yeni mod için temiz bir oturum açılır
  newSession(state.cwd);
});

// ---------- Seçili bağlantı bu oturumda kullanılabilir mi? ----------
// Bağlantılar oturum açılırken yüklenir. Bağlantı sonradan kurulduysa, oturum eski bir sürümle açıldıysa ya da
// araç sunucusu başlatılamadıysa yapay zekâ "araç tanımlı değil" der; bunu kullanıcıya önceden ve sebebiyle söyleriz.
state.mcpServers = null; // Claude Code'un bildirdiği { sunucu adı: durum } (Copilot bildirmez)
const linkServer = (link) => (LINKS[link]?.custom ? link : 'atolye');
let linkWarned = '';
function warnIfLinkUnavailable() {
  if (!activeLink) return;
  const name = LINKS[activeLink].name;
  const key = `${state.liveId}|${activeLink}`;
  if (linkWarned === key) return; // aynı oturumda aynı uyarı bir kez
  let text = '';
  if (currentEngine() === 'copilot') {
    // Copilot hangi araçların yüklendiğini bildirmez; veri bağlantılarında Atölye REST ile getirir, tarayıcıda getiremez
    if (LINKS[activeLink].custom && links.status?.services?.tarayici?.library) text = T('Copilot\'ta tarayıcı araçları kuruluş politikasıyla kapalı olabilir. Bu durumda Copilot, bağlantı kurulurken yüklenen Playwright\'ı bir betikle kullanır; yeni bir şey kurması gerekmez.');
    else if (LINKS[activeLink].custom) text = T('{name} bağlantısı yapay zekânın kendi aracıyla çalışır. Kuruluşunuzun Copilot politikası üçüncü taraf araçları kapatmışsa Copilot bunu kullanamaz; bu durumda sağ üstten Claude Code\'u seçip yeni bir oturum açın.', { name });
  } else if (state.mcpServers) {
    const status = state.mcpServers[linkServer(activeLink)];
    if (!status) text = T('{name} bağlantısı bu oturuma yüklenmemiş: bağlantı oturum açıldıktan sonra kurulmuş olabilir. Yeni bir oturum açıp yeniden deneyin.', { name });
    else if (status !== 'connected') text = T('{name} bağlantısı bu oturumda başlatılamadı (durum: {status}). Yeni bir oturum açın; sürerse Bağlantılar penceresinden yeniden kaydedin ve Kayıtlar sayfasına bakın.', { name, status });
  }
  if (!text) return;
  linkWarned = key;
  notice(text, 'info');
}

// ---------- Soruyu bir bağlantıyla ilişkilendirme ----------
// Mesaj kutusunun altındaki seçici yalnızca kurulmuş bağlantıları gösterir. Bir bağlantı seçiliyken gönderilen
// soruya, yapay zekânın o bağlantının araçlarını kullanması için kısa bir not eklenir (mesajda görünür).
const LINK_TOOLS = {
  jira: 'jira_search, jira_get_issue, jira_add_comment',
  confluence: 'confluence_search, confluence_get_page',
  bitbucket: 'bitbucket_list_repos, bitbucket_list_pull_requests, bitbucket_get_pull_request, bitbucket_get_file',
  graylog: 'graylog_search, graylog_list_streams',
  jenkins: 'jenkins_list_jobs, jenkins_get_build, jenkins_get_console, jenkins_trigger_build',
  fortify: 'fortify_list_versions, fortify_list_issues, fortify_get_issue',
  weblogic: 'weblogic_servers, weblogic_applications, weblogic_deployments, weblogic_datasources',
};
let activeLink = '';
function renderLinkSelect() {
  const sel = $('#linkSelect');
  const connected = Object.entries(links.status?.services || {}).filter(([id, s]) => s.connected && LINKS[id] && roleTabs().includes(id)).map(([id]) => id);
  if (!connected.includes(activeLink)) activeLink = '';
  $('#linkWrap').hidden = !connected.length;
  sel.replaceChildren(el('option', { value: '', text: T('Bağlantı: yok') }), ...connected.map((id) => el('option', { value: id, text: LINKS[id].name })));
  sel.value = activeLink;
  $('#linkFetchBtn').hidden = !activeLink || !currentRole().fetch || Boolean(LINKS[activeLink]?.custom);
  sel.onchange = () => {
    activeLink = sel.value;
    loadFetchTools(activeLink);
    $('#linkFetchBtn').hidden = !activeLink || !currentRole().fetch || Boolean(LINKS[activeLink]?.custom);
    $('#linkWrap').classList.toggle('active', Boolean(activeLink));
    dom.input.placeholder = activeLink ? T('{name} ile ilgili sorunuzu yazın…', { name: LINKS[activeLink].name }) : linkPlaceholder;
    dom.input.focus();
  };
}
const linkPlaceholder = dom.input.placeholder;
function withLinkHint(text) {
  if (!activeLink || text.startsWith('/')) return text; // komutlara not eklenmez
  // Veri mesaja zaten eklendiyse yapay zekânın araç aramasına gerek yok
  if (text.includes(T('[veri sonu]'))) return text;
  // Tarayıcı + Copilot: araçlar kuruluş politikasıyla kapalı olabilir. Bağlantı kurulurken Playwright zaten kuruldu;
  // yapay zekâ yeni bir şey kurmak yerine onu bir betikle kullanabilsin diye yeri ve seçilen tarayıcı bildirilir.
  const br = links.status?.services?.tarayici;
  if (activeLink === 'tarayici' && currentEngine() === 'copilot' && br?.library) {
    return `${text}\n\n${T('(Tarayıcı araçları (browser_navigate vb.) bu oturumda varsa onları kullan. Yoksa yeni bir kütüphane KURMA: Playwright bu bilgisayarda kurulu. Bir Node.js betiği yazıp çalıştır; kütüphane: require("{library}"), tarayıcı: chromium.launch({ channel: "{channel}", headless: {headless} }). Ekran görüntülerini çalışma klasörüne kaydet ve ne gördüğünü anlat.)', { library: br.library.replace(/\\/g, '/'), channel: br.browser, headless: String(Boolean(br.headless)) })}`;
  }
  return `${text}\n\n${T('({name} bağlantısını kullan; araçlar: {tools})', { name: LINKS[activeLink].name, tools: LINK_TOOLS[activeLink] })}`;
}
const linksDlg = $('#linksDialog');

async function loadLinks() {
  links.status = await fetch('/api/integrations').then((r) => r.json()).catch(() => null);
  renderLinksBadge();
  renderLinkSelect();
}
// Üst çubuktaki sayı: bu modda görünen bağlantılardan kaçının kurulu olduğu
function renderLinksBadge() {
  const n = Object.entries(links.status?.services || {}).filter(([id, s]) => s.connected && roleTabs().includes(id)).length;
  const badge = $('#linksCount');
  badge.hidden = !n;
  badge.textContent = String(n);
}

function renderLinks() {
  const services = links.status?.services || {};
  $('#linksTabs').replaceChildren(...Object.entries(LINKS).filter(([id]) => roleTabs().includes(id)).map(([id, def]) =>
    el('button', { class: 'links-tab', type: 'button', role: 'tab', 'aria-selected': String(id === links.tab), onclick: () => { links.tab = id; renderLinks(); } },
      el('span', { class: `links-dot${services[id]?.connected ? ' on' : ''}` }), el('span', { text: def.name }))),
    el('button', { class: 'links-tab', type: 'button', role: 'tab', 'aria-selected': String(links.tab === 'repo'), onclick: () => { links.tab = 'repo'; renderLinks(); } },
      el('span', { text: T('İlk repom') })),
    el('button', { class: 'links-tab', type: 'button', role: 'tab', 'aria-selected': String(links.tab === 'proxy'), onclick: () => { links.tab = 'proxy'; renderLinks(); } },
      el('span', { class: `links-dot${proxyUi.status?.configured ? ' on' : ''}` }), el('span', { text: 'Proxy' })));
  if (links.tab === 'repo') return renderRepoTab();
  if (links.tab === 'proxy') return renderProxyTab();
  if (links.tab === 'tarayici') return renderBrowserTab();

  const id = links.tab;
  const def = LINKS[id];
  const cur = services[id] || {};
  const url = el('input', { type: 'url', value: cur.url || '', placeholder: def.urlHint, spellcheck: 'false', autocomplete: 'off' });
  const email = el('input', { type: def.userLabel ? 'text' : 'email', value: cur.email || '', placeholder: def.userLabel ? '' : T('yalnızca Cloud (atlassian.net / bitbucket.org) için'), autocomplete: 'off', spellcheck: 'false' });
  const token = secretInput(cur.hasToken, T('API anahtarını yapıştırın'));
  const result = el('div', { class: 'links-result' });
  const show = (r) => {
    links.result[id] = r;
    result.hidden = !r;
    if (!r) return;
    result.className = `links-result ${r.ok ? 'ok' : r.pending ? '' : 'err'}`;
    result.textContent = r.pending ? T('Bağlantı sınanıyor…')
      : r.ok ? T('Bağlantı başarılı: {user} olarak giriş yapıldı.', { user: r.user })
        : T('Bağlanılamadı: {error}', { error: r.error });
    if (!r.ok && !r.pending) result.append(el('div', {}, askErrorButton(T('{name} bağlantısını kurma', { name: def.name }), r.error)));
  };
  const runTest = async () => {
    show({ pending: true });
    const r = await fetch(`/api/integrations/${id}/test?lang=${getLang()}`, { method: 'POST' }).then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
    links.result[id] = r;
    if (links.tab === id) renderLinks(); // nokta ve düğmeler güncellensin
  };
  const saveBtn = el('button', { class: 'btn primary', type: 'button', text: T('Kaydet ve sına'), onclick: async () => {
    saveBtn.disabled = true;
    try {
      const res = await fetch(`/api/integrations/${id}?lang=${getLang()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.value, email: email.value, token: secretValue(token) }) });
      const data = await res.json();
      if (!res.ok) return show({ ok: false, error: data.error });
      await loadLinks();
      await runTest();
    } finally { saveBtn.disabled = false; }
  } });
  const removeBtn = el('button', { class: 'btn ghost', type: 'button', text: T('Bağlantıyı kaldır'), onclick: async () => {
    if (!confirm(T('{name} bağlantısı ve kayıtlı API anahtarı silinsin mi?', { name: def.name }))) return;
    await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
    links.result[id] = null;
    await loadLinks();
    renderLinks();
  } });

  const steps = el('ol', { class: 'links-steps' }, ...def.steps().map((s) => (Array.isArray(s)
    ? el('li', {}, el('span', { text: `${s[0]} ` }), el('a', { href: s[1], target: '_blank', rel: 'noopener noreferrer', text: s[1] }))
    : el('li', { text: s }))));
  $('#linksBody').replaceChildren(...[
    steps,
    el('label', { class: 'links-field' }, el('span', { text: T('Adres') }), url),
    def.noEmail ? null : el('label', { class: 'links-field' }, el('span', { text: def.userLabel ? def.userLabel() : T('E-posta') }), email, el('small', { text: def.userHint ? def.userHint() : T('Şirket içi kurulumda (kişisel erişim belirteci) boş bırakın.') })),
    el('label', { class: 'links-field' }, el('span', { text: def.tokenLabel ? def.tokenLabel() : T('API anahtarı') }), token,
      links.status?.files ? savedWhere(T('Kayıt yeri: {claude} ve {copilot}', links.status.files)) : null),
    el('div', { class: 'links-actions' }, saveBtn,
      cur.connected ? el('button', { class: 'btn', type: 'button', text: T('Bağlantıyı sına'), onclick: runTest }) : null,
      cur.hasToken || cur.url ? removeBtn : null,
      helpButton(id)),
    result,
    el('p', { class: 'links-intro', text: def.examples() }),
  ].filter(Boolean));
  show(links.result[id] || null);
  const f = links.status?.files;
  $('#linksNote').textContent = f
    ? T('Bilgiler yalnızca bu bilgisayarda, Claude Code ve Copilot CLI ayar dosyalarında saklanır: {claude} ve {copilot}. API anahtarı bu dosyalarda düz metin olarak durur; anahtara gereğinden geniş izin vermeyin.', f) + ' ' + T('Not: şirketinizin Copilot politikası üçüncü taraf MCP sunucularını kapatmışsa bu araçlar yalnızca Claude Code oturumlarında kullanılabilir.')
    : '';
}

$('#linksBtn').onclick = async () => {
  await loadLinks();
  repoUi.info = null; // Git ve Bitbucket durumu her açılışta yeniden okunur
  proxyUi.status = await fetch('/api/proxy').then((r) => r.json()).catch(() => null);
  renderLinks();
  linksDlg.showModal();
};
$('#linksClose').onclick = () => linksDlg.close();
linksDlg.addEventListener('click', (e) => { if (e.target === linksDlg) linksDlg.close(); });
loadLinks();

// ---------- Yapay zekâdan yardım ----------
// Bağlantı kurarken ya da depo indirirken takılan kişi, hazır bir soruyla klasörsüz sohbete geçer.
const HELP_PROMPTS = {
  jira: () => T('Jira bağlantısını kurmak istiyorum ama teknik biri değilim. Jira adresimi nereden bulurum ve kişisel erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.'),
  confluence: () => T('Confluence bağlantısını kurmak istiyorum ama teknik biri değilim. Confluence adresimi nereden bulurum ve kişisel erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.'),
  bitbucket: () => T('Bitbucket bağlantısını kurmak istiyorum ama teknik biri değilim. Bitbucket adresimi nereden bulurum ve HTTP erişim belirtecini (API anahtarı) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.'),
  graylog: () => T('Graylog bağlantısını kurmak istiyorum ama teknik biri değilim. Graylog adresimi nereden bulurum ve erişim belirtecini (API token) nasıl oluştururum? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.'),
  tarayici: () => T('Yapay zekânın tarayıcıda gezinmesini (Playwright) kurmak istiyorum ve teknik biri değilim. Bu ne işe yarar, hangi tarayıcıyı seçmeliyim ve kurulumda nelere dikkat etmeliyim? Adım adım, sade bir dille anlat.'),
  repo: () => T('İlk kez bir depoyu (repository) bilgisayarıma indireceğim ve teknik biri değilim. Depo nedir, adresini nereden bulurum, indirdikten sonra dosyalara nasıl bakarım ve değişiklikleri nasıl güncel tutarım? Adım adım, sade bir dille anlat; takıldığım yerde soracağım.'),
};
function askAi(prompt) {
  linksDlg.close();
  newSession(state.config.generalDir || state.cwd);
  dom.input.value = prompt;
  autoGrow();
  updateSendBtn();
  dom.input.focus();
}
const helpButton = (id) => el('button', { class: 'btn ghost links-help', type: 'button', text: T('Yapay zekâdan yardım al'), title: T('Hazır bir soruyla yeni bir sohbet açar; göndermeden önce düzenleyebilirsiniz'), onclick: () => askAi(HELP_PROMPTS[id]()) });
const askErrorButton = (what, error) => el('button', { class: 'btn ghost', type: 'button', text: T('Bu hatayı yapay zekâya sor'),
  onclick: () => askAi(T('{what} sırasında şu hatayı aldım, teknik biri değilim. Sebebi ne olabilir ve nasıl düzeltirim? Adım adım anlat.\n\nHata: {error}', { what, error })) });

// ---------- İlk repom: depo indirme ----------
const repoUi = { info: null, repos: null, result: null, busy: false };

async function renderRepoTab() {
  const body = $('#linksBody');
  if (!repoUi.info) {
    body.replaceChildren(el('div', { class: 'links-result', text: T('Yükleniyor…') }));
    repoUi.info = await fetch('/api/repo/info').then((r) => r.json()).catch(() => ({}));
    if (links.tab !== 'repo') return;
  }
  const info = repoUi.info;
  // Birden fazla depo: her satıra bir adres. Listeden işaretlenenler de buraya eklenir.
  const urls = el('textarea', { rows: '3', placeholder: 'https://bitbucket.sirket.com/scm/abc/depo-adi.git', spellcheck: 'false', autocomplete: 'off' });
  urls.value = repoUi.url || '';
  const lines = () => [...new Set(urls.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
  urls.oninput = () => { repoUi.url = urls.value; syncChecks(); };
  const parent = el('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', value: repoUi.parent || info.defaultParent || '' });
  parent.oninput = () => { repoUi.parent = parent.value; };
  const result = el('div', { class: 'links-result' });
  result.hidden = true;
  let syncChecks = () => {};

  // Bitbucket bağlıysa depolar listeden işaretlenir (birden fazla seçilebilir)
  let picker = null;
  if (info.bitbucket) {
    const project = el('input', { type: 'text', placeholder: T('proje anahtarı (isteğe bağlı), ör. ABC'), spellcheck: 'false', value: repoUi.project || '' });
    project.oninput = () => { repoUi.project = project.value; };
    const filter = el('input', { type: 'text', placeholder: T('listede ara…'), spellcheck: 'false', value: repoUi.filter || '' });
    const list = el('div', { class: 'repo-list' });
    const drawList = () => {
      const q = (repoUi.filter || '').toLowerCase();
      const chosen = new Set(lines());
      list.replaceChildren(...(repoUi.repos || []).filter((r) => !q || r.name.toLowerCase().includes(q)).map((r) => {
        const box = el('input', { type: 'checkbox', checked: chosen.has(r.cloneUrl) });
        box.onchange = () => {
          const cur = lines().filter((u) => u !== r.cloneUrl);
          if (box.checked) cur.push(r.cloneUrl);
          urls.value = cur.join('\n');
          repoUi.url = urls.value;
        };
        return el('label', { class: 'repo-item' }, box, el('span', { text: r.name }));
      }));
      if (!list.children.length) list.append(el('div', { class: 'repo-empty', text: repoUi.repos ? T('Eşleşen depo yok.') : T('Önce "Depoları listele" deyin') }));
    };
    syncChecks = drawList;
    filter.oninput = () => { repoUi.filter = filter.value; drawList(); };
    const listBtn = el('button', { class: 'btn', type: 'button', text: T('Depoları listele'), onclick: async () => {
      listBtn.disabled = true;
      listBtn.replaceChildren(el('span', { class: 'btn-spin' }), el('span', { text: T('Yükleniyor…') }));
      const r = await fetch(`/api/repo/list?project=${encodeURIComponent(project.value.trim())}`).then((x) => x.json()).catch((e) => ({ error: e.message }));
      if (r.error) { repoUi.repos = null; repoUi.result = { failed: [{ name: T('Depo listesini alma'), error: r.error }] }; } else { repoUi.repos = r.repos; repoUi.result = null; }
      if (links.tab === 'repo') renderRepoTab();
    } });
    drawList();
    picker = el('div', { class: 'links-field' }, el('span', { text: T("Bağlı Bitbucket'tan seçin (birden fazla işaretleyebilirsiniz)") }),
      el('div', { class: 'links-row' }, project, listBtn), repoUi.repos ? filter : null, list);
  }

  const cloneBtn = el('button', { class: 'btn primary', type: 'button', text: T('Depoları indir'), disabled: !info.git || repoUi.busy, onclick: async () => {
    const todo = lines();
    if (!todo.length) { repoUi.result = { failed: [{ name: T('Depo indirme'), error: T('Önce en az bir depo adresi girin ya da listeden seçin.') }] }; return renderRepoTab(); }
    repoUi.busy = true;
    cloneBtn.disabled = true;
    result.hidden = false;
    result.className = 'links-result';
    const done = [];
    const failed = [];
    for (const [i, url] of todo.entries()) {
      const name = url.replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '');
      // İlerleme hem düğmede (her zaman görünür) hem altındaki kutuda gösterilir
      cloneBtn.replaceChildren(el('span', { class: 'btn-spin' }), el('span', { text: T('İndiriliyor… ({i}/{n})', { i: i + 1, n: todo.length }) }));
      result.replaceChildren(el('span', { class: 'btn-spin' }), el('span', { text: T('İndiriliyor ({i}/{n}): {name}… Büyük depolarda birkaç dakika sürebilir.', { i: i + 1, n: todo.length, name }) }));
      result.scrollIntoView({ block: 'nearest' });
      const r = await fetch(`/api/repo/clone?lang=${getLang()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, parent: parent.value }) })
        .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
      if (r.ok) done.push({ name, dir: r.dir, url }); else failed.push({ name, error: r.error, url });
    }
    repoUi.busy = false;
    for (const d of done) { setCollapsed(pathKey(d.dir), false); addProject(d.dir); }
    // Aynı klasörde birden fazla depo varsa o kök klasör de proje olarak eklenir: depoların tümü hakkında
    // (birbirleriyle ilişkisi, ortak arama vb.) oradan soru sorulabilir.
    const parentOf = (d) => d.replace(/[\\/]+[^\\/]+[\\/]*$/, '');
    const root = done.length ? parentOf(done[0].dir) : '';
    const inRoot = root ? state.projects.filter((p) => samePath(parentOf(p), root)).length : 0;
    const addRoot = Boolean(root) && inRoot >= 2;
    if (addRoot) { setCollapsed(pathKey(root), false); addProject(root); }
    // İndirilenler listeden düşer; olmayanlar yeniden denenebilsin diye kalır
    urls.value = failed.map((f) => f.url).join('\n');
    repoUi.url = urls.value;
    if (done.length && !failed.length) {
      repoUi.result = null;
      linksDlg.close();
      newSession(addRoot && done.length > 1 ? root : done[0].dir);
      dom.input.value = addRoot && done.length > 1
        ? T('Bu klasöre birden fazla depo indirdim ({names}) ve teknik biri değilim. Her birinin ne işe yaradığını ve birbirleriyle ilişkisini sade bir dille özetle.', { names: done.map((d) => d.name).join(', ') })
        : T('Bu depoyu yeni indirdim ve teknik biri değilim. Ne işe yaradığını, klasör yapısını ve nereden başlamam gerektiğini sade bir dille özetle.');
      autoGrow();
      updateSendBtn();
      return;
    }
    repoUi.result = { done, failed };
    if (links.tab === 'repo') renderRepoTab();
  } });

  const steps = el('ol', { class: 'links-steps' },
    el('li', { text: T('Depo (repository), bir projenin dosyalarının ve değişiklik geçmişinin tutulduğu yerdir. "İndirmek" (clone), onun bir kopyasını bilgisayarınıza alır; asıl depoya dokunmaz.') }),
    el('li', { text: info.bitbucket
      ? T('Aşağıdaki listeden depoları işaretleyin ya da depo sayfasındaki "Clone" (Kopyala) düğmesinden HTTPS adresini kopyalayıp yapıştırın. Birden fazla depo için her satıra bir adres yazın.')
      : T('Depo sayfasındaki "Clone" (Kopyala) düğmesinden HTTPS adresini kopyalayıp aşağıya yapıştırın; birden fazla depo için her satıra bir adres yazın. Bitbucket sekmesinden bağlantı kurarsanız depolar burada listelenir ve giriş otomatik yapılır.') }),
    el('li', { text: T('"Depoları indir" deyin: depolar aşağıdaki klasöre iner, solda proje olarak eklenir ve ilkinde yeni bir oturum açılır.') }));

  body.replaceChildren(...[
    steps,
    info.git ? null : el('div', { class: 'links-result err' },
      el('span', { text: `${T('Git kurulu değil. Depo indirmek için gerekir; şu adresten kurup Atölye\'yi yeniden başlatın:')} ` }),
      el('a', { href: 'https://git-scm.com/download/win', target: '_blank', rel: 'noopener noreferrer', text: 'https://git-scm.com/download/win' })),
    picker,
    el('label', { class: 'links-field' }, el('span', { text: T('Depo adresleri (her satıra bir tane)') }), urls),
    el('label', { class: 'links-field' }, el('span', { text: T('İndirileceği klasör') }), parent, el('small', { text: T('Her depo bu klasörün içinde kendi adıyla bir alt klasöre iner.') })),
    el('div', { class: 'links-actions' }, cloneBtn, helpButton('repo')),
    result,
  ].filter(Boolean));
  const res = repoUi.result;
  if (res) {
    result.hidden = false;
    result.className = `links-result ${res.failed?.length ? 'err' : 'ok'}`;
    result.replaceChildren(...[
      ...(res.done || []).map((d) => el('div', { class: 'repo-ok', text: T('İndirildi: {name} → {dir}', d) })),
      ...(res.failed || []).map((f) => el('div', { text: T('Olmadı ({name}): {error}', f) })),
      res.failed?.length ? askErrorButton(T('Depo indirme'), res.failed[0].error) : null,
    ].filter(Boolean));
  }
  $('#linksNote').textContent = T('İndirme, bilgisayarınızdaki Git ile yapılır. Bitbucket bağlıysa kayıtlı API anahtarı yalnızca bu indirme için kullanılır; sonraki çekme/gönderme işlemlerinde Git kendi giriş penceresini açabilir.');
}

// ---------- Proxy (kurumsal ağ) ----------
const proxyUi = { status: null, result: null };

async function renderProxyTab() {
  const body = $('#linksBody');
  if (!proxyUi.status) {
    body.replaceChildren(el('div', { class: 'links-result', text: T('Yükleniyor…') }));
    proxyUi.status = await fetch('/api/proxy').then((r) => r.json()).catch(() => ({}));
    if (links.tab !== 'proxy') return;
  }
  const st = proxyUi.status;
  const address = el('input', { type: 'text', value: st.address || '', placeholder: 'proxy.sirket.com:8080', spellcheck: 'false', autocomplete: 'off' });
  const username = el('input', { type: 'text', value: st.username || '', placeholder: T('gerekmiyorsa boş bırakın'), spellcheck: 'false', autocomplete: 'off' });
  const password = secretInput(st.hasPassword, T('gerekmiyorsa boş bırakın'));
  const noProxy = el('input', { type: 'text', value: st.noProxy || 'localhost,127.0.0.1', placeholder: 'localhost,127.0.0.1,.sirket.com', spellcheck: 'false', autocomplete: 'off' });
  const result = el('div', { class: 'links-result' });
  result.hidden = true;
  const show = (r) => {
    proxyUi.result = r;
    result.hidden = !r;
    if (!r) return;
    result.className = `links-result ${r.ok ? 'ok' : r.pending ? '' : 'err'}`;
    result.replaceChildren(el('div', { text: r.pending ? T('Proxy sınanıyor…') : r.ok ? T('Proxy çalışıyor: GitHub\'a ulaşılabiliyor. Yeni açtığınız Copilot oturumları bu ayarı kullanır.') : T('Olmadı: {error}', { error: r.error }) }));
    if (!r.ok && !r.pending) result.append(askErrorButton(T('Proxy ayarını yapma'), r.error));
  };
  // Sınama, kaydetmeden formdaki değerlerle yapılır
  const runTest = async () => {
    show({ pending: true });
    show(await fetch(`/api/proxy/test?lang=${getLang()}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: address.value, username: username.value, password: secretValue(password) }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message })));
  };
  const saveBtn = el('button', { class: 'btn primary', type: 'button', text: T('Kaydet ve sına'), onclick: async () => {
    saveBtn.disabled = true;
    try {
      const res = await fetch(`/api/proxy?lang=${getLang()}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: address.value, username: username.value, password: secretValue(password), noProxy: noProxy.value }) });
      const data = await res.json();
      if (!res.ok) return show({ ok: false, error: data.error });
      proxyUi.status = data;
      await runTest();
      if (links.tab === 'proxy') renderLinks(); // sekmedeki nokta ve "sına / kaldır" düğmeleri güncellensin (sonuç korunur)
    } finally { saveBtn.disabled = false; }
  } });
  const removeBtn = el('button', { class: 'btn ghost', type: 'button', text: T('Proxy ayarını kaldır'), onclick: async () => {
    if (!confirm(T('Proxy ayarı ve kayıtlı parola silinsin mi?'))) return;
    proxyUi.status = await fetch('/api/proxy', { method: 'DELETE' }).then((r) => r.json());
    proxyUi.result = null;
    renderLinks();
  } });

  body.replaceChildren(...[
    el('ol', { class: 'links-steps' },
      el('li', { text: T('Şirket ağınız internete bir proxy üzerinden çıkıyorsa GitHub Copilot bu bilgiler olmadan sunucularına ulaşamaz; oturumlar yavaş açılır ya da "zaman aşımı" hatası verir. Bu ayar yalnızca Copilot içindir; Claude Code etkilenmez.') }),
      el('li', { text: T('Proxy adresini, kullanıcı adını ve parolayı BT ekibinizden ya da şirket içi kurulum dokümanınızdan alın. Kullanıcı adındaki @ gibi özel karakterleri olduğu gibi yazın; Atölye gerekli dönüşümü kendisi yapar.') }),
      el('li', { text: T('"Proxy kullanılmayacak adresler" alanına şirket içi adresleri yazın (ör. .sirket.com); bunlara proxy olmadan gidilir.') }),
      el('li', { text: T('"Kaydet ve sına" deyin, sonra yeni bir Copilot oturumu açın.') })),
    st.source === 'system' ? el('div', { class: 'links-result', text: T('Bu bilgisayarda genel bir proxy ayarı (HTTPS_PROXY) bulundu ve form onunla dolduruldu. "Kaydet ve sına" derseniz Atölye\'ye yalnızca Copilot için kaydedilir.') }) : null,
    el('label', { class: 'links-field' }, el('span', { text: T('Proxy adresi') }), address),
    el('label', { class: 'links-field' }, el('span', { text: T('Kullanıcı adı') }), username),
    el('label', { class: 'links-field' }, el('span', { text: T('Parola') }), password, savedWhere(T('Kayıt yeri: {file}', { file: st.file }))),
    el('label', { class: 'links-field' }, el('span', { text: T('Proxy kullanılmayacak adresler') }), noProxy, el('small', { text: T('Virgülle ayırın. localhost ve 127.0.0.1 her zaman eklenir.') })),
    el('div', { class: 'links-actions' }, saveBtn,
      el('button', { class: 'btn', type: 'button', text: T('Sına'), title: T('Kaydetmeden, formdaki bilgilerle proxy üzerinden GitHub\'a ulaşılabildiğini denetler'), onclick: runTest }),
      st.configured ? removeBtn : null,
      el('button', { class: 'btn ghost links-help', type: 'button', text: T('Yapay zekâdan yardım al'), onclick: () => askAi(T('Şirket ağında proxy ayarı yapmam gerekiyor ve teknik biri değilim. Proxy nedir, adresini ve kullanıcı bilgilerini kimden öğrenirim, HTTPS_PROXY ve NO_PROXY ne işe yarar? Adım adım, sade bir dille anlat.')) })),
    result,
  ].filter(Boolean));
  show(proxyUi.result);
  $('#linksNote').textContent = T('Bu ayar yalnızca Atölye\'nin başlattığı GitHub Copilot oturumlarına uygulanır; Claude Code ve diğer programlar etkilenmez. Parola dosyada düz metin olarak durur, tarayıcıya geri gönderilmez ve kayıtlara yazılmaz.');
}

// ---------- Tarayıcı bağlantısı ----------
// Yapay zekânın bir tarayıcıyı sürmesi için Playwright MCP sunucusu kurulur ve CLI ayarlarına yazılır.
LINKS.tarayici = { name: 'Tarayıcı', custom: true };
LINK_TOOLS.tarayici = 'browser_navigate, browser_snapshot, browser_click, browser_type, browser_take_screenshot';
const browserUi = { result: null, busy: false, installed: undefined };
const BROWSER_CHOICES = [
  ['chrome', () => T('Google Chrome (bilgisayarda kurulu olan)')],
  ['msedge', () => T('Microsoft Edge (bilgisayarda kurulu olan)')],
  ['chromium', () => T("Chromium (Playwright'ın kendi tarayıcısı; ilk kullanımda indirilir)")],
  ['firefox', () => T("Firefox (Playwright'ın kendi tarayıcısı; ilk kullanımda indirilir)")],
  ['webkit', () => T("WebKit / Safari motoru (Playwright'ın kendi tarayıcısı; ilk kullanımda indirilir)")],
];

async function renderBrowserTab() {
  const st = links.status?.services?.tarayici || { connected: false, browser: 'chrome', headless: false };
  // Paket zaten kuruluysa kurulum adımı gösterilmez
  if (browserUi.installed === undefined) {
    $('#linksBody').replaceChildren(el('div', { class: 'links-result', text: T('Yükleniyor…') }));
    browserUi.installed = await fetch('/api/browser/installed').then((r) => r.json()).then((d) => d.version || null).catch(() => null);
    if (links.tab !== 'tarayici') return;
  }
  const installed = browserUi.installed;
  const pick = el('select', { class: 'links-select' }, ...BROWSER_CHOICES.map(([v, label]) => el('option', { value: v, text: label() })));
  pick.value = st.browser || 'chrome';
  const headless = el('input', { type: 'checkbox', checked: Boolean(st.headless) });
  const result = el('div', { class: 'links-result' });
  result.hidden = true;
  const show = (r) => {
    browserUi.result = r;
    result.hidden = !r;
    if (!r) return;
    result.className = `links-result ${r.ok ? 'ok' : r.pending ? '' : 'err'}`;
    result.replaceChildren(...(r.pending ? [el('span', { class: 'btn-spin' })] : []), el('span', { text: r.text }));
    if (!r.ok && !r.pending) result.append(el('div', {}, askErrorButton(T('Tarayıcı bağlantısını kurma'), r.text)));
  };
  const saveBtn = el('button', { class: 'btn primary', type: 'button', text: installed ? T('Kaydet') : T('Kur ve etkinleştir'), onclick: async () => {
    if (browserUi.busy) return;
    const browser = pick.value;
    browserUi.busy = true;
    saveBtn.disabled = true;
    try {
      show({ pending: true, text: T('Ön koşullar denetleniyor…') });
      const check = await fetch(`/api/browser/check?browser=${browser}`).then((r) => r.json()).catch(() => ({}));
      if (check.browser === 'missing') return show({ ok: false, text: T('Seçtiğiniz tarayıcı bu bilgisayarda bulunamadı. Kurulu olan bir tarayıcıyı ya da Playwright\'ın kendi tarayıcılarından birini seçin.') });
      let version = check.installed;
      if (!version) {
      if (!check.available) return show({ ok: false, text: T('Playwright MCP paketine ulaşılamadı: npm kayıt defterine erişilemiyor. Şirket ağı npm\'e izin vermiyor olabilir; kurulum yapılamadı.') });
      // Kurulum gerektiği kullanıcıya bildirilir; onay vermeden hiçbir şey indirilmez
      const ownBrowser = check.browser === 'managed';
      const browserNote = ownBrowser
        ? T('Seçtiğiniz tarayıcı Playwright\'a aittir; dosyaları ilk kullanımda ayrıca indirilir (yaklaşık 150 MB).')
        : T('Bilgisayarda kurulu tarayıcı kullanılacak; ayrıca tarayıcı indirilmeyecek.');
      const ask = T('Tarayıcı bağlantısı için kurulum gerekiyor:\n\n• Playwright MCP paketi (sürüm {version}) npm üzerinden bu bilgisayara indirilecek.\n• {browserNote}\n\nKurulum birkaç dakika sürebilir. Devam edilsin mi?', { version: check.available, browserNote });
      if (!confirm(ask)) return show(null);
      show({ pending: true, text: T('Kuruluyor… Bu pencereyi kapatmayın.') });
      const inst = await fetch('/api/browser/install', { method: 'POST' }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
      if (!inst.ok) return show({ ok: false, text: T('Kurulum başarısız: {error}', { error: inst.error }) });
      version = inst.version;
      browserUi.installed = version;
      }
      const res = await fetch('/api/browser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser, headless: headless.checked }) });
      const data = await res.json();
      if (!res.ok) return show({ ok: false, text: data.error });
      links.status = data;
      renderLinksBadge();
      renderLinkSelect();
      browserUi.result = { ok: true, text: T('Tarayıcı bağlantısı hazır (Playwright MCP {version}). Yeni açtığınız oturumlarda kullanılabilir.', { version }) };
      renderLinks();
    } finally { browserUi.busy = false; saveBtn.disabled = false; }
  } });
  const removeBtn = el('button', { class: 'btn ghost', type: 'button', text: T('Bağlantıyı kaldır'), onclick: async () => {
    if (!confirm(T('Tarayıcı bağlantısı kaldırılsın mı?'))) return;
    links.status = await fetch('/api/browser', { method: 'DELETE' }).then((r) => r.json());
    browserUi.result = null;
    renderLinksBadge();
    renderLinkSelect();
    renderLinks();
  } });

  $('#linksBody').replaceChildren(...[
    el('ol', { class: 'links-steps' },
      el('li', { text: T('Bu bağlantı, yapay zekânın bir tarayıcı açıp sayfalarda gezinmesini sağlar: sayfa açma, tıklama, form doldurma, ekran görüntüsü alma. Web arayüzlerini denemek ve hataları yeniden üretmek için kullanılır.') }),
      el('li', { text: T('Aşağıdan hangi tarayıcının açılacağını seçin. Açılan tarayıcı ayrı ve boş bir profildir; kendi tarayıcınızdaki oturumlar ve şirket girişleri orada olmaz.') }),
      el('li', { text: T('"Kur ve etkinleştir" dediğinizde gereken kurulum size bildirilir; onay verirseniz Microsoft\'un Playwright MCP paketi indirilir ve bağlantı etkinleşir.') }),
      el('li', { text: T('Yapay zekâ tarayıcıda her işlem için izninizi ister. Açtığı sayfadaki metinlerden etkilenebileceği için güvenmediğiniz sitelerde ve gerçek (üretim) sistemlerde dikkatli kullanın.') })),
    el('div', { class: `links-result ${installed ? 'ok' : ''}`, text: installed ? T('Playwright MCP kurulu (sürüm {version}); yeniden kurulum gerekmez.', { version: installed }) : T('Playwright MCP henüz kurulu değil; etkinleştirirken kurulum için onayınız istenir.') }),
    el('label', { class: 'links-field' }, el('span', { text: T('Tarayıcı') }), pick),
    el('label', { class: 'links-check' }, headless, el('span', { text: T('Pencere açmadan (arka planda) çalıştır') })),
    el('small', { class: 'links-where', text: T('İşaretli değilse tarayıcı her zaman görünür bir pencerede açılır ve yapay zekânın ne yaptığını izleyebilirsiniz.') }),
    el('div', { class: 'links-actions' }, saveBtn, st.connected ? removeBtn : null, helpButton('tarayici')),
    result,
    el('p', { class: 'links-intro', text: T('Örnek: "localhost:8080 adresini aç, giriş formunu doldur ve çıkan hatanın ekran görüntüsünü al".') }),
  ].filter(Boolean));
  show(browserUi.result);
  const f = links.status?.files;
  $('#linksNote').textContent = f
    ? T('Ayar, Claude Code ve Copilot CLI ayar dosyalarına "tarayici" adıyla yazılır: {claude} ve {copilot}. Şirketinizin Copilot politikası üçüncü taraf MCP sunucularını kapatmışsa tarayıcı yalnızca Claude Code oturumlarında kullanılabilir.', f)
    : '';
}

// ---------- Yapay zekâ ister, Atölye getirir (analist modu) ----------
// Akış: (1) kullanıcı bir bağlantı seçip sorusunu yazar, (2) yapay zekâ soruyu yorumlar ve hangi veriye ihtiyacı
// olduğunu belirli bir biçimde yazar, (3) Atölye bunu kullanıcıya gösterir ve onayla kayıtlı bağlantı üzerinden
// REST ile getirir, (4) veri yapay zekâya geri gönderilir ve soru yanıtlanır. Yalnızca okuma yapan işlemler vardır.
// MCP araçlarının kullanılamadığı oturumlarda (ör. Copilot) kullanılır; Claude Code'da araçlar zaten doğrudan çalışır.
const REQUEST_FENCE = 'atolye-istek';
const MAX_AUTO_FETCH = 5; // tek soruda art arda en fazla kaç veri isteği
const fetchTools = {}; // servis -> okuma işlemleri (yapay zekâya tarif etmek ve gelen isteği doğrulamak için)
const autoFetch = { active: false, service: null, text: '', count: 0, allowed: false };

async function loadFetchTools(service) {
  if (!service || fetchTools[service]) return;
  fetchTools[service] = await fetch(`/api/link-data/tools?service=${service}`).then((r) => r.json()).then((d) => d.tools || []).catch(() => []);
}
const usesFetchProtocol = () => Boolean(activeLink) && currentRole().fetch && currentEngine() === 'copilot' && (fetchTools[activeLink] || []).length > 0;

/** Soruya, yapay zekânın veriyi nasıl isteyeceğini anlatan yönerge eklenir */
function withFetchProtocol(text) {
  const tools = fetchTools[activeLink].map((t) => `- ${t.name}(${Object.keys(t.properties || {}).map((k) => `${k}${t.required.includes(k) ? '' : '?'}`).join(', ')}): ${t.description}`).join('\n');
  autoFetch.active = true;
  autoFetch.service = activeLink;
  autoFetch.text = '';
  autoFetch.count = 0;
  return `${text}\n\n${T('({name} verisi gerekiyorsa kendin erişmeye çalışma ve tahmin yürütme. Önce soruyu yorumla, sonra hangi veriye ihtiyacın olduğunu aşağıdaki biçimde TEK bir istek olarak yaz ve dur; veriyi Atölye getirip sana gönderecek.)', { name: LINKS[activeLink].name })}\n\`\`\`${REQUEST_FENCE}\n{"islem": "<işlem adı>", "args": { ... }}\n\`\`\`\n${T('Kullanılabilir işlemler:')}\n${tools}`;
}

/** Yapay zekânın cevabındaki veri isteğini ayıklar: { name, args } ya da null */
function parseFetchRequest(text) {
  const m = String(text).match(new RegExp('```' + REQUEST_FENCE + '\\s*([\\s\\S]*?)```'));
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    const name = j.islem || j.tool || j.name;
    return typeof name === 'string' ? { name, args: j.args && typeof j.args === 'object' ? j.args : {} } : null;
  } catch {
    return null;
  }
}

function sendToAi(text) {
  wsSend({ type: 'send', text, images: [] });
  setBusy(true);
  scrollDown(true);
}

async function runAutoFetch(req, card) {
  const name = LINKS[autoFetch.service]?.name || autoFetch.service;
  const what = Object.entries(req.args).map(([k, v]) => `${k}=${v}`).join(', ') || req.name;
  if (card) { card.classList.add('resolved'); $('.actions', card)?.remove(); card.append(el('div', { class: 'resolved-note', text: T('Veri getiriliyor…') })); }
  const r = await fetch('/api/link-data/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: req.name, args: req.args }) })
    .then((x) => x.json()).catch((e) => ({ ok: false, text: e.message }));
  if (card) $('.resolved-note', card).textContent = r.ok ? T('Getirildi ({n} karakter) ve yapay zekâya gönderildi.', { n: r.text.length }) : T('Getirilemedi: {error}', { error: r.text });
  sendToAi(r.ok
    ? `${T('[{name} bağlantısından getirildi: {what}]', { name, what })}\n${r.text}\n${T('[veri sonu]')}\n\n${T('(İstediğin veri yukarıda. Başka veri gerekiyorsa aynı biçimde yeni bir istek yaz; gerekmiyorsa sorumu yanıtla.)')}`
    : `${T('[{name} bağlantısından veri getirilemedi: {what}]', { name, what })}\n${r.text}\n\n${T('(Bu veri alınamadı. İsteği düzelterek yeniden dene ya da neyin eksik olduğunu bana söyle.)')}`);
}

/** Tur bittiğinde çağrılır: cevapta veri isteği varsa kullanıcıya sorulur (ya da izin verilmişse doğrudan getirilir) */
function checkFetchRequest() {
  if (!autoFetch.active) return;
  const req = parseFetchRequest(autoFetch.text);
  autoFetch.text = '';
  if (!req) { autoFetch.active = false; return; } // yapay zekâ yanıt verdi: akış bitti
  const tool = (fetchTools[autoFetch.service] || []).find((t) => t.name === req.name);
  const name = LINKS[autoFetch.service]?.name || autoFetch.service;
  if (!tool) {
    return sendToAi(T('("{op}" diye bir işlem yok. Yalnızca listedeki işlemleri kullan.)', { op: req.name }));
  }
  if (++autoFetch.count > MAX_AUTO_FETCH) {
    autoFetch.active = false;
    return notice(T('Yapay zekâ art arda çok fazla veri istedi; durduruldu. Sorunuzu daraltıp yeniden deneyin.'), 'info');
  }
  if (autoFetch.allowed) return runAutoFetch(req, null);
  const card = el('div', { class: 'prompt-card' });
  put(card,
    el('h3', { text: T('Atölye, {name} bağlantısından şu veriyi getirsin mi?', { name }) }),
    el('div', { class: 'fetch-request' }, el('strong', { text: tool.description }), el('code', { text: Object.entries(req.args).map(([k, v]) => `${k}: ${v}`).join('\n') || '—' })),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', text: T('Getir'), onclick: () => runAutoFetch(req, card) }),
      el('button', { class: 'btn', type: 'button', text: T('Bu oturumda sormadan getir'), onclick: () => { autoFetch.allowed = true; runAutoFetch(req, card); } }),
      el('button', { class: 'btn ghost', type: 'button', text: T('Vazgeç'), onclick: () => { autoFetch.active = false; card.classList.add('resolved'); $('.actions', card).remove(); card.append(el('div', { class: 'resolved-note', text: T('Vazgeçildi.') })); } })));
  append(card);
  scrollDown(true);
}

// ---------- Bağlantıdan veri getirme (REST) ----------
// Veriyi yapay zekâ değil Atölye çeker: kayıtlı bağlantıyla doğrudan servisin REST arayüzüne gidilir ve sonuç
// mesaja eklenir. Bu yüzden MCP araçlarının kapalı olduğu oturumlarda (ör. kuruluş politikasıyla kısıtlı Copilot)
// da çalışır. Yalnızca okuma yapan işlemler sunulur.
const fetchDlg = $('#fetchDialog');
const fetchUi = { tools: null, tool: null, result: null };

async function openFetchDialog() {
  if (!activeLink) return;
  fetchUi.tools = await fetch(`/api/link-data/tools?service=${activeLink}`).then((r) => r.json()).then((d) => d.tools || []).catch(() => []);
  fetchUi.tool = fetchUi.tools[0]?.name || null;
  fetchUi.result = null;
  renderFetchDialog();
  fetchDlg.showModal();
}

function renderFetchDialog() {
  const name = LINKS[activeLink]?.name || '';
  $('#fetchTitle').textContent = T('{name}: veri getir', { name });
  const body = $('#fetchBody');
  const tool = fetchUi.tools.find((t) => t.name === fetchUi.tool);
  if (!tool) {
    body.replaceChildren(el('div', { class: 'links-result err', text: T('Bu bağlantı için getirilebilecek veri yok ya da bağlantı kurulmamış.') }));
    return;
  }
  const pick = el('select', { class: 'links-select' }, ...fetchUi.tools.map((t) => el('option', { value: t.name, text: t.description })));
  pick.value = tool.name;
  pick.onchange = () => { fetchUi.tool = pick.value; fetchUi.result = null; renderFetchDialog(); };
  const inputs = {};
  const fields = Object.entries(tool.properties || {}).map(([key, p]) => {
    const input = el('input', { type: p.type === 'number' ? 'number' : 'text', spellcheck: 'false', autocomplete: 'off' });
    inputs[key] = input;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    return el('label', { class: 'links-field' }, el('span', { text: `${p.description || key}${tool.required.includes(key) ? ' *' : ''}` }), input);
  });
  const result = el('div', { class: 'links-result' });
  result.hidden = true;
  const preview = el('pre', { class: 'fetch-preview' });
  preview.hidden = true;
  const addBtn = el('button', { class: 'btn primary', type: 'button', text: T('Mesaja ekle'), disabled: true });
  const runBtn = el('button', { class: 'btn', type: 'button', text: T('Getir') });
  async function run() {
    const args = {};
    for (const [k, input] of Object.entries(inputs)) {
      const v = input.value.trim();
      if (v) args[k] = input.type === 'number' ? Number(v) : v;
    }
    runBtn.disabled = true;
    runBtn.replaceChildren(el('span', { class: 'btn-spin' }), el('span', { text: T('Getiriliyor…') }));
    const r = await fetch('/api/link-data/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: tool.name, args }) })
      .then((x) => x.json()).catch((e) => ({ ok: false, text: e.message }));
    runBtn.disabled = false;
    runBtn.textContent = T('Getir');
    fetchUi.result = r.ok ? { tool: tool.name, args, text: r.text } : null;
    result.hidden = r.ok;
    preview.hidden = !r.ok;
    addBtn.disabled = !r.ok;
    if (r.ok) preview.textContent = r.text;
    else { result.className = 'links-result err'; result.textContent = T('Olmadı: {error}', { error: r.text }); }
  }
  runBtn.onclick = run;
  addBtn.onclick = () => {
    const r = fetchUi.result;
    if (!r) return;
    const what = Object.entries(r.args).map(([k, v]) => `${k}=${v}`).join(', ');
    const block = `${T('[{name} bağlantısından getirildi: {what}]', { name, what: what || r.tool })}\n${r.text}\n${T('[veri sonu]')}`;
    const cur = dom.input.value.trim();
    dom.input.value = cur ? `${cur}\n\n${block}\n\n` : `${block}\n\n`;
    fetchDlg.close();
    autoGrow();
    updateSendBtn();
    dom.input.focus();
    dom.input.setSelectionRange(dom.input.value.length, dom.input.value.length);
  };
  body.replaceChildren(
    el('p', { class: 'links-intro', text: T('Veriyi Atölye kayıtlı bağlantınızla doğrudan servisten çeker ve mesajınıza ekler; ardından sorunuzu yazıp gönderirsiniz. Getirilen metin, seçili yapay zekâya mesajın parçası olarak gider.') }),
    el('label', { class: 'links-field' }, el('span', { text: T('Ne getirilsin?') }), pick),
    ...fields,
    el('div', { class: 'links-actions' }, runBtn, addBtn),
    result,
    preview,
  );
  (Object.values(inputs)[0] || pick).focus();
}

$('#linkFetchBtn').onclick = openFetchDialog;
$('#fetchClose').onclick = () => fetchDlg.close();
fetchDlg.addEventListener('click', (e) => { if (e.target === fetchDlg) fetchDlg.close(); });

// ---------- Güncelleme bildirimi ----------
// Depoda daha yeni bir Atölye sürümü varsa sağ üstte "Güncelleme var" görünür (bkz. src/update.js).
async function checkUpdate(manual = false) {
  const u = await fetch(`/api/update${manual ? '?refresh=1' : ''}`).then((r) => r.json()).catch(() => null);
  $('#updateWrap').hidden = !u?.available;
  if (!u?.available) return u;
  $('#updatePop').replaceChildren(...[
    el('strong', { text: T('Atölye {latest} yayımlandı (kurulu sürüm: {current}).', u) }),
    ...(u.canApply
      ? [el('div', { text: T('"Şimdi güncelle" son sürümü indirir, kurar ve Atölye\'yi yeniden başlatır. Ayarlarınız ve oturumlarınız korunur.') })]
      : u.how === 'git'
      ? [el('div', { text: T('Güncellemek için kurulum klasöründe PowerShell ile şunu çalıştırın:') }), el('code', { text: '.\\atolye.ps1 guncelle' })]
      : [el('div', { text: T("Güncellemek için yeni paketi indirip içindeki Kur.bat'ı çalıştırın. Ayarlarınız ve oturumlarınız korunur.") })]),
    u.canApply ? null : el('div', { text: T('Güncellemeden sonra bu sayfayı yenileyin.') }),
    u.canApply ? el('button', { class: 'btn primary', type: 'button', text: T('Şimdi güncelle'), onclick: () => applyUpdate(u) }) : null,
    u.canApply ? el('div', { class: 'update-status', id: 'updateStatus' }) : null,
  ].filter(Boolean));
  return u;
}

// Elle denetim (kenar çubuğunun altındaki düğme): günlük denetimi beklemeden hemen bakar.
// Kendiliğinden yapılan denetimde hata kullanıcıya gösterilmez; burada kullanıcı sorduğu için sonuç söylenir.
$('#checkUpdateBtn').onclick = async () => {
  const btn = $('#checkUpdateBtn');
  const label = T('Güncellemeleri denetle');
  btn.disabled = true;
  btn.textContent = T('Denetleniyor…');
  const u = await checkUpdate(true);
  btn.disabled = false;
  if (u?.available) {
    btn.textContent = label;
    $('#updatePop').hidden = false; // sağ üstteki düğme ve ayrıntısı açılır
    return;
  }
  btn.textContent = u?.latest ? T('Güncel (sürüm {current})', u) : T('Şu an denetlenemedi');
  setTimeout(() => { btn.textContent = label; }, 5000);
};

// Güncellemeyi sunucuda başlatır; Atölye yeni sürümle yeniden başlayınca sayfa kendiliğinden yenilenir.
// Çalışan oturumlar yeniden başlatmada kapanır (konuşmalar kaybolmaz, listeden yeniden açılır).
async function applyUpdate(u) {
  if (state.running?.some((r) => r.busy) && !confirm(T('Çalışan oturumlar var; güncelleme Atölye\'yi yeniden başlatır ve bu işleri yarıda keser. Devam edilsin mi?'))) return;
  const status = $('#updateStatus');
  const btn = $('#updatePop .btn');
  btn.disabled = true;
  status.textContent = T('Güncelleniyor… Atölye birazdan yeniden başlayacak.');
  const r = await fetch('/api/update/apply', { method: 'POST' }).then((x) => x.json()).catch(() => ({ started: false }));
  const end = Date.now() + 5 * 60_000;
  while (r.started && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 4000));
    const now = await fetch('/api/update').then((x) => x.json()).catch(() => null); // yeniden başlarken kısa süre cevap gelmez
    if (now && now.current !== u.current) return location.reload();
  }
  btn.disabled = false;
  status.textContent = T('Güncelleme tamamlanamadı. Kurulum klasöründe PowerShell ile ".\\atolye.ps1 guncelle" komutunu çalıştırıp çıktıya bakın.');
}
$('#updateBtn').onclick = (e) => { e.stopPropagation(); $('#updatePop').hidden = !$('#updatePop').hidden; };
document.addEventListener('click', (e) => { if (!$('#updateWrap').contains(e.target)) $('#updatePop').hidden = true; });
checkUpdate();
setInterval(checkUpdate, 60 * 60 * 1000); // sunucu depoya günde bir kez bakar; bu yalnızca sonucu okur

// Geliştirme için: ?debug ile açıldığında olaylar konsoldan elle verilebilir
if (new URLSearchParams(location.search).has('debug')) window.atolyeDebug = { handleEvent, state, autoFetch, fetchTools, withFetchProtocol, usesFetchProtocol };

// ---------- Başlangıç ----------
(async function init() {
  state.config = await fetch('/api/config').then((r) => r.json());
  // Eski sürümler Copilot etiketini Claude model seçimi olarak kaydedebiliyordu
  if (store.get('atolye:model', '') === 'GitHub Copilot') store.del('atolye:model');
  // Kalıcı durum sunucudan gelir. Eski sürümler listeyi tarayıcıda tutuyordu: bulunursa
  // bir kez sunucuya aktarılır ve tarayıcıdaki kopyası silinir.
  let saved = await fetch('/api/state').then((r) => r.json()).catch(() => null);
  const legacy = readJson('atolye:projects', null);
  const legacyCwd = store.get('atolye:cwd', '');
  const legacyOpen = readJson('atolye:open', null);
  const migrating = Array.isArray(legacy) && legacy.length > 0;
  if (migrating) {
    saved = await api('/api/state/import', { projects: legacy, collapsed: readJson('atolye:collapsed', []) }).catch(() => saved);
  }
  for (const k of ['atolye:projects', 'atolye:collapsed', 'atolye:cwd', 'atolye:selected', 'atolye:open']) store.del(k);
  applyServerState(saved || { projects: [] }, { load: false, render: false }); // klasörsüz sohbet en üstte
  // Aktarım yapılan açılışta eski kayıttaki son klasör/oturum önceliklidir
  setCwdLabel((migrating && legacyCwd) || saved?.cwd || legacyCwd || state.projects[0] || state.config.defaultCwd);
  // Sayfa yenilendiyse ya da tarayıcı yeniden açıldıysa en son bakılan oturuma dön
  if (saved?.engine) state.engine = saved.engine;
  if (saved?.role) state.role = saved.role;
  applyRole();
  let last = (migrating && legacyOpen) || saved?.open || legacyOpen;
  // Motor hiç seçilmediyse varsayılan (Copilot) geçerlidir: eski bir Claude oturumuna değil, yeni oturuma açılır
  await loadEngines(); // Copilot kurulu değilse seçim Claude'a düşer
  if (last && !saved?.engineChosen && (last.engine || 'claude') !== state.engine) last = null;
  if (last && samePath(last.cwd, state.cwd)) { state.liveId = last.liveId; state.sessionId = last.sessionId; state.sessionEngine = last.engine || 'claude'; }
  applyEngineUi();
  // Son oturum Copilot'tu ama Copilot artık yoksa: hata göstermek yerine Claude ile temiz başla
  if (state.sessionEngine === 'copilot' && !state.engines.copilot?.available) {
    state.liveId = null;
    state.sessionId = null;
    state.sessionEngine = 'claude';
    applyEngineUi();
  }
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
