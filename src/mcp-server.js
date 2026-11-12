#!/usr/bin/env node
// Atölye'nin Jira / Confluence / Bitbucket araçlarını Claude Code ve GitHub Copilot CLI'a sunan
// küçük MCP sunucusu (stdio, satır başına bir JSON-RPC mesajı). Bağlantı bilgileri ortam
// değişkenlerinden gelir; onları CLI'ların kendi ayar dosyalarına integrations.js yazar.
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { clients, configFromEnv, SERVICES } from './atlassian.js';

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const PROJECT = 'Proje anahtarı (şirket içi Bitbucket) ya da çalışma alanı (Bitbucket Cloud)';

// name -> { service, fn, write, description, properties, required }
export const TOOLS = {
  jira_search: { service: 'jira', fn: 'search', description: 'Jira kayıtlarını JQL ile arar (ör. "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC").', properties: { jql: str('JQL sorgusu'), limit: num('En fazla kaç kayıt (varsayılan 20)') }, required: ['jql'] },
  jira_get_issue: { service: 'jira', fn: 'getIssue', description: 'Bir Jira kaydının ayrıntılarını, açıklamasını ve son yorumlarını getirir.', properties: { key: str('Kayıt anahtarı, ör. ABC-123') }, required: ['key'] },
  jira_add_comment: { service: 'jira', fn: 'addComment', write: true, description: 'Bir Jira kaydına yorum ekler.', properties: { key: str('Kayıt anahtarı, ör. ABC-123'), body: str('Yorum metni') }, required: ['key', 'body'] },
  confluence_search: { service: 'confluence', fn: 'search', description: 'Confluence sayfalarında arama yapar. Düz metin ya da CQL (ör. space = ABC and title ~ "kurulum") verilebilir.', properties: { query: str('Aranacak metin ya da CQL'), limit: num('En fazla kaç sonuç (varsayılan 10)') }, required: ['query'] },
  confluence_get_page: { service: 'confluence', fn: 'getPage', description: 'Bir Confluence sayfasının içeriğini düz metin olarak getirir.', properties: { id: str('Sayfa kimliği (aramadan ya da adresteki pageId değerinden)') }, required: ['id'] },
  bitbucket_list_repos: { service: 'bitbucket', fn: 'listRepos', description: 'Bitbucket depolarını listeler.', properties: { project: str(PROJECT), limit: num('En fazla kaç depo (varsayılan 50)') }, required: [] },
  bitbucket_list_pull_requests: { service: 'bitbucket', fn: 'listPullRequests', description: 'Bir deponun çekme isteklerini (pull request) listeler.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), state: str('OPEN (varsayılan), MERGED ya da DECLINED'), limit: num('En fazla kaç kayıt (varsayılan 25)') }, required: ['repo'] },
  bitbucket_get_pull_request: { service: 'bitbucket', fn: 'getPullRequest', description: 'Bir çekme isteğinin açıklamasını ve değişikliklerini (diff) getirir.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), id: str('Çekme isteği numarası') }, required: ['repo', 'id'] },
  bitbucket_get_file: { service: 'bitbucket', fn: 'getFile', description: 'Depodaki bir dosyanın içeriğini getirir.', properties: { project: str(PROJECT), repo: str('Depo adı (slug)'), path: str('Dosya yolu'), ref: str('Dal, etiket ya da commit (varsayılan: ana dal)') }, required: ['repo', 'path'] },
};

/** Yalnızca bağlantısı kurulmuş servislerin araçları sunulur */
export function availableTools(env = process.env) {
  const configured = Object.fromEntries(SERVICES.map((s) => [s, configFromEnv(s, env)]));
  return Object.entries(TOOLS).filter(([, t]) => configured[t.service]).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: { type: 'object', properties: t.properties, required: t.required },
    annotations: { readOnlyHint: !t.write },
  }));
}

export async function callTool(name, args = {}, env = process.env) {
  const tool = TOOLS[name];
  const cfg = tool && configFromEnv(tool.service, env);
  if (!cfg) return { isError: true, content: [{ type: 'text', text: `Araç kullanılamıyor: ${name}` }] };
  try {
    for (const r of tool.required) if (args[r] === undefined || args[r] === '') throw new Error(`"${r}" gerekli`);
    const text = await clients[tool.service][tool.fn](cfg, args);
    return { content: [{ type: 'text', text: String(text) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `${tool.service}: ${err.message}` }] };
  }
}

export async function handleMessage(m, env = process.env) {
  if (m.id === undefined || m.id === null) return null; // bildirim: cevap yok
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return ok({ protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'atolye', version: '1' } });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: availableTools(env) });
    case 'tools/call': return ok(await callTool(m.params?.name, m.params?.arguments || {}, env));
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Bilinmeyen yöntem: ${m.method}` } };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const res = await handleMessage(m);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
  rl.on('close', () => process.exit(0));
}
