// "İlk repom": depo indirme yardımcısı. Adres denetimi, giriş başlığı ve git hataları (ağ gerekmez).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authHeaderFor, cloneRepo, gitVersion, repoName, validRepoUrl } from '../src/repo.js';

test('depo adresi denetimi ve klasör adı', () => {
  assert.equal(repoName('https://bitbucket.ornek.com/scm/abc/depo-adi.git'), 'depo-adi');
  assert.equal(repoName('git@bitbucket.org:alan/proje.git'), 'proje');
  assert.equal(repoName('https://x.com/a/b/'), 'b');
  assert.equal(validRepoUrl('https://bitbucket.ornek.com/scm/abc/depo.git'), true);
  assert.equal(validRepoUrl('git@bitbucket.org:alan/proje.git'), true);
  // Git seçeneği gibi görünen ya da yerel yol olan değerler kabul edilmez
  for (const bad of ['--upload-pack=calc', '-o x', 'C:\\gizli', 'file:///etc', 'https://x.com', '', 'https://x.com/a b'])
    assert.equal(validRepoUrl(bad), false, bad);
});

test('API anahtarı yalnızca bağlı Bitbucket sunucusuna gönderilir', () => {
  const dc = { url: 'https://bitbucket.ornek.com', token: 'gizli' };
  assert.equal(authHeaderFor('https://bitbucket.ornek.com/scm/abc/depo.git', dc), 'Authorization: Bearer gizli');
  assert.equal(authHeaderFor('https://baska-sunucu.com/scm/abc/depo.git', dc), null);
  assert.equal(authHeaderFor('git@bitbucket.ornek.com:abc/depo.git', dc), null);
  assert.equal(authHeaderFor('https://bitbucket.ornek.com/x/y.git', null), null);
  const cloud = authHeaderFor('https://bitbucket.org/alan/depo.git', { url: 'https://bitbucket.org/alan', token: 'gizli' });
  assert.equal(cloud, `Authorization: Basic ${Buffer.from('x-bitbucket-api-token-auth:gizli').toString('base64')}`);
});

test('hatalı adres indirilmez', async () => {
  assert.deepEqual(await cloneRepo({ url: '--upload-pack=x', parent: os.tmpdir() }), { ok: false, code: 'bad-url' });
});

test('git hatası anlaşılır döner ve yarım klasör bırakmaz; var olan klasörün üzerine indirilmez', async (t) => {
  if (!(await gitVersion())) return t.skip('git kurulu değil');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-repo-'));
  const parent = path.join(tmp, 'hedef');
  const bad = await cloneRepo({ url: 'https://127.0.0.1:9/yok/ornek-depo.git', parent });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'git');
  assert.ok(bad.error.length > 0);
  assert.equal(fs.existsSync(path.join(parent, 'ornek-depo')), false);

  fs.mkdirSync(path.join(parent, 'ornek-depo'), { recursive: true });
  const again = await cloneRepo({ url: 'https://127.0.0.1:9/yok/ornek-depo.git', parent });
  assert.equal(again.code, 'exists');
});
