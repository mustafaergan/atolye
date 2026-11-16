// Outlook bağlantısı: gerçek Outlook'a gitmeden (sahte çalıştırıcı) araçların çıktısı, hata metinleri ve etkinleştirme
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRunner, friendly } from '../src/outlook.js';
import { availableTools, callTool } from '../src/mcp-server.js';

const env = { OUTLOOK_ENABLED: '1' };
const calls = [];
setRunner(async (op, args) => {
  calls.push([op, args]);
  if (op === 'whoami') return { user: 'Ayşe Yılmaz', mailbox: 'ayse@example.com', inbox: 3303, unread: 1 };
  if (op === 'folders') return { folders: [{ path: 'Gelen Kutusu', count: 3303, unread: 1 }, { path: 'Gelen Kutusu/jira', count: 716, unread: 0 }] };
  if (op === 'search') return { folder: 'Gelen Kutusu/jira', days: 3, total: 1, items: [{ id: 'E1', received: '2026-11-16 17:13', from: 'Can Demir', subject: 'RE:  Paket   kontrolü', unread: true, attachments: 2, preview: 'Merhaba,\r\n paket hazır' }] };
  if (op === 'get') {
    if (args.id !== 'E1') throw new Error(friendly('NOT_FOUND: x'));
    return { subject: 'Paket kontrolü', from: 'Can Demir', to: 'Ayşe Yılmaz', cc: '', received: '2026-11-16 17:13', body: 'Merhaba\r\n\r\n\r\n\r\nPaket hazır.', bodyLength: 40, attachments: [{ name: 'rapor.xlsx', size: 20480 }] };
  }
  if (op === 'events') return { start: '2026-11-17', days: 1, items: [{ start: '2026-11-17 10:00', end: '2026-11-17 10:30', subject: 'Günlük toplantı', location: 'Teams', organizer: 'Can Demir', allDay: false, status: 3 }] };
  throw new Error('bilinmeyen');
});
const text = async (name, args = {}) => (await callTool(name, args, env)).content[0].text;

test('Outlook araçları yalnızca etkinleştirilince sunulur; hepsi okuma yapar', () => {
  const names = availableTools(env).map((t) => t.name);
  assert.deepEqual(names, ['outlook_list_folders', 'outlook_search_mail', 'outlook_get_mail', 'outlook_list_events']);
  assert.ok(availableTools(env).every((t) => t.annotations.readOnlyHint));
  assert.equal(availableTools({}).length, 0);
});

test('Outlook: klasörler, arama, e-posta ve takvim çıktısı', async () => {
  assert.equal(await text('outlook_list_folders'), 'Gelen Kutusu — 3303 e-posta, 1 okunmamış\nGelen Kutusu/jira — 716 e-posta');
  assert.equal(await text('outlook_search_mail', { folder: 'jira', days: 3, query: 'paket' }), 'Gelen Kutusu/jira — son 3 gün, "paket": 1 e-posta (gösterilen 1)\nE1 | 2026-11-16 17:13 | Can Demir | RE: Paket kontrolü | okunmamış | 2 ek\n  Merhaba, paket hazır');
  assert.deepEqual(calls.at(-1), ['search', { query: 'paket', folder: 'jira', days: 3, from: undefined, unread: undefined, limit: undefined }]);
  assert.equal(await text('outlook_get_mail', { id: 'E1' }), 'Konu: Paket kontrolü\nKimden: Can Demir | Tarih: 2026-11-16 17:13\nKime: Ayşe Yılmaz\nEkler: rapor.xlsx (20 KB)\n\nMerhaba\n\nPaket hazır.');
  const missing = await callTool('outlook_get_mail', { id: 'yok' }, env);
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /E-posta bulunamadı/);
  assert.equal(await text('outlook_list_events'), 'Takvim: 2026-11-17\n2026-11-17 10:00 – 10:30 | Günlük toplantı | Teams | düzenleyen: Can Demir | kabul');
  const { clients } = await import('../src/atlassian.js');
  assert.equal(await clients.outlook.whoami(), 'Ayşe Yılmaz (Gelen Kutusu: 3303 e-posta, 1 okunmamış)');
});

test('Outlook hata metinleri anlaşılır', () => {
  assert.match(friendly('NO_OUTLOOK: Retrieving the COM class factory ... 80040154 Class not registered'), /klasik Outlook bulunamadı/);
  assert.match(friendly('Exception 0x80080005 (CO_E_SERVER_EXEC_FAILURE)'), /farklı yetkilerle/);
  assert.match(friendly('Operation aborted (Exception from HRESULT: 0x80004004)'), /izin vermedi/);
  assert.match(friendly('NO_FOLDER: projeler'), /Klasör bulunamadı: projeler/);
  assert.equal(friendly('#< CLIXML\n<Objs Version="1.1.0.1"><Obj S="progress">x</Obj></Objs>beklenmedik durum'), 'Outlook: beklenmedik durum');
  // hata CLIXML içinde gelirse de okunur
  assert.match(friendly('#< CLIXML\n<Objs Version="1.1.0.1"><Obj S="progress">x</Obj><S S="Error">NO_OUTLOOK: 80040154 Sınıf kaydedilmemiş_x000D__x000A_</S></Objs>'), /klasik Outlook bulunamadı/);
});
