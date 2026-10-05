import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/store.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-durum-')), 'durum.json');

test('proje listesi diske yazılır; yeniden açılışta (tarayıcı/bilgisayar kapanıp açılınca) korunur', () => {
  const file = tmpFile();
  const a = new StateStore(file);
  a.addProject('C:\\proje\\bir');
  a.addProject('C:\\proje\\iki');
  a.addProject('c:\\PROJE\\bir\\'); // aynı klasör, farklı yazım: tekrar eklenmez (Windows)
  a.setCollapsed('c:\\proje\\iki', true);
  a.remember({ cwd: 'C:\\proje\\iki', selected: 'C:\\proje\\iki', open: { liveId: 'L', sessionId: 'S', cwd: 'C:\\proje\\iki' } });

  const b = new StateStore(file); // yeni süreç: Atölye yeniden başladı
  assert.equal(b.get().projects.length, process.platform === 'win32' ? 2 : 3);
  assert.deepEqual(b.get().collapsed, ['c:\\proje\\iki']);
  assert.equal(b.get().cwd, 'C:\\proje\\iki');
  assert.equal(b.get().open.sessionId, 'S');

  b.removeProject('C:\\proje\\bir');
  assert.ok(!new StateStore(file).get().projects.includes('C:\\proje\\bir'));
});

test('eski sürümün tarayıcıdaki listesi birleştirilerek aktarılır', () => {
  const s = new StateStore(tmpFile());
  s.addProject('/p/a');
  s.importLocal({ projects: ['/p/a', '/p/b', 42, ''], collapsed: ['/p/b'] });
  assert.deepEqual(s.get().projects, ['/p/a', '/p/b']);
  assert.deepEqual(s.get().collapsed, ['/p/b']);
});

test('bozuk ya da eksik dosya uygulamayı durdurmaz', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ bozuk json');
  assert.deepEqual(new StateStore(file).get().projects, []);
});

test('proje değişiklikleri dinleyicilere duyurulur, hatırlananlar duyurulmaz', () => {
  const s = new StateStore(tmpFile());
  const seen = [];
  s.onChange((st) => seen.push(st.projects.length));
  s.addProject('/x');
  s.remember({ cwd: '/x' });
  s.setCollapsed('/x', true);
  assert.deepEqual(seen, [1, 1]);
});
