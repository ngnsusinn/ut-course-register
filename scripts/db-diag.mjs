// Read-only MySQL diagnostics: latency, config, schema-vs-code, indexes, missing objects.
// Usage: node scripts/db-diag.mjs <label> <host> <port> <user> <password> <database>
import mysql from 'mysql2/promise';

const [label, host, port, user, password, database] = process.argv.slice(2);
const P = (s) => console.log(s);
const t = () => Date.now();

const ms = (n) => `${n}ms`;

async function timed(fn, note = '') {
  const a = t();
  try {
    const r = await fn();
    return { ok: true, ms: t() - a, value: r, note };
  } catch (e) {
    return { ok: false, ms: t() - a, error: `${e.code || e.name}: ${e.sqlMessage || e.message}`, note };
  }
}

async function main() {
  P(`\n${'='.repeat(72)}\nDIAG: ${label}  ->  ${user}@${host}:${port || 3306}/${database}\n${'='.repeat(72)}`);

  // ---- 1. TCP reachability ----
  const net = await import('node:net');
  const tcpStart = t();
  const tcp = await new Promise((resolve) => {
    const s = net.createConnection({ host, port: Number(port) || 3306 });
    const to = setTimeout(() => { s.destroy(); resolve({ ok: false, error: 'TCP connect timeout 8s' }); }, 8000);
    s.once('connect', () => { clearTimeout(to); const d = t() - tcpStart; s.destroy(); resolve({ ok: true, ms: d }); });
    s.once('error', (e) => { clearTimeout(to); resolve({ ok: false, error: `${e.code} ${e.message}` }); });
  });
  P(`[TCP]        ${tcp.ok ? 'reachable' : 'FAIL'}  ${tcp.ok ? ms(tcp.ms) : tcp.error}`);
  if (!tcp.ok) { P('\n>>> host:port không mở được từ máy này — dừng diag.\n'); return; }

  // ---- 2. Handshake + first query (this IS what a cold lambda pays) ----
  const conn = await timed(async () => {
    const c = await mysql.createConnection({
      host, port: Number(port) || 3306, user, password, database,
      connectTimeout: 10000, timezone: '+07:00', multipleStatements: false,
    });
    const one = await timed(() => c.query('SELECT 1 AS ok'));
    return { one };
  });
  P(`[HANDSHAKE]  ${conn.ok ? 'OK' : 'FAIL'}  ${ms(conn.ms)}  ${conn.error || ''}`);
  if (!conn.ok) {
    P(`\n>>> KHÔNG KẾT NỐI ĐƯỢC BẰNG CREDENTIAL NÀY: ${conn.error}`);
    P('>>> Thử phân biệt: sai password vs bị chặn host vs sai db name.\n');
    // Try without database to see if auth works at all
    const noDb = await timed(async () => {
      const c = await mysql.createConnection({ host, port: Number(port) || 3306, user, password, connectTimeout: 10000 });
      const r = await c.query('SELECT DATABASE() AS db, USER() AS usr');
      await c.end();
      return r[0][0];
    });
    P(`[AUTH-ONLY]  ${noDb.ok ? 'OK' : 'FAIL'}  ${ms(noDb.ms)}  ${JSON.stringify(noDb.value || noDb.error)}`);
    return;
  }
  const pool = mysql.createPool({
    host, port: Number(port) || 3306, user, password, database,
    waitForConnections: true, queueLimit: 0, timezone: '+07:00', connectionLimit: 5,
    connectTimeout: 10000,
  });

  const q = async (sql, args) => {
    const r = await timed(async () => { const [rows] = await pool.query(sql, args); return rows; });
    return r;
  };
  const show = async (title, sql, fmt = (v) => JSON.stringify(v)) => {
    const r = await q(sql);
    if (!r.ok) { P(`[${title}]   ERROR ${r.error}`); return null; }
    P(`[${title}]   ${ms(r.ms)}  ${fmt(r.value)}`);
    return r.value;
  };

  // ---- 3. Server identity & latency profile ----
  await show('VERSION', 'SELECT VERSION() AS v, @@hostname AS h');
  const lat = await q('SELECT 1');
  P(`[PING x5]`);
  {
    const samples = [];
    for (let i = 0; i < 5; i++) { const r = await q('SELECT 1'); samples.push(r.ok ? r.ms : `ERR:${r.error}`); }
    P(`             ${samples.join(', ')} ms`);
  }

  // ---- 4. Connection capacity — decisive for a pool-based serverless app ----
  const maxConn = await show('MAX_CONN', 'SELECT @@max_connections AS max_connections, @@wait_timeout AS wait_timeout, @@interactive_timeout AS interactive_timeout, @@max_allowed_packet AS packet');
  const threads = await show('THREADS', 'SELECT VARIABLE_VALUE AS threads_connected FROM performance_status.threads_connected');
  const threads2 = await q('SHOW STATUS LIKE "Threads%"');
  if (threads2.ok) {
    const m = {};
    for (const r of threads2.value) m[r.Variable_name] = r.Value;
    P(`[STATUS]     ${ms(threads2.ms)}  Threads_connected=${m.Threads_connected} Running=${m.Threads_running} Cached=${m.Threads_cached} Rejected=${m.Threads_rejected} Created=${m.Created_threads}`);
  }
  const proc = await q('SELECT COUNT(*) AS n, USER, SUBSTRING_INDEX(HOST,":",-1) AS port FROM information_schema.PROCESSLIST GROUP BY USER, port ORDER BY n DESC');
  if (proc.ok) P(`[PROCLIST]   ${JSON.stringify(proc.value)}`);
  else P(`[PROCLIST]   not permitted (${proc.error})`);

  // ---- 5. Schema: tables present vs required by code ----
  const EXPECTED_TABLES = ['users', 'admins', 'vip_plans', 'vip_subscriptions', 'orders', 'transactions', 'activity_logs', 'class_data'];
  const tbl = await q('SELECT TABLE_NAME AS name, TABLE_ROWS AS rows_approx, DATA_LENGTH AS data_bytes, INDEX_LENGTH AS idx_bytes, ENGINE AS engine, TABLE_COLLATION AS coll FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]);
  const found = new Set();
  if (tbl.ok) {
    P(`[TABLES]     ${ms(tbl.ms)}  ${tbl.value.length} table(s) in ${database}`);
    for (const r of tbl.value) {
      found.add(r.name);
      P(`             - ${r.name.padEnd(22)} rows≈${String(r.rows_approx).padEnd(8)} data=${(r.data_bytes / 1024).toFixed(0)}KB idx=${(r.idx_bytes / 1024).toFixed(0)}KB ${r.engine} ${r.coll}`);
    }
  } else P(`[TABLES]     ERROR ${tbl.error}`);
  const missing = EXPECTED_TABLES.filter((x) => !found.has(x));
  P(missing.length ? `[MISSING]    ${missing.join(', ')}` : '[MISSING]    none of the expected tables missing');

  // ---- 6. Column-level checks for queries the code actually runs ----
  const COLS = {
    users: ['id', 'user_id', 'email', 'full_name', 'is_active', 'created_at', 'updated_at'],
    vip_subscriptions: ['id', 'user_id', 'plan_id', 'plan_type', 'expiry_date'],
    vip_plans: ['id', 'plan_key', 'plan_name', 'duration_days', 'price', 'is_active', 'sort_order', 'description'],
    orders: ['id', 'user_id', 'order_code', 'plan_type', 'amount', 'payment_status', 'created_at', 'updated_at', 'cancelled_at', 'expired_at'],
    activity_logs: ['id', 'user_id', 'action', 'details', 'ip_address', 'user_agent', 'created_at'],
    admins: ['id', 'username', 'password_hash', 'full_name', 'role', 'is_active', 'last_login'],
    class_data: ['id', 'dot_id', 'class_id', 'source', 'data'],
  };
  const cols = await q('SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS typ, IS_NULLABLE AS nul, COLUMN_DEFAULT AS dft, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [database]);
  const colMap = new Map();
  if (cols.ok) for (const c of cols.value) { if (!colMap.has(c.tbl)) colMap.set(c.tbl, new Map()); colMap.get(c.tbl).set(c.col, c); }
  P(`\n[COLUMNS]    missing / suspicious columns the code depends on:`);
  let colIssues = 0;
  for (const [tb, list] of Object.entries(COLS)) {
    if (!found.has(tb)) { P(`             ! ${tb}: table absent`); colIssues++; continue; }
    const have = colMap.get(tb) || new Map();
    const miss = list.filter((c) => !have.has(c));
    if (miss.length) { P(`             ! ${tb}: MISSING ${miss.join(', ')}`); colIssues++; }
  }
  if (colIssues === 0) P('             (none)');

  // ---- 7. Indexes on hot paths ----
  P(`\n[INDEXES]    hot-path index coverage:`);
  const idx = await q('SELECT TABLE_NAME AS tbl, INDEX_NAME AS iname, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col, NON_UNIQUE AS non_uniq FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY tbl, iname, seq', [database]);
  const idxMap = new Map();
  if (idx.ok) for (const r of idx.value) {
    if (!idxMap.has(r.tbl)) idxMap.set(r.tbl, new Map());
    const m = idxMap.get(r.tbl);
    if (!m.has(r.iname)) m.set(r.iname, []);
    m.get(r.iname).push(r.col);
  }
  const HOT = {
    users: [['user_id']],
    vip_subscriptions: [['user_id', 'expiry_date'], ['user_id']],
    orders: [['payment_status', 'created_at'], ['user_id']],
    activity_logs: [['user_id', 'created_at'], ['created_at']],
    admins: [['username']],
    class_data: [['dot_id']],
  };
  for (const [tb, wants] of Object.entries(HOT)) {
    if (!idxMap.has(tb)) continue;
    const indexes = [...idxMap.get(tb).entries()];
    for (const want of wants) {
      const hit = indexes.find(([, cs]) => want.every((w, i) => cs[i] === w));
      P(`             ${hit ? 'OK  ' : 'MISS'} ${tb} (${want.join(',')})${hit ? ` -> ${hit[0]}` : ''}`);
    }
  }

  // ---- 8. EXPLAIN the login-critical & per-request queries ----
  P(`\n[EXPLAIN]    real plans on the queries login/per-request runs:`);
  const probes = [
    ['users lookup (saveUserInfo)', `SELECT id FROM users WHERE user_id = 'X'`],
    ['vip status (checkVIPStatus)', `SELECT id, plan_id, plan_type, expiry_date, TIMESTAMPDIFF(DAY, NOW(), expiry_date) AS days_left FROM vip_subscriptions WHERE user_id = 'X' AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1`],
    ['activity_logs insert (login)', `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) VALUES ('X','USER_LOGIN','d','1.1.1.1','ua',NOW())`],
    ['auto-cancel select (EVERY req)', `SELECT id, user_id FROM orders WHERE payment_status = "Unpaid" AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15`],
    ['auto-cancel update (EVERY req)', `UPDATE orders SET payment_status = "Cancelled", cancelled_at = NOW(), updated_at = NOW() WHERE payment_status = "Unpaid" AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15`],
    ['vip plans (getVIPPlansFromDB)', `SELECT id, plan_key, plan_name, duration_days, price FROM vip_plans WHERE is_active = 1 ORDER BY sort_order ASC`],
  ];
  for (const [name, sql] of probes) {
    const r = await q('EXPLAIN ' + sql);
    if (!r.ok) { P(`             ! ${name}: ${r.error}`); continue; }
    for (const row of r.value) {
      const pct = row.rows === null ? '?' : row.rows;
      P(`             ${name.padEnd(30)} type=${row.type} key=${row.key} rows=${pct} filtered=${row.filtered}% Extra=${row.Extra}`);
    }
  }

  // ---- 9. Stored procedure the code calls first on EVERY request ----
  const sp = await q('SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?', [database, 'sp_auto_cancel_unpaid_orders']);
  if (sp.ok) P(`\n[PROC]       sp_auto_cancel_unpaid_orders: ${sp.value.length ? 'EXISTS' : 'ABSENT -> every request pays 2 round-trips (CALL fails, then fallback)'}`);
  else P(`\n[PROC]       cannot read routines (${sp.error})`);

  // ---- 10. Data state that breaks login ----
  const adminCheck = await q('SELECT id, username, LEFT(password_hash, 12) AS hash_prefix, LENGTH(password_hash) AS hash_len, is_active FROM admins LIMIT 5');
  if (adminCheck.ok) {
    P(`[ADMINS]     ${JSON.stringify(adminCheck.value)}`);
    P(`             ^ hash_len 32/64 = bcrypt/argon (KHÔNG khớp plaintext compare) ; hash_len == độ dài mật khẩu thật = plaintext`);
  } else P(`[ADMINS]     ${adminCheck.error}`);
  const userDup = await q('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? AND SEQ_IN_INDEX = 1', [database, 'users', 'user_id']);
  const uniq = await q('SELECT NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [database, 'users', 'user_id']);
  if (uniq.ok && uniq.value.length) P(`[UNIQUE]     users.user_id NON_UNIQUE=${uniq.value[0].NON_UNIQUE} (0 = unique, required by saveUserInfo SELECT-then-INSERT race)`);
  else P(`[UNIQUE]     users.user_id has NO index at all -> full table scan on every login`);
  const sqlMode = await q("SELECT @@sql_mode AS m, @@character_set_server AS cs, @@collation_server AS col, @@time_zone AS tz, @@system_time_zone AS stz");
  if (sqlMode.ok) {
    const v = sqlMode.value[0];
    P(`[SQL_MODE]   ${v.m}`);
    P(`             ANSI_QUOTES=${/ANSI_QUOTES/.test(v.m) ? 'YES ("Unpaid" = column -> ERROR 1054)' : 'no'}   character_set_server=${v.cs} collation_server=${v.col} tz=${v.tz}/${v.stz}`);
  }

  // ---- 11. Row counts for scale ----
  for (const tb of ['users', 'orders', 'activity_logs', 'vip_subscriptions', 'class_data']) {
    if (!found.has(tb)) continue;
    const r = await q(`SELECT COUNT(*) AS n FROM \`${tb}\``);
    P(`[COUNT]      ${tb}: ${r.ok ? r.value[0].n + ' rows (' + r.ms + 'ms)' : r.error}`);
  }

  await pool.end();
  P(`\n${'='.repeat(72)}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('DIAG CRASH:', e); process.exit(1); });
