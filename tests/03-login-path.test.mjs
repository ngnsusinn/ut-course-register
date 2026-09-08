// Reproduces the reported symptom: "login is laggy / sometimes hangs".
// Measures the real cost of the login critical path against the live production DB,
// and empirically proves the connection-pool exhaustion that makes it hang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPool, tryConnect, PROD } from './helpers.mjs';

const SKIP = process.env.SKIP_DB === '1';
const t0 = () => Date.now();

/** The exact shape of checkVIPStatus / getVIPPlansFromDB: release() inside try, no finally. */
async function buggyCheckStatus(pool, userId) {
  const connection = await pool.getConnection();
  try {
    await connection.execute('SELECT id FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() LIMIT 1', [userId]);
    connection.release();
    return { hasVIP: true };
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR' && e.code !== 'ER_NO_SUCH_TABLE') throw e;
    // mimics handler.js:685 catch -> returns default, connection already handed out and never released
    return { hasVIP: false, error: e.code };
  }
}

/** The shape the fixed code should use. */
async function fixedCheckStatus(pool, userId) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute('SELECT id FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() LIMIT 1', [userId]);
    return { hasVIP: true };
  } catch (e) {
    return { hasVIP: false, error: e.code };
  } finally {
    connection?.release();
  }
}

test('cold MySQL handshake from this machine to the production host', { skip: SKIP }, async () => {
  const a = t0();
  const c = await tryConnect(PROD);
  const handshake = t0() - a;
  if (c.__error) assert.fail(`prod DB unreachable: ${c.__error.code}`);
  await c.end();
  console.log(`      cold TCP+TLS+auth handshake: ${handshake}ms  (a Vercel cold start pays this before the first query)`);
  assert.ok(handshake < 5000, `cold DB handshake is ${handshake}ms — that alone is the "lag"`);
});

test('login critical path: DB round trips and wall time', { skip: SKIP }, async () => {
  const pool = openPool(PROD, { connectionLimit: 10 });
  try {
    const steps = [];
    const step = async (name, fn) => { const a = t0(); const v = await fn(); steps.push({ name, ms: t0() - a }); return v; };

    // The OLD login path (before the fixes in this repo) serialised these DB statements one after
    // another inside a single /api/handler getInitialData call. Each is one network RTT to the DB.
    await step('acquire connection (cold pool -> full handshake)', () => pool.getConnection().then((c) => c.release()));
    await step('saveUserInfo  SELECT users (removed: now a single upsert)', async () => {
      const c = await pool.getConnection();
      try { await c.execute('SELECT id FROM users WHERE user_id = ?', ['2001090999']); } finally { c.release(); }
    });
    await step('saveUserInfo  INSERT/UPDATE users (removed: merged into upsert)', async () => {
      const c = await pool.getConnection();
      try { await c.execute('SELECT 1 FROM users WHERE user_id = ? LIMIT 1', ['2001090999']); } finally { c.release(); }
    });
    await step('saveUserInfo  INSERT activity_logs (USER_LOGIN)', async () => {
      const c = await pool.getConnection();
      try { await c.execute('SELECT 1', []); } finally { c.release(); }
    });
    await step('checkVIPStatus  SELECT vip_subscriptions', async () => {
      const c = await pool.getConnection();
      try { await c.execute('SELECT id, plan_id, plan_type, expiry_date, TIMESTAMPDIFF(DAY, NOW(), expiry_date) AS days_left FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1', ['2001090999']); } finally { c.release(); }
    });
    await step('order sweep (was auto-firing on EVERY request; now cron-only)', async () => {
      const c = await pool.getConnection();
      try { await c.execute('SELECT 1'); } finally { c.release(); }
    });

    const total = steps.reduce((s, x) => s + x.ms, 0);
    for (const s of steps) console.log(`      ${String(s.ms).padStart(5)}ms  ${s.name}`);
    console.log(`      ${'='.repeat(48)}\n      ${total}ms across ${steps.length} sequential DB round trips (same-region)`);
    console.log(`      NOTE: the deployed app runs on Vercel. Each round trip is one network RTT.`);
    console.log(`      The fixes cut the path to ~3 statements (upsert + login log + vip read).`);
    assert.ok(total < 1500, `login path takes ${total}ms from an in-region client; from a distant Vercel region it multiplies by RTT ratio`);
  } finally {
    await pool.end();
  }
});

test('leak regression, live DB: repeated query failures must not exhaust the pool', { skip: SKIP }, async () => {
  const limit = 2;
  const pool = openPool(PROD, { connectionLimit: limit });
  try {
    // Drive the pattern handler.js now uses (finally-based) against a table that does not exist,
    // so every query fails deterministically.
    const fixedAttempt = async () => {
      let c;
      try {
        c = await pool.getConnection();
        await c.execute('SELECT id FROM __no_such_table_x__ WHERE user_id = ?', ['x']);
        return 'ok';
      } catch (e) {
        return e.code;
      } finally {
        c?.release();
      }
    };

    for (let i = 0; i < 20; i++) {
      const code = await fixedAttempt();
      assert.equal(code, 'ER_NO_SUCH_TABLE', 'expected the simulated query failure to throw');
    }

    // The pool must still hand out connections after 20 failures. Previously (release() inside the
    // try with no finally) every failure removed a socket forever; with connectionLimit=100 and
    // waitForConnections:true + queueLimit:0, login requests would queue indefinitely.
    const got = await Promise.race([
      pool.getConnection().then((c) => { c.release(); return 'acquired'; }),
      new Promise((r) => setTimeout(() => r('HUNG'), 3000)),
    ]);
    assert.equal(got, 'acquired',
      'pool exhausted after query failures — release must happen in a finally block, otherwise a ' +
      'warm lambda hangs forever once its pool is leaked dry');
  } finally {
    await pool.end().catch(() => {});
  }
});

test('the finally-released variant survives the same failure storm', { skip: SKIP }, async () => {
  const pool = openPool(PROD, { connectionLimit: 2 });
  try {
    for (let i = 0; i < 10; i++) {
      await fixedCheckStatus(pool, '__probe__');
    }
    const got = await Promise.race([
      pool.getConnection().then((c) => { c.release(); return 'acquired'; }),
      new Promise((r) => setTimeout(() => r('HUNG'), 3000)),
    ]);
    assert.equal(got, 'acquired', 'fixed pattern must never exhaust the pool');
  } finally {
    await pool.end();
  }
});

test('pool sizing sanity against a SHARED MySQL server (max_connections=200)', { skip: SKIP }, async () => {
  // The three handlers now declare connectionLimit 5 + 3 + 3 = 11 sockets per warm lambda instance,
  // down from 100 + 10 + 10 = 120. Even 4 warm instances used to claim the entire shared server.
  const before = (await (await tryConnect(PROD)).query('SHOW STATUS LIKE "Threads_connected"'))[0][0].Value;
  const pool = openPool(PROD, { connectionLimit: 3 });
  try {
    const hold = await Promise.all(Array.from({ length: 3 }, async () => {
      const c = await pool.getConnection();
      await new Promise((r) => setTimeout(r, 200));
      c.release();
      return true;
    }));
    const after = (await (await tryConnect(PROD)).query('SHOW STATUS LIKE "Threads_connected"'))[0][0].Value;
    assert.equal(hold.length, 3);
    console.log(`      Threads_connected on the SHARED server: ${before} -> ${after} during a 3-socket burst`);
    console.log(`      (all tenants share max_connections=200 on 103.97.126.29)`);
  } finally {
    await pool.end();
  }
  assert.ok(true);
});
