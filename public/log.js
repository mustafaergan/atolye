// Kayıtlar sayfası (/log.html): Atölye'nin son çalışma kayıtlarını gösterir ve kopyalatır.
import { t as T, translatePage } from './i18n.js';

// Teams sohbet mesajı sınırı yaklaşık 28 KB'dir; biçimlendirme payıyla güvenli kalmak ve
// mesajı okunur tutmak için son satırlardan en fazla bu kadar karakter alınır.
export const TEAMS_MAX_CHARS = 6000;

/** Sondan başlayarak sınıra sığan satırlar (satır ortasından kesilmez; çok uzun satır kısaltılır) */
export function tailForChat(all, max = TEAMS_MAX_CHARS) {
  const out = [];
  let size = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const line = all[i].length > 600 ? `${all[i].slice(0, 600)}…` : all[i];
    if (size + line.length + 1 > max && out.length) break;
    out.unshift(line);
    size += line.length + 1;
  }
  return out;
}

function main() {
  // Ana sayfada seçilen tema burada da geçerli olsun
  try {
    const theme = (localStorage.getItem('atolye:theme') || '').replace(/"/g, '');
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* yoksay */ }
  translatePage();
  document.title = `Atölye · ${T('Kayıtlar')}`;

  const $ = (s) => document.querySelector(s);
  const view = $('#logView');
  const status = $('#logStatus');
  let lines = [];
  let version = '';

  async function load() {
    const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
    try {
      const [log, upd] = await Promise.all([
        fetch('/api/log').then((r) => r.json()),
        version ? null : fetch('/api/update').then((r) => r.json()).catch(() => null),
      ]);
      if (upd?.current) version = upd.current;
      lines = log.lines || [];
      view.textContent = lines.length ? lines.join('\n') : T('Henüz kayıt yok.');
      status.textContent = T('{n} satır · son yenileme {time}', { n: lines.length, time: new Date().toLocaleTimeString() });
      if (atBottom) view.scrollTop = view.scrollHeight;
    } catch {
      status.textContent = T("Atölye'ye ulaşılamadı; çalıştığından emin olun.");
    }
  }

  async function copy(btn, text) {
    const label = btn.textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = T('Kopyalandı'); } catch { btn.textContent = T('Kopyalanamadı'); }
    setTimeout(() => { btn.textContent = label; }, 2000);
  }

  $('#logRefresh').onclick = load;
  $('#logCopyAll').onclick = (e) => copy(e.currentTarget, lines.join('\n'));
  $('#logCopyTeams').onclick = (e) => {
    const tail = tailForChat(lines);
    const head = T('Atölye {version} kayıtları (son {n} satır)', { version, n: tail.length });
    // Üç ters tırnak: Teams bunu kod bloğu olarak gösterir, satırlar bozulmaz
    copy(e.currentTarget, `${head}\n\`\`\`\n${tail.join('\n')}\n\`\`\``);
  };
  load();
  setInterval(() => { if ($('#logAuto').checked && !document.hidden) load(); }, 5000);
}

if (typeof document !== 'undefined') main();
