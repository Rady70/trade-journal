# Phase H local qualification evidence

Status: **implemented and ready for independent review; not finalized.**
See [the application record](../../marketlab-phase-h.md) for provenance, authority
sources, coverage, bounds, exact identities, commands, limitations and self-audit.
The evidence qualifies the actual local Windows Next.js development-server
workflow in installed headless Edge; it is not a hosted, production-build or
owner/device-validation result.

| Receipt | Result and coverage |
| --- | --- |
| `automated.json` | PASS: 621/621 tests, no skipped; three package typechecks; changed-source formatting and recorded Git whitespace check |
| `browser.json` | PASS: complete basket/live-timeline pagination, distinct filters, 61 exact occurrence states, causal re-entry, distant windows, errors |
| `regression/qualified.json` | PASS: preserved Phase G checker, 117 events, 30 forced closes, 17,490 exact account-field comparisons, controls and negative checker cases |
| `fail-closed.json` | PASS: four cases, including an accepted-candle-only identity switch with unchanged package/manifest; all five stale routes rejected and explicit reload recovers |
| `manifest.json` | SHA-256 seal of retained artifacts, LF-normalized source/tests, implementation commit and finalized input identities |

Run scripts from the application root. Use the unchanged four variables in
`.env.example`, the actual application at localhost:4321 and an existing isolated
`puppeteer-core` install (`BROWSER_MODULE_ROOT` is its package.json path). The
independent `source.mjs` oracle uses raw finalized LEAN bytes and the preserved
Phase G identity verifier; it does not import the app loader or Phase H indexing.
Inputs remain outside Git. Scripts inherit explicit path overrides; local defaults
and exact invocation commands are in the application record.

Five Phase H PNGs show completed overview, exact first forced-close jump,
unfunded final open basket at run end, boundary timeline and invalid input.
`stale-candle-navigation.png` adds the accepted-cache-switch rejection.
`regression/` contains pre-anchor/close/risk evidence on the final runtime plus an
earlier failed-attempt capture; its README documents the preserved checker.
`attempts.json`, `automated-attempts.json`, `failure-attempts.json` and
`regression/attempts.json` retain earlier failed outcomes. They are not passes.
No full run payload, quote history, credentials, generated runtime, build output,
dependency tree or hosted CI state is retained here.

The focused correction qualifies implementation `121cc595f57ab2c45ecec83ec4eaf60b9522f5d4`.
`pre-review-manifest.json` is the unchanged historical seal for the original
publication `804f7b072ff58f0e93ce4bca577dfb18e4f2624d`; its artifact references
resolve to that historical commit, not refreshed receipts. Original build EPERM
evidence is in `failure-attempts.json` and the original publication; production
packaging was not rerun for this delta. The failure harness blocks only dev HMR
via supported browser request blocking, leaving real app/API responses unchanged.
