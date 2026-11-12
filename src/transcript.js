// Copilot konuşmalarının yerel kopyası. Claude oturumlarını Claude Code kendisi diske yazar; Copilot'ta
// geçmiş yalnızca Copilot oturumu yüklenebilirse (ağ, model listesi vb.) geri gelir. Yerel kopya sayesinde
// konuşma, Copilot o an cevap vermese bile hemen görünür. Dosyalar durum dosyasının yanında tutulur:
//   ~/.atolye/copilot/<oturum-kimliği>.jsonl
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = () => path.join(
  process.env.ATOLYE_STATE_FILE ? path.dirname(process.env.ATOLYE_STATE_FILE) : path.join(os.homedir(), '.atolye'),
  'copilot',
);
const fileFor = (id) => path.join(dir(), `${String(id).replace(/[^\w.-]/g, '_')}.jsonl`);

/** Kalıcı olması gereken olaylar: kullanıcı mesajları ve tam mesajlar (akış parçaları ve açılış bilgisi değil) */
export function shouldKeep(ev) {
  if (ev.type === 'user_prompt') return true;
  if (ev.type !== 'sdk') return false;
  const m = ev.msg;
  if (m.type === 'assistant' || m.type === 'user' || m.type === 'result') return true;
  return m.type === 'system' && m.subtype === 'local_command_output';
}

/** Görsel verisi diske yazılmaz (büyük ve gereksiz); yerine kaç görsel olduğu kalır */
const slim = (ev) => (ev.type === 'user_prompt' && ev.images?.length ? { ...ev, images: [], imageCount: ev.images.length } : ev);

export function append(id, events) {
  if (!id || !events.length) return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(fileFor(id), events.map((e) => `${JSON.stringify(slim(e))}\n`).join(''));
  } catch { /* yerel kopya yazılamazsa konuşma yine de sürer */ }
}

export function read(id) {
  if (!id) return [];
  let raw;
  try { raw = fs.readFileSync(fileFor(id), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* yarım yazılmış satır atlanır */ }
  }
  return out;
}

export function remove(id) {
  try { fs.rmSync(fileFor(id), { force: true }); } catch { /* yoksay */ }
}
