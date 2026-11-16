// Outlook bağlantısı: bilgisayardaki klasik Outlook'tan (Windows) e-posta, klasör ve takvim OKUR. Hesap, parola ya da
// sunucu adresi gerekmez; Outlook'ta açık olan hesap kullanılır. Erişim, Outlook'un kendi programlama arayüzüyle
// (COM) PowerShell üzerinden yapılır (bkz. outlook.ps1). Yeni Outlook ve Outlook web bu arayüzü desteklemez.
// Hiçbir e-posta gönderilmez, taşınmaz ya da silinmez.
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const SCRIPT = new URL('./outlook.ps1', import.meta.url);
let encoded = null;
const script = () => {
  if (!encoded) encoded = Buffer.from(fs.readFileSync(SCRIPT, 'utf8').replace(/^﻿/, ''), 'utf16le').toString('base64');
  return encoded;
};

/** PowerShell ile tek bir işlem çalıştırır; JSON sonuç ya da anlaşılır bir hata */
function runPowerShell(op, args = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Outlook bağlantısı yalnızca Windows\'ta çalışır'));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', script()], {
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, ATOLYE_OL_OP: op, ATOLYE_OL_ARGS: JSON.stringify(args) },
    }, (err, stdout, stderr) => {
      if (err && err.killed) return reject(new Error('Outlook yanıt vermedi (zaman aşımı). Outlook açık mı ve ekranda bekleyen bir onay penceresi var mı?'));
      const out = String(stdout || '').trim();
      if (!err && out) {
        try { return resolve(JSON.parse(out)); } catch { /* aşağıda */ }
      }
      const raw = String(stderr || '').trim() || String(err?.message || out || '').trim();
      // Ham hata Kayıtlar sayfasına yazılır (sorun bildirirken işe yarar)
      console.log(`[outlook] ${op} olmadı (çıkış ${err?.code ?? '?'}): ${plainError(raw).replace(/\s+/g, ' ').slice(0, 300)}`);
      reject(new Error(friendly(raw)));
    });
  });
}

let runner = runPowerShell;
/** Testler için: Outlook'a gitmeden sahte sonuç veren çalıştırıcı */
export const setRunner = (fn) => { runner = fn || runPowerShell; };

/**
 * PowerShell, çıktısı yönlendirildiğinde hataları ve ilerleme bildirimlerini CLIXML olarak yazabilir. Bildirimler atılır,
 * hata satırları (<S S="Error">) düz metne çevrilir.
 */
export function plainError(text) {
  return String(text || '').replace(/#< CLIXML\s*/g, '').replace(/<Objs[\s\S]*?<\/Objs>/g, (block) => [...block.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((m) => m[1].replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .join('')).trim();
}

export function friendly(text) {
  const t = plainError(text);
  if (/NO_OUTLOOK|80040154|Class not registered|sınıf kayıtlı değil/i.test(t))
    return 'Bu bilgisayarda klasik Outlook bulunamadı. Bağlantı yalnızca klasik Outlook (masaüstü) ile çalışır; "Yeni Outlook" ve Outlook web desteklenmez. Yeni Outlook kullanıyorsanız sağ üstteki "Yeni Outlook" anahtarını kapatın.';
  if (/80080005|CO_E_SERVER_EXEC_FAILURE/i.test(t))
    return 'Outlook\'a bağlanılamadı: Outlook ve Atölye farklı yetkilerle çalışıyor olabilir (biri "yönetici olarak" açılmış). İkisini de normal kullanıcı olarak açıp yeniden deneyin.';
  if (/80004004|Operation aborted|işlem iptal/i.test(t))
    return 'Outlook erişime izin vermedi. Ekranda Outlook\'un "bir program erişmeye çalışıyor" penceresi çıktıysa izin verin; çıkmadıysa kuruluşunuz programla erişimi kapatmış olabilir (BT ekibine danışın).';
  if (/NO_FOLDER/.test(t)) return `Klasör bulunamadı: ${t.replace(/^.*NO_FOLDER:\s*/s, '')}. outlook_list_folders ile klasör adlarına bakın.`;
  if (/NOT_FOUND/.test(t)) return 'E-posta bulunamadı (kimlik geçersiz ya da e-posta taşınmış/silinmiş). Önce outlook_search_mail ile yeniden arayın.';
  if (/BAD_DATE/.test(t)) return 'Tarih biçimi geçersiz; yyyy-aa-gg kullanın (ör. 2026-11-17).';
  return `Outlook: ${t.split(/\r?\n/).find(Boolean)?.slice(0, 300) || 'bilinmeyen hata'}`;
}

const line = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const outlook = {
  async whoami() {
    const r = await runner('whoami');
    return `${r.user || r.mailbox || 'Outlook'} (Gelen Kutusu: ${r.inbox} e-posta, ${r.unread} okunmamış)`;
  },
  async listFolders() {
    const r = await runner('folders');
    return (r.folders || []).map((f) => `${f.path} — ${f.count} e-posta${f.unread ? `, ${f.unread} okunmamış` : ''}`).join('\n') || 'Klasör yok.';
  },
  async searchMail(_cfg, { query, folder, days, from, unread, limit } = {}) {
    const r = await runner('search', { query, folder, days, from, unread, limit });
    const items = r.items || [];
    const head = `${r.folder || 'Gelen Kutusu'} — son ${r.days} gün${query ? `, "${query}"` : ''}: ${r.total} e-posta (gösterilen ${items.length})`;
    if (!items.length) return `${head}\nSonuç yok.`;
    return [head, ...items.map((m) => `${m.id} | ${m.received} | ${line(m.from)} | ${line(m.subject)}${m.unread ? ' | okunmamış' : ''}${m.attachments ? ` | ${m.attachments} ek` : ''}\n  ${line(m.preview).slice(0, 200)}`)].join('\n');
  },
  async getMail(_cfg, { id }) {
    const m = await runner('get', { id });
    return [
      `Konu: ${line(m.subject)}`,
      `Kimden: ${line(m.from)} | Tarih: ${m.received}`,
      `Kime: ${line(m.to)}${m.cc ? ` | Bilgi: ${line(m.cc)}` : ''}`,
      ...(m.attachments?.length ? [`Ekler: ${m.attachments.map((x) => `${x.name} (${Math.max(1, Math.round((x.size || 0) / 1024))} KB)`).join(', ')}`] : []),
      '',
      String(m.body || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
      ...(m.bodyLength > 30000 ? [`\n… (kısaltıldı: toplam ${m.bodyLength} karakter)`] : []),
    ].join('\n');
  },
  async listEvents(_cfg, { start, days } = {}) {
    const r = await runner('events', { start, days });
    const items = r.items || [];
    const head = `Takvim: ${r.start}${r.days > 1 ? ` itibarıyla ${r.days} gün` : ''}`;
    if (!items.length) return `${head}\nToplantı yok.`;
    const RESP = { 1: 'düzenleyen', 2: 'belirsiz', 3: 'kabul', 4: 'reddedildi', 5: 'yanıtlanmadı' };
    return [head, ...items.map((e) => `${e.allDay ? `${e.start.slice(0, 10)} (tüm gün)` : `${e.start} – ${e.end.slice(11)}`} | ${line(e.subject)}${e.location ? ` | ${line(e.location)}` : ''}${e.organizer ? ` | düzenleyen: ${line(e.organizer)}` : ''}${RESP[e.status] ? ` | ${RESP[e.status]}` : ''}`)].join('\n');
  },
};
