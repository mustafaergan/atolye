// Kalıcı arayüz durumu: proje listesi, daraltılmış klasörler, son seçili klasör ve son açık oturum.
// Tarayıcının yerel deposu yerine diskte (~/.atolye/durum.json) tutulur; böylece tarayıcı
// kapanışta site verilerini temizlese, port (yani adres) değişse ya da birden fazla sekme açık
// olsa da kaybolmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.atolye');
// ATOLYE_STATE_FILE: testlerde gerçek proje listesine dokunmamak için
const FILE = process.env.ATOLYE_STATE_FILE || path.join(DIR, 'durum.json');

const key = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);
const str = (v) => (typeof v === 'string' && v ? v : null);

function normalize(d = {}) {
  const projects = [];
  for (const p of strings(d.projects)) if (!projects.some((q) => key(q) === key(p))) projects.push(p);
  const open = d.open && typeof d.open === 'object'
    ? { liveId: str(d.open.liveId), sessionId: str(d.open.sessionId), cwd: str(d.open.cwd), engine: ['copilot', 'yerel'].includes(d.open.engine) ? d.open.engine : 'claude' }
    : null;
  // GitHub Copilot oturumları (Claude oturumlarını Claude Code kendisi saklar; Copilot'unkileri biz listeleriz)
  const copilotSessions = (Array.isArray(d.copilotSessions) ? d.copilotSessions : [])
    .filter((s) => s && str(s.id) && str(s.cwd))
    .map((s) => ({ id: s.id, cwd: s.cwd, title: str(s.title), lastModified: Number(s.lastModified) || 0, renamed: Boolean(s.renamed) }));
  // Motor seçimi saklanmaz: arayüz her açılışta GitHub Copilot ile başlar (kurulu değilse Claude Code).
  // Eski sürümlerin yazdığı engine/engineChosen alanları yok sayılır.
  const engineChosen = false;
  const engine = 'copilot';
  // Kullanım rolü (analist, gelistirici, …): arayüzün hangi bağlantı ve işlevleri göstereceğini belirler
  const role = typeof d.role === 'string' && /^[a-z]{2,24}$/.test(d.role) ? d.role : 'analist';
  // Yerel LLM ile açılmış oturumların kimlikleri (dosyaları Claude Code oturumlarıyla aynı yerdedir; listede ayırt edilsin diye)
  const localSessions = [...new Set(strings(d.localSessions))].slice(-2000);
  // Kullanıcının elle sıraladığı oturumlar: { <klasör anahtarı>: [oturum kimlikleri, üstten alta] }
  const sessionOrder = {};
  if (d.sessionOrder && typeof d.sessionOrder === 'object') for (const [k, v] of Object.entries(d.sessionOrder)) { const ids = strings(v).slice(0, 500); if (ids.length) sessionOrder[k] = ids; }
  return { projects, collapsed: [...new Set(strings(d.collapsed))], cwd: str(d.cwd), selected: str(d.selected), open, engine, engineChosen, role, copilotSessions, localSessions, sessionOrder };
}

export class StateStore {
  constructor(file = FILE) {
    this.file = file;
    this.listeners = new Set();
    try {
      this.data = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      this.data = normalize();
    }
  }

  get() {
    return this.data;
  }

  #save(broadcast) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Önce geçici dosyaya yaz, sonra yerine taşı: yazarken kapanırsa dosya bozulmasın
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    if (broadcast) for (const fn of this.listeners) fn(this.data);
  }

  addProject(dir) {
    if (!str(dir) || this.data.projects.some((p) => key(p) === key(dir))) return this.data;
    this.data.projects.push(dir);
    this.#save(true);
    return this.data;
  }

  removeProject(dir) {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => key(p) !== key(dir));
    if (this.data.projects.length !== before) this.#save(true);
    return this.data;
  }

  setCollapsed(k, collapsed) {
    const set = new Set(this.data.collapsed);
    if (collapsed) set.add(k);
    else set.delete(k);
    this.data.collapsed = [...set];
    this.#save(true);
    return this.data;
  }

  /** Sadece bir sonraki açılış için hatırlananlar (diğer sekmelere yayınlanmaz) */
  remember({ cwd, selected, open, engine, role }) {
    if (cwd !== undefined) this.data.cwd = str(cwd);
    if (selected !== undefined) this.data.selected = str(selected);
    if (open !== undefined) this.data.open = normalize({ open }).open;
    if (role !== undefined) this.data.role = normalize({ role }).role;
    this.#save(false);
    return this.data;
  }

  /** Eski sürümlerin tarayıcıda tuttuğu listeyi ekler (mevcutlarla birleştirir) */
  importLocal({ projects, collapsed }) {
    const merged = normalize({ ...this.data, projects: [...this.data.projects, ...strings(projects)], collapsed: [...this.data.collapsed, ...strings(collapsed)] });
    const changed = merged.projects.length !== this.data.projects.length || merged.collapsed.length !== this.data.collapsed.length;
    this.data = merged;
    if (changed) this.#save(true);
    return this.data;
  }

  // ---------- Copilot oturum kayıtları ----------
  copilotSessionsFor(dir) {
    return this.data.copilotSessions.filter((s) => key(s.cwd) === key(dir)).sort((a, b) => b.lastModified - a.lastModified);
  }

  recordCopilotSession({ id, cwd, title }) {
    if (!str(id) || !str(cwd)) return;
    const list = this.data.copilotSessions;
    const found = list.find((s) => s.id === id);
    if (found) {
      found.lastModified = Date.now();
      if (title && !found.title) found.title = title;
    } else {
      list.push({ id, cwd, title: str(title), lastModified: Date.now() });
    }
    this.#save(false);
  }

  renameCopilotSession(id, title) {
    const found = this.data.copilotSessions.find((s) => s.id === id);
    if (!found) return false;
    found.title = str(title);
    found.renamed = true;
    this.#save(false);
    return true;
  }

  /** Copilot'un verdiği başlık: kullanıcı yeniden adlandırmadıysa kullanılır */
  setCopilotTitle(id, title) {
    const found = this.data.copilotSessions.find((s) => s.id === id);
    if (found && str(title) && !found.renamed) { found.title = title; this.#save(false); }
  }

  deleteCopilotSession(id) {
    const before = this.data.copilotSessions.length;
    this.data.copilotSessions = this.data.copilotSessions.filter((s) => s.id !== id);
    if (this.data.copilotSessions.length !== before) this.#save(false);
  }

  // ---------- Yerel LLM oturumları ve elle sıralama ----------
  recordLocalSession(id) {
    if (!str(id) || this.data.localSessions.includes(id)) return;
    this.data.localSessions.push(id);
    this.#save(false);
  }

  isLocalSession(id) { return this.data.localSessions.includes(id); }

  deleteLocalSession(id) {
    if (!this.data.localSessions.includes(id)) return;
    this.data.localSessions = this.data.localSessions.filter((x) => x !== id);
    this.#save(false);
  }

  setSessionOrder(dir, ids) {
    if (!str(dir)) return;
    const list = strings(ids).slice(0, 500);
    if (list.length) this.data.sessionOrder[key(dir)] = list; else delete this.data.sessionOrder[key(dir)];
    this.#save(false);
  }

  /** Listeyi kullanıcının sırasına göre dizer: sıralanmamış (yeni) oturumlar tarihe göre üstte, sıralananlar kendi sırasında */
  applySessionOrder(dir, sessions) {
    const order = this.data.sessionOrder[key(dir)];
    if (!order?.length) return sessions;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...sessions.filter((s) => !rank.has(s.id)), ...sessions.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id))];
  }

  // ---------- Yerel LLM oturumları ve elle sıralama ----------
  recordLocalSession(id) {
    if (!str(id) || this.data.localSessions.includes(id)) return;
    this.data.localSessions.push(id);
    this.#save(false);
  }

  isLocalSession(id) { return this.data.localSessions.includes(id); }

  deleteLocalSession(id) {
    if (!this.data.localSessions.includes(id)) return;
    this.data.localSessions = this.data.localSessions.filter((x) => x !== id);
    this.#save(false);
  }

  setSessionOrder(dir, ids) {
    if (!str(dir)) return;
    const list = strings(ids).slice(0, 500);
    if (list.length) this.data.sessionOrder[key(dir)] = list; else delete this.data.sessionOrder[key(dir)];
    this.#save(false);
  }

  /** Listeyi kullanıcının sırasına göre dizer: sıralanmamış (yeni) oturumlar tarihe göre üstte, sıralananlar kendi sırasında */
  applySessionOrder(dir, sessions) {
    const order = this.data.sessionOrder[key(dir)];
    if (!order?.length) return sessions;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...sessions.filter((s) => !rank.has(s.id)), ...sessions.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id))];
  }

  // ---------- Yerel LLM oturumları ve elle sıralama ----------
  recordLocalSession(id) {
    if (!str(id) || this.data.localSessions.includes(id)) return;
    this.data.localSessions.push(id);
    this.#save(false);
  }

  isLocalSession(id) { return this.data.localSessions.includes(id); }

  deleteLocalSession(id) {
    if (!this.data.localSessions.includes(id)) return;
    this.data.localSessions = this.data.localSessions.filter((x) => x !== id);
    this.#save(false);
  }

  setSessionOrder(dir, ids) {
    if (!str(dir)) return;
    const list = strings(ids).slice(0, 500);
    if (list.length) this.data.sessionOrder[key(dir)] = list; else delete this.data.sessionOrder[key(dir)];
    this.#save(false);
  }

  /** Listeyi kullanıcının sırasına göre dizer: sıralanmamış (yeni) oturumlar tarihe göre üstte, sıralananlar kendi sırasında */
  applySessionOrder(dir, sessions) {
    const order = this.data.sessionOrder[key(dir)];
    if (!order?.length) return sessions;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...sessions.filter((s) => !rank.has(s.id)), ...sessions.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id))];
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
