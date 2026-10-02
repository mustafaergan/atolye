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
import { getSpend } from './spend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);

export function createServer({ port, host = '127.0.0.1', defaultCwd }) {
  const app = express();
  const manager = new SessionManager();
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
    fn(req, res).catch((err) => res.status(500).json({ error: String(err?.message || err) }));

  app.get('/api/config', wrap(async (_req, res) => {
    res.json({
      defaultCwd,
      home: os.homedir(),
      platform: process.platform,
      gateway: process.env.ANTHROPIC_BASE_URL || null,
      hasCredential: Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY),
    });
  }));

  app.get('/api/spend', wrap(async (req, res) => {
    res.json(await getSpend({ force: req.query.refresh === '1' }));
  }));

  app.get('/api/sessions', wrap(async (req, res) => {
    const dir = String(req.query.dir || defaultCwd);
    const sessions = await listSessions({ dir, limit: 100 });
    res.json(
      sessions.map((s) => ({
        id: s.sessionId,
        title: s.customTitle || s.summary || s.firstPrompt || 'Adsız oturum',
        lastModified: s.lastModified,
        gitBranch: s.gitBranch,
        cwd: s.cwd,
      })),
    );
  }));

  app.get('/api/sessions/:id/messages', wrap(async (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : undefined;
    res.json(await getSessionMessages(req.params.id, { dir }));
  }));

  app.post('/api/sessions/:id/rename', wrap(async (req, res) => {
    const dir = req.body?.dir ? String(req.body.dir) : undefined;
    await renameSession(req.params.id, String(req.body?.title || '').slice(0, 200), { dir });
    res.json({ ok: true });
  }));

  app.delete('/api/sessions/:id', wrap(async (req, res) => {
    const dir = req.query.dir ? String(req.query.dir) : undefined;
    manager.closeBySessionId(req.params.id);
    await deleteSession(req.params.id, { dir });
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
    const emit = (event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    const stopLive = manager.onChange((sessions) => emit({ type: 'live', sessions }));
    emit({ type: 'live', sessions: manager.list() });

    const detach = () => {
      unsubscribe?.();
      unsubscribe = null;
      entry = null;
    };

    const handle = async (m) => {
      switch (m.type) {
        case 'open': {
          const cwd = path.resolve(String(m.cwd || defaultCwd));
          const stat = await fs.stat(cwd).catch(() => null);
          if (!stat?.isDirectory()) throw new Error(`Klasör bulunamadı: ${cwd}`);
          detach();
          const next = await manager.open({
            liveId: m.new ? null : m.liveId,
            sessionId: m.new ? null : m.sessionId,
            cwd,
            mode: MODES.has(m.mode) ? m.mode : 'default',
            model: m.model || undefined,
          });
          const history = next.historyCount
            ? await getSessionMessages(next.agent.sessionId, { dir: next.cwd, limit: next.historyCount }).catch(() => [])
            : [];
          if (!manager.entries.has(next.liveId)) throw new Error('Oturum kapandı, yeniden açın');
          entry = next;
          unsubscribe = manager.subscribe(entry, emit, history);
          break;
        }
        case 'send':
          if (!entry || entry.agent.closed) throw new Error('Aktif oturum yok');
          manager.send(entry, String(m.text || ''), Array.isArray(m.images) ? m.images : []);
          break;
        case 'interrupt':
          await entry?.agent.interrupt();
          break;
        case 'answer':
          entry?.agent.answer(m.id, m.decision || { behavior: 'deny' });
          break;
        case 'set_mode':
          if (MODES.has(m.mode)) await entry?.agent.setPermissionMode(m.mode);
          break;
        case 'set_model':
          await entry?.agent.setModel(m.model);
          break;
        case 'get_context': {
          // Sadece isteyen bağlantıya gider; olay tamponuna yazılmaz
          if (!entry) break;
          const liveId = entry.liveId;
          const data = await entry.agent.contextUsage().catch((err) => ({ error: String(err?.message || err) }));
          emit({ type: 'context', liveId, data });
          break;
        }
      }
    };

    // Mesajları sırayla işle: hızlı oturum değişimlerinde "open" istekleri karışmasın
    let chain = Promise.resolve();
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      chain = chain.then(() => handle(m)).catch((err) => emit({ type: 'error', message: String(err?.message || err) }));
    });

    ws.on('close', () => {
      stopLive();
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
