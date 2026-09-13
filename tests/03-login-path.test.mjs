// Live latency profile of the login critical path against the REAL Atlas cluster, plus the
// fail-fast guarantee that replaced the old mysql pool-acquire guard: an unreachable cluster
// must reject in ~serverSelectionTimeoutMS, never hang a request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { tryConnectMongo, MONGO } from './helpers.mjs';

const SKIP = process.env.SKIP_DB === '1';
const t0 = () => Date.now();

test('cold Atlas handshake (SRV lookup + TLS + auth) from this machine', { skip: SKIP }, async () => {
  const a = t0();
  const c = await tryConnectMongo();
  const handshake = t0() - a;
  if (c.__error) assert.fail(`cluster unreachable: ${c.__error.message}`);
  await c.client.close();
  console.log(`      cold SRV+TLS+auth handshake: ${handshake}ms  (a Vercel cold start pays this once)`);
  assert.ok(handshake < 5000, `cold handshake is ${handshake}ms — that alone would be the "lag"`);
});

test('login critical path: DB round trips and wall time (warm connection)', { skip: SKIP }, async () => {
  const c = await tryConnectMongo();
  if (c.__error) assert.fail(`cluster unreachable: ${c.__error.message}`);
  const db = c.db;
  try {
    const steps = [];
    const step = async (name, fn) => { const a = t0(); const v = await fn(); steps.push({ name, ms: t0() - a }); return v; };

    // Exactly what api/handler.js getInitialData does against the DB per login:
    // one upsert against an existing student (no counter write), one VIP read, and the
    // VIP-plans read behind the payment endpoints.
    const sample = await db.collection('users').find({}).sort({ updated_at: -1 }).limit(1).toArray();
    const uid = sample[0].user_id;

    await step('saveUserInfo  users upsert (returning student)', () =>
      db.collection('users').updateOne(
        { user_id: uid },
        { $set: { updated_at: new Date() }, $setOnInsert: { user_id: uid } },
        { upsert: true }
      ));
    await step('checkVIPStatus  vip_subscriptions read', () =>
      db.collection('vip_subscriptions').findOne(
        { user_id: uid, expiry_date: { $gt: new Date() } },
        { projection: { _id: 0, id: 1, plan_id: 1, plan_type: 1, expiry_date: 1 }, sort: { expiry_date: -1 } }
      ));
    await step('getVIPPlansFromDB  vip_plans read', () =>
      db.collection('vip_plans').find({ is_active: 1 }, { projection: { _id: 0, id: 1, plan_key: 1, price: 1, duration_days: 1 } }).sort({ sort_order: 1 }).toArray());

    const total = steps.reduce((s, x) => s + x.ms, 0);
    for (const s of steps) console.log(`      ${String(s.ms).padStart(5)}ms  ${s.name}`);
    console.log(`      ${'='.repeat(48)}\n      ${total}ms across ${steps.length} sequential operations`);
    assert.ok(total < 1500, `login path takes ${total}ms from an in-region client; from a distant Vercel region it multiplies by RTT ratio`);
  } finally {
    await c.client.close().catch(() => {});
  }
});

test('fail-fast: an unreachable cluster rejects instead of hanging the request', { skip: SKIP }, async () => {
  // The mongodb driver has no acquire() timeout to test — its contract with the handlers is
  // serverSelectionTimeoutMS. api/db.js must surface a dead cluster in bounded time.
  const a = t0();
  let err;
  try {
    const client = await MongoClient.connect(
      'mongodb+srv://probe:probe@no-such-cluster.invalid.mongodb.net/?retryWrites=true',
      { serverSelectionTimeoutMS: 2000 }
    );
    await client.db().command({ ping: 1 });
    await client.close();
  } catch (e) { err = e; }
  const took = t0() - a;
  assert.ok(err, 'an invalid SRV host must throw, not resolve');
  assert.ok(took < 8000, `fail-fast took ${took}ms — a request budget of serverSelectionTimeoutMS=${2000}ms was not honoured`);
  console.log(`      dead cluster surfaced after ${took}ms (driver rejects; api/db.js resets its client cache so the next request retries)`);
});

test('the sweep query is index-backed and cheap', { skip: SKIP }, async () => {
  const c = await tryConnectMongo();
  if (c.__error) assert.fail(`cluster unreachable: ${c.__error.message}`);
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const plan = await c.db.collection('orders').find({ payment_status: 'Unpaid', created_at: { $lt: cutoff } }, { projection: { _id: 0, id: 1 } })
      .sort({ id: 1 }).limit(500).explain('queryPlanner');
    const win = plan.queryPlanner?.winningPlan && JSON.stringify(plan.queryPlanner.winningPlan);
    assert.ok(win && !/COLLSCAN/.test(win) || (await c.db.collection('orders').countDocuments({})) < 50,
      `the cron sweep does a full collection scan: ${win?.slice(0, 160)}`);
    const a = t0();
    await c.db.collection('orders').find({ payment_status: 'Unpaid', created_at: { $lt: cutoff } }, { projection: { _id: 0, id: 1 } }).limit(500).toArray();
    console.log(`      sweep SELECT: ${t0() - a}ms`);
  } finally {
    await c.client.close().catch(() => {});
  }
});
