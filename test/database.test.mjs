// Veritabanı bağlantıları: yalnızca okuma denetimi, adres denetimi ve sürücülerin salt okunur işlemle çağrılması
// (gerçek veritabanına bağlanılmaz; sürücüler sahtedir)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadOnly, skeleton, formatRows, validDbUrl, setDriver, oracle, postgres } from '../src/database.js';
import { availableTools, callTool } from '../src/mcp-server.js';

test('yalnızca tek bir SELECT / WITH sorgusu kabul edilir', () => {
  for (const ok of [
    'select * from siparis',
    'SELECT id, updated_at, offset_value FROM t WHERE durum = \'DELETE\' ORDER BY id;',
    'with son as (select * from t) select count(*) from son',
    '(select 1 from dual) union all (select 2 from dual)',
    "select replace(ad, 'a', 'b'), \"Update\" from t -- yorum: delete from t\n where 1=1",
    'select /* insert into x */ 1 from dual',
    "select $$drop table x$$ as metin",
  ]) assert.equal(typeof checkReadOnly(ok), 'string', ok);
  const bad = [
    ['delete from siparis', /Yalnızca SELECT/],
    ['update t set a = 1', /Yalnızca SELECT/],
    ['select 1; drop table t', /yalnızca bir sorgu/],
    ['with x as (delete from t returning *) select * from x', /"DELETE"/],
    ['select * into yeni_tablo from t', /"INTO"/],
    ['select * from t for update', /FOR UPDATE/],
    ['select * from t for share', /FOR UPDATE/],
    ['   ', /boş/],
    ['begin delete from t; end;', /yalnızca bir sorgu|Yalnızca SELECT/],
    ['explain analyze delete from t', /Yalnızca SELECT/],
  ];
  for (const [sql, re] of bad) assert.throws(() => checkReadOnly(sql), re, sql);
  assert.equal(skeleton("select 'a;b', \"c;d\" -- ;\n"), "select '', \"x\"  \n");
});

test('bağlantı adresi: PostgreSQL adresi parolasız, Oracle sunucu:port/servis ya da TNS', () => {
  assert.ok(validDbUrl('postgres', 'postgresql://db.example.com:5432/veri'));
  assert.ok(validDbUrl('postgres', 'postgres://db.example.com/veri?sslmode=require'));
  assert.ok(!validDbUrl('postgres', 'postgresql://kullanici:parola@db.example.com/veri'), 'parola adrese yazılmaz');
  assert.ok(!validDbUrl('postgres', 'https://db.example.com'));
  assert.ok(validDbUrl('oracle', 'db.example.com:1521/ORCLPDB1'));
  assert.ok(validDbUrl('oracle', 'db.example.com/XE'));
  assert.ok(validDbUrl('oracle', '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=X)))'));
  assert.ok(!validDbUrl('oracle', 'db.example.com'));
  assert.ok(!validDbUrl('oracle', 'kullanici/parola@db'));
});

test('sonuç tablosu: başlık, NULL, tarih, ikili veri, satır sınırı', () => {
  const text = formatRows(['id', 'ad', 'tarih', 'veri'], [[1, null, new Date('2026-01-02T10:00:00Z'), Buffer.from('abc')], [2, 'a|b\nc', null, null], [3, 'x', null, null]], 2);
  assert.equal(text, 'id | ad | tarih | veri\n1 | NULL | 2026-01-02 10:00:00Z | <ikili 3 bayt>\n2 | a¦b ⏎ c | NULL | NULL\n\n2 satır gösterildi; daha fazlası var (limit artırılabilir, en çok 1000) ya da sorguyu daraltın.');
  assert.match(formatRows(['a'], [], 10), /Sonuç yok \(0 satır\)/);
});

test('PostgreSQL: sorgu salt okunur işlemde, satır sınırıyla çalışır; işlem geri alınır', async () => {
  const log = [];
  setDriver('postgres', async () => ({
    Client: class {
      constructor(opt) { const u = new URL(opt.connectionString); log.push(['bağlan', `${u.protocol}//${u.host}${u.pathname}`, decodeURIComponent(u.username), decodeURIComponent(u.password), opt.statement_timeout]); }
      async connect() {}
      async query(q) {
        const text = typeof q === 'string' ? q : q.text;
        log.push(['sorgu', text.replace(/\s+/g, ' ').trim()]);
        if (/current_user/.test(text)) return { rows: [{ u: 'okuyucu', d: 'veri', v: 'PostgreSQL 17.2' }] };
        return { fields: [{ name: 'id' }, { name: 'ad' }], rows: [[1, 'a'], [2, 'b'], [3, 'c']] };
      }
      async end() { log.push(['kapat']); }
    },
  }));
  const cfg = { url: 'postgresql://db.example.com/veri', email: 'okuyucu', token: 'gizli' };
  assert.equal(await postgres.whoami(cfg), 'okuyucu @ veri (PostgreSQL 17.2)');
  log.length = 0;
  assert.equal(await postgres.query(cfg, { sql: 'select id, ad from t order by id;', limit: 2 }), 'id | ad\n1 | a\n2 | b\n\n2 satır gösterildi; daha fazlası var (limit artırılabilir, en çok 1000) ya da sorguyu daraltın.');
  assert.deepEqual(log.map((x) => x[0] === 'sorgu' ? x[1] : x[0]), ['bağlan', 'BEGIN READ ONLY', 'select * from (select id, ad from t order by id) as atolye_sorgu limit 3', 'ROLLBACK', 'kapat']);
  assert.equal(log[0][4], 30000, 'sorgu süresi sınırlı');
  await assert.rejects(postgres.query(cfg, { sql: 'delete from t' }), /Yalnızca SELECT/);
});

test('Oracle: SET TRANSACTION READ ONLY, maxRows ile sınır; işlem geri alınır ve bağlantı kapanır', async () => {
  const log = [];
  setDriver('oracle', async () => ({
    OUT_FORMAT_ARRAY: 4001, CLOB: 2017, NCLOB: 2019,
    async getConnection(opt) {
      log.push(['bağlan', opt.connectString, opt.user]);
      return {
        oracleServerVersionString: '19.3.0.0.0',
        async execute(sql, binds, opts = {}) {
          log.push(['sorgu', sql.replace(/\s+/g, ' ').trim(), opts.maxRows]);
          if (/sys_context/.test(sql)) return { rows: [['OKUYUCU', 'ORCL']] };
          if (/all_objects/.test(sql)) { log.push(['bağ', binds]); return { rows: [['APP', 'SIPARIS', 'tablo']] }; }
          return { metaData: [{ name: 'ID' }], rows: [[1], [2]] };
        },
        async rollback() { log.push(['geri al']); },
        async close() { log.push(['kapat']); },
      };
    },
  }));
  const cfg = { url: 'oracle://db.example.com:1521/ORCLPDB1', email: 'okuyucu', token: 'gizli' };
  assert.equal(await oracle.whoami(cfg), 'OKUYUCU @ ORCL (Oracle 19.3.0.0.0)');
  log.length = 0;
  assert.equal(await oracle.query(cfg, { sql: 'select id from siparis', limit: 5 }), 'ID\n1\n2\n\n2 satır.');
  assert.deepEqual(log, [['bağlan', 'db.example.com:1521/ORCLPDB1', 'okuyucu'], ['sorgu', 'SET TRANSACTION READ ONLY', undefined], ['sorgu', 'select id from siparis', 6], ['geri al'], ['kapat']]);
  log.length = 0;
  assert.match(await oracle.listTables(cfg, { schema: 'app', name: 'sip' }), /^şema \| ad \| tür\nAPP \| SIPARIS \| tablo/);
  assert.deepEqual(log.find((x) => x[0] === 'bağ')[1], { sema: 'app', ad: 'sip' });
});

test('veritabanı araçları yalnızca bağlantı kuruluysa sunulur ve hepsi okuma yapar', async () => {
  const env = { ORACLE_URL: 'db.example.com:1521/X', ORACLE_EMAIL: 'u', ORACLE_TOKEN: 'p', POSTGRES_URL: 'postgresql://db/veri', POSTGRES_EMAIL: 'u', POSTGRES_TOKEN: 'p' };
  const tools = availableTools(env);
  assert.deepEqual(tools.map((t) => t.name), ['oracle_query', 'oracle_list_tables', 'oracle_describe_table', 'postgres_query', 'postgres_list_tables', 'postgres_describe_table']);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
  const r = await callTool('postgres_query', { sql: 'drop table t' }, env);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^postgres: Yalnızca SELECT/);
});
