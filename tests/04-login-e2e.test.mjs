// End-to-end execution of the REAL api/handler.js login path, with the upstream portal and
// MySQL replaced by instrumented stubs. No production writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStubbed, mkreq, mkres, drain } from './loader.mjs';
import * as fstub from './mocks/fetch-stub.mjs';
import * as mstub from './mocks/mysql-stub.mjs';

const PROFILE = { maSinhVien: '2001090999', hoDem: 'Nguyễn Sun', ten: 'Sin', email: 'sin@ut.edu.vn' };

function healthyPortal() {
  fstub.respondWith((url) => {
    if (url.includes('/user/login')) return { status: 200, body: { success: true, status: 200, body: null, token: 'JWT-ABC' } };
    if (url.includes('getSummaryProfile')) return { status: 200, body: { success: true, status: 200, body: PROFILE } };
    if (url.includes('getDot')) return { status: 200, body: { success: true, status: 200, body: [{ id: 7, tenHocKy: 'HK2/2026' }, { id: 9, tenHocKy: 'HK1/2027' }] } };
    if (url.includes('getCredit')) return { status: 200, body: { success: true, status: 200, body: { credit: 3 } } };
    return { status: 200, body: { success: true, status: 200, body: {} } };
  });
}

test.beforeEach(() => { fstub.reset(); mstub.reset(); delete process.env.FRONTEND_URL; delete process.env.CRON_SECRET; });

test('login returns the upstream token to the client', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'login', payload: { username: '2001090999', password: 'x' } }), res);
  assert.equal(res.body.token, 'JWT-ABC');
});

test('login itself must not touch users/VIP/orders tables (no hidden sweeps or writes)', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  await handler(mkreq({ action: 'login', payload: { username: 'u', password: 'p' } }), mkres());
  await drain(120);
  const touching = mstub.stats.queries.filter((q) => !/activity_logs/i.test(q.sql));
  assert.deepEqual(touching.map((q) => q.sql), [], `login ran ${touching.length} hidden DB statements`);
});

test('REGRESSION GUARD: no order sweep fires during login/validation', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  await handler(mkreq({ action: 'login', payload: { username: 'u', password: 'p' } }), mkres());
  await handler(mkreq({ action: 'validateToken' }), mkres());
  await drain(120);
  const sweeps = mstub.stats.queries.filter((q) => /sp_auto_cancel_unpaid_orders|UPDATE orders/i.test(q.sql));
  assert.equal(sweeps.length, 0,
    `the order sweep fired ${sweeps.length} time(s) during non-order actions. It used to run on EVERY ` +
    `request (handler.js:1100) - a locking UPDATE on the orders table in parallel with the login the ` +
    `user is waiting for. It belongs only on order actions / the Vercel cron.`);
});

test('getInitialData: profile & dot run in parallel; DB is one upsert + one vip read', async () => {
  healthyPortal();
  fstub.setLatency(200);
  mstub.configure({ latencyMs: 25 });
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();

  const a = Date.now();
  const res = mkres();
  await handler(mkreq({ action: 'getInitialData' }), res);
  const ms = Date.now() - a;
  await drain();

  assert.ok(res.body.success, `happy path must succeed, got ${JSON.stringify(res.body)}`);
  assert.equal(res.body.dot.id, 9, 'must select the highest dot id');
  assert.ok(res.body.vip && 'hasVIP' in res.body.vip, 'must return VIP status');

  const all = mstub.stats.queries;
  const userWrites = all.filter((q) => /INSERT INTO users|ON DUPLICATE|UPDATE users/.test(q.sql)).length;
  const vipReads = all.filter((q) => /FROM vip_subscriptions/.test(q.sql)).length;

  console.log(`      getInitialData -> ${ms}ms wall with stubs (2x200ms upstream calls are parallel)`);
  assert.ok(ms < 380,
    `getInitialData took ${ms}ms with two independent 200ms upstream calls — they must run ` +
    `concurrently (Promise.all). Sequential = extra full portal RTT on every login.`);
  assert.equal(userWrites, 1, 'saveUserInfo must be ONE atomic upsert, not SELECT + INSERT/UPDATE');
  assert.equal(vipReads, 1, 'exactly one VIP-status read on the login path');
});

test('a failed query in checkVIPStatus must not leak its pooled connection', async () => {
  fstub.respondWith((url) => {
    if (url.includes('getSummaryProfile')) return { status: 200, body: { success: false, status: 401, message: 'portal down' } };
    if (url.includes('getDot')) return { status: 200, body: { success: true, status: 200, body: [{ id: 1 }] } };
    return { status: 200, body: { success: true, status: 200, body: {} } };
  });
  mstub.configure({ failWith: Object.assign(new Error('Bind parameters must not contain undefined'), { code: 'ER_BIND_PARAM_UNDEFINED' }) });

  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  const res = mkres();
  await handler(mkreq({ action: 'getInitialData' }), res);
  await drain();

  assert.equal(res.statusCode, 200, 'a portal hiccup must not 500 the login');
  const leaked = mstub.stats.acquired - mstub.stats.released;
  assert.ok(leaked <= 0,
    `connection leak: acquired=${mstub.stats.acquired} released=${mstub.stats.released}. ` +
    `checkVIPStatus/getVIPPlansFromDB must release in a finally block.`);
});

test('pool exhaustion must not hang a request forever (acquire() timeout guard)', async () => {
  healthyPortal();
  // getVIPPlans makes exactly ONE DB acquire; simulate a pool whose connections never resolve.
  mstub.configure({ hangAfter: 100000 });
  const handler = await loadStubbed('api/handler.js');
  const a = Date.now();
  const settled = await Promise.race([
    handler(mkreq({ action: 'getVIPPlans', payload: {} }), mkres()).then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('HUNG'), 13000)),
  ]);
  const took = Date.now() - a;
  assert.equal(settled, 'resolved',
    `the request hung: acquire() must race a timeout instead of queueing forever (took ${took}ms)`);
  assert.ok(took < 11000, `acquire should have rejected near its 9s budget; actually took ${took}ms`);
});

test('validateToken: only a real 401 means expired; portal trouble is NOT logout', async () => {
  const handler = await loadStubbed('api/handler.js');

  fstub.respondWith(() => ({ status: 200, body: { success: true, status: 200, body: { credit: 3 } } }));
  const r1 = mkres(); await handler(mkreq({ action: 'validateToken' }), r1);
  assert.equal(r1.body.valid, true, 'a healthy token must validate');

  // HTTP 200 but portal omits `status` in the body (previously reported "expired")
  fstub.respondWith(() => ({ status: 200, body: { success: true, body: { credit: 3 } } }));
  const r2 = mkres(); await handler(mkreq({ action: 'validateToken' }), r2);
  assert.equal(r2.body.valid, true, 'validity must not depend on the upstream echoing status:200 in the body');

  // HTTP 200 text/html (maintenance page)
  fstub.respondWith(() => ({ status: 200, contentType: 'text/html', body: {} }));
  const r3 = mkres(); await handler(mkreq({ action: 'validateToken' }), r3);
  assert.equal(r3.body.valid, false);
  assert.equal(r3.body.upstreamUnavailable, true,
    'unparseable upstream response must be flagged upstreamUnavailable (client keeps session + retries), ' +
    'NOT expired (client wipes session, app.original.js:966)');

  // real 401
  fstub.respondWith(() => ({ status: 401, body: { success: false, status: 401, message: 'Unauthorized' } }));
  const r4 = mkres(); await handler(mkreq({ action: 'validateToken' }), r4);
  assert.equal(r4.body.valid, false);
  assert.equal(r4.body.expired, true, 'a real 401 is the only thing that should expire the session');
});

test('order & log actions reject anonymous callers (no IDOR on orders)', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  for (const [action, payload] of [['checkOrderStatus', { orderId: 1 }], ['cancelOrder', { orderId: 1 }], ['logUserAction', { userId: 'v', action: 'X', details: 'y' }]]) {
    const res = mkres();
    await handler(mkreq({ action, payload }, { token: null }), res);
    assert.equal(res.statusCode, 401, `${action} must reject an unauthenticated request`);
  }
});

test('cancelOrder enforces ownership: token of another student gets 403', async () => {
  fstub.respondWith((url) => {
    if (url.includes('getSummaryProfile')) return { status: 200, body: { success: true, status: 200, body: { maSinhVien: 'OTHER-STUDENT' } } };
    return { status: 200, body: { success: true, status: 200, body: {} } };
  });
  mstub.configure({
    rows: [[/FROM orders/, [{ id: 42, order_code: 'DKHPX', user_id: '2001090999', amount: 432000, payment_status: 'Unpaid', plan_type: '30days' }]]],
  });
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'cancelOrder', payload: { orderId: 42 } }), res);
  assert.equal(res.statusCode, 403, 'a student must not cancel another student\'s order');
});

test('malformed payloads return clean 400s, never a raw TypeError', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'login' }), res);
  const msg = JSON.stringify(res.body);
  assert.equal(res.statusCode, 400, `status should be 400, got ${res.statusCode}: ${msg}`);
  assert.ok(!/Cannot destructure|of undefined|TypeError/.test(msg), `raw internal error leaked: ${msg}`);
});

test('CORS: with FRONTEND_URL unset the handler must NOT fall back to "*"', async () => {
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'login', payload: { username: 'u', password: 'p' } }), res);
  assert.notEqual(res.headers['Access-Control-Allow-Origin'], '*', 'wildcard CORS on the payment endpoint');
});

test('every VIP/payment/data action requires a token', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const guarded = ['getInitialData', 'validateToken', 'checkVIPStatus', 'createVIPOrder', 'getFullSchedule', 'getRegisteredClasses', 'register', 'cancel', 'syncClassData', 'getSharedClassData', 'checkOrderStatus', 'cancelOrder', 'logUserAction'];
  for (const action of guarded) {
    const res = mkres();
    await handler(mkreq({ action, payload: { userId: 'x', plan: '1day', dotId: 1 } }, { token: null }), res);
    assert.equal(res.statusCode, 401, `${action} accepted an unauthenticated request`);
  }
});

test('cron endpoint (GET + Bearer CRON_SECRET) sweeps orders without touching login', async () => {
  process.env.CRON_SECRET = 'cron-topsecret';
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  const ok = mkres();
  await handler({ method: 'GET', headers: { authorization: 'Bearer cron-topsecret' }, body: null }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.swept, true);

  const bad = mkres();
  await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, body: null }, bad);
  assert.equal(bad.statusCode, 405);
});

test('missing CRON_SECRET must not expose the cron endpoint', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler({ method: 'GET', headers: { authorization: 'Bearer anything' }, body: null }, res);
  assert.equal(res.statusCode, 405, 'without CRON_SECRET env set, GET stays 405');
});
