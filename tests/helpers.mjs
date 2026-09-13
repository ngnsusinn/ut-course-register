// Shared helpers for the test-suite: MongoDB config from env (never from source) plus the
// repo path used by the stub loader.
//
// Required env vars (see env.test.example): MONGODB_URI (optionally MONGODB_DB to override the
// database inside the URI). Tests fail with a clear message when a needed var is missing.
import { MongoClient } from 'mongodb';

export const REPO = new URL('..', import.meta.url).pathname;

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name} — see env.test.example (run: npm run test:db)`);
  return v;
}

/** Live cluster config: MONGODB_URI + resolved database name. */
export function MONGO() {
  const uri = need('MONGODB_URI');
  let dbName = process.env.MONGODB_DB;
  if (!dbName) {
    const at = uri.lastIndexOf('@');
    const slash = at !== -1 ? uri.indexOf('/', at + 1) : -1;
    if (slash !== -1) {
      const q = uri.indexOf('?', slash);
      dbName = decodeURIComponent(uri.slice(slash + 1, q === -1 ? undefined : q));
    }
    dbName = dbName || 'uth_registration';
  }
  return { uri, dbName };
}

/** Open a client, or return { __error } if the cluster is unreachable (test should skip). */
export async function tryConnectMongo(extra = {}) {
  try {
    const { uri, dbName } = MONGO();
    const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 2, ...extra });
    return { client, db: client.db(dbName) };
  } catch (e) {
    return { __error: e };
  }
}

/** Collection names the deployed handlers depend on (mirrors scripts/migrate-sql-to-mongo.mjs). */
export const COLLECTIONS = [
  'users', 'admins', 'vip_plans', 'vip_subscriptions', 'orders', 'transactions',
  'shared_class_data', 'shared_data_stats', 'class_data_contributions', 'counters',
];

/**
 * Unique-index contract: every read-modify-write in the handlers leans on one of these
 * (upserts, idempotency of the webhook, logical-key bulk upserts). If one disappears in
 * Atlas, the code silently allows duplicates.
 */
export const REQUIRED_UNIQUE_INDEXES = [
  { coll: 'users', fields: ['user_id'] },
  { coll: 'admins', fields: ['username'] },
  { coll: 'orders', fields: ['id'] },
  { coll: 'orders', fields: ['order_code'] },
  { coll: 'vip_plans', fields: ['id'] },
  { coll: 'vip_plans', fields: ['plan_key'] },
  { coll: 'vip_subscriptions', fields: ['id'] },
  { coll: 'shared_class_data', fields: ['id'] },
  { coll: 'shared_class_data', fields: ['dot_id', 'ma_lop_hoc_phan'] },
  { coll: 'class_data_contributions', fields: ['id'] },
  { coll: 'class_data_contributions', fields: ['user_id', 'dot_id'] },
  { coll: 'shared_data_stats', fields: ['dot_id'] },
];
