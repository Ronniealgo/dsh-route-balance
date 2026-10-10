# Changelog

## [0.6.3] - 2026-10-10

### Browser-half activation repair (the sidebar figure never appeared)

The published 0.6.2 shipped a browser half that was loaded by the shell but never activated, so the sidebar seat stayed empty and nothing was logged. A real desktop client showed an empty seat and a clean browser console; the bundle file itself was served and compiled.

- Declare `dsh.client.immediately` in `package.json`. The shipped UI-plugin contract carries this flag (the harness's own authoring template sets it for slot decorations); without it the browser half is not activated at page start.
- Stop hard-requiring the `remote` client service. The bundle now declares `inject = ["slots"]` only, and resolves the Remote namespace opportunistically per read. A client plugin whose injected service never appears stays pending forever and silently, which is the failure mode this release exists to remove.
- Order activation against `@deepseek-ai/dsh-client-connection` in `dsh.client.inject`, so the Remote namespace is provided before this bundle applies when the profile has it.
- Fail visible instead of blank. The shell replaces a slot entry whose component throws with an empty placeholder and logs it only on the browser console, so the control now computes every derived value defensively and renders one readable line ("余额显示出错" with the reason) instead of disappearing; a store that cannot be constructed at all reports "插件启动失败" through the same seat.
- Refresh is invoked defensively: a rejected refresh promise is caught and reported through the snapshot rather than surfacing as an unhandled rejection.

### Verification boundary

Activation was reproduced against the operator's real desktop profile; the entry renders only after a client restart. The 0.6.2 limitations that still apply: no real-browser visual validation in CI, no npm publication, and the local PowerShell execution-policy limit that fails the two Windows entry-point installer tests.

## [0.6.2] - 2026-10-09

### Security and correctness repairs

- Register the fixed balance endpoint through the DSH Connection Fetch registry, so its Host/Origin fence and browser-session authentication precede plugin execution. No direct exact webServer route remains.
- Stop serializing raw credential-store exceptions, API exceptions and Codex stderr. Reject malformed keys before constructing Authorization headers, redact resolved keys from formatted provider metadata, and refuse credential-store denial fallback.
- Reject empty strings, null, booleans, non-finite and out-of-range quota numbers. Unknown is a failed/unavailable entry; a measured 0% is still displayed.
- Give quota entries `summary` and `short`; the generated widget renders the quota next to money rather than hiding it in a tooltip. Missing account Remote no longer blocks API routes.
- Own one background Codex reader per plugin activation. HTTP reads never start Codex; overlapping reads share the in-flight operation, failures retain a labelled old reading, disposal aborts in-flight work, and sign-out clears cached account data.
- Use the complete app-server handshake, including the `initialized` notification. Determine sign-in through `account/read`, not auth.json contents. Pair the limiting quota window with its own reset timestamp.
- Handle asynchronous stream errors and process termination. Quote Windows .cmd shims using cmd.exe rules and terminate the synthetic tested process tree. Limit technical-candidate retries to a total read budget.
- Replace the installer with a byte-preserving managed block and journal. Preserve BOM, line endings, final-newline state and user comments, retain user-owned links, fail closed on damaged blocks, and roll back owned edits on failure. Empty flow lists are explicitly refused instead of corrupted.
- Pack all host modules and the installer helper; use the exact same unscoped package name in the Loader row. Add actual tarball unpack/import tests and explicit negative checks rather than substring checks.
- Extend CI to Windows/Ubuntu and Node 20/22/24. Test-only YAML is prepared separately; the plugin itself still has zero runtime dependencies.
- Make the quota CLI no-write by default. Snapshot writing requires `--write` or `--out`. A live check requires an explicitly supplied browser cookie; an absent plugin or failed HTTP response cannot claim PASS.
- Correct safety documentation and remove personal paths and placeholder publishing URLs from the current release tree. Historical Git objects are not rewritten or included in release source archives.

### Verification boundary

This is a local release candidate, not a claim of a completed public release. Unit and fixture results are recorded separately in the release verification report. Live supplier calls, installation into the operator's active DSH, real-browser visual validation, and remote CI execution require separate verification; historical green tests do not prove those checks.

## [0.6.1] - 2026-10-09

- Historical quota display wording and limiting-window changes (see local commits). Subsequent independent verification found that quota text still did not reach the widget headline; repaired in 0.6.2.

## [0.6.0] - 2026-10-09

- Historical fixes prompted by a live account with a weekly primary window. Earlier implementation and tests did not establish complete authentication, process or packaging safety.

## [0.5.0] - 2026-10-09

- Introduced background quota warming and remaining-allowance helpers. The earlier TTL gap and multiple concurrent starts were later found by independent verification and repaired in 0.6.2.

## [0.4.0] - 2026-10-09

- Added Codex app-server quota reading, executable discovery and snapshot fallback. Earlier statements that the plugin only checked auth.json existence, that auto was opt-in, and that querying Codex caused no disk writes were inaccurate and have been withdrawn.

## [0.3.0] - 2026-10-09

- Added the DeepSeek official key balance adapter and credential environment/Windows registry fallback.
- Added MiMo endpoint probes. The tested candidate paths do not prove that no public usage API exists.

## [0.2.0] - 2026-10-09

- Added host-side API-key provider readings and merged them with the account Remote. The historical direct webServer route lacked the Connection admission gate; do not use this version for that endpoint.

## [0.1.0] - 2026-10-09

- Initial account balance widget, generated bundle and local development installer. The old installer's byte-exact uninstall claim was contradicted by independent byte fixtures and is superseded by the managed installer in 0.6.2.
