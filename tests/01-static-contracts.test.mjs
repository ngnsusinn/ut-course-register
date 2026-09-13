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

function body(file, name) {
  const lines = src(file).split('\n');
  const fn = functions(lines).find((f) => f.name === name);
  assert.ok(fn, `${name}() not found in ${file}`);
  return lines.slice(fn.start, fn.end).join('\n');
}

test('every handler talks to MongoDB only through the shared ./db.js module', () => {
  for (const file of HANDLERS) {
    const s = src(file);
    assert.ok(/from '\.\/db\.js'/.test(s), `${file} must import the shared db module`);
    // There is no per-request connection to acquire/hold/release any more. If those patterns
    // come back, so does the class of bug that used to hang warm lambdas (leaked pool sockets).
    const offenders = s.split('\n')
      .map((l, i) => [i + 1, l.trim()])
      .filter(([, l]) => /createPool|getConnection|acquire\(|\.release\(\)|mysql/i.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.deepEqual(offenders, [], `${file} still does raw connection handling / MySQL:\n  ` + offenders.map(([n, l]) => `${n}: ${l}`).join('\n  '));
  }
});

test('the MongoDB client is configured for a serverless lifecycle', () => {
  const s = src('api/db.js');
  assert.ok(/process\.env\.MONGODB_URI/.test(s), 'db.js must read MONGODB_URI from env');
  assert.ok(/serverSelectionTimeoutMS/.test(s),
    'no serverSelectionTimeoutMS — an unreachable cluster would hang every request until the ' +
    'platform kills the function instead of failing fast.');
  const raw = s.match(/maxPoolSize:\s*Number\(\s*process\.env\.[A-Z0-9_]+(?:\s*\|\|\s*)?(\d+)\s*\)/);
  const limit = Number(raw?.[1]);
  assert.ok(Number.isFinite(limit) && limit <= 10,
    `maxPoolSize should be env-tunable and small (got ${raw?.[1]}): warm Atlas-M0 connections are scarce.`);
  assert.ok(/globalThis/.test(s), 'the client must be cached on globalThis so warm instances reuse it');
  assert.ok(/cache\.promise = null/.test(s),
    'a failed connect must reset the cached promise, or one network blip poisons the instance forever');
  assert.equal(s.match(/MongoClient\.connect\(/g)?.length, 1, 'exactly one connect site; never per request');
});

test('login-critical helpers answer with safe defaults, never a thrown error', () => {
  assert.ok(/unknown:\s*true/.test(body('api/handler.js', 'checkVIPStatus')),
    'checkVIPStatus must return { hasVIP: false, unknown: true } on DB failure so the client keeps its last known state');
  assert.ok(/VIP_PLANS_FALLBACK/.test(body('api/handler.js', 'getVIPPlansFromDB')),
    'getVIPPlansFromDB must fall back to the static plan map on DB failure');
  assert.ok(/return null/.test(body('api/handler.js', 'saveUserInfo')),
    'saveUserInfo must swallow persistence errors (login is not gated on the DB)');
});

test('numeric ids come from the counters collection, not a driver-specific AUTO_INCREMENT', () => {
  const code = HANDLERS.map(src).join('\n').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/LAST_INSERT_ID|insertId|AUTO_INCREMENT/.test(code), 'old MySQL id plumbing must not resurface');
  assert.ok(/nextId\(/.test(code), 'id allocation goes through nextId()/counters');
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
    '(api/handler.js, main handler). It races the login for the same orders and may be frozen ' +
    'mid-write when the platform suspends the instance.');
  assert.ok(/sweepExpiredOrdersThrottled/.test(s) && /ORDER_MAINTENANCE_ACTIONS/.test(s),
    'the order sweep should be throttled and restricted to order-related actions, not run on every request');
});

test('timezone handling is explicit: no bare new Date(wall-clock-string) in the API layer', () => {
  // On Vercel the process TZ is UTC; parsing a 'YYYY-MM-DD HH:mm:ss' wall-clock string with
  // new Date() silently shifts Vietnam datetimes by +7h. Only db.js may contain that parser.
  const offenders = [...HANDLERS, 'api/db.js'].flatMap((f) => src(f).split('\n')
    .map((l, i) => [f, i + 1, l.trim()])
    .filter(([, , l]) => /new Date\((\w*(?:Str|WallClock|DateTime)\w*)\)/.test(l))
    .map(([f, n, l]) => `${f}:${n}  ${l}`));
  assert.deepEqual(offenders, [],
    'wall-clock strings must reach Date through vnWallClockToUTCDate (process-TZ-unsafe new Date(str))');
  assert.ok(/vnWallClockToUTCDate/.test(src('api/db.js')), 'db.js must own the wall-clock parser');
  assert.ok(/vnWallClockToUTCDate/.test(src('api/handler.js')) && /vnWallClockToUTCDate/.test(src('api/sepay-webhook.js')),
    'the expiry writers must convert with vnWallClockToUTCDate');
});

test('handlers compile under esbuild without syntax errors', async () => {
  const { build } = await import('esbuild');
  for (const file of [...HANDLERS, 'api/db.js']) {
    const r = await build({ entryPoints: [REPO + file], bundle: true, write: false, platform: 'node', format: 'esm', external: ['mongodb', 'node-fetch', 'https-proxy-agent', 'abort-controller'] })
      .then(() => null).catch((e) => e);
    assert.equal(r, null, `${file} failed to compile: ${r?.message}`);
  }
});

test('the package has fully swapped mysql2 for mongodb', () => {
  const pkg = JSON.parse(src('package.json'));
  assert.ok(pkg.dependencies.mongodb, 'mongodb must be a dependency');
  assert.equal(pkg.dependencies.mysql2, undefined, 'mysql2 must be removed from dependencies');
});
