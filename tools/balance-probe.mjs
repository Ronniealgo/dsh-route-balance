// Legacy CLI name, now an authenticated host-contract check, not raw key probing.
// No credential files, registry values, signing grants or historical scratch paths.
import { verifyLive } from './verify-live.mjs';
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--json')) {
  console.error('This tool no longer reads raw provider credentials or --only routes. Use the authenticated host verifier with an explicitly supplied DSH_BROWSER_COOKIE.');
  process.exitCode = 2;
} else {
  const result = await verifyLive({ host: process.env.DSH_RPC_URL, cookie: process.env.DSH_BROWSER_COOKIE });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : result.unverified ? 2 : 1;
}
