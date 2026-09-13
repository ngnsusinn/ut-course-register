// Functional in-memory stand-in for api/db.js + the small MongoDB subset the handlers use.
// Unlike the old mysql-stub (which only replayed scripted rows), this one actually executes
// filters/updates/aggregations, so handler rewrites can be e2e-tested against real document
// state: seed collections with seedDocs(), then dump() them to inspect the outcome.
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export const stats = { queries: [], ops: [], indexes: [], created: 0, acquired: 0, released: 0 };
let failWith = null;
let queryLatencyMs = 0;
const store = new Map(); // collection name -> array of docs

const coll = (name) => {
    if (!store.has(name)) store.set(name, []);
    return store.get(name);
};

export function configure(o = {}) {
    if ('failWith' in o) failWith = o.failWith;
    if ('latencyMs' in o) queryLatencyMs = o.latencyMs;
    if (o.seed) for (const [c, docs] of Object.entries(o.seed)) seedDocs(c, docs);
}
export function reset() {
    store.clear();
    stats.queries.length = 0; stats.ops.length = 0; stats.indexes.length = 0;
    stats.created = 0; stats.acquired = 0; stats.released = 0;
    failWith = null; queryLatencyMs = 0;
}
/** Replace a collection's contents (docs are deep-cloned; pass plain objects). */
export function seedDocs(name, docs) {
    store.set(name, docs.map((d) => ({ _id: d._id ?? cryptoId(), ...clone(d) })));
}
/** Live contents of a collection (deep-cloned snapshot). */
export function dump(name) {
    return clone(coll(name));
}
let idSeq = 1;
function cryptoId() { return `stub-${idSeq++}`; }

function record(op, collection, extra = {}) {
    const e = { op, collection, ...extra };
    e.sql = `${op} ${collection} ${JSON.stringify(extra.filter ?? extra.document ?? {}, (k, v) => (v instanceof Date ? v.toISOString() : v))}`.slice(0, 220);
    stats.ops.push(e);
    stats.queries.push(e);
}

async function gate() {
    if (queryLatencyMs) await new Promise((r) => setTimeout(r, queryLatencyMs));
    if (failWith) throw failWith;
}

// ---------------- filter engine ----------------
const norm = (v) => (v instanceof Date ? v.getTime() : v);
const MISSING = Symbol('missing');
function pathOf(doc, path) {
    let cur = doc;
    for (const k of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return MISSING;
        cur = cur[k];
    }
    return cur === undefined ? MISSING : cur;
}
function cmp(a, b) {
    const na = norm(a) === MISSING ? null : norm(a);
    const nb = norm(b) === MISSING ? null : norm(b);
    if (na === null && nb === null) return 0;
    if (na === null) return -1;
    if (nb === null) return 1;
    if (typeof na === 'number' && typeof nb === 'number') return na - nb;
    if (typeof na === typeof nb) return na < nb ? -1 : na > nb ? 1 : 0;
    return String(na) < String(nb) ? -1 : String(na) > String(nb) ? 1 : 0;
}
function matches(doc, filter = {}) {
    for (const [key, cond] of Object.entries(filter)) {
        if (key === '$and') { if (!cond.every((f) => matches(doc, f))) return false; continue; }
        if (key === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
        if (key === '$nor') { if (cond.some((f) => matches(doc, f))) return false; continue; }
        const val = doc[key];
        if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((k) => k.startsWith('$'))) {
            for (const [op, arg] of Object.entries(cond)) {
                const v = val === undefined ? MISSING : val;
                if (op === '$eq' && !(norm(v) === norm(arg) || (arg === null && v === MISSING))) return false;
                else if (op === '$ne' && (norm(v) === norm(arg) || (arg === null && v === MISSING))) return false;
                else if (op === '$gt' && !(v !== MISSING && cmp(v, arg) > 0)) return false;
                else if (op === '$gte' && !(v !== MISSING && cmp(v, arg) >= 0)) return false;
                else if (op === '$lt' && !(v !== MISSING && cmp(v, arg) < 0)) return false;
                else if (op === '$lte' && !(v !== MISSING && cmp(v, arg) <= 0)) return false;
                else if (op === '$in' && !arg.some((x) => norm(x) === norm(v))) return false;
                else if (op === '$nin' && arg.some((x) => norm(x) === norm(v))) return false;
                else if (op === '$exists' && ((val !== undefined) !== Boolean(arg))) return false;
                else if (op === '$regex' && !(new RegExp(arg).test(String(val ?? '')))) return false;
                else if (!['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex'].includes(op)) return false;
            }
            continue;
        }
        // plain equality (null also matches missing, like Mongo)
        if (!(norm(val === undefined ? MISSING : val) === norm(cond) || (cond === null && val === undefined))) return false;
    }
    return true;
}

// ---------------- update engine ----------------
function applyUpdate(doc, update, inserted) {
    const out = clone(doc);
    for (const [op, spec] of Object.entries(update)) {
        if (op === '$set') for (const [k, v] of Object.entries(spec)) out[k] = clone(v);
        else if (op === '$setOnInsert') { if (inserted) for (const [k, v] of Object.entries(spec)) out[k] = clone(v); }
        else if (op === '$inc') for (const [k, v] of Object.entries(spec)) out[k] = (out[k] || 0) + v;
        else if (op === '$unset') for (const k of Object.keys(spec)) delete out[k];
        else if (op === '$currentDate') for (const k of Object.keys(spec)) out[k] = new Date();
        else if (!op.startsWith('$')) out[op] = clone(spec); // full replace
        else throw new Error(`mongo-stub: unsupported update operator ${op}`);
    }
    return out;
}

// ---------------- projection / sort ----------------
function project(doc, projection) {
    if (!projection) return doc;
    const keys = Object.entries(projection).filter(([k]) => k !== '$meta');
    const including = keys.some(([k, v]) => v === 1);
    const out = {};
    if (including) {
        for (const [k, v] of keys) if (v === 1) { const val = doc[k]; if (val !== undefined) out[k] = clone(val); }
    } else {
        Object.assign(out, clone(doc));
        for (const [k, v] of keys) if (v === 0) delete out[k];
    }
    return out;
}
function sorter(spec) {
    const keys = Object.entries(spec);
    return (a, b) => {
        for (const [k, dir] of keys) {
            const r = cmp(a[k] === undefined ? MISSING : a[k], b[k] === undefined ? MISSING : b[k]);
            if (r) return dir < 0 ? -r : r;
        }
        return 0;
    };
}

// ---------------- aggregation mini-engine ----------------
function truthyMongo(v) { return v !== false && v !== null && v !== undefined; }
function evalExpr(doc, e) {
    if (typeof e === 'string') return e.startsWith('$') ? pathOf(doc, e.slice(1)) : e;
    if (Array.isArray(e)) return e.map((x) => evalExpr(doc, x));
    if (e && typeof e === 'object') {
        const op = Object.keys(e).find((k) => k.startsWith('$'));
        if (!op) return clone(e);
        const arg = e[op];
        switch (op) {
            case '$add': return evalExpr(doc, arg).reduce((s, x) => s + (norm(x) || 0), 0);
            case '$multiply': return evalExpr(doc, arg).reduce((s, x) => s * (norm(x) ?? 1), 1);
            case '$eq': { const [a, b] = evalExpr(doc, arg); return cmp(a, b) === 0; }
            case '$ne': { const [a, b] = evalExpr(doc, arg); return cmp(a, b) !== 0; }
            case '$cond': { const [t, f, s] = Array.isArray(arg) ? evalExpr(doc, arg) : [evalExpr(doc, arg.if), evalExpr(doc, arg.then), evalExpr(doc, arg.else)]; return truthyMongo(t) ? f : s; }
            case '$ifNull': { const [a, b] = evalExpr(doc, arg); return a === MISSING || a === null ? b : a; }
            case '$toString': return String(evalExpr(doc, arg) ?? '');
            case '$dateToString': {
                const d = new Date(evalExpr(doc, arg.date));
                if (Number.isNaN(d.getTime())) return null;
                return arg.format.replace('%Y', d.getUTCFullYear()).replace('%m', String(d.getUTCMonth() + 1).padStart(2, '0')).replace('%d', String(d.getUTCDate()).padStart(2, '0'));
            }
            default: throw new Error(`mongo-stub: unsupported aggregation operator ${op}`);
        }
    }
    return e;
}
function runAggregate(docs, pipeline) {
    let cur = docs.map(clone);
    for (const stage of pipeline) {
        if (stage.$match) cur = cur.filter((d) => matches(d, stage.$match));
        else if (stage.$group) {
            const g = stage.$group;
            const groups = new Map();
            for (const d of cur) {
                const key = evalExpr(d, g._id);
                const ks = JSON.stringify(key === MISSING ? null : key instanceof Date ? key.toISOString() : key);
                if (!groups.has(ks)) groups.set(ks, { _id: key === MISSING ? null : key, docs: [] });
                groups.get(ks).docs.push(d);
            }
            cur = [...groups.values()].map(({ _id, docs: members }) => {
                const out = { _id };
                for (const [f, acc] of Object.entries(g)) {
                    if (f === '_id') continue;
                    const [op, arg] = Object.entries(acc)[0];
                    if (op === '$sum') out[f] = members.reduce((s, m) => { const v = evalExpr(m, arg); return s + (v === MISSING ? 0 : Number(v)); }, 0);
                    else if (op === '$avg') out[f] = members.reduce((s, m) => s + Number(evalExpr(m, arg) || 0), 0) / (members.length || 1);
                    else if (op === '$min') out[f] = members.map((m) => evalExpr(m, arg)).sort(cmp)[0] ?? null;
                    else if (op === '$max') out[f] = members.map((m) => evalExpr(m, arg)).sort(cmp).filter((x) => x !== MISSING).pop() ?? null;
                    else if (op === '$first') out[f] = members.length ? evalExpr(members[0], arg) : null;
                    else if (op === '$addToSet') { const set = new Map(); for (const m of members) { const v = evalExpr(m, arg); set.set(norm(v), v === MISSING ? null : v); } out[f] = [...set.values()]; }
                    else throw new Error(`mongo-stub: unsupported accumulator ${op}`);
                }
                return out;
            });
        }
        else if (stage.$sort) cur.sort(sorter(stage.$sort));
        else if (stage.$limit) cur = cur.slice(0, stage.$limit);
        else if (stage.$skip) cur = cur.slice(stage.$skip);
        else if (stage.$project) cur = cur.map((d) => project(d, stage.$project));
        else if (stage.$count) cur = [{ [stage.$count]: cur.length }];
        else throw new Error(`mongo-stub: unsupported pipeline stage ${Object.keys(stage)[0]}`);
    }
    return cur;
}

// ---------------- collection API ----------------
function makeCollection(name) {
    const find = (filter = {}, opts = {}) => {
        record('find', name, { filter, projection: opts.projection });
        let rows = coll(name).filter((d) => matches(d, filter));
        let s = opts.sort, lim = opts.limit, skip = opts.skip;
        const cursor = {
            sort(spec) { s = spec; return cursor; },
            limit(n) { lim = n; return cursor; },
            skip(n) { skip = n; return cursor; },
            async toArray() {
                let rows2 = rows;
                if (s) rows2 = [...rows2].sort(sorter(s));
                if (skip) rows2 = rows2.slice(skip);
                if (lim != null) rows2 = rows2.slice(0, lim);
                return rows2.map((d) => project(d, opts.projection));
            },
        };
        return cursor;
    };
    return {
        find,
        async findOne(filter = {}, opts = {}) {
            const rows = await find(filter, opts).sort(opts.sort || {}).limit(1).toArray();
            return rows[0] ?? null;
        },
        async insertOne(doc) {
            record('insertOne', name, { document: doc });
            const d = clone(doc);
            if (d._id === undefined) d._id = cryptoId();
            coll(name).push(d);
            return { acknowledged: true, insertedId: d._id };
        },
        async insertMany(docs) {
            record('insertMany', name, { n: docs.length });
            const ids = [];
            for (const doc of docs) { const d = clone(doc); if (d._id === undefined) d._id = cryptoId(); coll(name).push(d); ids.push(d._id); }
            return { acknowledged: true, insertedCount: ids.length, insertedIds: ids };
        },
        async updateOne(filter, update, opts = {}) {
            record('updateOne', name, { filter, update });
            const rows = coll(name);
            const at = rows.findIndex((d) => matches(d, filter));
            if (at === -1) {
                if (opts.upsert) {
                    const base = {};
                    for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$')) base[k] = v;
                    const inserted = applyUpdate(base, update, true);
                    if (inserted._id === undefined) inserted._id = cryptoId();
                    rows.push(inserted);
                    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: inserted._id };
                }
                return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
            }
            const next = applyUpdate(rows[at], update, false);
            const changed = JSON.stringify(next) !== JSON.stringify(rows[at]);
            rows[at] = next;
            return { acknowledged: true, matchedCount: 1, modifiedCount: changed ? 1 : 0, upsertedCount: 0, upsertedId: null };
        },
        async updateMany(filter, update) {
            record('updateMany', name, { filter, update });
            let matched = 0, modified = 0;
            const rows = coll(name);
            for (let i = 0; i < rows.length; i++) {
                if (!matches(rows[i], filter)) continue;
                matched++;
                const next = applyUpdate(rows[i], update, false);
                if (JSON.stringify(next) !== JSON.stringify(rows[i])) modified++;
                rows[i] = next;
            }
            return { acknowledged: true, matchedCount: matched, modifiedCount: modified, upsertedCount: 0 };
        },
        async findOneAndUpdate(filter, update, opts = {}) {
            record('findOneAndUpdate', name, { filter, update });
            const rows = coll(name);
            let idxs = rows.map((d, i) => [d, i]).filter(([d]) => matches(d, filter)).map(([, i]) => i);
            if (opts.sort) idxs.sort((a, b) => sorter(opts.sort)(rows[a], rows[b]));
            if (idxs.length === 0) {
                if (opts.upsert) { /* unused by handlers */ }
                return null;
            }
            const at = idxs[0];
            const before = clone(rows[at]);
            rows[at] = applyUpdate(rows[at], update, false);
            return project(opts.returnDocument === 'after' ? rows[at] : before, opts.projection);
        },
        async deleteOne(filter) {
            record('deleteOne', name, { filter });
            const rows = coll(name);
            const at = rows.findIndex((d) => matches(d, filter));
            if (at === -1) return { acknowledged: true, deletedCount: 0 };
            rows.splice(at, 1);
            return { acknowledged: true, deletedCount: 1 };
        },
        async deleteMany(filter) {
            record('deleteMany', name, { filter });
            const rows = coll(name);
            const keep = rows.filter((d) => !matches(d, filter || {}));
            const deleted = rows.length - keep.length;
            store.set(name, keep);
            return { acknowledged: true, deletedCount: deleted };
        },
        async countDocuments(filter = {}) {
            record('countDocuments', name, { filter });
            return coll(name).filter((d) => matches(d, filter)).length;
        },
        async distinct(key, filter = {}) {
            record('distinct', name, { filter });
            const set = new Map();
            for (const d of coll(name)) if (matches(d, filter) && d[key] !== undefined) set.set(norm(d[key]), clone(d[key]));
            return [...set.values()];
        },
        aggregate(pipeline) {
            record('aggregate', name, { pipeline: `agg ${pipeline.length} stages` });
            return { async toArray() { return runAggregate(coll(name), pipeline); } };
        },
        async bulkWrite(ops) {
            record('bulkWrite', name, { n: ops.length });
            let inserted = 0, matched = 0, modified = 0, deleted = 0, upserted = 0;
            const upsertedIds = [];
            for (const [i, op] of ops.entries()) {
                const [kind, spec] = Object.entries(op)[0];
                if (kind === 'updateOne') {
                    const r = await this.updateOne(spec.filter, spec.update, { upsert: spec.upsert });
                    matched += r.matchedCount; modified += r.modifiedCount;
                    if (r.upsertedCount) { upserted++; inserted++; upsertedIds.push({ index: i, _id: null }); }
                } else if (kind === 'insertOne') {
                    await this.insertOne(spec.document); inserted++;
                } else if (kind === 'deleteOne') {
                    deleted += (await this.deleteOne(spec.filter)).deletedCount;
                } else throw new Error(`mongo-stub: unsupported bulkWrite op ${kind}`);
            }
            return { acknowledged: true, insertedCount: inserted, matchedCount: matched, modifiedCount: modified, deletedCount: deleted, upsertedCount: upserted, upserted: upsertedIds };
        },
        async createIndex(spec, opts = {}) {
            stats.indexes.push({ collection: name, spec, unique: Boolean(opts.unique) });
            return Object.keys(spec).join('_');
        },
        async drop() { store.set(name, []); },
    };
}

const dbObj = {
    collection: (name) => makeCollection(name),
    async listCollections() { return { async toArray() { return [...store.keys()].map((name) => ({ name })); } } },
    async command() { return { ok: 1 }; },
};

export function getDbName() { return process.env.MONGODB_DB || 'uth_registration'; }
export async function getMongoClient() { return { db: () => dbObj, close() {}, server: { } }; }
export async function getDb() { await gate(); return dbObj; }

// Same semantics as the real implementation: counters.seq holds the highest id handed out.
export async function nextIdRange(counterName, count = 1) {
    await gate();
    const rows = coll('counters');
    let doc = rows.find((d) => d._id === counterName);
    if (!doc) { doc = { _id: counterName, seq: 0 }; rows.push(doc); }
    doc.seq += count;
    record('findOneAndUpdate', 'counters', { filter: { _id: counterName }, update: { $inc: { seq: count } } });
    return { start: doc.seq - count + 1, end: doc.seq };
}
export async function nextId(counterName) { return (await nextIdRange(counterName, 1)).start; }

// ---- pure timezone helpers: identical behaviour to api/db.js ----
export function vnWallClockToUTCDate(value) {
    if (value instanceof Date) return value;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(String(value).trim());
    if (!m) return new Date(value);
    const [, y, mo, d, h, mi, s, ms] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h - 7, +mi, +(s || 0), +((ms || '0').padEnd(3, '0'))));
}
export function utcToVnWallClock(date = new Date()) {
    const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function nowVnWallClock() { return utcToVnWallClock(new Date()); }

export default { getDb, getMongoClient, getDbName, nextId, nextIdRange, stats, configure, reset, seedDocs, dump };
