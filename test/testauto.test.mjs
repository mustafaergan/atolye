// Test otomasyonu bağlantısı: proje türünü algılama ve ayarın saklanması (gerçek ayar dosyasına dokunulmaz)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detect, save, status, remove, branches } from '../src/testauto.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-test-'));
const put = (dir, name, text = '') => fs.writeFileSync(path.join(dir, name), text);

test('proje türü algılanır ve çalıştırma komutu önerilir', () => {
  const maven = tmp(); put(maven, 'pom.xml', '<dependency><artifactId>cucumber-java</artifactId></dependency>');
  assert.deepEqual(detect(maven), { exists: true, kind: 'Maven + Cucumber', command: 'mvn test', tagExample: 'mvn test "-Dcucumber.filter.tags=@etiket"' });
  const plain = tmp(); put(plain, 'pom.xml', '<project/>');
  assert.equal(detect(plain).kind, 'Maven');
  const pw = tmp(); put(pw, 'package.json', JSON.stringify({ devDependencies: { '@playwright/test': '1' } }));
  assert.equal(detect(pw).command, 'npx playwright test');
  const node = tmp(); put(node, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
  assert.equal(detect(node).command, 'npm test');
  const py = tmp(); put(py, 'pytest.ini');
  assert.equal(detect(py).command, 'pytest');
  const gradle = tmp(); put(gradle, 'build.gradle');
  assert.match(detect(gradle).command, /gradle test$/);
  assert.deepEqual(detect(tmp()), { exists: true, kind: '', command: '', tagExample: '' });
  assert.equal(detect(path.join(os.tmpdir(), 'atolye-yok-boyle-klasor')).exists, false);
  assert.equal(detect('goreli/yol').exists, false);
  assert.equal(detect('').exists, false);
});

test('ayar kaydedilir, okunur ve kaldırılır; eksik ya da hatalı girişte anlaşılır hata kodu', () => {
  const file = path.join(tmp(), 'ayar', 'test-otomasyon.json');
  const repo = tmp();
  assert.equal(status({ file }).connected, false);
  assert.throws(() => save({ dir: '', command: 'mvn test' }, { file }), { code: 'no-dir' });
  assert.throws(() => save({ dir: path.join(repo, 'yok'), command: 'mvn test' }, { file }), { code: 'bad-dir' });
  assert.throws(() => save({ dir: repo, command: '  ' }, { file }), { code: 'no-command' });
  const st = save({ dir: repo, command: 'mvn test\n-Denv=test', notes: ' Etiketler: @smoke ', repoUrl: 'https://git.sirket.com/abc/test.git' }, { file });
  assert.equal(st.connected, true);
  assert.equal(st.command, 'mvn test -Denv=test', 'komut tek satıra indirilir');
  assert.equal(st.notes, 'Etiketler: @smoke');
  assert.equal(st.exists, true);
  assert.deepEqual(status({ file }), st);
  fs.rmdirSync(repo);
  assert.equal(status({ file }).exists, false, 'klasör silinmişse bildirilir');
  assert.equal(remove({ file }).connected, false);
  assert.equal(remove({ file }).connected, false);
});

test('release dalı saklanır; geçersiz dal adı reddedilir', () => {
  const file = path.join(tmp(), 'test-otomasyon.json');
  const repo = tmp();
  assert.equal(save({ dir: repo, command: 'mvn test', branch: ' release/2.5.0 ' }, { file }).branch, 'release/2.5.0');
  assert.equal(save({ dir: repo, command: 'mvn test' }, { file }).branch, '');
  assert.throws(() => save({ dir: repo, command: 'mvn test', branch: 'main; rm -rf x' }, { file }), { code: 'bad-branch' });
  assert.throws(() => save({ dir: repo, command: 'mvn test', branch: '--force' }, { file }), { code: 'bad-branch' });
});

test('dallar: release dalları en yenisi üstte gelir; git deposu olmayan klasör bildirilir', async () => {
  assert.deepEqual(await branches(tmp()), { git: false, current: '', branches: [] });
  assert.equal((await branches('')).git, false);
  const repo = tmp();
  const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  g('add', '.'); g('commit', '-q', '-m', 'ilk');
  for (const b of ['release/2.9.0', 'release/2.10.0', 'feature/deneme']) g('branch', b);
  const r = await branches(repo);
  assert.equal(r.git, true);
  assert.equal(r.current, 'main');
  assert.deepEqual(r.branches, ['release/2.10.0', 'release/2.9.0', 'feature/deneme', 'main']);
});
