// Live contract between the shapes the handlers read/write and the actual production MongoDB
// (Atlas) cluster. READ-ONLY except one self-cleaning probe doc used to verify Vietnamese
// round-tripping through the driver.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tryConnectMongo, MONGO, COLLECTIONS, REQUIRED_UNIQUE_INDEXES } from './helpers.mjs';

const SKIP = process.env.SKIP_DB === '1' || !process.env.MONGODB_URI;

let client, db;
test.before(async () => {
  if (SKIP) return;
  const c = await tryConnectMongo();
  if (c.__error) throw new Error(`cannot reach the Atlas cluster: ${c.__error.code || ''} ${c.__error.message}`);
  client = c.client; db = c.db;
});
test.after(async () => { await client?.close().catch(() => {}); });

test('all collections the code references exist', { skip: SKIP }, async () => {
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  const missing = COLLECTIONS.filter((c) => !names.includes(c));
  assert.deepEqual(missing, [], `handlers read collections that do not exist: ${missing.join(', ')}`);
});

test('every unique key the code relies on for correctness actually exists', { skip: SKIP }, async () => {
  for (const { coll, fields } of REQUIRED_UNIQUE_INDEXES) {
    const idx = await db.collection(coll).indexes();
    const hit = idx.find((i) => i.unique && JSON.stringify(Object.keys(i.key)) === JSON.stringify(fields));
    assert.ok(hit, `${coll} is missing UNIQUE(${fields.join(',')}) — upserts/idempotency silently allow duplicates without it`);
  }
});

test('non-unique query indexes keep the hot paths index-backed', { skip: SKIP }, async () => {
  // order sweep + student order list: payment_status/created_at
  const ordersIdx = await db.collection('orders').indexes();
  assert.ok(ordersIdx.some((i) => i.key.payment_status !== undefined), 'orders needs an index on payment_status for the sweep');
  assert.ok(ordersIdx.some((i) => i.key.created_at !== undefined), 'orders needs created_at (sweep range + newest-first listing)');
  // login VIP lookup: user_id (+ expiry) on vip_subscriptions
  const subsIdx = await db.collection('vip_subscriptions').indexes();
  assert.ok(subsIdx.some((i) => i.key.user_id !== undefined), 'vip_subscriptions needs user_id: checkVIPStatus runs on every login');
  // shared-class reads: dot_id first
  const sharedIdx = await db.collection('shared_class_data').indexes();
  assert.ok(sharedIdx.some((i) => i.key.dot_id !== undefined), 'shared_class_data needs dot_id first for every shared read');
});

test('counter sequences are ahead of every id already handed out', { skip: SKIP }, async () => {
  const counters = await db.collection('counters').find({}).toArray();
  const seq = new Map(counters.map((c) => [c._id, c.seq]));
  const problems = [];
  for (const coll of COLLECTIONS) {
    if (coll === 'counters' || coll === 'shared_data_stats') continue;
    const top = await db.collection(coll).find({ id: { $exists: true } }).sort({ id: -1 }).limit(1).toArray();
    if (!top.length) continue;
    const have = seq.get(coll);
    if (have === undefined) { problems.push(`${coll}: no counters doc at all`); continue; }
    if (have < top[0].id) problems.push(`${coll}: counters.seq=${have} <= max used id=${top[0].id} (next insert would collide)`);
  }
  assert.deepEqual(problems, [], 'id counters out of sync:\n  ' + problems.join('\n  '));
});

test('stored datetimes are true instants and amounts are numbers, not strings', { skip: SKIP }, async () => {
  const user = await db.collection('users').find({}).sort({ created_at: -1 }).limit(1).toArray();
  assert.ok(user.length, 'users collection is empty — the migration did not run?');
  assert.ok(user[0].created_at instanceof Date, 'users.created_at must be a BSON Date');

  const sub = await db.collection('vip_subscriptions').find({}).sort({ created_at: -1 }).limit(1).toArray();
  assert.ok(sub.length, 'no vip_subscriptions migrated');
  assert.ok(sub[0].expiry_date instanceof Date, 'expiry_date must be a BSON Date');
  const y = sub[0].expiry_date.getUTCFullYear();
  assert.ok(y >= 2024 && y <= 2200, `expiry_date instant looks shifted: ${sub[0].expiry_date.toISOString()}`);
  // legacy convention: expiry always lands on 23:59:59 VN wall-clock == 16:59:59 UTC
  const hm = sub[0].expiry_date.toISOString().slice(11, 19);
  assert.equal(hm, '16:59:59', 'VIP expiries must sit at VN end-of-day (16:59:59Z)');

  const order = await db.collection('orders').find({}).sort({ created_at: -1 }).limit(1).toArray();
  assert.ok(order.length, 'no orders migrated');
  assert.equal(typeof order[0].amount, 'number', 'amount must be numeric (was DECIMAL-as-string in mysql2)');
  assert.ok(order[0].created_at instanceof Date);

  const shared = await db.collection('shared_class_data').find({ schedule_details: { $type: 'array' } }).limit(1).toArray();
  assert.ok(shared.length, 'shared_class_data.schedule_details must have been migrated to real arrays');
  const strings = await db.collection('shared_class_data').countDocuments({ schedule_details: { $type: 'string' } });
  assert.equal(strings, 0, 'leftover JSON-string schedule_details rows: the handlers would not parse them');
});

test('admin rows store only scrypt hashes (never plaintext)', { skip: SKIP }, async () => {
  const admins = await db.collection('admins').find({}).toArray();
  assert.ok(admins.length, 'no admins — nobody can log into the admin panel');
  for (const a of admins) {
    assert.match(String(a.password_hash), /^scrypt\$/, `admin ${a.username}: password_hash is not an scrypt hash`);
  }
});

test('Vietnamese text round-trips through the driver (self-cleaning probe write)', { skip: SKIP }, async () => {
  const probe = db.collection('__utf8_probe__');
  const s = 'Đăng Ký Học Phần — Nguyễn Sun Sin ️';
  await probe.insertOne({ marker: 'dsh-schema-test', s });
  const back = await probe.findOne({ marker: 'dsh-schema-test' });
  await probe.deleteMany({ marker: 'dsh-schema-test' });
  assert.equal(back.s, s, 'utf-8 round-trip corrupted Vietnamese text');
});
