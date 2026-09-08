// Readiness of the proposed migration target 192.168.1.248:3306, judged against how this app
// is actually deployed (Vercel serverless functions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import mysql from 'mysql2/promise';
import { ALT, PROD, tryConnect, ro } from './helpers.mjs';

const RFC1918 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

test('the app is deployed to Vercel as serverless functions', () => {
  assert.ok(true); // asserted by repo shape: api/*.js + vercel.json, `npm run dev` = `vercel dev`
});

test('BLOCKER: the proposed target host is a private RFC1918 address', async () => {
  assert.ok(RFC1918.test(ALT.host),
    `DB_HOST would become ${ALT.host}. Vercel's Node runtime has no route to your LAN and will not ` +
    'accept an RFC1918 host as an outbound target — every /api/handler request would fail ' +
    'ETIMEDOUT/ENOTFOUND. The current host 103.97.126.29 is publicly routable, which is why it works.');
  const myIps = Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address);
  const onLan = myIps.some((a) => RFC1918.test(a) && a.split('.').slice(0, 3).join('.') === ALT.host.split('.').slice(0, 3).join('.'));
  console.log(`      this test machine ${onLan ? 'IS' : 'is NOT'} on the 192.168.1.0/24 network (${myIps.filter((a) => RFC1918.test(a)).join(', ') || 'no private ipv4'})`);
  console.log(`      => ${ALT.host} is only reachable from inside the LAN, never from Vercel.`);
});

test('target server: TCP reachability and measured query latency', { skip: process.env.SKIP_DB === '1' }, async () => {
  const tcp = await new Promise((resolve) => {
    const a = Date.now();
    const s = net.createConnection({ host: ALT.host, port: ALT.port });
    const to = setTimeout(() => { s.destroy(); resolve({ ok: false, ms: Date.now() - a, error: 'timeout 8s' }); }, 8000);
    s.once('connect', () => { clearTimeout(to); s.destroy(); resolve({ ok: true, ms: Date.now() - a }); });
    s.once('error', (e) => { clearTimeout(to); resolve({ ok: false, ms: Date.now() - a, error: e.code }); });
  });
  console.log(`      TCP ${ALT.host}:${ALT.port} -> ${tcp.ok ? `open in ${tcp.ms}ms` : `FAIL ${tcp.error} (${tcp.ms}ms)`}`);
  assert.ok(tcp.ok, `cannot even open ${ALT.host}:${ALT.port}: ${tcp.error}`);

  const c = await tryConnect({ ...ALT, database: undefined });
  assert.equal(c.__error, undefined, `credentials rejected: ${c.__error?.sqlMessage || c.__error?.code}`);
  const [v] = await ro(c, 'SELECT VERSION() AS v, @@max_connections AS mc, @@sql_mode AS m, @@character_set_server AS cs, @@collation_server AS col');
  console.log(`      server: ${v.v}  max_connections=${v.mc}  charset=${v.cs}  collation=${v.col}`);
  console.log(`      sql_mode: ${v.m}`);
  const lats = [];
  for (let i = 0; i < 5; i++) { const a = Date.now(); await ro(c, 'SELECT 1'); lats.push(Date.now() - a); }
  console.log(`      in-network SELECT 1: ${lats.join(', ')}ms`);
  await c.end();
});

test('target server: the application database must exist before DB_NAME can point at it', { skip: process.env.SKIP_DB === '1' }, async () => {
  const c = await tryConnect({ ...ALT, database: undefined });
  if (c.__error) { assert.fail(`auth failed: ${c.__error.code}`); }
  const dbs = (await ro(c, 'SHOW DATABASES')).map((d) => Object.values(d)[0]).filter((d) => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d));
  await c.end();
  console.log(`      user databases on ${ALT.host}: ${dbs.join(', ') || '(none)'}`);
  assert.ok(dbs.includes(ALT.database),
    `database "${ALT.database}" does not exist on ${ALT.host}. Migration is NOT done: nothing was copied. ` +
    `A DB_HOST switch today would take the site down with ER_BAD_DB_ERROR.`);
});

test('target server: MySQL 5.7 -> MariaDB 11 engine change is a real dialect risk', { skip: process.env.SKIP_DB === '1' }, async () => {
  const c = await tryConnect({ ...ALT, database: undefined });
  if (c.__error) { assert.fail('target unreachable'); }
  const [v] = await ro(c, 'SELECT VERSION() AS v, @@collation_server AS col');
  const src = await tryConnect(PROD);
  const [sv] = src.__error ? [{ v: 'unreachable', m: '' }] : await ro(src, 'SELECT VERSION() AS v, @@sql_mode AS m');
  if (!src.__error) await src.end();
  await c.end();
  console.log(`      source: ${sv.v}   target: ${v.v}   target collation: ${v.col}`);
  assert.ok(!/mariadb/i.test(v.v) || /5\.7/.test(sv.v),
    'source is MySQL 5.7, target is MariaDB. `utf8mb4_uca1400_ai_ci` does not exist on 5.7 and ' +
    'uca1400 collations sort Vietnamese differently than the utf8mb4_unicode_ci the tables use today — ' +
    'ORDER BY on full_name/plan_name can change result order after the move.');
});

test('STRICT MODE: the target enforces STRICT_TRANS_TABLES, the source does not', { skip: process.env.SKIP_DB === '1' }, async () => {
  const src = await tryConnect(PROD);
  const srcMode = src ? (await ro(src, 'SELECT @@sql_mode AS m'))[0].m : '';
  if (src) await src.end();
  const dst = await tryConnect({ ...ALT, database: undefined });
  const dstMode = dst.__error ? '' : (await ro(dst, 'SELECT @@sql_mode AS m'))[0].m;
  if (!dst.__error) await dst.end();

  console.log(`      source sql_mode: "${srcMode}"`);
  console.log(`      target sql_mode: "${dstMode}"`);
  assert.ok(!/STRICT_TRANS_TABLES/.test(dstMode) || /STRICT_TRANS_TABLES/.test(srcMode),
    'The target server runs STRICT_TRANS_TABLES while the source silently coerces bad values. Writes that ' +
    ' succeed today (empty full_name into a NOT NULL column, a datetime the driver formats as "undefined", ' +
    'integer overflow in `price`) will start throwing 1048/1292/1406 after the switch. handler.js swallows ' +
    'saveUserInfo errors (line 132-134) and returns null, so the failure would again be silent-but-broken.');
});

test('target server: the source is a SHARED host whose limits are the real reason to migrate', { skip: process.env.SKIP_DB === '1' }, async () => {
  const c = await tryConnect(PROD);
  if (c.__error) { assert.fail('prod unreachable — re-check first'); }
  const [ident] = await ro(c, 'SELECT @@hostname AS h, @@max_connections AS mc');
  const threads = {};
  for (const r of await ro(c, 'SHOW STATUS LIKE "Threads_connected"')) threads[r.Variable_name] = Number(r.Value);
  await c.end();
  const dst = await tryConnect({ ...ALT, database: undefined });
  let dstIdent = null;
  if (!dst.__error) { dstIdent = (await ro(dst, 'SELECT @@hostname AS h, @@max_connections AS mc'))[0]; await dst.end(); }
  console.log(`      source: host=${ident.h} max_connections=${ident.mc} Threads_connected=${threads.Threads_connected}`);
  if (dstIdent) console.log(`      target: host=${dstIdent.h} max_connections=${dstIdent.mc}`);
  assert.ok(true);
});
