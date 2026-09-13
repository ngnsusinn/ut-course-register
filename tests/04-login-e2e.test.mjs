// End-to-end execution of the REAL api/handler.js login/order paths, with the upstream portal
// and MongoDB replaced by instrumented stubs. The Mongo stub is a functional in-memory engine,
// so assertions inspect the resulting DOCUMENTS, not SQL text. No production writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStubbed, mkreq, mkres, drain } from './loader.mjs';
import * as fstub from './mocks/fetch-stub.mjs';
import * as mstub from './mocks/mongo-stub.mjs';

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

const ops = () => mstub.stats.ops;
const opsOn = (coll) => ops().filter((o) => o.collection === coll);

test.beforeEach(() => { fstub.reset(); mstub.reset(); delete process.env.FRONTEND_URL; delete process.env.CRON_SECRET; delete process.env.SEPAY_ACCOUNT_NUMBER; delete process.env.SEPAY_ACCOUNT_NAME; });

test('login returns the upstream token to the client', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'login', payload: { username: '2001090999', password: 'x' } }), res);
  assert.equal(res.body.token, 'JWT-ABC');
});

test('login itself must not touch users/VIP/orders (no hidden sweeps or writes)', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  await handler(mkreq({ action: 'login', payload: { username: 'u', password: 'p' } }), mkres());
  await drain(120);
  const touching = ops().filter((o) => ['users', 'vip_subscriptions', 'orders', 'counters'].includes(o.collection));
  assert.deepEqual(touching.map((o) => `${o.op} ${o.collection}`), [], `login ran ${touching.length} hidden DB operations`);
});

test('REGRESSION GUARD: no order sweep fires during login/validation', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  await handler(mkreq({ action: 'login', payload: { username: 'u', password: 'p' } }), mkres());
  await handler(mkreq({ action: 'validateToken' }), mkres());
  await drain(120);
  const sweeps = ops().filter((o) => o.collection === 'orders' && ['updateMany', 'findOneAndUpdate', 'deleteMany'].includes(o.op));
  assert.equal(sweeps.length, 0,
    `the order sweep mutated orders ${sweeps.length} time(s) during non-order actions. It used to run on ` +
    `EVERY request — now it belongs only on order actions / the Vercel cron.`);
});

test('getInitialData: profile & dot run in parallel; DB is one upsert + one vip read', async () => {
  healthyPortal();
  fstub.setLatency(200);
  mstub.configure({ latencyMs: 25 });
  const handler = await loadStubbed('api/handler.js');
  mstub.reset();
  // Returning student: the users row already exists, so NO counter write is expected.
  // (seed AFTER reset — reset() clears the whole store)
  mstub.seedDocs('users', [{ id: 5, user_id: '2001090999', email: 'old@x.vn', full_name: 'Old Name', is_active: 1, created_at: new Date(0), updated_at: new Date(0) }]);

  const a = Date.now();
  const res = mkres();
  await handler(mkreq({ action: 'getInitialData' }), res);
  const ms = Date.now() - a;
  await drain();

  assert.ok(res.body.success, `happy path must succeed, got ${JSON.stringify(res.body)}`);
  assert.equal(res.body.dot.id, 9, 'must select the highest dot id');
  assert.ok(res.body.vip && 'hasVIP' in res.body.vip, 'must return VIP status');

  console.log(`      getInitialData -> ${ms}ms wall with stubs (2x200ms upstream calls are parallel)`);
  assert.ok(ms < 380,
    `getInitialData took ${ms}ms with two independent 200ms upstream calls — they must run ` +
    `concurrently (Promise.all). Sequential = extra full portal RTT on every login.`);

  const userWrites = opsOn('users').filter((o) => o.op === 'updateOne');
  assert.equal(userWrites.length, 1, 'saveUserInfo must be ONE atomic upsert, not find + insert/update');
  assert.equal(opsOn('counters').length, 0, 'a returning student must not burn an id from the counter');
  const vipReads = opsOn('vip_subscriptions').filter((o) => o.op === 'find');
  assert.equal(vipReads.length, 1, 'exactly one VIP-status read on the login path');

  const stored = mstub.dump('users')[0];
  assert.equal(stored.email, 'sin@ut.edu.vn', 'the upsert must refresh profile fields');
  assert.equal(stored.full_name, 'Nguyễn Sun Sin');
  assert.equal(stored.id, 5, 'the upsert must NOT touch the surrogate id on update');
});

test('first-ever login INSERTS the user with a counter-allocated id', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getInitialData' }), res);
  await drain();

  assert.ok(res.body.success);
  const users = mstub.dump('users');
  assert.equal(users.length, 1);
  assert.equal(users[0].user_id, '2001090999');
  assert.equal(users[0].id, 1, 'the new row gets id = counter.next()');
  assert.ok(opsOn('counters').some((o) => JSON.stringify(o.filter) === JSON.stringify({ _id: 'users' })),
    'id allocation must go through the counters collection');
});

test('a DB outage must not 500 the login; VIP state degrades to unknown', async () => {
  healthyPortal();
  mstub.configure({ failWith: new Error('Server selection timed out after 8000 ms') });
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getInitialData' }), res);
  await drain();

  assert.equal(res.statusCode, 200, 'a DB hiccup must not 500 the login');
  assert.ok(res.body.success, 'getInitialData still returns the portal payload');
  assert.equal(res.body.vip.hasVIP, false);
  assert.equal(res.body.vip.unknown, true,
    'checkVIPStatus must flag `unknown` so the client keeps its last known VIP state instead of ' +
    'telling a paying member they have no VIP because our DB blipped');
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

test('order actions reject anonymous callers (no IDOR on orders)', async () => {
  healthyPortal();
  const handler = await loadStubbed('api/handler.js');
  for (const [action, payload] of [['checkOrderStatus', { orderId: 1 }], ['cancelOrder', { orderId: 1 }]]) {
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
  mstub.seedDocs('orders', [{ id: 42, order_code: 'DKHPX', user_id: '2001090999', amount: 432000, payment_status: 'Unpaid', plan_type: '30days', created_at: new Date() }]);
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'cancelOrder', payload: { orderId: 42 } }), res);
  assert.equal(res.statusCode, 403, 'a student must not cancel another student\'s order');
  assert.equal(mstub.dump('orders')[0].payment_status, 'Unpaid', 'the rejected attempt must not mutate the order');
});

test('cancelOrder by the owner flips exactly the Unpaid order (compare-and-swap)', async () => {
  healthyPortal();
  mstub.seedDocs('orders', [
    { id: 42, order_code: 'DKHPX', user_id: '2001090999', amount: 432000, payment_status: 'Unpaid', plan_type: '30days', created_at: new Date() },
    { id: 43, order_code: 'DKHPY', user_id: '2001090999', amount: 432000, payment_status: 'Paid', plan_type: '30days', created_at: new Date(), paid_at: new Date() },
  ]);
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'cancelOrder', payload: { orderId: 42 } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const [o42, o43] = mstub.dump('orders');
  assert.equal(o42.payment_status, 'Cancelled');
  assert.ok(o42.cancelled_at instanceof Date, 'cancelled_at must be stamped');
  assert.equal(o43.payment_status, 'Paid', 'cancelOrder must never touch paid orders');

  const again = mkres();
  await handler(mkreq({ action: 'cancelOrder', payload: { orderId: 42 } }), again);
  assert.equal(again.statusCode, 404, 'a second cancel of the same order is a 404, not a success');
});

test('createVIPOrder end-to-end: unique code, counter id, Unpaid document', async () => {
  healthyPortal();
  process.env.SEPAY_ACCOUNT_NUMBER = '01006022006';
  process.env.SEPAY_ACCOUNT_NAME = 'TEST ACCOUNT';
  mstub.seedDocs('users', [{ id: 5, user_id: '2001090999', is_active: 1 }]);
  mstub.seedDocs('vip_plans', [
    { id: 1, plan_key: '1day', plan_name: '1 Ngày VIP', duration_days: 1, price: 30000, is_active: 1, sort_order: 1 },
    { id: 3, plan_key: '30days', plan_name: '30 Ngày VIP', duration_days: 30, price: 432000, is_active: 1, sort_order: 5 },
  ]);
  mstub.seedDocs('counters', [{ _id: 'orders', seq: 113 }]);
  const handler = await loadStubbed('api/handler.js');
  try {
    const res = mkres();
    await handler(mkreq({ action: 'createVIPOrder', payload: { userId: '2001090999', plan: '30days' } }), res);

    assert.equal(res.body.success, true, JSON.stringify(res.body));
    const orders = mstub.dump('orders');
    assert.equal(orders.length, 1);
    const o = orders[0];
    assert.equal(o.id, 114, 'next id continues from the migrated AUTO_INCREMENT');
    assert.equal(o.user_id, '2001090999');
    assert.equal(o.plan_id, 3);
    assert.equal(o.amount, 432000);
    assert.equal(o.payment_status, 'Unpaid');
    assert.match(o.order_code, /^DKHP[A-Z0-9]{12}$/, 'order code format DKHP + 12 CSPRNG chars');
    assert.ok(o.created_at instanceof Date);
    assert.equal(res.body.order.amount, 432000);
    assert.equal(res.body.order.orderCode, o.order_code);
  } finally {
    delete process.env.SEPAY_ACCOUNT_NUMBER;
    delete process.env.SEPAY_ACCOUNT_NAME;
  }
});

test('free-plan order activates VIP instead of creating an order', async () => {
  healthyPortal();
  mstub.seedDocs('users', [{ id: 5, user_id: '2001090999', is_active: 1 }]);
  mstub.seedDocs('vip_plans', [{ id: 4, plan_key: 'free', plan_name: 'Miễn phí', duration_days: 1, price: 0, is_active: 1, sort_order: 0 }]);
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'createVIPOrder', payload: { userId: '2001090999', plan: 'free' } }), res);

  assert.equal(res.body.success, true, JSON.stringify(res.body));
  assert.equal(res.body.order.activated, true);
  assert.equal(mstub.dump('orders').length, 0, 'no order document for free plans');
  const subs = mstub.dump('vip_subscriptions');
  assert.equal(subs.length, 1);
  assert.ok(subs[0].expiry_date instanceof Date, 'expiry stored as a real UTC instant');
  // 1-day plan bought today → expiry wall-clock must be VN end of day tomorrow
  const wall = mstub.utcToVnWallClock(subs[0].expiry_date);
  assert.match(wall, / 23:59:59$/, `expiry must land on VN end-of-day, got ${wall}`);
});

test('the maintenance sweep cancels only stale (>15min) Unpaid orders', async () => {
  healthyPortal();
  mstub.seedDocs('orders', [
    { id: 1, order_code: 'OLD', user_id: 'u', amount: 1, payment_status: 'Unpaid', created_at: new Date(Date.now() - 20 * 60 * 1000) },
    { id: 2, order_code: 'NEW', user_id: 'u', amount: 1, payment_status: 'Unpaid', created_at: new Date(Date.now() - 60 * 1000) },
    { id: 3, order_code: 'PAID', user_id: 'u', amount: 1, payment_status: 'Paid', created_at: new Date(Date.now() - 90 * 60 * 1000) },
  ]);
  const handler = await loadStubbed('api/handler.js');
  // getVIPPlans is an ORDER_MAINTENANCE action: it sweeps (throttled) before answering.
  const res = mkres();
  await handler(mkreq({ action: 'getVIPPlans', payload: {} }), res);
  assert.equal(res.body.success, true);

  const [o1, o2, o3] = mstub.dump('orders');
  assert.equal(o1.payment_status, 'Cancelled', 'stale unpaid orders must be reaped');
  assert.equal(o2.payment_status, 'Unpaid', 'orders inside the 15-minute window stay');
  assert.equal(o3.payment_status, 'Paid', 'paid orders are never touched');
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
  const guarded = ['getInitialData', 'validateToken', 'checkVIPStatus', 'createVIPOrder', 'getFullSchedule', 'getRegisteredClasses', 'register', 'cancel', 'syncClassData', 'getSharedClassData', 'checkOrderStatus', 'cancelOrder'];
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
  assert.ok(opsOn('orders').some((o) => o.op === 'find'), 'the sweep must actually query orders');

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

test('syncClassData upserts classes and the contributor ledger', async () => {
  healthyPortal();
  mstub.seedDocs('shared_class_data', [{
    id: 1, dot_id: 76, ma_lop_hoc_phan: 'A01', ma_hoc_phan: 'A0', ten_mon_hoc: 'Cũ', so_tin_chi: 2,
    class_id: 10, ten_trang_thai: 'Đang chờ', phan_tram_dang_ky: 10, cho_dang_ky: 1,
    schedule_details: [{ thu: 2 }], source: 'dkhp', is_bat_buoc: 0, contributed_by: 'other', last_updated_by: 'other',
    contributor_count: 3, created_at: new Date(0), updated_at: new Date(0),
  }]);
  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({
    action: 'syncClassData',
    payload: {
      dotId: 76, userId: '2001090999', source: 'dkhp',
      classData: [
        { maLopHocPhan: 'A01', maHocPhan: 'A0', tenMonHoc: 'Mới', soTinChi: 2, id: 10, phanTramDangKy: 55, scheduleDetails: [{ thu: 3 }], isBatBuoc: false },
        { maLopHocPhan: 'B02', maHocPhan: 'B0', tenMonHoc: 'Lớp mới', soTinChi: 3, id: 20, phanTramDangKy: 5, scheduleDetails: [] },
      ],
    },
  }), res);
  await drain();

  assert.equal(res.body.success, true, JSON.stringify(res.body));
  const docs = mstub.dump('shared_class_data');
  assert.equal(docs.length, 2);
  const a01 = docs.find((d) => d.ma_lop_hoc_phan === 'A01');
  const b02 = docs.find((d) => d.ma_lop_hoc_phan === 'B02');
  assert.equal(a01.ten_mon_hoc, 'Mới', 'existing class is refreshed in place');
  assert.equal(a01.contributor_count, 4, 'existing class: contributor_count +1');
  assert.equal(a01.is_bat_buoc, 0);
  assert.equal(b02.contributor_count, 1, 'new class starts at contributor_count = 1');
  assert.equal(b02.contributed_by, '2001090999');
  assert.ok(Array.isArray(b02.schedule_details), 'schedule_details stored as an array, not a JSON string');
  assert.equal(res.body.inserted, 1);
  assert.equal(res.body.updated, 1);

  const ledger = mstub.dump('class_data_contributions');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].user_id, '2001090999');
  assert.equal(ledger[0].dot_id, 76);
  assert.equal(ledger[0].classes_contributed, 2);
  assert.equal(ledger[0].sync_count, 1);

  // second sync by the same student accumulates on the same ledger row
  const res2 = mkres();
  await handler(mkreq({
    action: 'syncClassData',
    payload: { dotId: 76, userId: '2001090999', source: 'dkhp', classData: [{ maLopHocPhan: 'B02', maHocPhan: 'B0', tenMonHoc: 'Lớp mới', soTinChi: 3, id: 20 }] },
  }), res2);
  assert.equal(mstub.dump('class_data_contributions').length, 1, 'one ledger row per (user,dot)');
  assert.equal(mstub.dump('class_data_contributions')[0].sync_count, 2);
});
