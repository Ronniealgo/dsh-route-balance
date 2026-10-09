// Operator-directed loopback status probe. No fixed machine ports or raw bodies.
//   node tools/bridge-probe.mjs --url http://127.0.0.1:<port>/<path> --allow-live
const args = process.argv.slice(2), at = args.indexOf('--url');
try {
  if (!args.includes('--allow-live') || at < 0 || !args[at + 1]) throw new Error('arguments');
  const url = new URL(args[at + 1]);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('target');
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  // A response body may contain private account state; never print it by default.
  await response.body?.cancel();
  console.log(JSON.stringify({ status: response.status, ok: response.ok, contentType: response.headers.get('content-type') }));
  process.exitCode = response.ok ? 0 : 1;
} catch {
  console.error('UNVERIFIED: supply an explicit loopback --url and --allow-live after operator approval; no default bridge ports are queried.');
  process.exitCode = 2;
}
