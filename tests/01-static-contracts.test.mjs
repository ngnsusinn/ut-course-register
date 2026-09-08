// Static contracts that must hold for the serverless handlers to be safe under load.
// Pure file analysis — no network, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO } from './helpers.mjs';

const HANDLERS = ['api/handler.js', 'api/admin-handler.js', 'api/sepay-webhook.js'];
const src = (f) => readFileSync(REPO + f, 'utf8');

/** Split a file into {name, start, end} spans for each top-level `function` declaration. */
function functions(lines) {
  const fns = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:async\s+)?function\s+(\w+)/);
    if (m) fns.push({ name: m[1], start: i });
  });
  fns.forEach((f, i) => { f.end = i + 1 < fns.length ? fns[i + 1].start : lines.length; });
  return fns;
}

/** Every function that acquires a pooled connection must release it in a `finally`. */
function leaksIn(file) {
  const lines = src(file).split('\n');
  return functions(lines)
    .map((fn) => {
      const body = lines.slice(fn.start, fn.end);
      const acqAt = body.findIndex((l) => /getConnection\(\)/.test(l));
      if (acqAt === -1) return null;
      // The `acquire()` helper is the sanctioned wrapper: it races a timeout and releases a
      // late arrival itself, so it is not a leak site.
      if (fn.name === 'acquire') return null;
      const finallyAt = body.findIndex((l) => /finally\s*\{/.test(l));
      const releaseAt = body.findIndex((l) => /\.release\(\)/.test(l));
      const safe = finallyAt !== -1 && releaseAt > finallyAt;
      return safe ? null : { fn: fn.name, line: fn.start + acqAt + 1, file };
    })
    .filter(Boolean);
}

test('every pooled connection is released in a finally block', () => {
  const leaks = HANDLERS.flatMap(leaksIn);
  assert.deepEqual(
    leaks, [],
    'LEAK: getConnection() without a `finally { release() }` leaks a pool connection on every ' +
    'query error. Under `waitForConnections:true, queueLimit:0` the pool eventually hangs every ' +
    'request forever. Offenders: ' + leaks.map((l) => `${l.file}:${l.line} ${l.fn}()`).join(', ')
  );
});

test('login-critical helpers checkVIPStatus / getVIPPlansFromDB do not hold a connection across a throw', () => {
  for (const fn of ['checkVIPStatus', 'getVIPPlansFromDB']) {
    assert.doesNotThrow(() => leaksIn('api/handler.js').find((l) => l.fn === fn));
    const offenders = leaksIn('api/handler.js').filter((l) => l.fn === fn);
    assert.deepEqual(offenders, [], `${fn}() sits on the login critical path (getInitialData) and must not leak`);
  }
});

test('mysql pool is configured for a serverless lifecycle', () => {
  for (const file of HANDLERS) {
    const s = src(file);
    // Connection limit may be wrapped as Number(process.env.X || <literal>).
    const raw = s.match(/connectionLimit:\s*(?:Number\(\s*process\.env\.[A-Z0-9_]+(?:\s*\|\|\s*)?(\d+)\s*\)|(\d+))/);
    const limit = Number(raw?.[1] || raw?.[2] || NaN);
    assert.ok(Number.isFinite(limit), `${file} must set connectionLimit`);
    assert.ok(limit <= 10,
      `${file} connectionLimit=${limit}: each warm Vercel lambda opens up to ${limit} sockets. ` +
      `With max_connections=200 on a SHARED MySQL host, a handful of concurrent logins saturates the server. Keep it <=10.`);
    assert.ok(/connectTimeout/.test(s),
      `${file}: no connectTimeout — mysql2 defaults to 10s, so a slow/unreachable DB freezes the login request for 10s.`);
    assert.ok(/enableKeepAlive:\s*true/.test(s),
      `${file}: no enableKeepAlive — after a Vercel instance is frozen and thawed, idle pool sockets are ` +
      `dead; the next request executes on a reset socket and hangs until TCP timeout. This is the ` +
      `classic "first login after a while is slow" symptom.`);
  }
});

test('upstream fetch is bounded by an AbortSignal, not only the node-fetch `timeout` option', () => {
  const s = src('api/handler.js');
  // node-fetch v2 does honour `timeout`, but an explicit abort deadline also covers a proxy that
  // accepts the socket and never answers.
  assert.ok(/AbortSignal|AbortController/.test(s),
    'callApi has no AbortController/AbortSignal deadline (api/handler.js, callApi request options). ' +
    'A hung upstream socket blocks the lambda until Vercel kills it.');
});

test('no per-request write work on the critical path', () => {
  const s = src('api/handler.js');
  // Everything between the handler entry and the action switch is work that every POST pays for.
  const m = s.match(/export default async \(req, res\) => \{([\s\S]*?)\n\s*const \{ action, payload/);
  assert.ok(m, 'could not locate the top of the main handler');
  const prelude = m[1];

  assert.ok(!/^\s*(?:void\s+)?autoCancelExpiredOrders\(\)/m.test(prelude),
    'autoCancelExpiredOrders() must not be called unconditionally before the action switch ' +
    '(api/handler.js, main handler). It takes a pooled connection and runs a locking UPDATE ' +
    'against `orders` in parallel with the login the user is waiting for.');
  assert.ok(/sweepExpiredOrdersThrottled/.test(s) && /ORDER_MAINTENANCE_ACTIONS/.test(s),
    'the order sweep should be throttled and restricted to order-related actions, not run on every request');
});

test('handlers compile under esbuild without syntax errors', async () => {
  const { build } = await import('esbuild');
  for (const file of HANDLERS) {
    const r = await build({ entryPoints: [REPO + file], bundle: true, write: false, platform: 'node', format: 'esm', external: ['mysql2/promise', 'node-fetch'] })
      .then(() => null).catch((e) => e);
    assert.equal(r, null, `${file} failed to compile: ${r?.message}`);
  }
});
