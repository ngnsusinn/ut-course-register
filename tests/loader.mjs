// Loads a real api/*.js handler with its dependencies swapped for the instrumented stubs.
// The import specifiers are rewritten on disk (no bundling), so the test process and the
// handler share the SAME stub module instance and can inspect recorded traffic.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO } from './helpers.mjs';

const OUT = REPO + '.tmp-tests';
mkdirSync(OUT, { recursive: true });

/**
 * @param {string} rel  path under the repo, e.g. 'api/handler.js'
 * @returns {Promise<Function>} the default-exported handler
 */
export async function loadStubbed(rel) {
  let src = readFileSync(REPO + rel, 'utf8');
  src = src.replace(/from\s+['"]node-fetch['"]/g, `from '${pathToFileURL(REPO + 'tests/mocks/fetch-stub.mjs').href}'`);
  src = src.replace(/from\s+['"]mysql2\/promise['"]/g, `from '${pathToFileURL(REPO + 'tests/mocks/mysql-stub.mjs').href}'`);
  const name = rel.replace(/[/.]/g, '_');
  const file = `${OUT}/${name}.mjs`;
  writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href + `?v=${process.hrtime.bigint()}`);
  return mod.default;
}

/** Vercel-style req/res pair, minimal enough for these handlers. */
export function mkreq(body, { token = 'bearer-token', method = 'POST', headers = {} } = {}) {
  return {
    method, body,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'user-agent': 'node-test',
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}
export function mkres() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.end = () => res;
  return res;
}

/** Let detached fire-and-forget promise chains (autoCancelExpiredOrders) reach a settled state. */
export const drain = (ms = 60) => new Promise((r) => setTimeout(r, ms));
