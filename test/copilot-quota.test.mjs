// Copilot kalan kotası: Copilot CLI'ın yerel önbellek dosyasından okunur (GitHub'a istek atılmaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copilotQuota, summarize } from '../src/copilot-quota.js';

const entry = (login, retrievedAt, premium, extra = {}) => ({
  schemaVersion: 1, retrievedAt,
  response: { login, copilot_plan: 'business', quota_reset_date: '2026-12-01', ...(premium ? { quota_snapshots: { premium_interactions: premium } } : {}), ...extra },
});

test('kalan kota özetlenir: toplam, kalan, yüzde, sıfırlanma tarihi', () => {
  const q = summarize({ copilotUserCache: { a: entry('biri', '2026-11-12T10:00:00Z', { entitlement: 300, remaining: 142.5, percent_remaining: 47.5, unlimited: false, overage_count: 0 }) } });
  assert.deepEqual(q, { available: true, plan: 'business', unlimited: false, total: 300, remaining: 142.5, percentRemaining: 47.5, overage: 0, resetDate: '2026-12-01', retrievedAt: '2026-11-12T10:00:00Z' });
});

test('birden fazla hesap varsa giriş yapılan hesabın en yeni kaydı kullanılır; kota bilgisi yoksa gösterilmez', () => {
  const cache = { copilotUserCache: {
    eski: entry('biri', '2026-11-01T10:00:00Z', { entitlement: 300, remaining: 300, percent_remaining: 100, unlimited: false }),
    yeni: entry('biri', '2026-11-12T10:00:00Z', { entitlement: 300, remaining: 10, percent_remaining: 3.3, unlimited: false }),
    baska: entry('baskasi', '2026-11-13T10:00:00Z', { entitlement: 50, remaining: 50, percent_remaining: 100, unlimited: false }),
  } };
  assert.equal(summarize(cache, 'biri').remaining, 10);
  assert.equal(summarize(cache, 'baskasi').total, 50);
  assert.equal(summarize(cache).total, 50, 'hesap bilinmiyorsa en yeni kayıt');
  // Giriş yapılan hesabın kota bilgisi yok (ör. lisanssız hesap): başka hesabın kotası gösterilmez
  assert.deepEqual(summarize({ copilotUserCache: { a: entry('biri', '2026-11-12T10:00:00Z', null), b: cache.copilotUserCache.baska } }, 'biri'), { available: false });
  assert.deepEqual(summarize({}), { available: false });
  assert.equal(summarize({ copilotUserCache: { a: entry('biri', 'x', { unlimited: true, entitlement: 0, remaining: 0, percent_remaining: 100 }) } }).unlimited, true);
});

test('dosyadan okuma: başındaki açıklama satırı atlanır; dosya yoksa hata vermez', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atolye-kota-'));
  const file = path.join(dir, 'copilot-user-cache.json');
  fs.writeFileSync(file, `// Disposable cache for Copilot user responses, safe to delete. Managed automatically.\n${JSON.stringify({ copilotUserCache: { a: entry('biri', '2026-11-12T10:00:00Z', { entitlement: 200, remaining: 150, percent_remaining: 75, unlimited: false }) } })}`);
  fs.writeFileSync(path.join(dir, 'config.json'), '// managed\n{ "lastLoggedInUser": { "host": "https://github.com", "login": "biri" } }');
  const q = copilotQuota({ COPILOT_USER_CACHE: file, COPILOT_HOME: dir });
  assert.equal(q.remaining, 150);
  assert.equal(q.total, 200);
  assert.deepEqual(copilotQuota({ COPILOT_USER_CACHE: path.join(dir, 'yok.json'), COPILOT_HOME: dir }), { available: false });
  fs.writeFileSync(file, 'bozuk');
  assert.deepEqual(copilotQuota({ COPILOT_USER_CACHE: file, COPILOT_HOME: dir }), { available: false });
});
