// Köprü: Claude Code yalnızca Anthropic biçimini (/v1/messages) konuşur; birçok model sunucusu ve kurum içi
// gateway ise yalnızca OpenAI biçimini (/chat/completions) sunar. Bu dosya ikisi arasında çeviri yapar:
// Claude Code isteğini Atölye'nin kendi adresine (/kopru/<model kimliği>/v1/messages) gönderir, Atölye onu OpenAI
// biçimine çevirip asıl sunucuya iletir ve yanıtı (akış dahil) Anthropic biçiminde geri verir.
// Köprü yalnızca bu bilgisayardan ve her açılışta yeniden üretilen anahtarla çağrılabilir.
import { randomBytes } from 'node:crypto';

/** Köprünün adresi (sunucu açılınca yazılır) ve bu çalıştırmaya özel anahtarı */
export const bridge = { origin: '', secret: randomBytes(18).toString('hex') };

/** OpenAI uyumlu sunucunun sohbet uç noktası: tam adres yazıldıysa o, değilse /v1/chat/completions eklenir */
export function openaiEndpoint(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) return '';
  if (/\/chat\/completions$/i.test(u)) return u;
  return /\/v\d+$/i.test(u) ? `${u}/chat/completions` : `${u}/v1/chat/completions`;
}
/** Aynı sunucunun model listesi adresi */
export const openaiModelsUrl = (url) => openaiEndpoint(url).replace(/\/chat\/completions$/i, '/models');
/** Adres /chat/completions ile bitiyorsa sunucu kesin olarak OpenAI uyumludur */
export const looksOpenAI = (url) => /\/chat\/completions\/?$/i.test(String(url || '').trim());

const blocksOf = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.filter(Boolean) : []);
const textOf = (content, sep = '\n\n') => blocksOf(content).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join(sep);
const imagePart = (b) => {
  if (b.type !== 'image' || !b.source) return null;
  if (b.source.type === 'base64' && b.source.data) return { type: 'image_url', image_url: { url: `data:${b.source.media_type || 'image/png'};base64,${b.source.data}` } };
  if (b.source.type === 'url' && b.source.url) return { type: 'image_url', image_url: { url: b.source.url } };
  return null;
};

/** Anthropic /v1/messages isteği → OpenAI /chat/completions isteği */
export function toOpenAI(body = {}, model) {
  const messages = [];
  const system = textOf(body.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    const blocks = blocksOf(m?.content);
    if (m?.role === 'assistant') {
      const text = textOf(blocks, '');
      const calls = blocks.filter((b) => b.type === 'tool_use' && b.name)
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      if (!text && !calls.length) continue;
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Araç sonuçları, onları isteyen yanıtın hemen ardından gelmelidir; kullanıcının yazdıkları sonra eklenir
    const parts = [];
    for (const b of blocks.filter((x) => x.type === 'tool_result')) {
      const inner = blocksOf(b.content);
      messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: textOf(inner, '\n') || (b.is_error ? '(hata)' : '(çıktı yok)') });
      for (const img of inner.map(imagePart).filter(Boolean)) parts.push(img);
    }
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') { const img = imagePart(b); if (img) parts.push(img); }
    }
    if (!parts.length) continue;
    messages.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n\n') : parts });
  }
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter((t) => t?.name && t.input_schema)
    .map((t) => ({ type: 'function', function: { name: t.name, description: String(t.description || '').slice(0, 8000), parameters: t.input_schema } }));
  const choice = body.tool_choice?.type;
  const out = { model, messages, stream: Boolean(body.stream) };
  if (tools.length) {
    out.tools = tools;
    if (choice === 'any') out.tool_choice = 'required';
    else if (choice === 'none') out.tool_choice = 'none';
    else if (choice === 'tool' && body.tool_choice.name) out.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
  }
  if (Number.isFinite(body.max_tokens)) out.max_tokens = body.max_tokens;
  if (Number.isFinite(body.temperature)) out.temperature = body.temperature;
  if (Number.isFinite(body.top_p)) out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences.slice(0, 4);
  if (out.stream) out.stream_options = { include_usage: true };
  return out;
}

const stopReason = (finish, hasTools) => (hasTools ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'tool_calls' || finish === 'function_call' ? 'tool_use' : 'end_turn');
const callId = () => `call_${randomBytes(9).toString('hex')}`;
const messageId = () => `msg_${randomBytes(12).toString('hex')}`;
const argsObject = (args) => {
  if (args && typeof args === 'object') return args;
  try { const v = JSON.parse(args || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};
const estimate = (value) => Math.ceil(JSON.stringify(value ?? '').length / 4);

/** Düşünen modellerin <think>…</think> bölümünü akış sırasında ayıklar (etiket parçalara bölünmüş gelebilir) */
export function thinkFilter() {
  let buf = '';
  let inside = false;
  return {
    push(s) {
      buf += s;
      let out = '';
      for (;;) {
        if (inside) {
          const i = buf.indexOf('</think>');
          if (i < 0) { buf = buf.slice(-7); break; }
          buf = buf.slice(i + 8);
          inside = false;
        } else {
          const i = buf.indexOf('<think>');
          if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + 7); inside = true; continue; }
          let hold = 0;
          for (let n = Math.min(6, buf.length); n > 0; n -= 1) if ('<think>'.startsWith(buf.slice(-n))) { hold = n; break; }
          out += buf.slice(0, buf.length - hold);
          buf = buf.slice(buf.length - hold);
          break;
        }
      }
      return out;
    },
    flush() { const rest = inside ? '' : buf; buf = ''; return rest; },
  };
}

/** OpenAI yanıtı (akışsız) → Anthropic mesajı */
export function fromOpenAI(data = {}, model, inputEstimate = 0) {
  const choice = data.choices?.[0] || {};
  const msg = choice.message || {};
  const f = thinkFilter();
  const text = (f.push(typeof msg.content === 'string' ? msg.content : '') + f.flush()).trim();
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    if (tc?.function?.name) content.push({ type: 'tool_use', id: tc.id || callId(), name: tc.function.name, input: argsObject(tc.function.arguments) });
  }
  return {
    id: messageId(), type: 'message', role: 'assistant', model, content,
    stop_reason: stopReason(choice.finish_reason, content.some((b) => b.type === 'tool_use')), stop_sequence: null,
    usage: { input_tokens: data.usage?.prompt_tokens ?? inputEstimate, output_tokens: data.usage?.completion_tokens ?? estimate(text) },
  };
}

/**
 * OpenAI akış parçalarını Anthropic akış olaylarına çevirir. Metin geldikçe iletilir; araç çağrıları parça parça
 * ve karışık sırayla gelebildiği için biriktirilip akışın sonunda tek seferde verilir.
 */
export function streamTranslator({ model, send, inputEstimate = 0 }) {
  const filter = thinkFilter();
  const calls = new Map(); // sıra → { id, name, args }
  let started = false;
  let index = -1;
  let textOpen = false;
  let anyText = false;
  let chars = 0;
  let finish = null;
  let usage = null;
  let done = false;
  const start = () => {
    if (started) return;
    started = true;
    send('message_start', { type: 'message_start', message: { id: messageId(), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputEstimate, output_tokens: 0 } } });
  };
  const text = (piece) => {
    const s = anyText ? piece : piece.replace(/^\s+/, '');
    if (!s) return;
    start();
    if (!textOpen) { index += 1; textOpen = true; send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }); }
    anyText = true;
    chars += s.length;
    send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: s } });
  };
  return {
    feed(chunk) {
      if (done || !chunk) return;
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      const d = choice.delta || choice.message || {};
      if (typeof d.content === 'string' && d.content) text(filter.push(d.content));
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const known = tc.id ? [...calls.entries()].find(([, c]) => c.id === tc.id)?.[0] : undefined;
        const key = typeof tc.index === 'number' ? tc.index : known ?? (tc.id ? calls.size : Math.max(0, calls.size - 1));
        const c = calls.get(key) || { id: '', name: '', args: '' };
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name = tc.function.name;
        const a = tc.function?.arguments;
        if (typeof a === 'string') c.args += a; else if (a && typeof a === 'object') c.args = JSON.stringify(a);
        calls.set(key, c);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    },
    end() {
      if (done) return;
      text(filter.flush());
      done = true;
      start();
      if (textOpen) send('content_block_stop', { type: 'content_block_stop', index });
      const tools = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter((c) => c.name);
      for (const c of tools) {
        index += 1;
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: c.id || callId(), name: c.name, input: {} } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(argsObject(c.args)) } });
        send('content_block_stop', { type: 'content_block_stop', index });
        chars += c.args.length;
      }
      send('message_delta', {
        type: 'message_delta', delta: { stop_reason: stopReason(finish, tools.length > 0), stop_sequence: null },
        usage: { input_tokens: usage?.prompt_tokens ?? inputEstimate, output_tokens: usage?.completion_tokens ?? Math.ceil(chars / 4) },
      });
      send('message_stop', { type: 'message_stop' });
    },
    fail(message) {
      if (done) return;
      done = true;
      send('error', { type: 'error', error: { type: 'api_error', message } });
    },
  };
}

const errorType = (status) => (status === 401 || status === 403 ? 'authentication_error' : status === 404 ? 'not_found_error' : status === 429 ? 'rate_limit_error' : status >= 500 ? 'api_error' : 'invalid_request_error');
const errorBody = (status, message) => ({ type: 'error', error: { type: errorType(status), message: String(message || `HTTP ${status}`).slice(0, 600) } });
export const upstreamHeaders = (key) => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}`, 'api-key': key, 'x-api-key': key } : {}) });

// Bazı sunucular stream_options ya da büyük max_tokens değerini reddeder: o durumda istek bu alanlar olmadan
// yinelenir ve sunucunun bunu istediği hatırlanır.
const plain = new Set();

async function callUpstream(cfg, payload, signal, fetchImpl) {
  const endpoint = openaiEndpoint(cfg.url);
  const post = (p) => fetchImpl(endpoint, { method: 'POST', signal, headers: upstreamHeaders(cfg.key), body: JSON.stringify(p) });
  const slim = () => { const { stream_options: _s, max_tokens: _m, ...rest } = payload; return rest; };
  if (plain.has(cfg.id)) return post(slim());
  const res = await post(payload);
  if (res.status !== 400 && res.status !== 422) return res;
  const detail = await res.text().catch(() => '');
  const again = await post(slim());
  if (again.ok) { plain.add(cfg.id); return again; }
  await again.body?.cancel().catch(() => {});
  return new Response(detail, { status: res.status });
}

/** Sunucunun akışını satır satır okuyup her "data:" kaydını verir */
async function* sseData(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

/**
 * Express işleyicileri. configOf(kimlik) kayıtlı modeli ({ id, url, model, key, kind }) döndürür.
 * @returns {{ messages: Function, countTokens: Function }}
 */
export function bridgeHandlers({ configOf, fetchImpl = fetch, log = () => {} }) {
  const allowed = (req) => {
    const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return key === bridge.secret;
  };
  const find = (req, res) => {
    if (!allowed(req)) { res.status(401).json(errorBody(401, 'Köprü anahtarı geçersiz')); return null; }
    const cfg = configOf(req.params.id);
    if (!cfg || cfg.id !== req.params.id || cfg.kind !== 'openai') { res.status(404).json(errorBody(404, 'Bu model artık kayıtlı değil')); return null; }
    return cfg;
  };
  return {
    countTokens(req, res) {
      if (!find(req, res)) return;
      res.json({ input_tokens: estimate(req.body) });
    },
    async messages(req, res) {
      const cfg = find(req, res);
      if (!cfg) return;
      const body = req.body || {};
      const payload = toOpenAI(body, cfg.model);
      const inputEstimate = estimate(payload.messages) + estimate(payload.tools);
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      let up;
      try {
        up = await callUpstream(cfg, payload, abort.signal, fetchImpl);
      } catch (err) {
        if (abort.signal.aborted) return;
        log(`sunucuya ulaşılamadı: ${err?.cause?.code || err?.message || err}`);
        res.status(502).json(errorBody(502, `Model sunucusuna ulaşılamadı: ${err?.cause?.code || err?.message || err}`));
        return;
      }
      if (!up.ok) {
        const detail = (await up.text().catch(() => '')).replace(/\s+/g, ' ').trim();
        log(`HTTP ${up.status} ${detail.slice(0, 200)}`);
        res.status(up.status).json(errorBody(up.status, `Model sunucusu HTTP ${up.status} döndürdü. ${detail}`));
        return;
      }
      if (!payload.stream) {
        const data = await up.json().catch(() => null);
        if (!data) { res.status(502).json(errorBody(502, 'Model sunucusunun yanıtı okunamadı')); return; }
        res.json(fromOpenAI(data, cfg.model, inputEstimate));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const tr = streamTranslator({ model: cfg.model, inputEstimate, send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) });
      try {
        if (!/event-stream/i.test(up.headers.get('content-type') || '')) {
          // Akış istendiği hâlde tek parça yanıt veren sunucu
          tr.feed(await up.json());
        } else {
          for await (const data of sseData(up)) {
            if (data === '[DONE]') break;
            if (!data) continue;
            let chunk;
            try { chunk = JSON.parse(data); } catch { continue; }
            if (chunk?.error) throw new Error(chunk.error.message || JSON.stringify(chunk.error).slice(0, 300));
            tr.feed(chunk);
          }
        }
        tr.end();
      } catch (err) {
        if (!abort.signal.aborted) { log(`akış kesildi: ${err?.message || err}`); tr.fail(`Model sunucusunun yanıtı yarıda kesildi: ${err?.message || err}`); }
      }
      res.end();
    },
  };
}
