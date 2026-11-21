// Veritabanı bağlantıları (Geliştirici modu): Oracle ve PostgreSQL. YALNIZCA OKUMA:
//   1. Sorgu metni denetlenir: tek ifade, SELECT ya da WITH ile başlamalı; değişiklik yapan anahtar sözcükler reddedilir.
//   2. Sorgu salt okunur bir işlem (READ ONLY transaction) içinde çalışır ve sonunda geri alınır.
//   3. Satır sayısı ve süre sınırlıdır.
// Yine de en güvenlisi veritabanında yalnızca okuma yetkisi olan bir kullanıcı kullanmaktır.
// Sürücüler (pg, oracledb) yalnızca gerektiğinde yüklenir. Oracle varsayılan olarak "thin" kipte çalışır: Oracle istemcisi
// kurmak gerekmez (Oracle Database 12.1 ve üstü). Bilgisayarda Oracle istemci kitaplıkları varsa "thick" kip kullanılır:
// thin kipin desteklemediği eski parola biçimi (10G) ve eski veritabanı sürümleri onunla çalışır (bkz. findOracleClient).
import fs from 'node:fs';
import path from 'node:path';

const MAX_ROWS = 1000;
const DEFAULT_ROWS = 100;
const CELL_MAX = 300;
const TEXT_MAX = 60_000;
const QUERY_TIMEOUT_MS = 30_000;

const FORBIDDEN = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|rename|grant|revoke|commit|rollback|savepoint|call|exec|execute|begin|declare|lock|copy|vacuum|reindex|refresh|set|into|do|listen|notify|purge|flashback|shutdown|startup)\b/i;

/** Yorumları ve metin/ad sabitlerini atar (denetim yalnızca sorgunun iskeletine bakar) */
export function skeleton(sql) {
  let out = '';
  const s = String(sql || '');
  for (let i = 0; i < s.length;) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (two === '--') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; out += ' '; continue; }
    if (two === '/*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; out += ' '; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === c && s[j + 1] === c) { j += 2; continue; } // '' kaçışı
        if (s[j] === c) break;
        j++;
      }
      i = j + 1;
      out += c === "'" ? "''" : '"x"';
      continue;
    }
    // PostgreSQL dolar tırnağı: $$...$$ ya da $etiket$...$etiket$
    const dollar = c === '$' && /^\$[A-Za-z_]*\$/.exec(s.slice(i));
    if (dollar) { const end = s.indexOf(dollar[0], i + dollar[0].length); i = end < 0 ? s.length : end + dollar[0].length; out += "''"; continue; }
    out += c;
    i++;
  }
  return out;
}

/** Yalnızca okuma yapan tek bir sorgu mu? Değilse anlaşılır bir hata fırlatır; temizlenmiş sorguyu döndürür. */
export function checkReadOnly(sql) {
  const text = String(sql || '').trim().replace(/;\s*$/, '');
  if (!text) throw new Error('Sorgu boş');
  const sk = skeleton(text);
  if (sk.includes(';')) throw new Error('Tek seferde yalnızca bir sorgu çalıştırılabilir (noktalı virgülle ayrılmış birden fazla ifade var)');
  if (!/^\s*\(*\s*(select|with)\b/i.test(sk)) throw new Error('Yalnızca SELECT (ya da WITH ... SELECT) sorguları çalıştırılabilir; bu bağlantı veritabanında değişiklik yapmaz');
  if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(sk)) throw new Error('FOR UPDATE / FOR SHARE kilitleri kullanılamaz; bu bağlantı yalnızca okuma yapar');
  const bad = FORBIDDEN.exec(sk);
  if (bad) throw new Error(`Sorguda değişiklik yapabilecek bir ifade var ("${bad[1].toUpperCase()}"); bu bağlantı yalnızca okuma yapar`);
  return text;
}

const limitOf = (n) => Math.min(Math.max(Number(n) || DEFAULT_ROWS, 1), MAX_ROWS);

function cell(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString().replace('T', ' ').replace(/\.000Z$/, 'Z');
  if (Buffer.isBuffer(v)) return `<ikili ${v.length} bayt>`;
  if (typeof v === 'object') { try { v = JSON.stringify(v); } catch { v = String(v); } }
  const s = String(v).replace(/\r?\n/g, ' ⏎ ').replace(/\|/g, '¦');
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
}

/** Sonuç tablosu: başlık satırı + satırlar ("|" ile), sınır aşıldıysa not */
export function formatRows(columns, rows, limit) {
  const more = rows.length > limit;
  const shown = more ? rows.slice(0, limit) : rows;
  if (!columns.length) return 'Sonuç kolonu yok.';
  const lines = [columns.join(' | '), ...shown.map((r) => columns.map((c, i) => cell(Array.isArray(r) ? r[i] : r[c])).join(' | '))];
  let text = lines.join('\n');
  if (text.length > TEXT_MAX) text = `${text.slice(0, TEXT_MAX)}\n… (çıktı kısaltıldı)`;
  const note = !shown.length ? 'Sonuç yok (0 satır).' : more ? `${shown.length} satır gösterildi; daha fazlası var (limit artırılabilir, en çok ${MAX_ROWS}) ya da sorguyu daraltın.` : `${shown.length} satır.`;
  return `${text}\n\n${note}`;
}

// ---------- sürücüler (testlerde değiştirilebilir) ----------
const drivers = {
  postgres: async () => (await import('pg')).default,
  oracle: async () => (await import('oracledb')).default,
};
export function setDriver(kind, loader) { drivers[kind] = loader; }

/** Bağlantı adresi denetimi: PostgreSQL için postgresql:// adresi, Oracle için host:port/servis ya da (DESCRIPTION=...) */
export function validDbUrl(kind, url) {
  const u = String(url || '').trim();
  if (kind === 'postgres') {
    try {
      const p = new URL(u);
      return /^postgres(ql)?:$/.test(p.protocol) && Boolean(p.hostname) && !p.username && !p.password;
    } catch { return false; }
  }
  if (kind === 'oracle') return /^\(.*\)$/s.test(u) || /^[\w.-]+(:\d+)?\/[\w.$#-]+(:[\w]+)?(\/[\w-]+)?$/.test(u.replace(/^oracle:\/\//i, ''));
  return false;
}

// ---------- PostgreSQL ----------
async function pgRun(cfg, fn) {
  const pg = await drivers.postgres();
  // pg, adres verilince ayrı user/password alanlarını yok sayar: kimlik bilgileri adrese (kodlanarak) yerleştirilir.
  // Bu adres yalnızca bellekte kalır, hiçbir yere yazılmaz.
  const url = new URL(cfg.url);
  url.username = cfg.email || '';
  url.password = cfg.token || '';
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15_000, statement_timeout: QUERY_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS + 5_000, application_name: 'atolye' });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`PostgreSQL'e bağlanılamadı: ${err.code === '28P01' ? 'kullanıcı adı ya da parola hatalı' : err.message}`);
  }
  try {
    await client.query('BEGIN READ ONLY');
    try { return await fn(client); } finally { await client.query('ROLLBACK').catch(() => {}); }
  } finally {
    await client.end().catch(() => {});
  }
}

export const postgres = {
  async whoami(cfg) {
    return pgRun(cfg, async (c) => {
      const r = await c.query("select current_user as u, current_database() as d, split_part(version(), ' on ', 1) as v");
      return `${r.rows[0].u} @ ${r.rows[0].d} (${r.rows[0].v})`;
    });
  },
  async query(cfg, { sql, limit }) {
    const text = checkReadOnly(sql);
    const n = limitOf(limit);
    return pgRun(cfg, async (c) => {
      const r = await c.query({ text: `select * from (${text}) as atolye_sorgu limit ${n + 1}`, rowMode: 'array' });
      return formatRows(r.fields.map((f) => f.name), r.rows, n);
    });
  },
  async listTables(cfg, { schema, name, limit } = {}) {
    const n = limitOf(limit || 200);
    return pgRun(cfg, async (c) => {
      const r = await c.query({
        text: `select table_schema, table_name, case table_type when 'VIEW' then 'görünüm' else 'tablo' end as tur
               from information_schema.tables
               where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg_toast%'
                 and ($1::text is null or table_schema ilike $1) and ($2::text is null or table_name ilike $2)
               order by table_schema, table_name limit ${n + 1}`,
        values: [schema || null, name ? `%${name}%` : null],
        rowMode: 'array',
      });
      return formatRows(['şema', 'ad', 'tür'], r.rows, n);
    });
  },
  async describeTable(cfg, { table, schema }) {
    return pgRun(cfg, async (c) => {
      const r = await c.query({
        text: `select c.table_schema, c.column_name, c.data_type || coalesce('(' || c.character_maximum_length || ')', '') as tur,
                      case c.is_nullable when 'YES' then 'boş olabilir' else 'zorunlu' end as bos,
                      col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position) as aciklama
               from information_schema.columns c
               where c.table_name ilike $1 and ($2::text is null or c.table_schema ilike $2)
               order by c.table_schema, c.ordinal_position`,
        values: [table, schema || null],
        rowMode: 'array',
      });
      if (!r.rows.length) return `Tablo bulunamadı: ${schema ? `${schema}.` : ''}${table}. postgres_list_tables ile adları arayın.`;
      return formatRows(['şema', 'kolon', 'tür', 'boş', 'açıklama'], r.rows, MAX_ROWS);
    });
  },
};

// ---------- Oracle ----------
/**
 * Oracle istemci kitaplıklarının (Oracle Client / Instant Client) klasörü ya da null. Sırayla: ORACLE_CLIENT_LIB_DIR
 * (elle gösterilen klasör), ORACLE_HOME ve PATH (Linux'ta LD_LIBRARY_PATH) içindeki klasörler.
 */
export function findOracleClient(env = process.env, exists = fs.existsSync, platform = process.platform) {
  const win = platform === 'win32';
  const lib = win ? 'oci.dll' : platform === 'darwin' ? 'libclntsh.dylib' : 'libclntsh.so';
  const sep = win ? ';' : ':';
  const dirs = [env.ORACLE_CLIENT_LIB_DIR, env.ORACLE_HOME && path.join(env.ORACLE_HOME, win ? 'bin' : 'lib'),
    ...String((win ? env.PATH || env.Path : env.LD_LIBRARY_PATH) || '').split(sep)];
  for (const raw of dirs) {
    const dir = String(raw || '').trim().replace(/^"+|"+$/g, '');
    if (dir && exists(path.join(dir, lib))) return dir;
  }
  return null;
}

// Sürücünün kipi süreç başına bir kez, ilk bağlantıdan ÖNCE belirlenir (sonradan değiştirilemez)
let oracleMode = null;
/** Testler için: kip seçimini sıfırlar */
export function resetOracleMode() { oracleMode = null; }
async function oracleDriver(env = process.env) {
  const oracledb = await drivers.oracle();
  if (oracleMode) return oracledb;
  oracleMode = 'thin';
  const dir = env.ORACLE_THIN === '1' || typeof oracledb.initOracleClient !== 'function' ? null : findOracleClient(env);
  if (dir) {
    try {
      oracledb.initOracleClient({ libDir: dir });
      oracleMode = 'thick';
    } catch (err) {
      // Kitaplık yüklenemedi (ör. 32 bit istemci): istemcisiz kiple sürdürülür
      console.error(`[oracle] istemci kitaplığı kullanılamadı (${dir}): ${String(err.message || err).split('\n')[0]}`);
    }
  }
  return oracledb;
}

const ORACLE_CLIENT_HINT = 'Bilgisayarda 64 bit Oracle istemcisi (Oracle Client ya da Instant Client) varsa Atölye onu kendiliğinden kullanır: '
  + 'klasörü PATH\'te değilse Atölye klasöründeki .env dosyasına ORACLE_CLIENT_LIB_DIR=<oci.dll\'in bulunduğu klasör> satırını ekleyip Atölye\'yi yeniden başlatın.';
/** Bağlantı hatasının anlaşılır açıklaması */
export function oracleConnectError(message, mode = 'thin') {
  const m = String(message || '').split('\n')[0];
  if (/ORA-01017/.test(m)) return 'kullanıcı adı ya da parola hatalı';
  if (/NJS-116/.test(m)) {
    return 'bu veritabanı kullanıcısının parolası eski (10G) biçimde saklanıyor; Atölye\'nin Oracle istemcisi gerektirmeyen bağlantısı bu biçimi desteklemiyor (NJS-116). '
      + 'Parola doğru olsa da bağlanılamaz. İki çözüm var: (1) veritabanı yöneticisinden bu kullanıcının parolasını yeniden tanımlamasını isteyin (aynı parola olabilir; '
      + `yeni biçim o zaman oluşur) ya da parolası yeni biçimde olan başka bir kullanıcı kullanın. (2) ${ORACLE_CLIENT_HINT}`;
  }
  if (/NJS-138|NJS-112/.test(m)) return `${m} — veritabanı sürümü Oracle istemcisi gerektirmeyen bağlantıyı desteklemiyor (Oracle 12.1 ve üstü gerekir). ${ORACLE_CLIENT_HINT}`;
  if (/ORA-28040|ORA-03134/.test(m)) return `${m} — bilgisayardaki Oracle istemcisi ile veritabanı sürümü uyuşmuyor (istemci çok eski ya da çok yeni olabilir)`;
  return mode === 'thick' ? `${m} (Oracle istemcisiyle bağlanıldı)` : m;
}

const SYSTEM_OWNERS = "'SYS','SYSTEM','XDB','MDSYS','CTXSYS','ORDSYS','ORDDATA','OLAPSYS','WMSYS','EXFSYS','DBSNMP','APPQOSSYS','OUTLN','LBACSYS','DVSYS','GSMADMIN_INTERNAL','AUDSYS','OJVMSYS','DVF','GSMCATUSER','SYSBACKUP','SYSDG','SYSKM','SYSRAC','REMOTE_SCHEDULER_AGENT','DBSFWUSER','ORACLE_OCM','SI_INFORMTN_SCHEMA','ORDPLUGINS','MDDATA','APEX_PUBLIC_USER','FLOWS_FILES','ANONYMOUS','XS$NULL'";

async function oraRun(cfg, fn) {
  const oracledb = await oracleDriver();
  oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB].filter(Boolean);
  let conn;
  try {
    conn = await oracledb.getConnection({ user: cfg.email, password: cfg.token, connectString: cfg.url.replace(/^oracle:\/\//i, ''), connectTimeout: 15 });
  } catch (err) {
    throw new Error(`Oracle'a bağlanılamadı: ${oracleConnectError(err.message || err, oracleMode)}`);
  }
  try {
    try { conn.callTimeout = QUERY_TIMEOUT_MS; } catch { /* Oracle istemcisi 18'den eskiyse süre sınırı ayarlanamaz */ }
    await conn.execute('SET TRANSACTION READ ONLY');
    try { return await fn(conn, oracledb); } finally { await conn.rollback().catch(() => {}); }
  } finally {
    await conn.close().catch(() => {});
  }
}

const oraRows = (r) => ({ columns: (r.metaData || []).map((m) => m.name), rows: r.rows || [] });

export const oracle = {
  async whoami(cfg) {
    return oraRun(cfg, async (c, db) => {
      const r = await c.execute("select user, sys_context('USERENV', 'DB_NAME') from dual", [], { outFormat: db.OUT_FORMAT_ARRAY });
      return `${r.rows[0][0]} @ ${r.rows[0][1]}${c.oracleServerVersionString ? ` (Oracle ${c.oracleServerVersionString})` : ''}${oracleMode === 'thick' ? ' · Oracle istemcisiyle' : ''}`;
    });
  },
  async query(cfg, { sql, limit }) {
    const text = checkReadOnly(sql);
    const n = limitOf(limit);
    return oraRun(cfg, async (c, db) => {
      const r = await c.execute(text, [], { outFormat: db.OUT_FORMAT_ARRAY, maxRows: n + 1 });
      const { columns, rows } = oraRows(r);
      return formatRows(columns, rows, n);
    });
  },
  async listTables(cfg, { schema, name, limit } = {}) {
    const n = limitOf(limit || 200);
    return oraRun(cfg, async (c, db) => {
      const r = await c.execute(
        `select owner, object_name, decode(object_type, 'VIEW', 'görünüm', 'tablo') from all_objects
         where object_type in ('TABLE', 'VIEW') and owner not in (${SYSTEM_OWNERS})
           and (:sema is null or owner = upper(:sema)) and (:ad is null or object_name like '%' || upper(:ad) || '%')
         order by owner, object_name`,
        { sema: schema || null, ad: name || null },
        { outFormat: db.OUT_FORMAT_ARRAY, maxRows: n + 1 },
      );
      return formatRows(['şema', 'ad', 'tür'], r.rows || [], n);
    });
  },
  async describeTable(cfg, { table, schema }) {
    return oraRun(cfg, async (c, db) => {
      const r = await c.execute(
        `select t.owner, t.column_name,
                t.data_type || case when t.data_type in ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW') then '(' || t.data_length || ')'
                                    when t.data_type = 'NUMBER' and t.data_precision is not null then '(' || t.data_precision || nvl2(t.data_scale, ',' || t.data_scale, '') || ')' end,
                decode(t.nullable, 'Y', 'boş olabilir', 'zorunlu'), m.comments
         from all_tab_columns t
         left join all_col_comments m on m.owner = t.owner and m.table_name = t.table_name and m.column_name = t.column_name
         where t.table_name = upper(:tablo) and (:sema is null or t.owner = upper(:sema))
         order by t.owner, t.column_id`,
        { tablo: table, sema: schema || null },
        { outFormat: db.OUT_FORMAT_ARRAY, maxRows: MAX_ROWS },
      );
      if (!(r.rows || []).length) return `Tablo bulunamadı: ${schema ? `${schema}.` : ''}${table}. oracle_list_tables ile adları arayın.`;
      return formatRows(['şema', 'kolon', 'tür', 'boş', 'açıklama'], r.rows, MAX_ROWS);
    });
  },
};
