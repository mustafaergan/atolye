import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/spend.js';

test('tablo biçimi: harcanan / bütçe ve hesaplanan yüzde', () => {
  const r = summarize('Claude Code Spend\n──────────────\nMonthly Spend    $82.40\nMonthly Budget   $100.00\nRemaining        $17.60');
  assert.equal(r.title, 'Claude Code Spend');
  assert.equal(r.items.length, 3);
  assert.equal(r.summary, '$82.40 / $100.00 · %82.4');
  assert.equal(r.percent, 82.4);
});

test('Türkçe etiketler ve "%45" yazımı', () => {
  const r = summarize('Başlık\n─────\nKullanım   %45\nHarcama    1.234,50 TL\nBütçe      2.000,00 TL');
  assert.equal(r.percent, 45);
  assert.equal(r.summary, '1.234,50 TL / 2.000,00 TL · %45');
});

test('bilinmeyen biçim: tutar içeren ilk satır', () => {
  const r = summarize('Rapor\nBu ay: $12.00 harcandı (12%)');
  assert.equal(r.items.length, 0);
  assert.equal(r.summary, 'Bu ay: $12.00 harcandı (12%)');
  assert.equal(r.percent, 12);
});
