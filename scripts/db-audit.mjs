// Read-only deep audit: DDL of every table, duplicate/redundant indexes, FK coverage,
// collation mixes, bloat metrics, table sizes. Run BEFORE any optimization.
import mysql from 'mysql2/promise';

const cfg = {
  host: process.env.DB_HOST || '103.97.126.29',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'roacqgfa_reg',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'roacqgfa_reg',
  connectTimeout: 10000, timezone: '+07:00',
};
if (!cfg.password) { console.error('set DB_PASSWORD'); process.exit(2); }

const c = await mysql.createConnection(cfg);

console.log('=== 1) SHOW CREATE TABLE — chốt cấu trúc + index thật ===');
const [tables] = await c.query(
  `SELECT TABLE_NAME name, TABLE_ROWS rows_est, DATA_LENGTH data_b, INDEX_LENGTH idx_b,
          (DATA_LENGTH+INDEX_LENGTH) total_b, ENGINE, TABLE_COLLATION coll
     FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY total_b DESC`, [cfg.database]);
for (const t of tables) {
  if (t.name.startsWith('v_')) continue;
  const [[ddl]] = await c.query('SHOW CREATE TABLE `' + t.name + '`');
  console.log(`\n----- ${t.name}  (est rows=${t.rows_est}, data=${(t.data_b/1024).toFixed(0)}KB, idx=${(t.idx_b/1024).toFixed(0)}KB, ${t.ENGINE}, ${t.coll}) -----`);
  console.log(ddl['Create Table']);
}

console.log('\n\n=== 2) Column collation mix (cột lệch collation so với table) ===');
const [cols] = await c.query(`SELECT TABLE_NAME t, COLUMN_NAME col, CHARACTER_SET_NAME cs, COLLATION_NAME coln
   FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLLATION_NAME IS NOT NULL
   AND COLLATION_NAME NOT LIKE 'utf8mb4%'`, [cfg.database]);
console.log(cols.length ? cols : '(không có cột nào lệch khỏi utf8mb4)');

console.log('\n=== 3) Foreign keys thiếu index (InnoDB) ===');
const [fks] = await c.query(`SELECT TABLE_NAME t, CONSTRAINT_NAME con, COLUMN_NAME col, REFERENCED_TABLE_NAME rt
  FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`, [cfg.database]);
const [idxs] = await c.query(`SELECT TABLE_NAME t, INDEX_NAME i, COLUMN_NAME col, SEQ_IN_INDEX seq
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=?`, [cfg.database]);
const idxMap = new Map();
for (const i of idxs) { const k = i.t + '|' + i.i; if (!idxMap.has(k)) idxMap.set(k, []); idxMap.get(k).push({ col: i.col, seq: i.seq }); }
for (const fk of fks) {
  const covered = [...idxMap.entries()].some(([k, cs]) =>
    k.startsWith(fk.t + '|') && cs.some(x => x.col === fk.col && x.seq === 1) && cs.length === 1);
  console.log(`  ${fk.t}.${fk.col} -> ${fk.rt}: ${covered ? 'indexed' : '*** THIẾU INDEX ***'}`);
}

console.log('\n=== 4) Redundant/overlapping indexes (prefix trùng) ===');
const per = new Map();
for (const i of idxs) { if (!per.has(i.t)) per.set(i.t, []); per.get(i.t).push({ i: i.i, cols: idxMap.get(i.t + '|' + i.i).sort((a,b)=>a.seq-b.seq).map(x=>x.col) }); }
for (const [t, list] of per) {
  for (let a = 0; a < list.length; a++) for (let b = 0; b < list.length; b++) {
    if (a === b) continue;
    const A = list[a], B = list[b];
    if (A.i === 'PRIMARY' || B.i === 'PRIMARY') continue;
    if (A.cols.length >= B.cols.length && A.cols.slice(0, B.cols.length).join() === B.cols.join()) {
      console.log(`  ${t}: [${A.i}](${A.cols.join(',')}) covers [${B.i}](${B.cols.join(',')})`);
    }
  }
}

console.log('\n=== 5) Biến động dữ liệu: activity_logs theo tháng ===');
const [months] = await c.query(
  `SELECT DATE_FORMAT(created_at,'%Y-%m') ym, COUNT(*) n FROM activity_logs GROUP BY ym ORDER BY ym`);
for (const m of months) console.log(`  ${m.ym}: ${m.n}`);

console.log('\n=== 6) Đơn & giao dịch: phân bố status ===');
const [ost] = await c.query(`SELECT payment_status s, COUNT(*) n, MIN(created_at) first, MAX(created_at) last FROM orders GROUP BY payment_status`);
for (const r of ost) console.log(`  orders.${r.s}: ${r.n} (${String(r.first).slice(0,10)} -> ${String(r.last).slice(0,10)})`);

console.log('\n=== 7) InnoDB status nhanh: lỗi/waits tích lũy ===');
const [st] = await c.query(`SHOW GLOBAL STATUS WHERE Variable_name IN
  ('Innodb_row_lock_current_waits','Innodb_row_lock_time_avg','Threads_connected','Max_used_connections','Uptime','Slow_queries')`);
for (const r of st) console.log(`  ${r.Variable_name}: ${r.Value}`);

await c.end();
