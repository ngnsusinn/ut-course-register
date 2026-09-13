// ============================================
// Shared MongoDB access (driver-level singleton)
// ============================================
// The whole app talks to one MongoDB Atlas cluster through MONGODB_URI. Unlike the old MySQL
// pools there is nothing to acquire/release per request: the driver owns a connection pool and
// multiplexes operations over it. The client is cached for the lifetime of the (warm) lambda
// instance; a cold start pays the SRV lookup + TLS handshake once.
//
// Contract with callers:
//  - Documents keep the SNAKE_CASE field names of the old MySQL columns (user_id, order_code,
//    payment_status, ...) so the mapping code and the admin frontend keep working unchanged.
//  - Numeric primary keys (id) are preserved from MySQL and allocated through the `counters`
//    collection (see nextId) — the response payloads expose `id` exactly as before.
//  - Every datetime field is stored as a BSON Date (a true UTC instant). The legacy session was
//    pinned to +07:00: DATETIME columns held Vietnam *wall-clock strings* ("2026-09-12 23:59:59"
//    meaning 16:59:59Z). Code that derives an expiry string must convert with
//    vnWallClockToUTCDate() before writing — `new Date(str)` would be parsed with the process
//    timezone, which is UTC on Vercel and would silently shift every VIP by +7h.

import { MongoClient } from 'mongodb';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_DB = 'uth_registration';

// Cache on globalThis so the client survives module re-evaluation in a warm instance
// (Vercel dev, HMR, or several handlers bundled into one process).
const cache = globalThis.__UT_MONGO__ || (globalThis.__UT_MONGO__ = { promise: null });

/** Database name: MONGODB_DB env > the path component of the URI > uth_registration. */
export function getDbName(uri = process.env.MONGODB_URI || '') {
    if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
    const at = uri.lastIndexOf('@');
    if (at !== -1) {
        const slash = uri.indexOf('/', at + 1);
        if (slash !== -1) {
            const q = uri.indexOf('?', slash);
            const name = decodeURIComponent(uri.slice(slash + 1, q === -1 ? undefined : q));
            if (name) return name;
        }
    }
    return DEFAULT_DB;
}

/**
 * Lazily connect once per instance. Failures reset the cache so the next request retries
 * instead of being poisoned by a rejected promise forever.
 */
export function getMongoClient() {
    if (!cache.promise) {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('MONGODB_URI environment variable is not set — add it in Vercel project settings');
        }
        cache.promise = MongoClient.connect(uri, {
            // Atlas DNS/TLS problems must fail the request in seconds, not after the platform's
            // own function timeout (the old mysql2 pools used connectTimeout for the same reason).
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000),
            connectTimeoutMS: 10000,
            maxPoolSize: Number(process.env.MONGODB_POOL_SIZE || 5),
            retryWrites: true,
        }).catch((err) => {
            cache.promise = null;
            throw err;
        });
    }
    return cache.promise;
}

export async function getDb() {
    const client = await getMongoClient();
    return client.db(getDbName());
}

/**
 * Allocate `count` consecutive numeric ids for a collection, mimicking AUTO_INCREMENT.
 * `counters.seq` always holds the highest id handed out. Atomic $inc means concurrent
 * lambdas can never receive the same id.
 */
export async function nextIdRange(counterName, count = 1) {
    const db = await getDb();
    const doc = await db.collection('counters').findOneAndUpdate(
        { _id: counterName },
        { $inc: { seq: count } },
        { upsert: true, returnDocument: 'after' }
    );
    if (!doc) throw new Error(`counter ${counterName}: no document returned after $inc`);
    return { start: doc.seq - count + 1, end: doc.seq };
}

export async function nextId(counterName) {
    const { start } = await nextIdRange(counterName, 1);
    return start;
}

/**
 * Parse 'YYYY-MM-DD HH:mm:ss' (or ISO-ish 'YYYY-MM-DDTHH:mm:ss') as a VIETNAM wall-clock
 * string and return the true UTC instant. This is how the old +07 session stored DATETIME
 * columns; the migration and every expiry computation go through here.
 */
export function vnWallClockToUTCDate(value) {
    if (value instanceof Date) return value;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(String(value).trim());
    if (!m) return new Date(value); // fall back to native parsing for anything else
    const [, y, mo, d, h, mi, s, ms] = m;
    // Wall-clock +07 → UTC instant: subtract the 7h offset (Date.UTC handles negative hours).
    return new Date(Date.UTC(+y, +mo - 1, +d, +h - 7, +mi, +(s || 0), +((ms || '0').padEnd(3, '0'))));
}

/** Render a Date as the Vietnam wall-clock string the legacy DATETIME columns held. */
export function utcToVnWallClock(date = new Date()) {
    const d = new Date(date.getTime() + VN_OFFSET_MS);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Current instant as a Vietnam wall-clock string — replaces `NOW()` in DATETIME comparisons
 *  the old code formatted for INSERTs. */
export function nowVnWallClock() {
    return utcToVnWallClock(new Date());
}
