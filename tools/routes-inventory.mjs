// Public profile-package snapshot only. Never discovers or reads credential stores.
//   node tools/routes-inventory.mjs --input <profile-package.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function inventorySnapshot(file) {
  if (!file || fs.statSync(file).size > 1024 * 1024) throw new Error('input');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = pkg?.dsh?.profile?.bundles;
  return { source: 'operator-supplied package snapshot', runtimeProviderDiscovery: false, credentialStoresRead: false,
    bundles: Array.isArray(values) ? values.filter((s) => typeof s === 'string' && /^[a-z0-9@/_.-]{1,160}$/i.test(s)) : [] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--input');
  try { if (at < 0 || !args[at + 1]) throw new Error('input'); console.log(JSON.stringify(inventorySnapshot(args[at + 1]), null, 2)); }
  catch { console.error('UNVERIFIED: provide --input <public profile-package.json>; automatic home, provider and credential-store discovery has been removed.'); process.exitCode = 2; }
}
