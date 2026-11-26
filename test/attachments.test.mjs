import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const { saveAttachments, attachmentPrompt, xlsxSheets, decodeText, docxText, pptxSlides, pdfText, extractText } = await import('../src/attachments.js');

// Küçük bir zip yazıcı (xlsx üretmek için): dosyalar sıkıştırılarak (deflate) eklenir
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const workbook = () => zip({
  'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Satışlar" sheetId="1" r:id="rId1"/><sheet name="Boş &amp; Not" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Ürün</t></si><si><t>Tutar</t></si><si><r><t>Çay, </t></r><r><t>"demlik"</t></r></si><si><t>Tarih</t></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>1250.5</v></c><c r="C2"/><c r="D2" s="1"><v>46339</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>Toplam &lt;net&gt;</t></is></c><c r="B4" t="b"><v>1</v></c></row>'
    + '</sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
});

test('xlsx: sayfalar CSV olur; paylaşılan metinler, boş hücreler, tarihler ve kaçışlar doğru', () => {
  const [a, b] = xlsxSheets(workbook());
  assert.equal(a.name, 'Satışlar');
  assert.deepEqual(a.csv.split('\n'), [
    'Ürün,Tutar,,Tarih',
    '"Çay, ""demlik""",1250.5,,2026-11-13',
    '',
    'Toplam <net>,TRUE',
  ]);
  assert.equal(a.rows, 4);
  assert.equal(b.name, 'Boş & Not');
  assert.equal(b.csv, '');
  assert.throws(() => xlsxSheets(Buffer.from('zip değil')));
});

test('metin: UTF-8, BOM ve Windows-1254 (Excel CSV) doğru okunur', () => {
  assert.equal(decodeText(Buffer.from('﻿şehir;ığü', 'utf8')), 'şehir;ığü');
  assert.equal(decodeText(Buffer.from([0xfe, 0x65, 0x68, 0x69, 0x72, 0x3b, 0xdd, 0xf0])), 'şehir;İğ');
});

test('ekler diske kaydedilir; mesaja yol ve içeriğin başı eklenir, uzun içerik kısaltılır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-ek-'));
  const b64 = (v) => Buffer.from(v).toString('base64');
  const big = Array.from({ length: 5000 }, (_, i) => `satır ${i},değer`).join('\n');
  const saved = saveAttachments([
    { name: 'liste.csv', data: b64('ad,yaş\nAli,30') },
    { name: '..\\..\\kötü:ad.xlsx', data: workbook().toString('base64') },
    { name: 'eski.xls', data: b64(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0])) },
    { name: 'belge.pdf', data: b64('%PDF-1.7 ...') },
    { name: 'büyük.log', data: b64(big) },
    { name: 'liste.csv', data: b64('ikinci') },
    { name: 'bozuk', data: 5 },
  ], { dir });
  assert.equal(saved.length, 6);
  for (const f of saved) assert.ok(f.path.startsWith(dir) && fs.existsSync(f.path), f.path);
  const [csv, xlsx, xls, pdf, log, again] = saved;
  assert.equal(csv.kind, 'text');
  assert.equal(xlsx.kind, 'sheet');
  assert.ok(!/[\\/:]/.test(xlsx.name), 'dosya adı klasör dışına çıkamaz');
  assert.equal(path.dirname(xlsx.path), path.dirname(csv.path));
  assert.equal(xlsx.parts.length, 2);
  assert.ok(fs.readFileSync(xlsx.parts[0].path, 'utf8').includes('Ürün,Tutar'));
  assert.equal(xls.note, 'old_xls');
  assert.equal(pdf.kind, 'binary');
  assert.notEqual(again.name, csv.name, 'aynı adlı ikinci dosya ötekinin üzerine yazmaz');

  const text = attachmentPrompt(saved, 'tr');
  assert.match(text, /^\[Ekli dosyalar: /);
  assert.ok(text.includes(csv.path) && text.includes('Ali,30'));
  assert.ok(text.includes('Sayfa "Satışlar" (4 satır)'));
  assert.ok(text.includes('.xls'));
  assert.ok(text.includes('İkili dosya'));
  assert.match(text, /kısaltıldı: toplam \d+ karakterin ilk \d+ karakteri/);
  assert.ok(!text.includes('satır 4999,'), 'uzun dosyanın sonu mesaja girmez');
  assert.ok(text.length < 70_000);
  assert.match(attachmentPrompt(saved, 'en'), /^\[Attached files: /);
  assert.equal(attachmentPrompt([], 'tr'), '');
  assert.deepEqual(saveAttachments(undefined, { dir }), []);
});

test('30 günden eski ek klasörleri temizlenir, başka klasörlere dokunulmaz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-ek-'));
  const old = path.join(dir, '20250101-101010-abcd');
  const other = path.join(dir, 'benim-klasorum');
  fs.mkdirSync(old); fs.mkdirSync(other);
  const past = new Date(Date.now() - 40 * 86_400_000);
  fs.utimesSync(old, past, past); fs.utimesSync(other, past, past);
  saveAttachments([{ name: 'a.txt', data: Buffer.from('x').toString('base64') }], { dir });
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(other));
});

test('Word, PowerPoint ve PDF metne çevrilir; okunamayan PDF boş döner', () => {
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Başlık &amp; özet</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Alan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">Değer</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>Bir</w:t><w:tab/><w:t>iki</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(docxText(docx), 'Başlık & özet\nAlan | Değer\nBir\tiki');
  const pptx = zip({
    'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Onuncu</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>İkinci</a:t></a:r></a:p><a:p><a:r><a:t>satır</a:t></a:r></a:p></p:sld>',
  });
  assert.deepEqual(pptxSlides(pptx), [{ label: 'Slayt 1', text: 'İkinci\nsatır' }, { label: 'Slayt 2', text: 'Onuncu' }]);

  const content = zlib.deflateSync(Buffer.from('BT /F1 12 Tf 72 700 Td (Rapor sablonu: baslik) Tj T* [(Durum) -300 (alani \\(zorunlu\\))] TJ ET', 'latin1'));
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n4 0 obj << /Length 99 /Filter /FlateDecode >>\nstream\n', 'latin1'), content, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]);
  assert.equal(pdfText(pdf), 'Rapor sablonu: baslik\nDurum alani (zorunlu)');
  const garbled = Buffer.from('%PDF-1.4\n<< /Length 9 >>\nstream\nBT (\x01\x02\x03\x04\x05\x06\x07\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b) Tj ET\nendstream\n', 'latin1');
  assert.equal(pdfText(garbled), '', 'özel kodlamalı yazı tipi: metin yok sayılır');

  assert.equal(extractText('a.pdf', pdf).note, '', 'sohbette PDF çıkarılmaz (yapay zekâ kendisi okur)');
  assert.equal(extractText('a.pdf', pdf).parts.length, 0);
  assert.equal(extractText('a.pdf', pdf, { pdf: true }).parts[0].text.startsWith('Rapor'), true);
  assert.equal(extractText('a.pdf', garbled, { pdf: true }).note, 'pdf_unreadable');
  assert.match(extractText('bozuk.docx', Buffer.from('zip değil')).note, /^unreadable:/);

  // Sohbet ekinde Word metni mesaja girer
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-ek-'));
  const [saved] = saveAttachments([{ name: 'not.docx', data: docx.toString('base64') }], { dir });
  assert.equal(saved.kind, 'doc');
  assert.match(attachmentPrompt([saved]), /Başlık & özet/);
  fs.rmSync(dir, { recursive: true, force: true });
});
