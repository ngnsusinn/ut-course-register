// Stand-in for mysql2/promise that counts acquisitions/releases and can inject failures or
// scripted result rows. This is what proves the connection-leak hypothesis without writing to
// production.
export const stats = { created: 0, acquired: 0, released: 0, queries: [], pending: 0, hanging: 0 };
let failWith = null;      // Error to throw from execute()
let queryLatencyMs = 0;
let maxConnections = Infinity;
let hangAfter = Infinity; // simulate an exhausted pool
let scriptedRows = null;  // [[regex, rows], ...] — first matching regex wins

export function configure(o = {}) {
  if ('failWith' in o) failWith = o.failWith;
  if ('latencyMs' in o) queryLatencyMs = o.latencyMs;
  if ('maxConnections' in o) maxConnections = o.maxConnections;
  if ('hangAfter' in o) hangAfter = o.hangAfter;
  if ('rows' in o) scriptedRows = o.rows;
}
export function reset() {
  stats.created = 0; stats.acquired = 0; stats.released = 0; stats.queries.length = 0; stats.pending = 0; stats.hanging = 0;
  failWith = null; queryLatencyMs = 0; maxConnections = Infinity; hangAfter = Infinity; scriptedRows = null;
}
export const leakCount = () => stats.acquired - stats.released;

function pickRows(sql) {
  if (!scriptedRows) return [[]];
  for (const [re, rows] of scriptedRows) {
    if (re.test(sql)) return [rows];
  }
  return [[]];
}

function makeConnection() {
  return {
    async execute(sql, params) {
      if (queryLatencyMs) await new Promise((r) => setTimeout(r, queryLatencyMs));
      stats.queries.push({ sql: sql.replace(/\s+/g, ' ').trim().slice(0, 200), params });
      if (failWith) throw failWith;
      return pickRows(sql);
    },
    async query(sql, params) { return this.execute(sql, params); },
    async beginTransaction() { stats.queries.push({ sql: 'BEGIN' }); },
    async commit() { stats.queries.push({ sql: 'COMMIT' }); },
    async rollback() { stats.queries.push({ sql: 'ROLLBACK' }); },
    release() { stats.released += 1; },
    destroy() {},
  };
}

export function createPool(config) {
  stats.created += 1;
  const pool = {
    pool: config,
    __config: config,
    on() {}, // real mysql2 pools are EventEmitters; handlers attach an 'error' listener
    async getConnection() {
      if (stats.acquired >= hangAfter) { stats.hanging += 1; return new Promise(() => {}); } // never resolves
      if (stats.acquired - stats.released >= maxConnections) {
        const e = new Error('Max connections reached'); e.code = 'ER_CON_COUNT_ERROR'; throw e;
      }
      stats.acquired += 1;
      return makeConnection();
    },
    async execute(sql, params) {
      const c = await this.getConnection();
      try { return await c.execute(sql, params); } finally { c.release(); }
    },
    end() { return Promise.resolve(); },
    destroy() {},
  };
  return pool;
}

export default { createPool };
