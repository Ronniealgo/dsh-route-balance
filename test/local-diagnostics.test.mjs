import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, temporary } from './helpers.mjs';
import { inventorySnapshot } from '../tools/routes-inventory.mjs';
for (const file of ['verify-live.mjs', 'balance-probe.mjs', 'bridge-probe.mjs', 'routes-inventory.mjs']) {
  test(`diagnostic ${file} defaults to UNVERIFIED without implicit account or port probing`, () => {
    const env = { ...process.env, DSH_ROUTE_BALANCE_TEST: '1' };
    for (const key of Object.keys(env)) if (/BROWSER_COOKIE|AUTH_TOKEN|API_KEY|OAUTH_TOKEN/i.test(key)) delete env[key];
    const result = spawnSync(process.execPath, ['--require', path.join(ROOT, 'tools/offline-guard.cjs'), path.join(ROOT, 'tools', file)], { encoding: 'utf8', timeout: 10000, cwd: ROOT, env });
    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
  });
}
test('inventory reads only an explicitly supplied public snapshot, not its private fields', (t) => {
  const dir = temporary(t, 'inventory-'), file = path.join(dir, 'package.json');
  fs.writeFileSync(file, JSON.stringify({ dsh: { profile: { bundles: ['dsh-route-balance'] } }, token: 'SYNTHETIC_SECRET', credentials: { secret: 'SYNTHETIC_SECRET' } }));
  const result = inventorySnapshot(file);
  assert.deepEqual(result.bundles, ['dsh-route-balance']); assert.equal(result.credentialStoresRead, false);
  assert.equal(result.runtimeProviderDiscovery, false); assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET/);
});
