// Deterministic stand-in for api/handler.js's upstream dependency (node-fetch).
// Records every call so tests can assert on the number/shape of network round trips.
export const calls = [];
let handler = () => ({ status: 200, body: { success: true, status: 200, body: {}, token: 'tok' } });
let latencyMs = 0;

export function respondWith(fn) { handler = fn; }
export function setLatency(ms) { latencyMs = ms; }
export function reset() { calls.length = 0; handler = () => ({ status: 200, body: { success: true, status: 200, body: {}, token: 'tok' } }); latencyMs = 0; }

export default async function fetchStub(url, options = {}) {
  calls.push({ url, method: options.method, hasAuth: Boolean(options.headers?.Authorization), body: options.body ? JSON.parse(options.body) : null, timeoutOption: options.timeout, hasAgent: Boolean(options.agent) });
  if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
  const spec = (await handler(url, options)) || {};
  const status = spec.status ?? 200;
  const json = JSON.stringify(spec.body ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? (spec.contentType ?? 'application/json') : null) },
    json: async () => JSON.parse(json),
    text: async () => json,
  };
}
