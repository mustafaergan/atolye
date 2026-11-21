// HTTP + WebSocket sunucusu. Sadece 127.0.0.1'e bağlanır; tarayıcıdan gelen
// isteklerde Host/Origin kontrolü yapılır (DNS rebinding ve başka sitelerin
// yerel sunucuya WebSocket açmasına karşı).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import {
  listSessions,
  getSessionMessages,
  deleteSession,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from './manager.js';
import { StateStore } from './store.js';
import { getSpend } from './spend.js';
import { detectCopilot, startLogin, loginStatus, cancelLogin, startInstall, installStatus } from './copilot.js';
import * as integrations from './integrations.js';
import * as fikirhane from './fikirhane.js';
import { applyUpdate, checkUpdate } from './update.js';
import * as repo from './repo.js';
import { recentLog } from './log.js';
import { shortTitle } from './title.js';
import { saveAttachments } from './attachments.js';
import * as transcript from './transcript.js';
import * as proxy from './proxy.js';
import * as testauto from './testauto.js';
import * as commands from './commands.js';
import * as settings from './settings.js';
import * as teams from './teams.js';
import * as oracleClient from './oracle-client.js';
import { bridge, bridgeHandlers } from './kopru.js';
import { searchSessions } from './search.js';
import { validWork } from './workmode.js';
import { copilotQuota } from './copilot-quota.js';
import { checkBrowser, installedMcp, installPlaywrightMcp, playwrightLibrary } from './browser-check.js';
import { msg, normalizeLang } from './messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
// Claude Code / Copilot sürecine giden bir isteğin en fazla bekleneceği süre
const CONTROL_TIMEOUT_MS = Number(process.env.ATOLYE_CONTROL_TIMEOUT_MS) || 10_000;
// Klasörsüz sohbet oturumlarının çalıştığı boş klasör (hiçbir projeye bağlı değil)
const GENERAL_DIR = path.join(os.homedir(), '.atolye', 'genel');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export async function createServer({ port, host = '127.0.0.1', defaultCwd }) {
  await fs.mkdir(GENERAL_DIR, { recursive: true });
  // Bu işaret yalnızca yerel LLM oturumlarına verilir (bkz. settings.js localEnv); dışarıdan gelmişse yok sayılır ki
  // Outlook araçları Claude ya da Copilot oturumlarına hiçbir koşulda sunulmasın
  delete process.env.ATOLYE_YEREL_OTURUM;
  for (const k of ['ATOLYE_TEAMS_URL', 'ATOLYE_TEAMS_ANAHTAR']) delete process.env[k];
  // Eski sürümle eklenmiş skill'ler Copilot'un klasörüne de kopyalanır (bkz. settings.js syncSkills)
  try { const n = settings.syncSkills(); if (n) console.log(`[ayarlar] ${n} skill Copilot klasörüne kopyalandı`); } catch (err) { console.error(`[ayarlar] skill eşitlenemedi: ${err?.message || err}`); }
  const app = express();
  const store = new StateStore();
  const manager = new SessionManager({
    store,
    aiTitles: process.env.ATOLYE_AI_TITLE !== '0',
    // Claude oturumunun başlığı Claude Code'un kendi oturum kaydına yazılır (liste oradan okunur)
    onTitle: (entry, title) => { if (entry.agent.sessionId) renameSession(entry.agent.sessionId, title, { dir: entry.cwd }).catch(() => {}); },
  });
  // Klasörsüz sohbet listede her zaman arayüz tarafından en üste konur; kayda yazılmaz
  const notGeneral = (p) => typeof p === 'string' && p && !samePath(p, GENERAL_DIR);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const isAllowedOrigin = (origin) =>
    !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;

  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host)) return res.status(403).send('Forbidden host');
    if (req.method !== 'GET' && !isAllowedOrigin(req.headers.origin))
      return res.status(403).send('Forbidden origin');
    next();
  });
  app.use(express.json({ limit: '25mb' }));
  // Güncellemeden sonra tarayıcının eski dosyaları göstermemesi için her seferinde doğrulat
  app.use(express.static(path.join(ROOT, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use('/vendor/marked', express.static(path.join(ROOT, 'node_modules/marked/lib')));
  app.use('/vendor/dompurify', express.static(path.join(ROOT, 'node_modules/dompurify/dist')));

  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
      console.error(`[istek] ${req.method} ${req.path}: ${err?.message || err}`);
      res.status(500).json({ error: String(err?.message || err) });
    });

  app.get('/api/config', wrap(async (_req, res) => {
    res.json({
      defaultCwd,
      generalDir: GENERAL_DIR,
      home: os.homedir(),
      platform: process.platform,
      gateway: process.env.ANTHROPIC_BASE_URL || null,
      hasCredential: Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY),
    });
  }));

  // Kalıcı arayüz durumu (projeler, daraltılmış klasörler, son seçimler) — bkz. store.js
  app.get('/api/state', wrap(async (_req, res) => res.json(store.get())));
  app.post('/api/state/projects', wrap(async (req, res) => {
    const { op, dir } = req.body || {};
    if (op === 'add' && notGeneral(dir)) store.addProject(dir);
    else if (op === 'remove' && typeof dir === 'string') store.removeProject(dir);
    else if (op === 'order' && Array.isArray(req.body?.dirs)) store.setProjectOrder(req.body.dirs);
    res.json(store.get());
  }));
  app.post('/api/state/collapsed', wrap(async (req, res) => {
    const { key, collapsed } = req.body || {};
    if (typeof key === 'string' && key) store.setCollapsed(key, Boolean(collapsed));
    res.json(store.get());
  }));
  app.post('/api/state/remember', wrap(async (req, res) => {
    const { cwd, selected, open, engine, role } = req.body || {};
    res.json(store.remember({ cwd, selected, open, engine, role }));
  }));
  app.post('/api/state/import', wrap(async (req, res) => {
    const { projects, collapsed } = req.body || {};
    res.json(store.importLocal({ projects: (Array.isArray(projects) ? projects : []).filter(notGeneral), collapsed }));
  }));

  app.get('/api/spend', wrap(async (req, res) => {
    res.json(await getSpend({ force: req.query.refresh === '1', lang: normalizeLang(req.query.lang) }));
  }));

  // "İlk repom": depo indirme yardımcısı (bkz. repo.js)
  app.get('/api/repo/info', wrap(async (_req, res) => {
    res.json({ git: await repo.gitVersion(), defaultParent: repo.defaultParent(), bitbucket: Boolean(integrations.config('bitbucket')) });
  }));
  app.get('/api/repo/list', wrap(async (req, res) => {
    const cfg = integrations.config('bitbucket');
    if (!cfg) return res.json({ error: msg(req.query.lang, 'Bağlantı bilgileri eksik') });
    try {
      res.json({ repos: await repo.listRepos(cfg, String(req.query.project || '').trim() || undefined) });
    } catch (err) {
      res.json({ error: err.message });
    }
  }));
  app.post('/api/repo/clone', wrap(async (req, res) => {
    const lang = req.query.lang;
    const r = await repo.cloneRepo({ url: req.body?.url, parent: req.body?.parent, bitbucketCfg: integrations.config('bitbucket') });
    console.log(`[depo] indirme: ${r.ok ? `tamam → ${r.dir}` : `olmadı (${r.code}) ${r.error || ''}`}`);
    if (r.ok) store.addProject(r.dir);
    else if (r.code === 'bad-url') r.error = msg(lang, 'Geçerli bir depo adresi girin (ör. https://…/depo-adi.git)');
    else if (r.code === 'no-git') r.error = msg(lang, 'Git kurulu değil. https://git-scm.com adresinden kurup Atölye\'yi yeniden başlatın.');
    else if (r.code === 'exists') r.error = msg(lang, 'Bu klasör zaten var: {dir}. Depo daha önce indirilmiş olabilir; soldan "Klasör ekle" ile açabilirsiniz.', { dir: r.dir });
    res.json(r);
  }));

  // Test otomasyonu bağlantısı (bkz. testauto.js): depo klasörü ve çalıştırma komutu
  app.get('/api/testauto/detect', wrap(async (req, res) => res.json(testauto.detect(String(req.query.dir || '')))));
  app.get('/api/testauto/branches', wrap(async (req, res) => res.json(await testauto.branches(String(req.query.dir || '')))));
  app.post('/api/testauto', wrap(async (req, res) => {
    const lang = req.query.lang;
    try {
      const st = testauto.save(req.body || {});
      console.log(`[test otomasyonu] kaydedildi: ${st.dir}`);
      res.json({ ok: true, status: st });
    } catch (err) {
      const text = err.code === 'no-dir' ? msg(lang, 'Depo klasörünü yazın')
        : err.code === 'bad-dir' ? msg(lang, 'Bu klasör bulunamadı. Tam yolu yazın (ör. C:\\dev\\test-otomasyon) ya da önce depoyu indirin.')
          : err.code === 'no-command' ? msg(lang, 'Testleri çalıştıran komutu yazın (ör. mvn test)')
            : err.code === 'bad-branch' ? msg(lang, 'Dal adı geçersiz (ör. release/2.5.0)') : err.message;
      res.json({ ok: false, error: text });
    }
  }));
  app.delete('/api/testauto', wrap(async (_req, res) => { console.log('[test otomasyonu] bağlantı kaldırıldı'); res.json({ ok: true, status: testauto.remove() }); }));

  // Öğretilen komutlar (bkz. commands.js): kullanıcının tarif ettiği, yapay zekânın derlediği hazır komutlar
  const commandsFile = process.env.ATOLYE_COMMANDS_FILE || undefined;
  const commandList = () => ({ ok: true, commands: commands.list(commandsFile), builtins: commands.builtins(commandsFile), linkIds: commands.LINK_IDS, maxLinks: commands.MAX_LINKS, colors: commands.COLORS });
  const commandError = (lang, err) => (err.code === 'no-name' ? msg(lang, 'Komuta bir ad verin')
    : err.code === 'no-prompt' ? msg(lang, 'Komutun ne yapacağını yazın')
      : err.code === 'no-description' ? msg(lang, 'Ne yapılmasını istediğinizi anlatın')
        : err.code === 'not-found' ? msg(lang, 'Bu komut bulunamadı; silinmiş olabilir')
          : err.code === 'too-many' ? msg(lang, 'En fazla {n} komut kaydedilebilir; önce birini silin', { n: commands.MAX_COMMANDS }) : err.message);
  app.get('/api/commands', wrap(async (_req, res) => res.json(commandList())));
  app.post('/api/commands', wrap(async (req, res) => {
    try {
      commands.save(req.body || {}, commandsFile);
      console.log(`[komut] kaydedildi: ${String(req.body?.name || '').slice(0, 40)}`);
      res.json(commandList());
    } catch (err) { res.json({ ok: false, error: commandError(req.query.lang, err) }); }
  }));
  // Hazır komutlar: değiştirme, gizleme (POST) ve Atölye'nin kendi hâline döndürme (DELETE)
  app.post('/api/commands/builtin', wrap(async (req, res) => {
    try { commands.saveBuiltin(req.body?.key, req.body || {}, commandsFile); res.json(commandList()); } catch (err) { res.json({ ok: false, error: commandError(req.query.lang, err) }); }
  }));
  app.delete('/api/commands/builtin', wrap(async (req, res) => { commands.resetBuiltin(String(req.query.key || ''), commandsFile); res.json(commandList()); }));
  app.delete('/api/commands/:id', wrap(async (req, res) => { commands.remove(req.params.id, commandsFile); console.log('[komut] silindi'); res.json(commandList()); }));
  app.post('/api/commands/compile', wrap(async (req, res) => {
    const { description, engine, cwd, model } = req.body || {};
    try {
      const dir = typeof cwd === 'string' && cwd && existsSync(cwd) ? cwd : GENERAL_DIR;
      const c = await commands.compile({ engine: engine === 'copilot' ? 'copilot' : 'claude', cwd: dir, model: typeof model === 'string' && model ? model : undefined, description, lang: req.query.lang });
      console.log(`[komut] derlendi (${c.ai ? 'yapay zekâ' : 'yedek: tarif olduğu gibi'}): ${c.name}`);
      res.json({ ok: true, command: c });
    } catch (err) { res.json({ ok: false, error: commandError(req.query.lang, err) }); }
  }));


  // ---------- Ayarlar (bkz. settings.js) ----------
  const settingsError = (lang, err) => ({
    'bad-url': msg(lang, 'Geçerli bir adres girin (http://… ya da https://… ile başlamalı)'),
    'no-token': msg(lang, 'Gateway adresi ya da token girin'),
    'no-model': msg(lang, 'Model adını yazın ya da listeden seçin'),
    'unreachable': msg(lang, 'Sunucuya ulaşılamadı: {detail}. Adresi ve sunucunun çalıştığını kontrol edin.', { detail: err.detail || '' }),
    'no-messages-api': msg(lang, 'Sunucu yanıt veriyor ama bu adreste ne Anthropic uyumlu (/v1/messages) ne de OpenAI uyumlu (/chat/completions) uç nokta bulundu. Adresi kontrol edin; OpenAI uyumlu sunucuda adresi /chat/completions ile biten tam hâliyle yazabilirsiniz.'),
    'no-model-list': msg(lang, 'Bu sunucu model listesi vermiyor. Model adını elle yazıp yeniden deneyin.'),
    'bad-model': msg(lang, 'Model yanıt vermedi: {detail}', { detail: err.detail || '' }),
    'no-dir': msg(lang, 'Bu klasör bulunamadı. Tam yolu yazın (ör. C:\\dev\\skillerim).'),
    'no-skill': msg(lang, 'Bu klasörde skill bulunamadı. Klasörün (ya da alt klasörlerinin) içinde SKILL.md dosyası olmalı.'),
    'exists': msg(lang, '"{name}" adında bir skill zaten var ve Atölye eklememiş; üzerine yazılmadı.', { name: err.name || '' }),
    'not-found': msg(lang, 'Bu skill Atölye ile eklenmemiş; kaldırılamaz'),
    'not-supported': msg(lang, 'Bu seçenek yalnızca Windows kurulumunda kullanılabilir'),
    'bad-date': msg(lang, 'Geçerli ve geçmiş bir tarih seçin'),
    'bad-days': msg(lang, 'Gün sayısı 1 ile 3650 arasında olmalı'),
    'local-not-found': msg(lang, 'Bu yerel model bulunamadı; silinmiş olabilir'),
    'too-many-local': msg(lang, 'En fazla {n} yerel model eklenebilir', { n: settings.MAX_LOCAL }),
    'nothing-to-export': msg(lang, 'Dışa aktarılacak yerel model yok'),
    'bad-file': msg(lang, 'Bu dosya bir Atölye yerel model dosyası değil ya da bozuk'),
    'need-pass': msg(lang, 'Dosyadaki API anahtarları şifreli; şifreleme anahtarını yazın'),
    'bad-pass': msg(lang, 'Şifreleme anahtarı yanlış; dosyadaki API anahtarları çözülemedi'),
  })[err.code] || err.message;
  const guard = (fn) => wrap(async (req, res) => {
    try { res.json(await fn(req, res)); } catch (err) { res.json({ ok: false, error: settingsError(req.query.lang, err) }); }
  });
  const pkgVersion = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  app.get('/api/settings', wrap(async (_req, res) => res.json({
    version: pkgVersion,
    app: await settings.appStatus(),
    claude: settings.claudeStatus(),
    copilot: settings.copilotStatus(),
    local: settings.localStatus(),
    skills: settings.listSkills(),
  })));
  app.post('/api/settings/app', guard(async (req) => {
    const r = await settings.appSet(String(req.body?.key || ''), Boolean(req.body?.on));
    console.log(`[ayarlar] ${req.body?.key}: ${req.body?.on ? 'açık' : 'kapalı'} (${r.ok ? 'tamam' : 'başarısız'})`);
    return r;
  }));
  app.post('/api/settings/claude', guard(async (req) => { const st = settings.saveClaude(req.body || {}); console.log('[ayarlar] Claude bağlantısı kaydedildi'); return { ok: true, status: st }; }));
  app.delete('/api/settings/claude', guard(async () => { console.log('[ayarlar] Claude bağlantısı kaldırıldı'); return { ok: true, status: settings.removeClaude() }; }));
  app.post('/api/settings/copilot', guard(async (req) => ({ ok: true, status: settings.saveCopilot(req.body || {}) })));
  app.post('/api/settings/local', guard(async (req) => { const st = settings.saveLocal(req.body || {}); console.log(`[ayarlar] yerel LLM kaydedildi (${st.models.length} model)`); return { ok: true, status: st }; }));
  app.delete('/api/settings/local/:id', guard(async (req) => { console.log('[ayarlar] yerel LLM kaldırıldı'); return { ok: true, status: settings.removeLocal(req.params.id) }; }));
  // Dışa / içe aktarma: API anahtarları dosyada şifreli durur (bkz. settings.js)
  app.post('/api/settings/local/export', guard(async (req) => { const file = settings.exportLocal(req.body || {}); console.log(`[ayarlar] yerel LLM dışa aktarıldı (${file.models.length} model)`); return { ok: true, file }; }));
  app.post('/api/settings/local/import', guard(async (req) => { const r = settings.importLocal(req.body || {}); console.log(`[ayarlar] yerel LLM içe aktarıldı (${r.added} yeni, ${r.updated} güncellenen)`); return { ok: true, ...r }; }));
  app.post('/api/settings/local/test', guard(async (req) => {
    // Düzenlenen modelde anahtar alanı boş bırakıldıysa kayıtlı anahtarla denenir
    const saved = req.body?.id ? settings.localConfig(req.body.id) : null;
    return settings.testLocal({ ...req.body, key: req.body?.key || (saved && saved.id === req.body.id ? saved.key : '') || '' });
  }));
  // OpenAI uyumlu sunucular için köprü: Claude Code buraya Anthropic biçiminde yazar (bkz. kopru.js)
  bridge.origin = `http://127.0.0.1:${port}`;
  const kopru = bridgeHandlers({ configOf: (id) => settings.localConfig(id), log: (text) => console.error(`[köprü] ${text}`) });
  app.post('/kopru/:id/v1/messages/count_tokens', (req, res) => kopru.countTokens(req, res));
  app.post('/kopru/:id/v1/messages', (req, res) => kopru.messages(req, res).catch((err) => {
    console.error(`[köprü] ${err?.message || err}`);
    if (!res.headersSent) res.status(500).json({ type: 'error', error: { type: 'api_error', message: String(err?.message || err) } }); else res.end();
  }));
  app.post('/api/settings/skills', guard(async (req) => { const added = settings.addSkill(req.body?.dir); console.log(`[ayarlar] skill eklendi: ${added.join(', ')}`); return { ok: true, added, skills: settings.listSkills() }; }));
  app.delete('/api/settings/skills/:name', guard(async (req) => { const skills = settings.removeSkill(req.params.name); console.log(`[ayarlar] skill kaldırıldı: ${req.params.name}`); return { ok: true, skills }; }));

  // Atölye'nin bildiği bütün klasörlerdeki oturumlar (temizlik ve arama için), en yenisi üstte
  async function allSessions(lang) {
    const dirs = [];
    for (const d of [...store.get().projects, GENERAL_DIR, defaultCwd]) if (d && !dirs.some((x) => samePath(x, d))) dirs.push(d);
    const out = [];
    for (const dir of dirs) {
      const list = await listSessions({ dir, limit: 300 }).catch(() => []);
      for (const s of list) out.push({ id: s.sessionId, engine: store.isLocalSession(s.sessionId) ? 'yerel' : 'claude', cwd: s.cwd || dir, lastModified: s.lastModified, title: s.customTitle || shortTitle(s.summary) || shortTitle(s.firstPrompt) || msg(lang, 'Adsız oturum') });
    }
    for (const s of store.get().copilotSessions) out.push({ id: s.id, engine: 'copilot', cwd: s.cwd, lastModified: s.lastModified, title: s.title || msg(lang, 'Adsız oturum') });
    const seen = new Set();
    return out.filter((s) => !seen.has(`${s.engine}:${s.id}`) && seen.add(`${s.engine}:${s.id}`)).sort((a, b) => b.lastModified - a.lastModified);
  }

  // Eski oturumların temizliği: önce kaç oturumun silineceği sorulur (apply yok), onaydan sonra silinir (apply: true)
  app.post('/api/sessions/cleanup', guard(async (req) => {
    const cutoff = settings.cleanupCutoff(req.body || {});
    const openIds = new Set([...manager.entries.values()].map((e) => e.agent.sessionId).filter(Boolean));
    const old = settings.selectOld(await allSessions(req.query.lang), cutoff, openIds);
    if (!req.body?.apply) return { ok: true, count: old.length, cutoff, sample: old.slice(0, 6).map((s) => ({ title: s.title, cwd: s.cwd, lastModified: s.lastModified })) };
    let deleted = 0;
    for (const s of old) {
      try {
        if (s.engine === 'copilot') { store.deleteCopilotSession(s.id); transcript.remove(s.id); } else { await deleteSession(s.id, { dir: s.cwd }); store.deleteLocalSession(s.id); }
        deleted++;
      } catch { /* silinemeyen oturum atlanır */ }
    }
    console.log(`[oturum] temizlik: ${deleted} eski oturum silindi (sınır ${new Date(cutoff).toISOString().slice(0, 10)})`);
    return { ok: true, deleted };
  }));

  // Bütün sohbetlerde arama (bkz. search.js)
  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, results: [] });
    const started = Date.now();
    const results = searchSessions({ q, sessions: await allSessions(req.query.lang), readCopilot: (id) => transcript.read(id) });
    console.log(`[arama] ${results.length} sonuç, ${Date.now() - started} ms`);
    res.json({ ok: true, results });
  }));

  // Oturumların elle sıralanması
  app.post('/api/state/order', wrap(async (req, res) => {
    if (typeof req.body?.dir === 'string') store.setSessionOrder(req.body.dir, req.body.ids);
    res.json({ ok: true });
  }));

  // Tarayıcı bağlantısı (Playwright MCP): ön koşul denetimi, onay sonrası kurulum, etkinleştirme
  app.get('/api/browser/check', wrap(async (req, res) => res.json(await checkBrowser(String(req.query.browser || 'chrome')))));
  app.get('/api/browser/installed', wrap(async (_req, res) => res.json({ version: (await installedMcp())?.version || null })));
  app.post('/api/browser/install', wrap(async (_req, res) => {
    console.log('[tarayıcı] Playwright MCP kurulumu başlatıldı');
    const r = await installPlaywrightMcp();
    console.log(`[tarayıcı] kurulum: ${r.ok ? `tamam (${r.version})` : r.error}`);
    res.json(r);
  }));
  app.post('/api/browser', wrap(async (req, res) => {
    try {
      const mcp = await installedMcp();
      const st = integrations.saveBrowser({ ...(req.body || {}), cli: mcp?.cli });
      console.log(`[tarayıcı] etkinleştirildi: ${req.body?.browser}${req.body?.headless ? ' (arka planda)' : ''}`);
      res.json(st);
    } catch (err) {
      res.status(400).json({ error: err.code === 'bad-browser' ? msg(req.query.lang, 'Geçersiz tarayıcı seçimi') : err.code === 'not-installed' ? msg(req.query.lang, 'Önce Playwright MCP kurulmalı') : err.message });
    }
  }));
  app.delete('/api/browser', wrap(async (_req, res) => { console.log('[tarayıcı] bağlantı kaldırıldı'); res.json(integrations.removeBrowser()); }));

  // Copilot kalan kotası: Copilot CLI'ın yerel önbelleğinden okunur (bkz. copilot-quota.js)
  app.get('/api/copilot/quota', wrap(async (_req, res) => res.json(copilotQuota())));

  // Copilot CLI'ı arayüzden kurma (kullanıcı onayıyla): durum 'running' → 'done' / 'failed'
  app.get('/api/copilot/install', wrap(async (_req, res) => res.json(installStatus())));
  app.post('/api/copilot/install', wrap(async (_req, res) => res.json(startInstall())));

  // Copilot'a arayüzden giriş (cihaz kodu akışı): kod ve adres ekranda gösterilir, giriş bitince durum 'done' olur
  app.get('/api/copilot/login', wrap(async (_req, res) => res.json(loginStatus())));
  app.post('/api/copilot/login', wrap(async (_req, res) => res.json(startLogin())));
  app.delete('/api/copilot/login', wrap(async (_req, res) => res.json(cancelLogin())));

  // Kurumsal proxy ayarı (bkz. proxy.js). Parola arayüze geri gönderilmez.
  app.get('/api/proxy', wrap(async (_req, res) => res.json(proxy.status())));
  app.post('/api/proxy', wrap(async (req, res) => {
    try {
      const st = await proxy.save(req.body || {});
      console.log('[proxy] ayar kaydedildi');
      res.json(st);
    } catch (err) {
      res.status(400).json({ error: err.code === 'bad-address' ? msg(req.query.lang, 'Geçerli bir proxy adresi girin (ör. proxy.sirket.com:8080)') : err.message });
    }
  }));
  app.delete('/api/proxy', wrap(async (_req, res) => { console.log('[proxy] ayar kaldırıldı'); res.json(await proxy.remove()); }));
  app.post('/api/proxy/test', wrap(async (req, res) => {
    const lang = req.query.lang;
    // Formdaki değerler gönderildiyse kaydetmeden onlar sınanır
    let form = null;
    if (req.body?.address) {
      try { form = proxy.fromForm(req.body); } catch { return res.json({ ok: false, error: msg(lang, 'Geçerli bir proxy adresi girin (ör. proxy.sirket.com:8080)') }); }
    }
    const r = await proxy.test(form ? { proxy: form } : {});
    console.log(`[proxy] sınama: ${r.ok ? 'başarılı' : `${r.code}${r.status ? ` (${r.status})` : ''}`}`);
    if (!r.ok) {
      r.error = r.code === 'auth' ? msg(lang, 'Proxy kullanıcı adını ya da parolayı kabul etmedi (407).')
        : r.code === 'unreachable' ? msg(lang, 'Proxy sunucusuna ulaşılamadı; adresi ve portu kontrol edin.')
          : r.code === 'timeout' ? msg(lang, 'Proxy cevap vermedi (zaman aşımı).')
            : r.code === 'not-configured' ? msg(lang, 'Proxy ayarı yok.')
              : msg(lang, 'Proxy GitHub\'a bağlanmayı reddetti (HTTP {status}).', { status: r.status || '?' });
    }
    res.json(r);
  }));

  // Son kayıt satırları (kenar çubuğundaki "Kayıtlar" penceresi)
  app.get('/api/log', wrap(async (req, res) => res.json({ lines: recentLog(req.query.lines) })));

  // Yeni Atölye sürümü var mı? (sağ üstteki "Güncelleme var" bildirimi)
  app.get('/api/update', wrap(async (req, res) => res.json(await checkUpdate({ force: req.query.refresh === '1' }))));
  app.post('/api/update/apply', wrap(async (_req, res) => {
    const r = applyUpdate();
    console.log(`[güncelleme] arayüzden başlatıldı: ${r.started ? 'evet (çıktı: atolye-guncelle.log)' : 'başlatılamadı'}`);
    res.json(r);
  }));

  // Jira / Confluence / Bitbucket bağlantıları (bkz. integrations.js). API anahtarı arayüze geri gönderilmez.
  const integrationError = (lang, err) => {
    if (err.code === 'bad-url') return msg(lang, 'Geçerli bir adres girin (https://… ile başlamalı)');
    if (err.code === 'bad-db-url') return err.service === 'oracle'
      ? msg(lang, 'Oracle adresini sunucu:port/servis-adı biçiminde yazın (ör. db.sirket.com:1521/ORCLPDB1); kullanıcı adı ve parola ayrı alanlara yazılır')
      : msg(lang, 'PostgreSQL adresini postgresql://sunucu:5432/veritabani biçiminde yazın; kullanıcı adı ve parola adrese değil ayrı alanlara yazılır');
    if (err.code === 'no-token') return msg(lang, 'API anahtarı gerekli');
    return err.message;
  };
  app.get('/api/integrations', wrap(async (_req, res) => {
    const st = integrations.status();
    // Tarayıcı bağlantısı kuruluysa Playwright kütüphanesinin yeri de bildirilir (betikle kullanım için)
    if (st.services.tarayici?.connected) {
      const mcp = await installedMcp();
      // Eski sürümler sunucuyu npx ile indirerek başlatıyordu (npm erişimi olmayan ağlarda çalışmaz): kayıtlı ayar,
      // seçilen tarayıcı korunarak Atölye ile gelen Playwright'a çevrilir
      if (mcp && integrations.browserCli() !== mcp.cli) {
        integrations.saveBrowser({ browser: st.services.tarayici.browser, headless: st.services.tarayici.headless, cli: mcp.cli });
        console.log('[tarayıcı] kayıtlı ayar Atölye ile gelen Playwright\'a güncellendi');
      }
      st.services.tarayici.library = playwrightLibrary(mcp?.cli);
    }
    st.services.testotomasyon = testauto.status();
    // Teams: araçlar açık mı (ayar dosyasında) ve bellekteki erişim anahtarının durumu
    const tk = teams.status();
    st.services.teams = { ...st.services.teams, ...tk, enabled: st.services.teams.connected, connected: st.services.teams.connected && tk.hasToken && !tk.expired };
    // Fikirhane açıksa dinlediği port da bildirilir (araçların kullanılamadığı oturumlarda adresi yönergeye yazmak için)
    if (st.services.fikirhane?.connected) { try { st.services.fikirhane.port = fikirhane.door(fikirhane.fikirhaneConfig({ FIKIRHANE_ENABLED: '1' })).port; } catch { /* Fikirhane çalışmıyor */ } }
    res.json(st);
  }));
  // Fikirhane: bu bilgisayarda çalışan ayrı uygulama (gezilmiş sitelerin ekranları ve senaryoları). Araçları açılır/kapatılır;
  // durum ucu Fikirhane'nin çalışıp çalışmadığını ve gezilmiş siteleri bildirir (bkz. fikirhane.js)
  app.get('/api/fikirhane', wrap(async (_req, res) => res.json(await fikirhane.probe(fikirhane.fikirhaneConfig({ FIKIRHANE_ENABLED: '1' })))));
  app.post('/api/fikirhane', wrap(async (_req, res) => { console.log('[bağlantı] fikirhane etkinleştirildi'); res.json(integrations.setFikirhane(true)); }));
  app.delete('/api/fikirhane', wrap(async (_req, res) => { console.log('[bağlantı] fikirhane kapatıldı'); res.json(integrations.setFikirhane(false)); }));
  // Outlook: bilgisayardaki Outlook'un araçları açılır/kapatılır (adres ya da anahtar gerekmez)
  app.post('/api/outlook', wrap(async (_req, res) => { console.log('[bağlantı] outlook etkinleştirildi'); res.json(integrations.setOutlook(true)); }));
  app.delete('/api/outlook', wrap(async (_req, res) => { console.log('[bağlantı] outlook kapatıldı'); res.json(integrations.setOutlook(false)); }));
  // Oracle istemcisi: thin kipin desteklemediği bağlantılar için Oracle Instant Client, kullanıcı istediğinde Oracle'ın
  // sitesinden indirilir (bkz. oracle-client.js). İndirme arka planda sürer; arayüz durumu aralıklarla sorar.
  app.get('/api/oracle-client', wrap(async (_req, res) => res.json(oracleClient.status())));
  app.post('/api/oracle-client', wrap(async (_req, res) => {
    const { status, done } = oracleClient.start();
    if (status.phase === 'download' && !status.received) console.log('[oracle] istemci indirme başlatıldı');
    done.then((st) => console.log(`[oracle] istemci indirme: ${st.phase === 'done' ? `tamam (${st.installed})` : st.error}`)).catch(() => {});
    res.json(oracleClient.status());
  }));
  // Teams: Graph Explorer'dan alınan erişim anahtarı yalnızca bellekte tutulur (diske ve kayıtlara yazılmaz); araçlar
  // yalnızca yerel LLM oturumlarına sunulur ve isteklerini aşağıdaki iç kapıdan geçirir (bkz. teams.js)
  teams.gate.origin = `http://127.0.0.1:${port}`;
  const teamsError = (lang, err) => ({
    'no-token': msg(lang, 'Erişim anahtarını yapıştırın'),
    'bad-token': msg(lang, 'Bu metin bir erişim anahtarına benzemiyor. Graph Explorer\'daki "Access token" sekmesindeki değerin tamamını kopyalayın.'),
    expired: msg(lang, 'Bu erişim anahtarının süresi dolmuş. Graph Explorer\'da sayfayı yenileyip yeni anahtarı kopyalayın.'),
    'wrong-audience': msg(lang, 'Bu anahtar Microsoft Graph için değil. Anahtarı Graph Explorer\'daki "Access token" sekmesinden alın.'),
  }[err.code] || err.message);
  app.post('/api/teams', wrap(async (req, res) => {
    let st;
    try { st = teams.setToken(req.body?.token); } catch (err) { return res.status(400).json({ ok: false, error: teamsError(req.query.lang, err) }); }
    integrations.setTeams(true);
    const r = await teams.test();
    if (r.code === 401) teams.clearToken(); // Graph'in reddettiği anahtar saklanmaz
    console.log(`[bağlantı] teams anahtarı alındı (${st.minutesLeft ?? '?'} dk geçerli); sınama: ${r.ok ? 'başarılı' : r.error}`);
    res.json({ ...r, status: teams.status() });
  }));
  app.post('/api/teams/test', wrap(async (_req, res) => {
    const r = await teams.test();
    console.log(`[bağlantı] teams sınaması: ${r.ok ? 'başarılı' : r.error}`);
    res.json({ ...r, status: teams.status() });
  }));
  app.delete('/api/teams', wrap(async (_req, res) => { teams.clearToken(); console.log('[bağlantı] teams kapatıldı, anahtar bellekten silindi'); res.json(integrations.setTeams(false)); }));
  app.post('/ic/teams', wrap(async (req, res) => {
    const r = await teams.gateRequest(req.headers.authorization, req.body);
    if (r.status === 200) console.log(`[bağlantı] teams ${req.body?.op}: ${r.body.error ? r.body.error.slice(0, 160) : `tamam (${r.body.text.length} karakter)`}`);
    res.status(r.status).json(r.body);
  }));
  app.post('/api/integrations/:service', wrap(async (req, res) => {
    try {
      const st = integrations.save(req.params.service, req.body || {});
      console.log(`[bağlantı] ${req.params.service} kaydedildi`);
      res.json(st);
    } catch (err) {
      res.status(400).json({ error: integrationError(req.query.lang, err) });
    }
  }));
  app.delete('/api/integrations/:service', wrap(async (req, res) => res.json(integrations.remove(req.params.service))));
  // Bağlantıdan veri getirme: Atölye kayıtlı bağlantıyla doğrudan REST çağrısı yapar (yalnızca okuma)
  app.get('/api/link-data/tools', wrap(async (req, res) => {
    try { res.json({ tools: integrations.readTools(String(req.query.service || '')) }); } catch { res.json({ tools: [] }); }
  }));
  app.post('/api/link-data/call', wrap(async (req, res) => {
    const r = await integrations.runReadTool(String(req.body?.name || ''), req.body?.args);
    console.log(`[bağlantı] veri getirme ${req.body?.name}: ${r.ok ? `tamam (${r.text.length} karakter)` : r.text.slice(0, 160)}`);
    res.json(r);
  }));
  app.post('/api/integrations/:service/test', wrap(async (req, res) => {
    const r = await integrations.test(req.params.service);
    console.log(`[bağlantı] ${req.params.service} sınaması: ${r.ok ? `başarılı (${r.user})` : r.error}`);
    if (r.error === 'not-configured') r.error = msg(req.query.lang, 'Bağlantı bilgileri eksik');
    res.json(r);
  }));

  // Hangi yapay zekâ motorları kullanılabilir? (Claude Code her zaman; GitHub Copilot CLI kuruluysa)
  app.get('/api/engines', wrap(async (req, res) => {
    const local = settings.localStatus();
    res.json({ claude: { available: true }, copilot: await detectCopilot({ force: req.query.refresh === '1' }), yerel: { available: local.configured, models: local.models.map(({ id, name, model }) => ({ id, name, model })) } });
  }));

  app.get('/api/sessions', wrap(async (req, res) => {
    const dir = String(req.query.dir || defaultCwd);
    const sessions = await listSessions({ dir, limit: 100 });
    const claude = sessions.map((s) => ({
      id: s.sessionId,
      engine: store.isLocalSession(s.sessionId) ? 'yerel' : 'claude',
      local: store.localModelOf(s.sessionId),
      title: s.customTitle || shortTitle(s.summary) || shortTitle(s.firstPrompt) || msg(req.query.lang, 'Adsız oturum'),
      lastModified: s.lastModified,
      gitBranch: s.gitBranch,
      cwd: s.cwd,
    }));
    const copilot = store.copilotSessionsFor(dir).map((s) => ({
      id: s.id,
      engine: 'copilot',
      title: s.title || msg(req.query.lang, 'Adsız oturum'),
      lastModified: s.lastModified,
      cwd: s.cwd,
    }));
    res.json(store.applySessionOrder(dir, [...claude, ...copilot].sort((a, b) => b.lastModified - a.lastModified)));
  }));

  app.get('/api/sessions/:id/messages', wrap(async (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : undefined;
    res.json(await getSessionMessages(req.params.id, { dir }));
  }));

  app.post('/api/sessions/:id/rename', wrap(async (req, res) => {
    const dir = req.body?.dir ? String(req.body.dir) : undefined;
    const title = String(req.body?.title || '').slice(0, 200);
    if (req.body?.engine === 'copilot') store.renameCopilotSession(req.params.id, title);
    else await renameSession(req.params.id, title, { dir });
    res.json({ ok: true });
  }));

  app.delete('/api/sessions/:id', wrap(async (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : undefined;
    manager.closeBySessionId(req.params.id);
    // Copilot oturumu: listeden kaldırılır (Copilot'un kendi kayıtlarına dokunulmaz)
    if (req.query.engine === 'copilot') { store.deleteCopilotSession(req.params.id); transcript.remove(req.params.id); }
    else { await deleteSession(req.params.id, { dir }); store.deleteLocalSession(req.params.id); }
    res.json({ ok: true });
  }));

  // Klasör seçici
  app.get('/api/fs/list', wrap(async (req, res) => {
    const requested = String(req.query.path || '');
    if (!requested && process.platform === 'win32') return res.json({ path: '', parent: null, dirs: await windowsDrives() });
    // "~": kullanıcının ev klasörü (klasör seçici başlangıcı)
    const dir = path.resolve(requested === '~' ? os.homedir() : requested || os.homedir());
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('$'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const parent = path.dirname(dir);
    res.json({ path: dir, parent: parent === dir ? (process.platform === 'win32' ? '' : null) : parent, dirs });
  }));

  // @ ile dosya önerisi için hafif bir arama
  app.get('/api/fs/files', wrap(async (req, res) => {
    const root = path.resolve(String(req.query.dir || defaultCwd));
    const q = String(req.query.q || '').toLowerCase();
    res.json(await findFiles(root, q, 30));
  }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !allowedHosts.has(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    // Bu bağlantının o an izlediği oturum. Bağlantı kapansa da oturum çalışmaya devam eder.
    let entry = null;
    let unsubscribe = null;
    let lang = 'tr'; // arayüzün dili; "open" mesajıyla gelir
    const emit = (event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    const stopLive = manager.onChange((sessions) => emit({ type: 'live', sessions }));
    // Başka bir sekmede proje eklenince/kaldırılınca bu sekme de güncellensin
    const stopState = store.onChange((state) => emit({ type: 'state', state }));
    emit({ type: 'live', sessions: manager.list() });

    const detach = () => {
      unsubscribe?.();
      unsubscribe = null;
      entry = null;
    };

    // Claude Code / Copilot sürecine giden istekler takılabilir (süreç cevap vermiyorsa).
    // Hiçbiri sonsuza kadar beklenmez ve hiçbiri başka bir isteği kilitlemez.
    const timed = (promise, label) => {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label}: zaman aşımı`), { timeout: true })), CONTROL_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
    };

    // "Oturum aç": son tıklanan kazanır. Yavaş bir açılış, sonradan istenen oturumu bekletmez;
    // geride kalan açılışın oluşturduğu boş oturum hemen kapatılır.
    let openSeq = 0;
    let opening = Promise.resolve();
    const open = async (m) => {
      const seq = ++openSeq;
      try {
        await openSession(m, seq);
      } catch (err) {
        if (seq === openSeq) throw err; // geride kalmış bir açılışın hatası yeni ekranı ilgilendirmez
      }
    };
    const openSession = async (m, seq) => {
      lang = normalizeLang(m.lang);
      detach(); // eski oturumun olayları yeni ekrana karışmasın
      const cwd = path.resolve(String(m.cwd || defaultCwd));
      const stat = await fs.stat(cwd).catch(() => null);
      if (!stat?.isDirectory()) throw new Error(msg(lang, 'Klasör bulunamadı: {dir}', { dir: cwd }));
      const engine = ['copilot', 'yerel'].includes(m.engine) ? m.engine : 'claude';
      if (engine === 'yerel' && !settings.localConfig()) throw new Error(msg(lang, 'Yerel LLM ayarlı değil. Ayarlar > Yerel LLM bölümünden sunucu adresini ve modeli girin.'));
      if (engine === 'copilot') {
        const cp = await detectCopilot();
        if (!cp.available) throw new Error(msg(lang, 'GitHub Copilot CLI bulunamadı. Kurmak için: npm install -g @github/copilot ({error})', { error: cp.error }));
      }
      const next = await manager.open({
        engine,
        localId: typeof m.local === 'string' ? m.local : undefined,
        liveId: m.new ? null : m.liveId,
        sessionId: m.new ? null : m.sessionId,
        cwd,
        mode: MODES.has(m.mode) ? m.mode : 'default',
        model: m.model || undefined,
        effort: typeof m.effort === 'string' && m.effort ? m.effort : undefined,
        general: samePath(cwd, GENERAL_DIR),
        role: typeof m.role === 'string' ? m.role : undefined,
        work: validWork(m.work),
        lang,
      });
      const history = next.historyCount
        ? await timed(getSessionMessages(next.agent.sessionId, { dir: next.cwd, limit: next.historyCount }), 'geçmiş').catch(() => [])
        : [];
      if (seq !== openSeq) {
        // Bu arada başka bir oturum istendi: bunu ekrana bağlama
        if (!next.sent && !next.subs.size) manager.close(next);
        return;
      }
      if (!manager.entries.has(next.liveId)) throw new Error(msg(lang, 'Oturum kapandı, yeniden açın'));
      entry = next;
      unsubscribe = manager.subscribe(entry, emit, history);
    };

    const handle = async (m) => {
      const current = entry;
      switch (m.type) {
        case 'open': {
          const p = open(m);
          opening = p.catch(() => {});
          return p;
        }
        case 'send':
          await opening; // oturum açılırken yazılan mesaj, açılan oturuma gitsin
          if (!entry || entry.agent.closed) throw new Error(msg(lang, 'Aktif oturum yok'));
          {
            const files = saveAttachments(m.files);
            if (files.length) console.log(`[ek] ${files.length} dosya kaydedildi (${files.map((f) => `${f.kind}${f.note ? `:${f.note.split(':')[0]}` : ''}`).join(', ')})`);
            const handoff = typeof m.handoff === 'string' ? m.handoff : '';
            if (handoff.trim()) console.log(`[oturum] ${entry.engine}: başka bir oturumdan özet aktarıldı (${handoff.trim().length} karakter)`);
            manager.send(entry, String(m.text || ''), Array.isArray(m.images) ? m.images : [], lang, files, m.work ? validWork(m.work) : undefined, handoff);
          }
          return;
        case 'interrupt':
          if (!current) return;
          try {
            await timed(current.agent.interrupt(), 'durdurma');
          } catch (err) {
            if (!err.timeout) throw err;
            // Süreç durdurma isteğine bile cevap vermiyor: zorla kapat; oturum listeden yeniden açılabilir
            manager.close(current);
            emit({ type: 'error', message: msg(lang, 'Oturum yanıt vermiyordu ve kapatıldı. Listeden yeniden açabilirsiniz.') });
            emit({ type: 'busy', busy: false });
          }
          return;
        case 'answer':
          current?.agent.answer(m.id, m.decision || { behavior: 'deny' });
          return;
        case 'set_work':
          if (current) current.agent.work = validWork(m.work);
          return;
        case 'set_mode':
          if (current && MODES.has(m.mode)) await timed(current.agent.setPermissionMode(m.mode), 'mod');
          return;
        case 'set_model':
          if (current) await timed(current.agent.setModel(m.model), 'model');
          return;
        case 'set_effort':
          if (current) await timed(current.agent.setEffort(typeof m.effort === 'string' ? m.effort : ''), 'düşünme seviyesi');
          return;
        case 'get_context': {
          // Sadece isteyen bağlantıya gider; olay tamponuna yazılmaz
          if (!current) return;
          const data = await timed(current.agent.contextUsage(), 'bağlam').catch((err) => ({ error: String(err?.message || err) }));
          emit({ type: 'context', liveId: current.liveId, data });
          return;
        }
      }
    };

    // "Oturum aç" ve "gönder" sırayla işlenir (gönder, açılmakta olan oturumu bekler); diğer istekler
    // beklemeden ayrı çalışır ki takılan bir oturum yeni oturum açmayı kilitlemesin.
    let chain = Promise.resolve();
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      const onError = (err) => emit({ type: 'error', message: String(err?.message || err) });
      if (m.type === 'send') chain = chain.then(() => handle(m)).catch(onError);
      else handle(m).catch(onError);
    });

    ws.on('close', () => {
      stopLive();
      stopState();
      detach();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function windowsDrives() {
  const drives = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${letter}:\\`;
    if (await fs.access(p).then(() => true, () => false)) drives.push({ name: p, path: p });
  }
  return drives;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', 'bin', 'obj', '.venv', 'venv', '__pycache__']);

async function findFiles(root, q, limit) {
  const out = [];
  const queue = [''];
  let visited = 0;
  while (queue.length && out.length < limit && visited < 3000) {
    const rel = queue.shift();
    visited++;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push(relPath);
      } else if (!q || relPath.toLowerCase().includes(q)) {
        out.push(relPath);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
