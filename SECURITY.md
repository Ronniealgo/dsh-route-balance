# Security policy — 0.6.2 candidate

## Browser and authenticated host route

The [generated browser bundle](lib/client.js) is public code. It renders formatted amounts and quota text, calls the optional account Remote and makes a same-origin balance request with browser-session credentials. No provider API key belongs in the bundle.

The [host module](lib/index.js) registers `/api/dsh-route-balance/balances` only through `connection.fetch.register`. DSH's shared `/api` admission gate checks Host/Origin and browser-session authentication before selecting the plugin. There is no direct exact webServer route bypass. GET reads provider results; HEAD returns headers without upstream work. Unsupported methods are not registered; the shared Connection dispatcher may return 404, not the plugin handler's defensive 405.

Authenticated local balance data is private. Do not expose a DSH instance without the operator's deployment controls. A loopback binding alone is not authentication.

## Credentials and errors

API adapters resolve named credentials through DSH's service, then process environment and Windows named registry values where appropriate. A service exception is a denial/failure, not permission to bypass it. Invalid key formatting is rejected before fetch. Provider requests refuse redirects, limiting accidental authorization forwarding.

Raw exception messages, credentials objects and Codex stderr are never serialized to the page. Resolved keys are removed from returned formatted provider metadata. Extension adapters are trusted code and must also avoid logging, encoding or returning secrets; redaction is defense in depth, not a guarantee against malicious extension code.

[Core formatting](lib/core.js) and [payload mapping](lib/registry.js) reject unknown values rather than manufacturing zero balances or full allowances. Measured zero remains a valid reading.

## Codex and filesystem effects

The [quota reader](lib/codex.js) does not inspect auth.json. It asks the installed Codex app-server for account type and rate limits, performs no inference request, validates numeric fields, handles pipe/process errors and terminates the child. Technical discovery retries are bounded; authentication/account-type failures are not retried across installations.

Default `auto` starts Codex in the background. **Codex itself uses its configured authentication and may perform network activity and write databases, logs, installation identifiers or other runtime state under its own home.** This is not an entirely disk-read-only process. `snapshot` avoids process execution, `off` avoids the quota reader. `CODEX_HOME` is passed through; the snapshot path follows that home unless explicitly configured.

Caches are activation-local. Failed refreshes retain labelled old readings, except sign-out/API-Key account results clear previous subscription state. Manual snapshots are historical operator-provided data, not an authenticated claim about today's account.

The [installer](tools/install-state.mjs) changes only the selected profile's patch, byte backup, management record, temporary/lock files and plugin link. It owns exact marked bytes, refuses ambiguous or edited ownership, preserves user data, and rolls back its edits on recoverable failures. Existing unowned plugin rows require manual review; damaged records or interrupted installs are not silently overwritten.

## Diagnostic and test boundaries

[The live verifier](tools/verify-live.mjs) accepts an explicitly supplied `DSH_BROWSER_COOKIE`, targets loopback only, never reads the signing-secret store and never creates a real browser grant. Missing authentication is UNVERIFIED, not PASS. Its generated-component check is not visual browser verification.

[The quota CLI](tools/codex-quota.mjs) writes a snapshot only for `--write`/`--out`. This does not prevent Codex's own runtime writes.

Regression suites use synthetic credentials, isolated profiles, an offline tripwire, temporary process fixtures and, optionally, installed DSH modules with an **in-memory test grant**. That synthetic grant does not grant access to a real DSH instance. Real-provider or real-instance validation and public publication require separate operator approval.

## Reporting

Report privately to the maintainer through the security channel of [Ronniealgo/dsh-route-balance](https://github.com/Ronniealgo/dsh-route-balance). No personal maintainer email is published here. Include the candidate version, minimal synthetic reproduction and impact; do not attach keys, cookies, account tokens or real credential dumps.

Versions before 0.6.2 contain known pre-release defects. This document does not claim that the candidate has already been publicly published or that all future DSH versions are compatible.
