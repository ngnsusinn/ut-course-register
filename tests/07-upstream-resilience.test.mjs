// Regression guard for upstream resilience (api/handler.js callApi).
//
// The portal rate-limits hard (429) and its edge drops sockets mid-response under a burst, which
// node-fetch reports as "Invalid response body while trying to fetch ...: Premature close". The
// old callApi made exactly ONE attempt, so every dropped socket became a permanent
// `scheduleDetails: { error: true }` for the user. These tests pin the recovery behaviour AND the
// safety rule that a non-idempotent registration POST is never silently replayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStubbed, mkreq, mkres, drain } from './loader.mjs';
import * as fstub from './mocks/fetch-stub.mjs';
import * as mstub from './mocks/mysql-stub.mjs';

// Keep backoff negligible so the suite stays fast; the constants are read when the handler loads.
process.env.UPSTREAM_RETRY_BASE_MS = '50';
process.env.UPSTREAM_RETRY_MAX_MS = '50';

const prematureClose = () => Object.assign(
  new Error('Invalid response body while trying to fetch https://portal.ut.edu.vn/api/v1/dkhp: Premature close'),
  { code: 'ERR_STREAM_PREMATURE_CLOSE' }
);

const detailOk = () => ({ status: 200, body: { success: true, status: 200, body: [{ thu: 2, tietHoc: '1-3', loaiLich: 'LT' }] } });
const genericOk = () => ({ status: 200, body: { success: true, status: 200, body: {} } });

test.beforeEach(() => { fstub.reset(); mstub.reset(); });

test('GET schedule detail retries a dropped connection instead of returning error:true', async () => {
  let attempts = 0;
  fstub.respondWith((url) => {
    if (!url.includes('getLopHocPhanDetail')) return genericOk();
    attempts++;
    if (attempts === 1) throw prematureClose();
    return detailOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getScheduleDetails', payload: { classId: 219191, source: 'dkhp' } }), res);

  assert.equal(attempts, 2, 'the transient "Premature close" must be retried once on a fresh socket');
  assert.equal(res.body.success, true, `detail fetch must succeed after retry, got ${JSON.stringify(res.body)}`);
  assert.ok(Array.isArray(res.body.body) && res.body.body.length === 1, 'the retry must return the real schedule');
});

test('GET schedule detail retries an explicit HTTP 429 rate-limit', async () => {
  let attempts = 0;
  fstub.respondWith((url) => {
    if (!url.includes('getLopHocPhanDetail')) return genericOk();
    attempts++;
    if (attempts === 1) return { status: 429, body: { success: false, status: 429, message: 'Hệ thống đang xử lý yêu cầu của bạn' } };
    return detailOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getScheduleDetails', payload: { classId: 219191, source: 'dkhp' } }), res);

  assert.equal(attempts, 2, 'a 429 is transient and must be retried');
  assert.equal(res.body.success, true, 'rate-limited detail fetch must recover');
});

test('GET schedule detail retries a 5xx server error', async () => {
  let attempts = 0;
  fstub.respondWith((url) => {
    if (!url.includes('getLopHocPhanDetail')) return genericOk();
    attempts++;
    if (attempts === 1) return { status: 502, body: { success: false, status: 502, message: 'Bad gateway' } };
    return detailOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getScheduleDetails', payload: { classId: 219191, source: 'dkhp' } }), res);

  assert.equal(attempts, 2, 'an HTTP 5xx is transient and must be retried');
  assert.equal(res.body.success, true);
});

test('SAFETY: the non-idempotent registration POST is never replayed on a dropped socket', async () => {
  let registerCalls = 0;
  fstub.respondWith((url) => {
    if (url.includes('dangKyLopHocPhan')) { registerCalls++; throw prematureClose(); }
    return genericOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'register', payload: { classId: 5, source: 'dkhp', userId: 'u', className: 'X' } }), res);
  await drain();

  assert.equal(registerCalls, 1,
    'a dropped socket on dangKyLopHocPhan is ambiguous (the write may have landed) — replaying it ' +
    'can double-register the class. It must surface as a failure instead.');
  assert.equal(res.body.success, false, 'the ambiguous failure must reach the client');
});

test('SAFETY: the registration POST IS retried on an explicit 429, which proves it was not applied', async () => {
  let registerCalls = 0;
  fstub.respondWith((url) => {
    if (url.includes('dangKyLopHocPhan')) {
      registerCalls++;
      if (registerCalls === 1) return { status: 429, body: { success: false, status: 429, message: 'rate limited' } };
      return { status: 200, body: { success: true, status: 200, body: { message: 'Đăng ký thành công' } } };
    }
    return genericOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'register', payload: { classId: 5, source: 'dkhp', userId: 'u', className: 'X' } }), res);
  await drain();

  assert.equal(registerCalls, 2, 'an explicit 429 is a hard rejection the portal did not apply — retrying is safe');
  assert.equal(res.body.success, true, 'the registration must go through after the rate limit clears');
});

test('DELETE (cancel) retries a dropped connection', async () => {
  let cancelCalls = 0;
  fstub.respondWith((url) => {
    if (url.includes('huyDangKy')) {
      cancelCalls++;
      if (cancelCalls === 1) throw prematureClose();
      return { status: 200, body: { success: true, status: 200, body: { message: 'ok' } } };
    }
    return genericOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'cancel', payload: { registrationId: 12, source: 'dkhp', userId: 'u' } }), res);
  await drain();

  assert.equal(cancelCalls, 2, 'DELETE is idempotent and must be retried');
  assert.equal(res.body.success, true);
});

test('a non-JSON maintenance page is NOT retried (it is a definite answer, and retrying stalls the request)', async () => {
  let attempts = 0;
  fstub.respondWith((url) => {
    if (!url.includes('getLopHocPhanDetail')) return genericOk();
    attempts++;
    return { status: 200, contentType: 'text/html', body: {} };
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getScheduleDetails', payload: { classId: 219191, source: 'dkhp' } }), res);

  assert.equal(attempts, 1, 'an HTML maintenance page must fail fast, not be retried');
  assert.equal(res.body.success, false);
});

test('getFullSchedule bounds schedule-detail concurrency instead of firing every request at once', async () => {
  let inFlight = 0;
  let peak = 0;
  // The stub is synchronous, so give each request a short real latency for overlap to be observable.
  fstub.setLatency(15);
  fstub.respondWith((url) => {
    if (url.includes('getHocPhanHocMoi')) {
      return { status: 200, body: { success: true, status: 200, body: Array.from({ length: 12 }, (_, i) => ({ maHocPhan: `HP${i}`, tenMonHoc: `Môn ${i}` })) } };
    }
    if (url.includes('getLopHocPhanChoDangKy')) {
      const ma = new URL(url).searchParams.get('maHocPhan');
      return { status: 200, body: { success: true, status: 200, body: Array.from({ length: 20 }, (_, i) => ({ id: `${ma}-${i}`, maLopHocPhan: `${ma}-${i}` })) } };
    }
    if (url.includes('getLopHocPhanDetail')) {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Hold the request open briefly so genuine overlap is observable; release when it "completes".
      return new Promise((resolve) => setTimeout(() => { inFlight--; resolve(detailOk()); }, 15));
    }
    return genericOk();
  });

  const handler = await loadStubbed('api/handler.js');
  const res = mkres();
  await handler(mkreq({ action: 'getFullSchedule', payload: { dotId: 77, userId: 'u' } }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.schedule.length, 240, 'all 12 subjects x 20 classes must be returned');
  assert.ok(res.body.schedule.every((c) => Array.isArray(c.scheduleDetails)),
    'every class must carry real schedule details');
  assert.ok(peak > 1, 'the test must actually observe overlapping requests');
  assert.ok(peak <= 16,
    `detail fetching peaked at ${peak} concurrent requests; getFullSchedule must bound concurrency ` +
    `(DETAIL_FETCH_CONCURRENCY, default 16) instead of Promise.all-ing hundreds of requests.`);
});
