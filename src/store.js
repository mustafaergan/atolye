// Kalıcı arayüz durumu: proje listesi, daraltılmış klasörler, son seçili klasör ve son açık oturum.
// Tarayıcının yerel deposu yerine diskte (~/.atolye/durum.json) tutulur; böylece tarayıcı
// kapanışta site verilerini temizlese, port (yani adres) değişse ya da birden fazla sekme açık
// olsa da kaybolmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.atolye');
const FILE = path.join(DIR, 'durum.json');

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
    ? { liveId: str(d.open.liveId), sessionId: str(d.open.sessionId), cwd: str(d.open.cwd) }
    : null;
  return { projects, collapsed: [...new Set(strings(d.collapsed))], cwd: str(d.cwd), selected: str(d.selected), open };
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
  remember({ cwd, selected, open }) {
    if (cwd !== undefined) this.data.cwd = str(cwd);
    if (selected !== undefined) this.data.selected = str(selected);
    if (open !== undefined) this.data.open = normalize({ open }).open;
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

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
