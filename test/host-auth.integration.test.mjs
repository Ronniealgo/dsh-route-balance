// Optional integration with the operator-supplied, installed DSH modules.
// Only a temporary loopback listener and an in-memory synthetic grant are used.
// Never imports credentials from a real profile or touches a running GUI server.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { apply as balancePlugin, ROUTE_PATH } from '../lib/index.js';
const sdkPackage = process.env.DSH_ROUTE_BALANCE_SDK_PACKAGE;
test('C1 official DSH Connection, Host/Origin fence, signed cookie, HTTP bridge and teardown', {
  skip: !sdkPackage ? 'UNVERIFIED: supply DSH_ROUTE_BALANCE_SDK_PACKAGE for the installed DSH package.json' : false,
  timeout: 20000,
}, async (t) => {
  const require = createRequire(path.resolve(sdkPackage));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
  const { apply: connectionPlugin } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')));
  const { WebServer } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-host-webserver')));
  const ctx = new Context(); let record;
  ctx.provide('credentials', { async modifyRecord(key, modify) {
    const next = await modify(record); if (next) record = next; return record;
  } });
  // Use the real routing table algorithms without activating a DSH webserver.
  const tables = { exact: new Map(), prefixes: new Map() };
  ctx.provide('webServer', {
    register: (route) => WebServer.prototype.register.call(tables, route),
  });
  await connectionPlugin(ctx, {});
  await new Promise(setImmediate);
  let reads = 0, starts = 0, stops = 0;
  balancePlugin(ctx, { codex: { strategy: 'off' } }, {
    credentials: { resolve: async () => undefined },
    providers: [{ id: 'synthetic', label: 'Synthetic', async read() {
      reads++; return { kind: 'ready', amounts: [{ currency: 'USD', text: '$1.23' }] };
    } }],
    codexRuntime: { start() { starts++; }, stop() { stops++; }, entry() { return null; } },
  });
  await new Promise(setImmediate);
  assert.equal(tables.exact.size, 0, 'plugin cannot create an exact route ahead of admission');
  assert.ok(tables.prefixes.has('/api'));
  assert.ok(ctx.connection.fetchRoutes.has(ROUTE_PATH));
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://test.invalid').pathname;
    if (pathname === '/') {
      if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('synthetic index'); }
      return;
    }
    const route = WebServer.prototype.match.call(tables, pathname);
    if (!route) { res.writeHead(404); res.end(); return; }
    Promise.resolve(route.handler(req, res)).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await ctx.fiber.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`, url = base + ROUTE_PATH;
  // Node fetch may overwrite the Host header; raw HTTP is necessary for the
  // rebinding counterexample to actually arrive at the server unchanged.
  const get = (headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: new Headers(response.headers), json: async () => JSON.parse(text), text: async () => text });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('synthetic integration timeout')));
    request.end();
  });
  assert.equal((await get()).status, 401);
  assert.equal((await get({ cookie: 'synthetic-invalid-cookie' })).status, 401);
  assert.equal((await get({ host: 'outside.invalid' })).status, 403);
  assert.equal((await get({ origin: 'http://outside.invalid' })).status, 403);
  assert.equal((await get({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal(reads, 0, 'rejected requests do not reach providers');
  const exchange = await fetch(ctx.connection.authenticatedUrl(base + '/'), { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  const cookie = exchange.headers.get('set-cookie').split(';', 1)[0];
  const authenticated = await get({ cookie, origin: base });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers.get('cache-control'), 'no-store');
  assert.equal((await authenticated.json()).entries[0].amounts[0].text, '$1.23');
  assert.equal(reads, 1);
  assert.equal((await get({ cookie, origin: 'http://outside.invalid' })).status, 403);
  const head = await get({ cookie }, 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(reads, 1, 'HEAD performs no provider work');
  assert.equal((await get({ cookie }, 'POST')).status, 404, 'the official shared registry rejects unsupported methods');
  assert.equal(starts, 1);
  await ctx.fiber.dispose();
  assert.equal(stops, 1);
  assert.equal((await get({ cookie })).status, 404);
});
