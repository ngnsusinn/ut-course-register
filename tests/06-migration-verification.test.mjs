// Verifies the MySQL -> MongoDB data migration against the manifest emitted by
// scripts/migrate-sql-to-mongo.mjs (tests/fixtures/migration-manifest.json).
// Counts, counters and byte-for-byte document samples are compared against the live cluster;
// new rows written after the migration are allowed (counts >= manifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tryConnectMongo, REPO } from './helpers.mjs';

const SKIP = process.env.SKIP_DB === '1' || !process.env.MONGODB_URI;
const MANIFEST_PATH = REPO + 'tests/fixtures/migration-manifest.json';

const canonicalize = (v) => (v instanceof Date ? { __date: v.toISOString() }
    : Array.isArray(v) ? v.map(canonicalize)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_id').map(([k, x]) => [k, canonicalize(x)]))
            : v);

let client, db, manifest;
test.before(async () => {
  if (SKIP) return;
  assert.ok(existsSync(MANIFEST_PATH), 'no migration manifest — run: node scripts/migrate-sql-to-mongo.mjs <dump.sql>');
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const c = await tryConnectMongo();
  if (c.__error) assert.fail(`cluster unreachable: ${c.__error.message}`);
  client = c.client; db = c.db;
});
test.after(async () => { await client?.close().catch(() => {}); });

test('every migrated collection has at least the migrated document count', { skip: SKIP }, async () => {
  for (const [name, m] of Object.entries(manifest.tables)) {
    const live = await db.collection(name).countDocuments({});
    assert.ok(live >= m.count, `${name}: live has ${live} docs but the migration inserted ${m.count} — data disappeared`);
  }
});

test('the retired activity_logs collection was NOT migrated', { skip: SKIP }, async () => {
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  assert.ok(!names.includes('activity_logs'), 'activity_logs should not exist (feature removed)');
});

test('sample documents survive the migration field-for-field', { skip: SKIP }, async () => {
  // Login legitimately moves users.updated_at / users.last_login forward; anything else — and
  // any BACKWARD move of those two — still fails the comparison.
  const VOLATILE = { users: ['updated_at', 'last_login'] };
  const problems = [];
  for (const [name, m] of Object.entries(manifest.tables)) {
    for (const sample of [m.firstDoc, m.sample].filter(Boolean)) {
      const live = await db.collection(name).findOne({ id: sample.id }, { projection: { _id: 0 } });
      if (!live) { problems.push(`${name}: doc id=${sample.id} missing`); continue; }
      const norm = { ...canonicalize(live) };
      for (const f of (VOLATILE[name] || [])) {
        if (norm[f]?.__date && sample[f]?.__date && new Date(norm[f].__date) >= new Date(sample[f].__date)) {
          norm[f] = sample[f]; // forward-only drift of login bookkeeping fields is expected
        }
      }
      const a = JSON.stringify(norm);
      const b = JSON.stringify(canonicalize(sample));
      if (a !== b) {
        // surface the first differing field for the message
        const ka = Object.keys(sample).filter((k) => k !== '_id');
        const diff = ka.find((k) => JSON.stringify(canonicalize(live[k])) !== JSON.stringify(sample[k]));
        problems.push(`${name} id=${sample.id}: field '${diff}' migrated=${JSON.stringify(sample[diff])} live=${JSON.stringify(canonicalize(live[diff]))}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'fidelity problems:\n  ' + problems.join('\n  '));
});

test('id counters never roll backwards under new inserts', { skip: SKIP }, async () => {
  const counters = await db.collection('counters').find({}).toArray();
  const seq = new Map(counters.map((c) => [c._id, c.seq]));
  const problems = [];
  for (const [name, m] of Object.entries(manifest.tables)) {
    if (!m.maxId) continue;
    const s = seq.get(name);
    if (s === undefined || s < m.maxId) problems.push(`${name}: counter seq=${s} below migrated maxId=${m.maxId}`);
    if (s < manifest.counters[name]) problems.push(`${name}: counter regressed from ${manifest.counters[name]} to ${s}`);
  }
  assert.deepEqual(problems, [], problems.join('\n  '));
});

test('business totals are consistent post-migration', { skip: SKIP }, async () => {
  const paidSum = await db.collection('orders').aggregate([
    { $match: { payment_status: 'Paid' } }, { $group: { _id: null, s: { $sum: '$amount' } } },
  ]).toArray().then((r) => r[0]?.s || 0);
  assert.ok(paidSum >= manifest.totals.ordersPaidSum,
    `paid revenue shrank: live ${paidSum} < manifest ${manifest.totals.ordersPaidSum}`);

  const activeVips = (await db.collection('vip_subscriptions').distinct('user_id', { expiry_date: { $gt: new Date() } })).length;
  assert.ok(activeVips >= 0 && Number.isFinite(activeVips));
  console.log(`      live paid revenue: ${paidSum} VND (migrated baseline ${manifest.totals.ordersPaidSum}), active VIP users: ${activeVips}`);
});
