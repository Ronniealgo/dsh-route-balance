import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyLive } from '../tools/verify-live.mjs';
import { parseOptions, runQuota } from '../tools/codex-quota.mjs';
import { summarizeRateLimits } from '../lib/codex.js';
import { temporary } from './helpers.mjs';
for (const status of [0, 401, 403, 404, 500]) test(`live verifier must not fake-pass missing/broken plugin HTTP ${status}`, async () => {
  const result = await verifyLive({ cookie: 'FAKE', fetchImpl: async (url) => { assert.match(String(url), /^http:\/\/127\.0\.0\.1:19387\/api\/dsh-route-balance\/balances$/); return { ok: false, status }; } });
  assert.equal(result.passed, false);
});
test('live verifier will not read or fabricate authentication', async () => {
  let calls = 0; const report = await verifyLive({ fetchImpl: () => { calls++; } });
  assert.equal(report.unverified, true); assert.equal(calls, 0);
  assert.equal((await verifyLive({ host: 'https://external.invalid', cookie: 'FAKE', fetchImpl: () => { calls++; } })).passed, false); assert.equal(calls, 0);
});
test('live verifier passes a real-shaped synthetic quota through generated component', async () => {
  const report = await verifyLive({ cookie: 'FAKE', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 1, entries: [{ id: 'quota', kind: 'ready', summary: 'Quota', short: 'GPT 剩 0%', amounts: [] }] }) }) });
  assert.equal(report.passed, true, JSON.stringify(report)); assert.equal(report.displayed, 'GPT 剩 0%'); assert.equal(report.visualBrowserVerified, false);
});
test('quota diagnostic does not write snapshots by default; --out/--write are explicit', async (t) => {
  const dir = temporary(t, 'quota-cli-'), env = { CODEX_HOME: dir }, file = path.join(dir, 'rate-limits.snapshot.json');
  const quota = summarizeRateLimits({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } });
  const deps = { env, home: dir, read: async () => ({ ok: true, quota, readAt: new Date().toISOString() }) };
  const readOnly = await runQuota([], deps); assert.equal(readOnly.report.snapshotWritten, false); assert.equal(fs.existsSync(file), false);
  await runQuota(['--no-write'], deps); assert.equal(fs.existsSync(file), false);
  await runQuota(['--write'], deps); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
  const other = path.join(dir, 'explicit.json'); await runQuota(['--out', other], deps); assert.ok(fs.existsSync(other));
  assert.throws(() => parseOptions(['--out'], env, dir));
});
