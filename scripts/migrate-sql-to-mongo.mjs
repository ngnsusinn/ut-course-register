// ============================================
// MySQL dump  ->  MongoDB Atlas migration
// ============================================
// Reads a phpMyAdmin/mysqldump SQL file and writes every business collection into the
// cluster pointed to by MONGODB_URI, preserving ids, types and — most importantly — the
// exact UTC instants the old +07:00 session produced:
//
//   * TIMESTAMP columns were exported by the dump with the session time_zone "+00:00"
//     => the string IS the true instant (read it as UTC).
//   * DATETIME columns (vip_subscriptions.expiry_date, transactions.transaction_date)
//     hold Vietnam wall-clock strings written by an app session pinned to "+07:00"
//     => true instant = string - 7h.
//
// AUTO_INCREMENT counters are replayed into the `counters` collection so nextId() continues
// where MySQL left off. activity_logs is deliberately NOT migrated (the feature was removed).
//
// Usage:
//   MONGODB_URI="..." node scripts/migrate-sql-to-mongo.mjs [path/to/dump.sql] [--drop]
// Writes tests/fixtures/migration-manifest.json for the 06 verification test.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const DROP = argv.includes('--drop');
const dumpPath = argv.find((a) => !a.startsWith('--')) || '.tmp-reg.sql';

const uri = process.env.MONGODB_URI;
if (!uri && !process.argv.includes('--parse-only')) {
    console.error('MONGODB_URI is required (the Atlas connection string).');
    process.exit(1);
}
let dbName = process.env.MONGODB_DB;
if (!dbName && uri) {
    const at = uri.lastIndexOf('@');
    const slash = at !== -1 ? uri.indexOf('/', at + 1) : -1;
    if (slash !== -1) {
        const q = uri.indexOf('?', slash);
        dbName = decodeURIComponent(uri.slice(slash + 1, q === -1 ? undefined : q));
    }
    dbName = dbName || 'uth_registration';
}

const SKIP_TABLES = new Set(['activity_logs']);

// ---------------- dump parsing ----------------
const sql = readFileSync(dumpPath, 'utf8');

/** Ordered {name, type} per table from the CREATE TABLE block. */
function parseCreateTables(text) {
    const out = {};
    const re = /CREATE TABLE `(\w+)` \(([\s\S]*?)\n\) ENGINE=/g;
    let m;
    while ((m = re.exec(text))) {
        const [, table, body] = m;
        const cols = [];
        for (const line of body.split('\n')) {
            const c = /^\s*`(\w+)`\s+([a-z]+(?:\([\d,]+\))?)\b/.exec(line);
            if (c) cols.push({ name: c[1], type: c[2].toLowerCase() });
        }
        out[table] = cols;
    }
    return out;
}

/** AUTO_INCREMENT=<n> (next value) per table from the ALTER ... MODIFY blocks. */
function parseAutoIncrements(text) {
    const out = {};
    // lazy inner match so the optional ", AUTO_INCREMENT=n" anchors on the value, not the
    // column flag: ... MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;
    const re = /ALTER TABLE `(\w+)`[\s\S]*?MODIFY `\w+`[^;]*?AUTO_INCREMENT(?:,\s*AUTO_INCREMENT=(\d+))?;/g;
    let m;
    while ((m = re.exec(text))) out[m[1]] = m[2] ? Number(m[2]) : 1;
    return out;
}

const UNESCAPE = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\u001a', '\\': '\\', "'": "'", '"': '"', '%': '%', _: '_' };

/** Tokenise one INSERT ... VALUES payload into row arrays of JS values. */
function parseRows(payload) {
    const rows = [];
    let i = 0;
    const n = payload.length;
    while (i < n) {
        while (i < n && payload[i] !== '(') i++;
        if (i >= n) break;
        i++; // consume (
        const row = [];
        while (i < n) {
            // skip whitespace
            while (i < n && (payload[i] === ' ' || payload[i] === '\n' || payload[i] === '\t')) i++;
            if (payload.startsWith('NULL', i)) { row.push(null); i += 4; }
            else if (payload[i] === "'") {
                i++;
                let s = '';
                while (i < n) {
                    const c = payload[i];
                    if (c === '\\') { s += UNESCAPE[payload[i + 1]] ?? payload[i + 1]; i += 2; continue; }
                    if (c === "'") {
                        if (payload[i + 1] === "'") { s += "'"; i += 2; continue; } // doubled-quote escape
                        i++; break;
                    }
                    s += c; i++;
                }
                row.push(s);
            } else {
                let j = i;
                while (j < n && !", \n)".includes(payload[j])) j++;
                const tok = payload.slice(i, j);
                row.push(tok.includes('.') ? parseFloat(tok) : parseInt(tok, 10));
                i = j;
            }
            while (i < n && (payload[i] === ' ' || payload[i] === '\t')) i++;
            if (payload[i] === ',') { i++; continue; }
            if (payload[i] === ')') { i++; break; }
        }
        rows.push(row);
    }
    return rows;
}

function parseInserts(text) {
    const out = {};
    const re = /INSERT INTO `(\w+)` \(([^)]*)\) VALUES\n/g;
    let m;
    while ((m = re.exec(text))) {
        const [, table, colsRaw] = m;
        const cols = colsRaw.split(',').map((c) => c.trim().replace(/`/g, ''));
        // A statement ends at the first ';\n' after its start: raw newlines never appear inside
        // quoted values of a dump (they are escaped as \n), so this cannot end a row early.
        const semi = text.indexOf(';\n', m.index + m[0].length);
        const payload = text.slice(m.index + m[0].length, semi === -1 ? undefined : semi + 1);
        re.lastIndex = semi === -1 ? text.length : semi + 1;
        (out[table] ||= []).push(...parseRows(payload).map((r) => Object.fromEntries(cols.map((c, k) => [c, r[k]]))));
    }
    return out;
}

// ---------------- type conversion ----------------
const VN = 7 * 60 * 60 * 1000;
function toDate(v, kind) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v;
    const s = String(v).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s);
    if (!m) return new Date(s);
    const [, y, mo, d, h, mi, sec, ms] = m;
    // 'timestamp' strings come out of the dump in UTC (SET time_zone "+00:00");
    // 'datetime' strings are Vietnam wall-clock written by a +07:00 session.
    const off = kind === 'datetime' ? 7 : 0;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h - off, +mi, +(sec || 0), +((ms || '0').padEnd(3, '0').slice(0, 3))));
}
function convert(value, type) {
    if (value === null) return null;
    const t = type.split('(')[0];
    switch (t) {
        case 'timestamp': return toDate(value, 'timestamp');
        case 'datetime': return toDate(value, 'datetime');
        case 'date': return toDate(`${value} 00:00:00`, 'datetime');
        case 'decimal': case 'float': case 'double': return Number(value);
        case 'int': case 'bigint': case 'smallint': case 'mediumint': case 'tinyint':
            return typeof value === 'number' ? value : Number(value);
        case 'json': {
            if (typeof value !== 'string') return value;
            try { return JSON.parse(value); } catch { return value; }
        }
        default: return value; // text/varchar/enum -> string
    }
}

// ---------------- index plan ----------------
function indexPlan() {
    return {
        users: [
            { key: { user_id: 1 }, unique: true },
            { key: { updated_at: -1 } },
        ],
        admins: [
            { key: { id: 1 }, unique: true },
            { key: { username: 1 }, unique: true },
            { key: { email: 1 }, unique: true, sparse: true },
        ],
        vip_plans: [
            { key: { id: 1 }, unique: true },
            { key: { plan_key: 1 }, unique: true },
            { key: { is_active: 1, sort_order: 1 } },
        ],
        vip_subscriptions: [
            { key: { id: 1 }, unique: true },
            { key: { user_id: 1, expiry_date: -1 } },
            { key: { order_id: 1 }, unique: true, partial: { order_id: { $type: 'int' } } },
        ],
        orders: [
            { key: { id: 1 }, unique: true },
            { key: { order_code: 1 }, unique: true },
            { key: { user_id: 1 } },
            { key: { payment_status: 1, created_at: 1 } },
            { key: { created_at: -1 } },
        ],
        transactions: [
            { key: { id: 1 }, unique: true },
            { key: { order_id: 1 } },
            { key: { received_at: -1 } },
            { key: { reference_number: 1 } },
        ],
        shared_class_data: [
            { key: { id: 1 }, unique: true },
            { key: { dot_id: 1, ma_lop_hoc_phan: 1 }, unique: true },
            { key: { dot_id: 1, ma_hoc_phan: 1, ma_lop_hoc_phan: 1 } },
            { key: { dot_id: 1, source: 1 } },
        ],
        class_data_contributions: [
            { key: { id: 1 }, unique: true },
            { key: { user_id: 1, dot_id: 1 }, unique: true },
        ],
        shared_data_stats: [
            { key: { id: 1 }, unique: true },
            { key: { dot_id: 1 }, unique: true },
        ],
    };
}

// ---------------- main ----------------
const tables = parseCreateTables(sql);
const data = parseInserts(sql);
const autoInc = parseAutoIncrements(sql);

const rowsFor = (t) => (data[t] || []).map((row) => {
    const doc = {};
    for (const col of tables[t]) doc[col.name] = convert(row[col.name], col.type);
    return doc;
});

console.log(`source dump : ${dumpPath}`);

if (argv.includes('--parse-only')) {
    // offline self-check of the dump parser (no cluster needed)
    let bad = 0;
    for (const t of Object.keys(tables)) {
        if (SKIP_TABLES.has(t)) continue;
        const rows = rowsFor(t);
        for (const r of rows) {
            for (const c of tables[t]) {
                if (r[c.name] instanceof Date && Number.isNaN(r[c.name].getTime())) { console.error(`${t}.${c.name} invalid date`); bad++; }
            }
            if (r.id !== undefined && typeof r.id !== 'number') { console.error(`${t}: id not numeric (${typeof r.id})`); bad++; }
        }
        if (t === 'shared_class_data') {
            const str = rows.filter((r) => typeof r.schedule_details === 'string').length;
            console.log(`  shared_class_data: ${rows.length} rows, ${str} still-string schedule_details`);
        }
        console.log(`  ${t.padEnd(26)} ${rows.length} rows${autoInc[t] ? ` (next id ${autoInc[t]})` : ''}`);
    }
    console.log(bad ? `PARSE-ONLY: ${bad} PROBLEMS` : 'PARSE-ONLY: clean');
    process.exit(bad ? 1 : 0);
}

console.log(`target      : ${(uri || '').replace(/\/\/[^@]+@/, '//***@')}/${dbName}`);

const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 5 });
const db = client.db(dbName);

const manifest = { source: dumpPath, database: dbName, generatedAt: new Date().toISOString(), tables: {}, skipped: {}, totals: {} };

try {
    for (const table of Object.keys(tables)) {
        if (SKIP_TABLES.has(table)) {
            manifest.skipped[table] = (data[table] || []).length;
            continue;
        }
        const rows = rowsFor(table);
        const coll = db.collection(table);

        const existing = await coll.countDocuments({});
        if (existing > 0 && !DROP) {
            throw new Error(`collection ${table} already holds ${existing} documents — rerun with --drop to replace them`);
        }
        if (DROP) await coll.deleteMany({});

        for (let i = 0; i < rows.length; i += 500) {
            await coll.insertMany(rows.slice(i, i + 500), { ordered: true });
        }

        const plan = indexPlan()[table] || [];
        for (const spec of plan) {
            const opts = { name: `idx_${Object.keys(spec.key).join('_')}${spec.unique ? '_u' : ''}`, unique: !!spec.unique };
            if (spec.sparse) opts.sparse = true;
            if (spec.partial) opts.partialFilterExpression = spec.partial;
            await coll.createIndex(spec.key, opts);
        }

        const ids = rows.map((r) => r.id).filter((v) => typeof v === 'number');
        const maxId = ids.length ? Math.max(...ids) : 0;
        if (ids.length) {
            // counters.seq = highest id handed out; nextId() returns seq+1.
            const seed = Math.max(maxId, (autoInc[table] || 1) - 1);
            await db.collection('counters').updateOne(
                { _id: table },
                { $max: { seq: seed } },
                { upsert: true }
            );
        }

        const doc = await coll.find({}).sort({ id: 1 }).limit(1).toArray();
        manifest.tables[table] = {
            count: rows.length,
            maxId,
            firstDoc: doc[0] ? canonicalize(doc[0]) : null,
            sample: canonicalize(rows.length ? rows[rows.length - 1] : null),
        };
        console.log(`✔ ${table.padEnd(26)} ${rows.length} inserted, ${plan.length} indexes`);
    }

    // cross-checks the handlers will lean on
    manifest.totals.ordersPaidSum = await db.collection('orders').aggregate([
        { $match: { payment_status: 'Paid' } }, { $group: { _id: null, s: { $sum: '$amount' } } },
    ]).toArray().then((r) => r[0]?.s || 0);
    manifest.totals.activeVipUsers = (await db.collection('vip_subscriptions').distinct('user_id', { expiry_date: { $gt: new Date() } })).length;
    manifest.counters = Object.fromEntries((await db.collection('counters').find({}).toArray()).map((c) => [c._id, c.seq]));

    mkdirSync('tests/fixtures', { recursive: true });
    writeFileSync('tests/fixtures/migration-manifest.json', JSON.stringify(manifest, null, 1));
    console.log(`\nmanifest -> tests/fixtures/migration-manifest.json`);
    console.log(`orders paid sum: ${manifest.totals.ordersPaidSum} VND | active VIP users: ${manifest.totals.activeVipUsers}`);
    console.log('DONE');
} finally {
    await client.close();
}

/** Deterministic JSON view of a document for the manifest / 06 verification.
 *  _id is dropped: insertMany() mutates the row objects, and the verifier re-reads by `id`. */
function canonicalize(v) {
    if (v instanceof Date) return { __date: v.toISOString() };
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_id').map(([k, x]) => [k, canonicalize(x)]));
    return v;
}
