// Shared helpers for the test-suite: load DB config from env (never from source), memoised
// schema, tiny SQL guard.
//
// Required env vars (see env.test.example): DB_HOST, DB_USER, DB_PASSWORD, DB_NAME for the
// current production database; ALT_DB_HOST/ALT_DB_USER/ALT_DB_PASSWORD/ALT_DB_NAME for the
// proposed migration target. Tests fail with a clear message when a needed var is missing.
import mysql from 'mysql2/promise';

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name} — see env.test.example (run: npm run test:db)`);
  return v;
}

// Configs resolve lazily so files that merely import helpers (e.g. offline suites needing only
// REPO) never crash; the DB suites call requireProd()/tryConnect() only when they actually run.
export const PROD = () => ({
  host: need('DB_HOST'), port: Number(process.env.DB_PORT || 3306),
  user: need('DB_USER'), password: need('DB_PASSWORD'), database: need('DB_NAME'),
});

export const ALT = () => ({
  host: process.env.ALT_DB_HOST || '192.168.1.248',
  port: Number(process.env.ALT_DB_PORT || 3306),
  user: process.env.ALT_DB_USER || '',
  password: process.env.ALT_DB_PASSWORD || '',
  database: process.env.ALT_DB_NAME || 'roacqgfa_reg',
});

export const REPO = new URL('..', import.meta.url).pathname;

/** Open a connection, or return null if the server is unreachable (test should skip). */
export async function tryConnect(cfg, extra = {}) {
  try {
    return await mysql.createConnection({ ...cfg, connectTimeout: 8000, timezone: '+07:00', ...extra });
  } catch (e) {
    return { __error: e };
  }
}

export function openPool(cfg, extra = {}) {
  return mysql.createPool({ ...cfg, waitForConnections: true, queueLimit: 0, timezone: '+07:00', connectionLimit: 5, connectTimeout: 8000, ...extra });
}

const READ_ONLY = /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i;
/** Run a read-only query; throws if the SQL is not a read statement. prod-safe by construction. */
export async function ro(conn, sql, args) {
  if (!READ_ONLY.test(sql)) throw new Error(`refusing to run non-read-only SQL: ${sql.slice(0, 60)}`);
  const [rows] = await conn.query(sql, args);
  return rows;
}

let schemaCache;
/** Live schema snapshot of the production database (memoised across test files in one process). */
export async function prodSchema() {
  if (schemaCache) return schemaCache;
  const conn = await tryConnect(PROD);
  if (conn.__error) throw conn.__error;
  const tables = await ro(conn, 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [PROD.database]);
  const columns = await ro(conn, 'SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS typ FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [PROD.database]);
  const indexes = await ro(conn, 'SELECT TABLE_NAME AS tbl, INDEX_NAME AS iname, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?', [PROD.database]);
  const routines = await ro(conn, 'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?', [PROD.database]);
  const vars = (await ro(conn, 'SELECT @@max_connections AS max_connections, @@sql_mode AS sql_mode, @@character_set_server AS charset, @@collation_server AS collation, @@wait_timeout AS wait_timeout'))[0];
  const status = {};
  for (const r of await ro(conn, 'SHOW STATUS LIKE "Threads%"')) status[r.Variable_name] = Number(r.Value);
  await conn.end();
  schemaCache = { tables, columns, indexes, routines, vars, status };
  return schemaCache;
}

export function tableIndex(s, t) {
  return s.indexes.filter((i) => i.tbl === t).reduce((m, i) => { (m[i.iname] ||= []).push(i.col); return m; }, {});
}
export function columnsOf(s, t) {
  return new Set(s.columns.filter((c) => c.tbl === t).map((c) => c.col));
}
export function hasTable(s, t) {
  return s.tables.some((x) => x.name === t);
}
export function hasIndexOver(s, t, cols) {
  const idx = tableIndex(s, t);
  return Object.values(idx).some((cs) => cols.every((c, i) => cs[i] === c));
}
