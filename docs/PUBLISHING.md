# Publishing checklist — 0.6.2 experimental pre-release

This checklist covers the experimental 0.6.2 pre-release published from the settled public repository. It does not by itself authorize installation into the operator's active DSH, account calls, Git pushes or npm publication; the upload/tag state is read from the GitHub repository, not asserted here.

## 1. Honest identity and scope

- Keep the current unscoped name `dsh-route-balance`. [The manifest](../package.json), [Loader row](../cordis.patch.yml), [installer](../tools/install-state.mjs) and generated module ID must agree exactly.
- No maintainer email is published for this candidate. Absent metadata is preferable to invented URLs, addresses or author names. Public repository source: <https://github.com/Ronniealgo/dsh-route-balance>; npm identity for this candidate stays unpublished.
- Keep public wording and badges honest while the release is a **GitHub pre-release (experimental)**: no plugin-marketplace inclusion, no DSH endorsement and no unverified badge claims. Upload/tag state is read from the GitHub repository, not asserted here.
- Preserve the [MIT license and existing attribution](../LICENSE). Do not transfer another project's licensing decision here, and do not rewrite the original author line or invent an email. Link the maintainer as the GitHub account [Ronniealgo](https://github.com/Ronniealgo) only.
- The package requires Node >=20 and a DSH version with the authenticated Connection Fetch registry. Metadata is not a blanket real-instance compatibility certificate.

## 2. Local release gate

Prepare a test-only YAML parser, or set `DSH_ROUTE_BALANCE_YAML_PACKAGE` to an installed parser's package file. It is not a plugin runtime dependency.

```bash
node tools/build-client.mjs
node tools/build-client.mjs --check
node tools/check-package.mjs
node tools/run-tests.mjs
```

All failures matter. The runner includes its self-tests and rejects empty suites. Its deliberately failing synthetic fixtures must be asserted by the surrounding test suite, not counted as product passes by themselves.

The actual package test performs offline `npm pack`, unpacks the result and imports its host entry without applying it. Confirm actual packaged file names, not just the repository tree. The identity checker alone is not a signature or proof of authenticity.

## 3. What ships

The runtime archive contains the six JavaScript host/client modules; the Loader patch; the PowerShell entry; the Node installer/YAML-check helpers; the quota CLI; and README, CHANGELOG, LICENSE and SECURITY. The [manifest's explicit `files` list](../package.json) is authoritative. Source templates, tests, CI and build tools belong in the separate source archive.

Do not include `.git`, profile files, installed dependency trees, account credentials, test homes, npm caches or private acceptance logs in a public source archive. Old Git history is preserved locally for review; public uploading of that history needs an independent privacy decision. Do not automatically rewrite it.

## 4. Validation still separate from unit tests

The optional [official Connection integration](../test/host-auth.integration.test.mjs) uses an explicitly supplied DSH dependency anchor, a synthetic in-memory grant and a temporary loopback listener. This checks the actual routing/admission/HTTP bridge without altering the real GUI.

Before public release, explicitly decide and perform any required:

- installation into an isolated real DSH profile and actual browser rendering;
- live supplier/account quota verification with approved credentials;
- remote Windows/Ubuntu Node 20/22/24 CI execution;
- public registry-name/account ownership confirmation and upload.

[verify-live](../tools/verify-live.mjs) requires a supplied browser cookie and never creates a real grant. A 404 or unavailable host is not PASS. Generated-component rendering is not visual browser proof. A real quota query may write Codex's own runtime state, even when no snapshot is written.

## 5. Public release is an operator action

Only after the owner separately approves the target repository, npm identity, exposure scope and remaining real checks should publishing/tagging/pushing be performed. Nothing in this candidate automatically uploads. The public source repository is settled as <https://github.com/Ronniealgo/dsh-route-balance>; the experimental 0.6.2 release is presented as a **GitHub pre-release**. One public installation entry is the pinned GitHub spec (this plugin is not published on npm; the profile package manager may still resolve registry dependencies), e.g. `dsh plugin --profile desktop add "github:Ronniealgo/dsh-route-balance#v0.6.2"`; the plugin page "add plugin" paste of the same spec is the other. See the [README installation section](../README.md#安装), the [handoff checklist](HANDOFF-VERIFICATION.md) and [security boundary](../SECURITY.md).
