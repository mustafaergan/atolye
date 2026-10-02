// Atölye arayüzü: oturum listesi, akış halinde sohbet, araç kartları,
// izin onayları, sorular, slash komutları ve @dosya önerileri.
import { lineDiff, renderDiff } from './diff.js';

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
  sessionId: null,      // aktif oturum
  sessions: [],
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
  pendingStart: null,
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
  folderName: $('#folderName'),
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
    const btn = el('button', { class: 'copy-code', type: 'button', text: 'Kopyala' });
    btn.onclick = () => {
      navigator.clipboard?.writeText(pre.querySelector('code')?.innerText ?? pre.innerText);
      btn.textContent = 'Kopyalandı';
      setTimeout(() => (btn.textContent = 'Kopyala'), 1200);
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
  if (s < 60) return 'şimdi';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} g`;
  return new Date(ms).toLocaleDateString('tr-TR');
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
    return content.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[görsel]' : '')).join('\n');
  return JSON.stringify(content, null, 2);
}

function clip(text, max = 20000) {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} karakter daha)` : text;
}

// ---------- WebSocket ----------
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws = ws;
  setConn('wait', 'Bağlanıyor');
  ws.onopen = () => {
    state.connected = true;
    setConn('ok', 'Bağlı');
    startSession(state.sessionId);
  };
  ws.onclose = () => {
    state.connected = false;
    setBusy(false);
    setConn('err', 'Bağlantı koptu');
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
  else notice('Sunucuya bağlı değil. Yeniden bağlanılıyor…');
}

function startSession(resume) {
  wsSend({ type: 'start', cwd: state.cwd, resume: resume || null, mode: state.mode, model: state.model || null });
}

// ---------- Olaylar ----------
function handleEvent(ev) {
  switch (ev.type) {
    case 'sdk': return handleSdk(ev.msg);
    case 'busy': return setBusy(ev.busy);
    case 'permission': return renderPermission(ev);
    case 'question': return renderQuestion(ev);
    case 'permission_resolved': return resolvePrompt(ev.id, ev.behavior);
    case 'mode': return setMode(ev.mode, false);
    case 'model': return;
    case 'capabilities': return setCapabilities(ev);
    case 'error': setBusy(false); return notice(ev.message);
    case 'session_ended': return;
    case 'started': return;
  }
}

function handleSdk(msg) {
  if (msg.type === 'system') {
    if (msg.subtype === 'init') {
      const isNew = state.sessionId !== msg.session_id;
      state.sessionId = msg.session_id;
      setMode(msg.permissionMode, false);
      dom.statusline.dataset.model = msg.model;
      updateStatus();
      if (isNew) { highlightSession(); store.set(`atolye:last:${state.cwd}`, msg.session_id); }
    } else if (msg.subtype === 'local_command_output') {
      const node = el('div', { class: 'msg-text' });
      renderMarkdown(node, msg.content);
      append(node);
    } else if (msg.subtype === 'compact_boundary') {
      notice('Konuşma özetlendi (compact). Eski mesajlar bağlamdan çıkarıldı.', 'info');
    } else if (msg.subtype === 'api_retry') {
      setWorking(`Gateway yanıt vermedi, yeniden deneniyor (${msg.attempt}. deneme)…`);
    } else if (msg.subtype === 'status' && msg.status === 'compacting') {
      setWorking('Konuşma özetleniyor…');
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
    el('summary', {}, icon(ICONS.chevron), 'Düşünüyor'),
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
    notice('Kimlik doğrulama başarısız. Şirket gateway token\'ını (ANTHROPIC_AUTH_TOKEN) ~/.claude/settings.json ya da .env içinde kontrol edin.');
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
    images.length ? el('div', { class: 'imgs' }, images.map((src) => el('img', { src, alt: 'Ek görsel' }))) : null,
    text ? el('div', { class: 'bubble', text }) : null));
}

function renderResult(msg) {
  for (const list of state.live.values()) for (const r of list) r.el.classList.remove('streaming');
  state.live.clear();
  state.liveByIndex.clear();
  if (typeof msg.total_cost_usd === 'number') state.cost = msg.total_cost_usd;
  const secs = (msg.duration_ms / 1000).toFixed(1);
  const parts = [`${secs} sn`];
  if (msg.num_turns) parts.push(`${msg.num_turns} tur`);
  if (msg.total_cost_usd) parts.push(`≈ $${msg.total_cost_usd.toFixed(3)}`);
  if (msg.subtype === 'success' && msg.is_error) {
    // API hatası zaten asistan metni olarak gösterildi
    append(el('div', { class: 'result-line err', text: parts.join(' · ') }));
  } else if (msg.subtype !== 'success') {
    const reason =
      msg.subtype === 'error_max_turns' ? 'Tur sınırına ulaşıldı'
      : msg.subtype === 'error_max_budget_usd' ? 'Bütçe sınırına ulaşıldı'
      : msg.result || (msg.errors || []).join('\n') || 'Bir hata oluştu';
    if (!/interrupt/i.test(String(msg.terminal_reason || '')) && !/abort/i.test(reason)) notice(reason);
    else append(el('div', { class: 'result-line', text: 'Durduruldu' }));
  } else {
    append(el('div', { class: 'result-line', text: parts.join(' · ') }));
  }
  updateStatus(msg);
  loadSessions();
}

function updateStatus(result) {
  const bits = [];
  if (dom.statusline.dataset.model) bits.push(dom.statusline.dataset.model);
  if (result?.modelUsage) {
    const ctx = Object.values(result.modelUsage).reduce((a, u) => Math.max(a, u.contextWindow || 0), 0);
    const u = result.usage || {};
    const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    if (ctx && used) bits.push(`bağlam ~%${Math.min(100, Math.round((used / ctx) * 100))}`);
  }
  if (state.cost) bits.push(`oturum ≈ $${state.cost.toFixed(3)}`);
  dom.statusline.replaceChildren(...bits.map((b) => el('span', { text: b })));
}

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
  Read: 'Okundu', Write: 'Yazıldı', Edit: 'Düzenlendi', MultiEdit: 'Düzenlendi', Bash: 'Komut', PowerShell: 'PowerShell',
  Grep: 'Arama', Glob: 'Dosya arama', WebFetch: 'Web', WebSearch: 'Web araması', TodoWrite: 'Yapılacaklar',
  Task: 'Alt ajan', Agent: 'Alt ajan', ExitPlanMode: 'Plan', NotebookEdit: 'Not defteri',
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
      return `${t.filter((x) => x.status === 'completed').length}/${t.length} tamamlandı`;
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
    parts.push(el('div', { class: 't-label', text: 'Görev' }), el('pre', { class: 'out', text: input.prompt || '' }));
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
    el('div', { class: 't-label', text: block.is_error ? 'Hata' : 'Çıktı' }),
    el('pre', { class: `out ${block.is_error ? 'err' : ''}`, text: clip(text) }));
  if (block.is_error && !denied) t.el.open = true;
}

// ---------- İzin kartları ----------
function renderPermission(ev) {
  const { id, toolName, input = {}, title, decisionReason, blockedPath, canAlways } = ev;
  const card = el('div', { class: 'prompt-card', 'data-id': id });

  if (toolName === 'ExitPlanMode') {
    const plan = el('div', { class: 'plan msg-text' });
    renderMarkdown(plan, input.plan || '');
    put(card, 
      el('h3', {}, icon(ICONS.plan), 'Plan hazır. Uygulamaya geçilsin mi?'),
      plan,
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', text: 'Onayla, düzenlemeleri otomatik kabul et',
          onclick: () => answer(id, { behavior: 'allow', nextMode: 'acceptEdits' }) }),
        el('button', { class: 'btn', type: 'button', text: 'Onayla, her adımda sor',
          onclick: () => answer(id, { behavior: 'allow', nextMode: 'default' }) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Planlamaya devam et',
          onclick: () => answer(id, { behavior: 'deny', message: 'Kullanıcı planı henüz onaylamadı; planlamaya devam et.' }) })));
  } else {
    const heading = title || `${TOOL_LABEL[toolName] || toolName} için izin gerekiyor`;
    const note = el('input', { type: 'text', placeholder: 'Reddederken Claude\'a ne yapmasını istediğinizi yazın (isteğe bağlı)' });
    put(card, 
      el('h3', {}, icon(ICONS.shield), heading),
      decisionReason ? el('p', { class: 'why', text: decisionReason }) : null,
      blockedPath ? el('p', { class: 'why', text: `Erişilmek istenen yol: ${blockedPath}` }) : null,
      el('div', { class: 'diff-file', text: toolSummary(toolName, input) }),
      toolInputBody(toolName, input),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', text: 'İzin ver', onclick: () => answer(id, { behavior: 'allow' }) }),
        canAlways ? el('button', { class: 'btn', type: 'button', text: 'Bu oturumda hep izin ver',
          onclick: () => answer(id, { behavior: 'allow', always: true }) }) : null,
        el('button', { class: 'btn ghost', type: 'button', text: 'Reddet',
          onclick: () => answer(id, { behavior: 'deny', message: note.value.trim() || undefined }) }),
        el('span', { class: 'kbd', text: 'Enter izin ver · Esc reddet' })),
      el('div', { class: 'deny-note' }, note));
  }
  state.prompts.set(id, card);
  append(card);
  scrollDown(true);
}

function renderQuestion(ev) {
  const { id, input = {} } = ev;
  const card = el('div', { class: 'prompt-card', 'data-id': id });
  const blocks = (input.questions || []).map((q, qi) => {
    const name = `q-${id}-${qi}`;
    const type = q.multiSelect ? 'checkbox' : 'radio';
    const other = el('input', { type: 'text', placeholder: 'Diğer…' });
    const opts = (q.options || []).map((o) =>
      el('label', { class: 'q-opt' },
        el('input', { type, name, value: o.label }),
        el('div', {}, el('div', { text: o.label }), o.description ? el('div', { class: 'd', text: o.description }) : null)));
    other.addEventListener('input', () => {
      if (other.value && type === 'radio') for (const r of card.querySelectorAll(`input[name="${name}"]`)) r.checked = false;
    });
    return { q, name, other, node: el('div', { class: 'q-block' },
      el('div', { class: 'q-head', text: q.header || 'Soru' }),
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
    el('h3', {}, icon(ICONS.question), 'Claude bir şey soruyor'),
    blocks.map((b) => b.node),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', text: 'Cevapla', onclick: submit }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Atla', onclick: () => answer(id, { behavior: 'deny', message: 'Kullanıcı soruyu cevaplamadı.' }) })));
  state.prompts.set(id, card);
  append(card);
  scrollDown(true);
}

function answer(id, decision) {
  wsSend({ type: 'answer', id, decision });
}

function resolvePrompt(id, behavior) {
  const card = state.prompts.get(id);
  if (!card) return;
  state.prompts.delete(id);
  card.classList.add('resolved');
  for (const b of card.querySelectorAll('button, input')) b.disabled = true;
  const label = behavior === 'allow' ? 'İzin verildi' : behavior === 'deny' ? 'Reddedildi' : 'İptal edildi';
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
  if (busy) setWorking('Çalışıyor…');
  else $('.working', dom.messages)?.remove();
  updateSendBtn();
}

function setWorking(text) {
  let w = $('.working', dom.messages);
  if (!w) {
    w = el('div', { class: 'working' }, el('span', { class: 'spark' }, icon(ICONS.spark)), el('span', { class: 'w-text' }));
    dom.messages.append(w);
  }
  $('.w-text', w).textContent = text;
  dom.empty.hidden = true;
  scrollDown();
}

function updateSendBtn() {
  const hasText = dom.input.value.trim() || state.attachments.length;
  const stop = state.busy && !hasText;
  dom.sendBtn.classList.toggle('stop', stop);
  dom.sendBtn.title = stop ? 'Durdur (Esc)' : 'Gönder';
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
  dom.modelSelect.replaceChildren(el('option', { value: '', text: 'Varsayılan model' }),
    ...models.filter((m) => m.value && m.value !== 'default').map((m) => el('option', { value: m.value, text: m.name || m.value, title: m.description || '' })));
  if (current && ![...dom.modelSelect.options].some((o) => o.value === current))
    dom.modelSelect.append(el('option', { value: current, text: current }));
  dom.modelSelect.value = current;
}

dom.modeSelect.addEventListener('change', () => {
  const mode = dom.modeSelect.value;
  if (mode === 'bypassPermissions' && !confirm('İzinleri atla modunda Claude dosya düzenleme ve komut çalıştırma işlemlerini SORMADAN yapar. Emin misiniz?')) {
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
  renderUserBubble(text, state.attachments.map((a) => a.url));
  wsSend({ type: 'send', text: text || 'Bu görsele bak.', images });
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
  if (file.size > 5 * 1024 * 1024) return notice(`${file.name} 5 MB'tan büyük, eklenmedi.`);
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
      el('button', { type: 'button', text: '×', 'aria-label': 'Kaldır', onclick: () => { state.attachments.splice(i, 1); renderAttachments(); } }))));
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
    const items = [{ name: 'clear', description: 'Yeni oturum başlat' }, ...state.commands]
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

// ---------- Oturum listesi ----------
async function loadSessions() {
  try {
    state.sessions = await fetch(`/api/sessions?dir=${encodeURIComponent(state.cwd)}`).then((r) => r.json());
    if (!Array.isArray(state.sessions)) throw new Error(state.sessions?.error || 'Liste alınamadı');
  } catch (err) {
    state.sessions = [];
    dom.sessionList.replaceChildren(el('div', { class: 'list-empty', text: `Oturumlar yüklenemedi: ${err.message}` }));
    return;
  }
  renderSessions();
}

function renderSessions() {
  if (!state.sessions.length) {
    dom.sessionList.replaceChildren(el('div', { class: 'list-empty', text: 'Bu klasörde henüz oturum yok.' }));
    return;
  }
  dom.sessionList.replaceChildren(...state.sessions.map((s) => {
    const item = el('button', { class: `session-item ${s.id === state.sessionId ? 'active' : ''}`, type: 'button', 'data-id': s.id, title: s.title },
      el('span', { class: 's-title', text: s.title }),
      el('span', { class: 's-time', text: timeAgo(s.lastModified) }),
      el('span', { class: 's-actions' },
        el('span', { title: 'Yeniden adlandır', onclick: (e) => { e.stopPropagation(); renameSession(s); } }, icon(ICONS.pencil)),
        el('span', { title: 'Sil', onclick: (e) => { e.stopPropagation(); removeSession(s); } }, icon(ICONS.trash))));
    item.onclick = () => openSession(s.id);
    return item;
  }));
  const cur = state.sessions.find((s) => s.id === state.sessionId);
  if (cur) dom.sessionTitle.textContent = cur.title;
}

function highlightSession() {
  for (const n of dom.sessionList.querySelectorAll('.session-item')) n.classList.toggle('active', n.dataset.id === state.sessionId);
}

async function renameSession(s) {
  const title = prompt('Oturumun yeni adı:', s.title);
  if (!title?.trim()) return;
  await fetch(`/api/sessions/${s.id}/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim(), dir: state.cwd }) });
  loadSessions();
}

async function removeSession(s) {
  if (!confirm(`"${s.title}" oturumu kalıcı olarak silinsin mi?`)) return;
  await fetch(`/api/sessions/${s.id}?dir=${encodeURIComponent(state.cwd)}`, { method: 'DELETE' });
  if (s.id === state.sessionId) newSession();
  loadSessions();
}

function resetTranscript() {
  dom.messages.replaceChildren();
  state.tools.clear();
  state.live.clear();
  state.liveByIndex.clear();
  state.prompts.clear();
  state.cost = 0;
  dom.empty.hidden = false;
  dom.statusline.replaceChildren();
  setBusy(false);
}

function newSession() {
  state.sessionId = null;
  resetTranscript();
  dom.sessionTitle.textContent = 'Yeni oturum';
  highlightSession();
  startSession(null);
  dom.input.focus();
  closeMenu();
}

async function openSession(id) {
  if (id === state.sessionId && dom.messages.children.length) return closeMenu();
  state.sessionId = id;
  resetTranscript();
  highlightSession();
  const s = state.sessions.find((x) => x.id === id);
  dom.sessionTitle.textContent = s?.title || 'Oturum';
  closeMenu();
  try {
    const msgs = await fetch(`/api/sessions/${id}/messages?dir=${encodeURIComponent(state.cwd)}`).then((r) => r.json());
    if (!Array.isArray(msgs)) throw new Error(msgs?.error || 'Geçmiş alınamadı');
    for (const m of msgs) {
      if (m.type === 'assistant') renderAssistant(m, true);
      else if (m.type === 'user') renderUserFromSdk(m, true);
    }
  } catch (err) {
    notice(`Oturum geçmişi yüklenemedi: ${err.message}`);
  }
  scrollDown(true);
  startSession(id);
}

$('#newSessionBtn').onclick = newSession;
for (const b of document.querySelectorAll('.suggestions button')) b.onclick = () => { dom.input.value = b.dataset.prompt; autoGrow(); send(); };

// ---------- Klasör seçici ----------
const dlg = $('#folderDialog');
const pathInput = $('#pathInput');
const dirList = $('#dirList');

async function browse(p) {
  try {
    const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}`).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    pathInput.value = res.path;
    const items = [];
    if (res.parent !== null && res.parent !== undefined)
      items.push(el('button', { class: 'dir-item', type: 'button', onclick: () => browse(res.parent) }, icon(ICONS.up), '..'));
    for (const d of res.dirs) items.push(el('button', { class: 'dir-item', type: 'button', ondblclick: () => browse(d.path), onclick: () => browse(d.path) }, icon(ICONS.folder), d.name));
    dirList.replaceChildren(...items);
  } catch (err) {
    dirList.replaceChildren(el('div', { class: 'list-empty', text: err.message }));
  }
}
$('#folderBtn').onclick = () => { browse(state.cwd); dlg.showModal(); };
$('#pathGo').onclick = () => browse(pathInput.value);
pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browse(pathInput.value); } });
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'ok' && pathInput.value && pathInput.value !== state.cwd) setCwd(pathInput.value);
});

function setCwd(cwd) {
  state.cwd = cwd;
  store.set('atolye:cwd', cwd);
  dom.folderName.textContent = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
  dom.folderName.parentElement.title = cwd;
  dom.sessionCwd.textContent = cwd;
  newSession();
  loadSessions();
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

// Geliştirme için: ?debug ile açıldığında olaylar konsoldan elle verilebilir
if (new URLSearchParams(location.search).has('debug')) window.atolyeDebug = { handleEvent, state };

// ---------- Başlangıç ----------
(async function init() {
  state.config = await fetch('/api/config').then((r) => r.json());
  state.model = store.get('atolye:model', '');
  const cwd = store.get('atolye:cwd', '') || state.config.defaultCwd;
  state.cwd = cwd;
  dom.folderName.textContent = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
  dom.folderName.parentElement.title = cwd;
  dom.sessionCwd.textContent = cwd;
  dom.gatewayInfo.textContent = state.config.gateway
    ? `Gateway: ${new URL(state.config.gateway).host}`
    : 'Gateway: Claude Code ayarlarından';
  dom.gatewayInfo.title = state.config.gateway || '';
  await loadSessions();
  updateSendBtn();
  connect();
  dom.input.focus();
})();
