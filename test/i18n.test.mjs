// Her çevrilebilir metnin İngilizce karşılığı var mı? Yeni bir metin eklenip çevirisi
// unutulursa bu test hangi metin olduğunu söyler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EN as UI_EN, t } from '../public/i18n.js';
import { EN as SERVER_EN } from '../src/messages.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// Kaynak koddaki string sabitlerini (tek/çift tırnak) sırayla döndürür
function stringLiterals(src) {
  const out = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g;
  let m;
  while ((m = re.exec(src))) out.push((m[1] ?? m[2]).replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n'));
  return out;
}

// fn( ... ) çağrılarının parantez içini döndürür (iç içe parantez ve string'leri atlayarak)
function callBodies(src, fn) {
  const bodies = [];
  const re = new RegExp(`(?<![\\w.])${fn}\\(`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex, quote = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    bodies.push(src.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

const block = (src, start) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `${start} bulunamadı`);
  return src.slice(i, src.indexOf('\n};', i));
};

test('arayüz: T(...) ile kullanılan her metnin İngilizcesi var', () => {
  const src = read('../public/app.js');
  const keys = new Set();
  for (const body of callBodies(src, 'T')) for (const s of stringLiterals(body)) keys.add(s);
  // Sonradan T() ile çizilen sözlükler
  for (const name of ['const EMPTY = {', 'const ALWAYS_LABEL = {']) for (const s of stringLiterals(block(src, name))) keys.add(s);
  // T(...) içindeki karşılaştırmalarda geçen kod değerleri metin değildir
  const CODE_VALUES = new Set(['allow', 'deny', 'completed', 'PowerShell']);
  const missing = [...keys].filter((k) => /[a-zçğıöşü]/i.test(k) && !(k in UI_EN) && !CODE_VALUES.has(k));
  assert.deepEqual(missing, [], `Çevirisi olmayan metinler:\n${missing.join('\n')}`);
});

test('sayfa: data-i18n ile işaretli her metnin İngilizcesi var', () => {
  const html = read('../public/index.html');
  const keys = new Set();
  for (const m of html.matchAll(/<[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)/g)) if (m[1].trim()) keys.add(m[1].trim());
  for (const m of html.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const attr of m[1].split(',')) {
      const v = m[0].match(new RegExp(`\\s${attr.trim()}="([^"]*)"`));
      if (v) keys.add(v[1]);
    }
  }
  assert.ok(keys.size > 20, 'sayfada işaretli metin bulunamadı');
  const missing = [...keys].filter((k) => !(k in UI_EN));
  assert.deepEqual(missing, [], `Çevirisi olmayan metinler:\n${missing.join('\n')}`);
});

test('sunucu: msg(...) ile kullanılan her mesajın İngilizcesi var', () => {
  const keys = new Set();
  for (const f of ['server.js', 'session.js', 'manager.js', 'spend.js']) {
    for (const body of callBodies(read(`../src/${f}`), 'msg')) {
      const lit = stringLiterals(body)[0]; // ilk argüman dil, ikincisi anahtar: ilk string sabiti anahtardır
      if (lit) keys.add(lit);
    }
  }
  assert.ok(keys.size > 5);
  const missing = [...keys].filter((k) => !(k in SERVER_EN));
  assert.deepEqual(missing, [], `Çevirisi olmayan mesajlar:\n${missing.join('\n')}`);
});

test('yer tutucular doldurulur', () => {
  assert.equal(t('{n} oturum daha', { n: 3 }), '3 oturum daha'); // Node'da dil Türkçe
  for (const [tr, en] of Object.entries(UI_EN)) {
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(names(en), names(tr), `yer tutucular farklı: "${tr}"`);
  }
});
