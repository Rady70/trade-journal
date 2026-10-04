# Phase H local qualification evidence

Status: **implemented and ready for independent review; not finalized.**
See [the application record](../../marketlab-phase-h.md) for provenance, authority
sources, coverage, bounds, exact identities, commands, limitations and self-audit.
The evidence qualifies the actual local Windows Next.js development-server
workflow in installed headless Edge; it is not a hosted, production-build or
owner/device-validation result.

| Receipt | Result and coverage |
| --- | --- |
| `automated.json` | PASS: 620/620 tests, no skipped; three package typechecks; changed-source formatting |
| `browser.json` | PASS: complete basket/live-timeline pagination, distinct filters, 61 exact occurrence states, causal re-entry, distant windows, errors |
| `regression/qualified.json` | PASS: preserved Phase G checker, 117 events, 30 forced closes, 17,490 exact account-field comparisons, controls and negative checker cases |
| `fail-closed.json` | PASS: accepted-payload corruption and unexpected package/candle identities hidden in the actual browser; full build exits 1 on inherited Windows symlink EPERM after compilation |
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
`regression/` contains pre-anchor/close/risk evidence on the final runtime plus an
earlier failed-attempt capture; its README documents the preserved checker.
`attempts.json`, `automated-attempts.json`, `failure-attempts.json` and
`regression/attempts.json` retain earlier failed outcomes. They are not passes.
No full run payload, quote history, credentials, generated runtime, build output,
dependency tree or hosted CI state is retained here.
