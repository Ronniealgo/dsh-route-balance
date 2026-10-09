## What does this change

<!-- One paragraph. If it adds a route adapter, name the route and its endpoint. -->

## Kind of change

- [ ] Route adapter (a new balance source)
- [ ] Fix in the widget, formatting or state machine
- [ ] Docs / tooling only
- [ ] Other

## Checklist

- [ ] `node tools/build-client.mjs` was run (I did not hand-edit `lib/client.js`)
- [ ] `node test/client.test.mjs` passes, with a new case for new behaviour
- [ ] No secret, token, cookie, personal path or account id in the diff — the
      browser half is public code
- [ ] Any host-half code reads credentials through `ctx.credentials`, never from
      `process.env` directly, and never sends them to the browser
- [ ] An unreadable balance still reports failure, never `0`

## How I verified it

<!-- Commands you ran, plus what you could not verify (e.g. "only read the
shipped READMEs for X, did not run it"). -->
