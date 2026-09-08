// Live contract between the SQL the handlers emit and the actual production schema.
// READ-ONLY: every query goes through ro() which rejects non-SELECT/SHOW/EXPLAIN.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prodSchema, tryConnect, ro, hasTable, columnsOf, hasIndexOver, REPO, PROD } from './helpers.mjs';

// The exact tables the handlers reference (verified by grep over api/*.js).
const REQUIRED_TABLES = ['users', 'admins', 'vip_plans', 'vip_subscriptions', 'orders', 'transactions', 'activity_logs', 'shared_class_data', 'shared_data_stats', 'class_data_contributions'];
const REQUIRED_VIEWS = ['v_revenue_by_day'];

// Columns the login path reads/writes. If one of these disappears, saveUserInfo silently
// returns null (its catch swallows the error) and the user gets a broken session.
const LOGIN_CRITICAL_COLUMNS = {
  users: ['id', 'user_id', 'email', 'full_name', 'created_at', 'updated_at'],
  vip_subscriptions: ['id', 'user_id', 'plan_id', 'plan_type', 'expiry_date'],
  activity_logs: ['user_id', 'action', 'details', 'ip_address', 'user_agent', 'created_at'],
  vip_plans: ['id', 'plan_key', 'plan_name', 'duration_days', 'price', 'is_active', 'sort_order'],
};

let schema, conn;
before({ skip: process.env.SKIP_DB === '1' }, async () => {
  conn = await tryConnect(PROD());
  if (conn.__error) {
    throw new Error(`cannot reach ${PROD().user}@${PROD().host}: ${conn.__error.code} ${conn.__error.message}`);
  }
  schema = await prodSchema();
});
after(async () => { await conn?.end().catch(() => {}); });

test('all tables and views the code references exist', async () => {
  if (!schema) return;
  const missing = REQUIRED_TABLES.filter((t) => !hasTable(schema, t));
  assert.deepEqual(missing, [], `code queries tables that do not exist: ${missing.join(', ')}`);
  const missingViews = REQUIRED_VIEWS.filter((v) => !hasTable(schema, v));
  assert.deepEqual(missingViews, [], `admin dashboard reads missing views: ${missingViews.join(', ')}`);
});

test('login-critical columns all exist', async () => {
  if (!schema) return;
  const problems = [];
  for (const [tbl, cols] of Object.entries(LOGIN_CRITICAL_COLUMNS)) {
    if (!hasTable(schema, tbl)) { problems.push(`${tbl}: table absent`); continue; }
    const have = columnsOf(schema, tbl);
    for (const c of cols) if (!have.has(c)) problems.push(`${tbl}.${c}`);
  }
  assert.deepEqual(problems, [], `login path will throw (and silently swallow it): ${problems.join(', ')}`);
});

test('users.user_id is UNIQUE — saveUserInfo does a SELECT-then-INSERT with no lock', async () => {
  if (!schema) return;
  const uniq = schema.indexes.filter((i) => i.tbl === 'users' && i.col === 'user_id');
  assert.ok(uniq.length, 'users.user_id has no index at all: every login does a full table scan');
  const name = uniq[0].iname;
  const cols = schema.indexes.filter((i) => i.tbl === 'users' && i.iname === name).sort((a, b) => a.seq - b.seq).map((i) => i.col);
  assert.deepEqual(cols, ['user_id'], `users.user_id index must be single-column, got (${cols.join(',')})`);
  // NON_UNIQUE is not in STATISTICS projection above; re-read it.
  const [rows] = await conn.query('SELECT NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', [PROD().database, 'users', name]);
  assert.equal(rows[0].NON_UNIQUE, 0, 'users.user_id is NOT unique -> two concurrent logins by the same student INSERT twice and the FK/subsequent lookups break');
});

test('activity_logs is indexed for the per-login INSERT and the admin listing query', async () => {
  if (!schema) return;
  assert.ok(hasIndexOver(schema, 'activity_logs', ['user_id', 'created_at']) || hasIndexOver(schema, 'activity_logs', ['user_id']),
    'activity_logs needs a (user_id, ...) index for getUserActivity()');
  assert.ok(hasIndexOver(schema, 'activity_logs', ['created_at']), 'activity_logs needs a created_at index for getAllLogs() ORDER BY created_at DESC');
});

test('orders lookup used by the order sweep is index-backed, not a full scan', async () => {
  if (!schema) return;
  assert.ok(hasIndexOver(schema, 'orders', ['payment_status']), 'orders needs a payment_status index for the order sweep');
  // Prove it with the real planner, not just the catalog.
  const plan = await ro(conn, 'EXPLAIN SELECT id, user_id FROM orders WHERE payment_status = "Unpaid" AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15');
  for (const p of plan) {
    assert.notEqual(p.type, 'ALL', `auto-cancel SELECT does a full table scan (type=ALL, rows=${p.rows})`);
    assert.ok(p.key, `auto-cancel SELECT uses no index: ${JSON.stringify(p)}`);
  }
});

test('the stored procedure autoCancelExpiredOrders calls first actually exists', async () => {
  if (!schema) return;
  const names = schema.routines.map((r) => r.name);
  assert.ok(names.includes('sp_auto_cancel_unpaid_orders'),
    `missing sp_auto_cancel_unpaid_orders (found: ${names.join(', ') || 'none'}). Without it every request pays an extra failed-CALL round trip before falling back to SQL.`);
});

test('server charset can store Vietnamese without mojibake', async () => {
  if (!schema) return;
  const r = await ro(conn, `SELECT 'Đăng Ký Học Phần — Nguyễn Sun Sin' AS s, LENGTH('Đăng') AS byte_len, CHAR_LENGTH('Đăng') AS char_len`);
  assert.equal(r[0].char_len, 4, 'CHAR_LENGTH wrong');
  assert.ok(r[0].byte_len > 4, `utf8mb4 multibyte expected, got byte_len=${r[0].byte_len} -> connection is not utf8mb4`);
  assert.equal(r[0].s, 'Đăng Ký Học Phần — Nguyễn Sun Sin', 'round-trip corrupted Vietnamese text');
  // character_set_server is latin1 on the shared host; mysql2 defaults its connection charset to
  // utf8, so verify explicitly that a table column survives it too.
  const tbl = await ro(conn, `SELECT CCSA.character_set_name AS cs FROM information_schema.TABLES T JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY CCSA ON T.TABLE_COLLATION = CCSA.COLLATION_NAME WHERE T.TABLE_SCHEMA = ? AND T.TABLE_NAME = 'users'`, [PROD().database]);
  assert.equal(tbl[0].cs, 'utf8mb4', `users table is not utf8mb4 (${tbl[0].cs}) — Vietnamese full_name will truncate/corrupt`);
});

test('sql_mode permits the double-quoted string literals the handlers emit', async () => {
  if (!schema) return;
  assert.doesNotMatch(schema.vars.sql_mode, /ANSI_QUOTES/,
    'sql_mode has ANSI_QUOTES -> `payment_status = "Unpaid"` is parsed as a COLUMN reference and throws ER_BAD_FIELD_ERROR');
  // Empirically: run the exact predicate the code uses.
  const r = await ro(conn, 'SELECT COUNT(*) AS n FROM orders WHERE payment_status = "Unpaid"');
  assert.ok(Number.isFinite(Number(r[0].n)), 'double-quoted literal predicate failed');
});

test('SQL in the handlers is parameterised — no request-controlled string interpolation', async () => {
  if (!schema) return;
  const offenders = [];
  for (const f of ['api/handler.js', 'api/admin-handler.js', 'api/sepay-webhook.js']) {
    const s = readFileSync(REPO + f, 'utf8').split('\n');
    let inSql = false;
    s.forEach((l, i) => {
      if (/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(l)) inSql = true;
      if (inSql && /\$\{/.test(l) && !/map\([^)]*=>\s*'\?'/.test(l)) offenders.push(`${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
      if (/['"`]\s*[;,)]?\s*$/.test(l) === false && inSql && /;/.test(l)) inSql = false;
      if (inSql && /^\s*(?:\)|`|\}|\])/.test(l)) inSql = false;
    });
  }
  assert.deepEqual(offenders, [], `interpolation inside SQL text (potential injection): \n  ${offenders.join('\n  ')}`);
});

test('max_connections leaves headroom for the pools the app opens', async () => {
  if (!schema) return;
  const perLambda = 5 + 3 + 3; // handler.js + admin-handler.js + sepay-webhook.js connectionLimit (env-tunable)
  const used = schema.status.Threads_connected;
  assert.ok(schema.vars.max_connections >= perLambda * 4,
    `max_connections=${schema.vars.max_connections} but the three handlers declare up to ${perLambda} sockets EACH per warm instance. ` +
    `A burst of concurrent logins can exhaust the SHARED server (currently ${used} connections in use by all tenants). ` +
    `Lower connectionLimit and/or add a connection pooler (ProxySQL / RDS Proxy).`);
});
