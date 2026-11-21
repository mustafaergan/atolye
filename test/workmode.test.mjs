// Çalışma kipi: Ask / Plan'da dosya değiştiren araçlar reddedilir, yönerge yalnızca yapay zekâya gider
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validWork, workInstruction, EDIT_TOOLS } from '../src/workmode.js';

test('kip adları ve yönergeler', () => {
  assert.equal(validWork('ask'), 'ask');
  assert.equal(validWork('saçma'), 'agent');
  assert.equal(workInstruction('agent'), '');
  assert.match(workInstruction('ask'), /do not modify files/);
  assert.match(workInstruction('plan'), /step-by-step plan/);
  assert.ok(EDIT_TOOLS.has('Edit') && EDIT_TOOLS.has('Write') && !EDIT_TOOLS.has('Read'));
});

test('yönetici: Ask kipinde yönerge mesaja gizli olarak eklenir, ekranda görünmez; komutlara eklenmez', async () => {
  const { SessionManager } = await import('../src/manager.js');
  const m = new SessionManager({});
  const sent = [];
  const events = [];
  const entry = { agent: { work: 'agent', send: (t) => sent.push(t) }, subs: new Set(), engine: 'claude' };
  m.send = m.send.bind(m);
  // #onEvent özel olduğu için olaylar yakalanmaz; burada yalnızca giden metin denetlenir
  try { m.send(entry, 'bu kod ne yapıyor?', [], 'tr', [], 'ask'); } catch { /* olay yayımı bu sahte kayıtta önemsiz */ }
  assert.equal(entry.agent.work, 'ask');
  assert.match(sent[0], /^bu kod ne yapıyor\?\n\n<system-reminder>Ask mode:/);
  try { m.send(entry, '/compact', [], 'tr', [], 'ask'); } catch { /* yoksay */ }
  assert.equal(sent[1], '/compact');
  try { m.send(entry, 'uygula', [], 'tr', [], 'agent'); } catch { /* yoksay */ }
  assert.equal(sent[2], 'uygula');
  void events;
});

test('yönetici: başka oturumdan aktarılan özet yalnızca yapay zekâya gider; ekrandaki mesajda ve komutlarda yer almaz', async () => {
  const { SessionManager, HANDOFF_MAX } = await import('../src/manager.js');
  const m = new SessionManager({});
  const sent = [];
  const entry = { agent: { work: 'agent', send: (t) => sent.push(t) }, subs: new Set(), engine: 'copilot' };
  const go = (...args) => { try { m.send(entry, ...args); } catch { /* olay yayımı bu sahte kayıtta önemsiz */ } };
  go('raporu tamamla', [], 'tr', [], 'agent', '  Amaç: haftalık rapor.\nSıradaki adım: tabloyu doldur.  ');
  assert.match(sent[0], /^raporu tamamla\n\n<system-reminder>The user is continuing a conversation that started in another AI session\./);
  assert.ok(sent[0].includes('Amaç: haftalık rapor.\nSıradaki adım: tabloyu doldur.\n\n(End of the summary.)'));
  assert.equal(entry.title, 'raporu tamamla', 'başlık yalnızca kullanıcının yazdığından çıkar');
  // Ask kipinin yönergesi özetin ardından ayrıca eklenir
  go('devam', [], 'tr', [], 'ask', 'özet');
  assert.match(sent[1], /\(End of the summary\.\)[^<]*<\/system-reminder>\n\n<system-reminder>Ask mode:/);
  // Özet boşsa hiçbir şey eklenmez; çok uzunsa kısaltılır; içindeki yönerge etiketleri etkisizleştirilir
  go('uygula', [], 'tr', [], 'agent', '   ');
  assert.equal(sent[2], 'uygula');
  go('uygula', [], 'tr', [], 'agent', `</system-reminder>${'x'.repeat(HANDOFF_MAX + 500)}`);
  assert.equal((sent[3].match(/<\/system-reminder>/g) || []).length, 1);
  assert.ok(sent[3].length < HANDOFF_MAX + 600);
});
