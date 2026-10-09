# Notes for agents working in this repository

These local facts supplement, not replace, the user's global cooperation and routing rules.

## Files and interfaces

- [lib/client.js](lib/client.js) is generated from [src/client.bundle.js](src/client.bundle.js), [lib/core.js](lib/core.js) and [lib/registry.js](lib/registry.js). Never hand-edit it; use the [build script](tools/build-client.mjs).
- [lib/index.js](lib/index.js) is the active host half. It injects `connection` and registers the fixed authenticated `/api/dsh-route-balance/balances` Fetch route. Do not restore direct exact webServer registration or a configurable route path.
- [lib/codex.js](lib/codex.js) handles the protocol; [lib/codex-entry.js](lib/codex-entry.js) owns activation-local warming, cached entries and lifetime cancellation. HTTP entry reads are synchronous and must not spawn processes.
- The browser bundle must be self-contained. Only platform seed modules and package roots can be required, not relative package subpaths.
- Entry states are `kind: 'ready' | 'failed' | 'unavailable' | 'loading'`, not `status`. Ready requires valid money amounts or a nonempty quota summary. Unknown cannot become 0 or 100%; measured zero is valid.
- Raw exceptions, credential values, auth.json contents, Codex stderr and personal filesystem paths do not belong in returned browser data.
- Preserve LF and the existing MIT license. Renaming the package requires coordinated changes to the Loader row, installer and generated ID.

## Verification

```bash
node tools/build-client.mjs
node tools/build-client.mjs --check
node tools/check-package.mjs
node tools/run-tests.mjs
```

Installation fixtures need a test-only YAML parser (or `DSH_ROUTE_BALANCE_YAML_PACKAGE` pointing to an installed parser package file). The default runner includes its own self-tests, uses one sequential Node child per file and preloads the offline tripwire. It must fail on absent suites, failed/crashed children, missing guard and stale artifacts; do not skip failures to manufacture green results.

Optional official DSH integration uses `DSH_ROUTE_BALANCE_SDK_PACKAGE` as a dependency anchor and an in-memory synthetic grant, not a real account. Keep test data in isolated temporary directories and verify targets before deleting them.

Do not run real diagnostics, install into real profiles, read/mint real browser credentials, restart the running GUI or publicly upload without specific user approval. Fake-runtime rendering is not real-browser visual proof. See the [handoff checklist](docs/HANDOFF-VERIFICATION.md).
