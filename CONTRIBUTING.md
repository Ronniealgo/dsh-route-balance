# Contributing

Use the public source repository <https://github.com/Ronniealgo/dsh-route-balance> (0.6.2 is a GitHub pre-release) or the source archive provided by the maintainer. The npm package is not published, so there is no npm-based contribution flow. Do not add invented URLs, maintainer emails or author names.

## First checks

The plugin has no runtime dependencies. Installation fixtures need the test-only YAML parser; see the [README](README.md) for an offline dependency path or preparation command.

```bash
node tools/build-client.mjs --check
node tools/check-package.mjs
node tools/run-tests.mjs
```

Do not install into a real profile, restart DSH, call real suppliers or publish merely to validate a patch. Default tests use synthetic inputs. An explicitly approved live validation is a separate step and must be reported separately.

## Rules

- [lib/client.js](lib/client.js) is generated. Edit the [template](src/client.bundle.js), [core](lib/core.js) or [registry](lib/registry.js), then rebuild. Never hand-edit the artifact.
- Host credentials never belong in browser code, logs, tooltips or raw exceptions.
- Return `kind: 'failed'`/`'unavailable'` for unknown readings. A measured zero is fine; a coerced unknown zero is not.
- New behavior needs falsifiable regression tests using independent inputs, not assertions that merely find the expected source string.
- Preserve zero runtime dependencies and LF source endings. Test-only dependency preparation is separate.
- Keep architecture, interface changes and security-critical logic with the Lead; delegated code still requires Lead diff review and re-run acceptance.
- Respect other projects and disjoint write scopes. Do not reset/rewrite another worker's changes.

## Adding providers

API-key adapters belong in the [host module](lib/index.js). They receive `{ key, fetchImpl, signal, config }`, resolve a credential by a stable name and return a sanitized result:

```js
{
  id: 'example', label: 'Example', credential: 'EXAMPLE_API_KEY',
  async read({ key, fetchImpl, signal }) {
    // Fixed supplier endpoint, timeout signal and redirects disabled.
    // Validate JSON field types before creating an amount.
    return { kind: 'ready', amounts: [{ currency: 'USD', text: '$1.00' }] };
  }
}
```

Quota entries use a nonempty `summary` and optional compact `short`; they do not pretend to be currency amounts. Ready entries without any displayable amount/summary are invalid. The fixed route goes through `connection.fetch.register`, never an unauthenticated direct webServer exact route.

Remote-backed browser sources may be added to the [client template](src/client.bundle.js). Missing account Remote must not disable API-route display. For mechanism details see [PLUGIN-ANATOMY](docs/PLUGIN-ANATOMY.md).

Before delivering, inspect the complete diff, re-run the impacted tests and the release gate, verify actual tarball contents/imports, and state any missing live/browser/cross-platform checks. Preserve the [original license](LICENSE).
