// HTTP + WebSocket sunucusu. Sadece 127.0.0.1'e bağlanır; tarayıcıdan gelen
// isteklerde Host/Origin kontrolü yapılır (DNS rebinding ve başka sitelerin
// yerel sunucuya WebSocket açmasına karşı).
import fs from 'node:fs/promises';
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
import { detectCopilot } from './copilot.js';
import * as integrations from './integrations.js';
import { applyUpdate, checkUpdate } from './update.js';
import * as repo from './repo.js';
import { recentLog } from './log.js';
import * as transcript from './transcript.js';
import * as proxy from './proxy.js';
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
  const app = express();
  const store = new StateStore();
  const manager = new SessionManager({ store });
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
    res.json(store.get());
  }));
  app.post('/api/state/collapsed', wrap(async (req, res) => {
    const { key, collapsed } = req.body || {};
    if (typeof key === 'string' && key) store.setCollapsed(key, Boolean(collapsed));
    res.json(store.get());
  }));
  app.post('/api/state/remember', wrap(async (req, res) => {
    const { cwd, selected, open, engine } = req.body || {};
    res.json(store.remember({ cwd, selected, open, engine }));
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
    const r = await proxy.test();
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
  app.post('/api/update/apply', wrap(async (_req, res) => res.json(applyUpdate())));

  // Jira / Confluence / Bitbucket bağlantıları (bkz. integrations.js). API anahtarı arayüze geri gönderilmez.
  const integrationError = (lang, err) => {
    if (err.code === 'bad-url') return msg(lang, 'Geçerli bir adres girin (https://… ile başlamalı)');
    if (err.code === 'no-token') return msg(lang, 'API anahtarı gerekli');
    return err.message;
  };
  app.get('/api/integrations', wrap(async (_req, res) => res.json(integrations.status())));
  app.post('/api/integrations/:service', wrap(async (req, res) => {
    try {
      res.json(integrations.save(req.params.service, req.body || {}));
    } catch (err) {
      res.status(400).json({ error: integrationError(req.query.lang, err) });
    }
  }));
  app.delete('/api/integrations/:service', wrap(async (req, res) => res.json(integrations.remove(req.params.service))));
  app.post('/api/integrations/:service/test', wrap(async (req, res) => {
    const r = await integrations.test(req.params.service);
    console.log(`[bağlantı] ${req.params.service} sınaması: ${r.ok ? `başarılı (${r.user})` : r.error}`);
    if (r.error === 'not-configured') r.error = msg(req.query.lang, 'Bağlantı bilgileri eksik');
    res.json(r);
  }));

  // Hangi yapay zekâ motorları kullanılabilir? (Claude Code her zaman; GitHub Copilot CLI kuruluysa)
  app.get('/api/engines', wrap(async (req, res) => {
    res.json({ claude: { available: true }, copilot: await detectCopilot({ force: req.query.refresh === '1' }) });
  }));

  app.get('/api/sessions', wrap(async (req, res) => {
    const dir = String(req.query.dir || defaultCwd);
    const sessions = await listSessions({ dir, limit: 100 });
    const claude = sessions.map((s) => ({
      id: s.sessionId,
      engine: 'claude',
      title: s.customTitle || s.summary || s.firstPrompt || msg(req.query.lang, 'Adsız oturum'),
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
    res.json([...claude, ...copilot].sort((a, b) => b.lastModified - a.lastModified));
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
    else await deleteSession(req.params.id, { dir });
    res.json({ ok: true });
  }));

  // Klasör seçici
  app.get('/api/fs/list', wrap(async (req, res) => {
    const requested = String(req.query.path || '');
    if (!requested && process.platform === 'win32') return res.json({ path: '', parent: null, dirs: await windowsDrives() });
    const dir = path.resolve(requested || os.homedir());
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
      const engine = m.engine === 'copilot' ? 'copilot' : 'claude';
      if (engine === 'copilot') {
        const cp = await detectCopilot();
        if (!cp.available) throw new Error(msg(lang, 'GitHub Copilot CLI bulunamadı. Kurmak için: npm install -g @github/copilot ({error})', { error: cp.error }));
      }
      const next = await manager.open({
        engine,
        liveId: m.new ? null : m.liveId,
        sessionId: m.new ? null : m.sessionId,
        cwd,
        mode: MODES.has(m.mode) ? m.mode : 'default',
        model: m.model || undefined,
        general: samePath(cwd, GENERAL_DIR),
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
          manager.send(entry, String(m.text || ''), Array.isArray(m.images) ? m.images : [], lang);
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
        case 'set_mode':
          if (current && MODES.has(m.mode)) await timed(current.agent.setPermissionMode(m.mode), 'mod');
          return;
        case 'set_model':
          if (current) await timed(current.agent.setModel(m.model), 'model');
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
