# Phase G — Basket #276 replay acceptance

Status: **implemented/qualified; ready for independent review, not finalized.** Phase F is the
finalized implementation baseline. Phase H and Phase I have not started.

## Starting state and scope

The live default heads were independently queried before work:

| Repository           | Default | Starting SHA                               |
| -------------------- | ------- | ------------------------------------------ |
| Rady70/Market_Lab    | main    | `3f2e7a46521722f77ff279059d87b86fecf02c70` |
| Rady70/trade-journal | main    | `66ac370fd74a2d13613b21141bafcbeab4eff122` |
| Rady70/Lean          | master  | `2722bc3c2d67ebfb2b67fdec401904abfa825359` |

The application checkout was clean at `1aca72e0…`, then fast-forwarded to
`66ac370f…` before creating `marketlab/phase-g-basket-276`. LEAN was clean at
`5daf9646…`, then fast-forwarded to `2722bc3c…`; no LEAN files were changed.
The dirty, unrelated `E:\Market_Lab` IBKR checkout at `695dae57…` was preserved.
Control work uses a separate worktree and branch
`marketlab/single-anchor-phase-g-record` from the live control default head.

Authority is the finalized control plan's Phase G, the LEAN Phase E contract and
signed-net evidence, and the finalized Phase F documentation. Phase F browser
demonstrations were not counted as Phase G acceptance.

## Authoritative identity

| Object                                | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| Signed-net replay package             | `d145a49b548fe9356f1355d33df3329f87ce667cd15b367369219b8f27a9ccb4` |
| Signed-net evidence manifest          | `f98263618bde5d2cd24542e028d322d0bab35074c430ce6b0bdb4c7a4b22f685` |
| Phase D / signed-net run results.json | `bc3958b2629e8930ef8de3890cac9c80006f26d7c8dffdf5ecf54d6a6aa9bdad` |
| Derived M1 candle content             | `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d` |

Local source: `E:\MarketLab\Lean\MarketLab\output\20261003-143124-SingleAnchorVNextAlgorithm\storage\single-anchor\replay`.
Candle cache: `E:\MarketLab\data\lean\xauusd-m1-candles`.
Recoverable authoritative evidence: LEAN
`MarketLab/evidence/20261003-phase-e-signed-net-export/`, with the unchanged
original evidence under `20261002-phase-e-replay-export/`.

`docs/evidence/phase-g/source.mjs` reads the raw LEAN files independently using
only Node standard-library functions. It recomputes the package fingerprint,
hashes and counts every payload, hashes the results and signed-net evidence
manifest, and compares replay/candle manifests to the finalized records.
Nothing is simulated; decimal strings stay strings, timestamps retain UTC
millisecond identity, and events retain occurrence ids and immutable trade ids.

Basket #276 has **117** live occurrences: one anchor, **36** entries, one
hard-BE activation, **22** Margin Call enters / **22** leaves, **4** Stop Outs,
**30** forced liquidations, and one normal Escape exit. Entries #1–#36 remain
separate alternating Sell/Buy legs. The authoritative Stop Out episodes are:

| Trigger id | UTC trigger              | Forced closes |
| ---------- | ------------------------ | ------------: |
| 1323       | 2020-03-23T12:06:26.292Z |            20 |
| 1346       | 2020-03-23T12:06:32.137Z |             8 |
| 1357       | 2020-03-23T12:06:38.717Z |             1 |
| 1361       | 2020-03-23T12:06:54.330Z |             1 |

Hard-BE activates at event #1253, **2020-03-16T17:18:58.529Z**, with exported
targets **1436.41207500 / 1571.08792500**. The episode-end position counts are
**16 → 8 → 7 → 6**, not a premature basket close. After the fourth episode,
the exported account has gross exposure **1.38 lots** and signed net
**+1.18 lots**; opposing sides remain distinct. Those six positions continue
until the later Escape. All 22 Margin Call entered/left transitions belong to
the qualified event prefix and carry exact exported event snapshots.

The Escape event is #1364 at **2020-04-13T18:24:10.475Z**, closing six
survivors: BUY **1.28 lots @ 1721.098**, SELL **0.10 lots @ 1721.212**.
Exported lifetime basket result is **30.65700**, including prior forced
realization **-25051.42100**; the UI displays those values without recalculation.

## Demonstrated Phase F defect and bounded correction

The real Edge baseline check is retained as
`docs/evidence/phase-g/baseline.json` and
`baseline-skipped-liquidation-states.png`. At `12:06:00Z` the panel has 36
positions. One Next candle step to `12:07:00Z` reveals all four Stop Outs and
30 closes, while the panel jumps to six positions. The first close's exact
balance `21536.96000` and 35-position state, and the other intermediate
post-liquidation snapshots, cannot be watched in the old playback. The package
is valid; this is a display/playback defect, not an export or strategy defect.

The correction keeps the existing bounded candle windows and supported replay
controls. Forward steps request `reveal?...&step=1`, which returns only the next
exported occurrence before the requested candle-advance bound and its snapshot **by event
id**. No next-event payload is preloaded. The displayed cursor is
time + occurrence id, distinguishing consecutive liquidations at the same
timestamp. Cursor, event and account update atomically; backward time navigation
uses the exported row at that time, and replaying forward hides cached later
same-time occurrences until reached again. Candles still reveal only at M1 close.

The first correction made one awaited server request per M1 candle and was
observably slow at 64× on the long event-free tail. The bounded follow-up groups
four/16 candles per visual advance at 16×/64×, with at most four advances per
second. The server still returns only the first authoritative occurrence and
its exact snapshot, so fast candle batches cannot skip any event or liquidation
account state. Next always remains a one-candle-bound action. The formal run is
repeated on this corrected source; earlier slow/interrupted runs are not counted.

The user-visible close summary exposes the exported reason, exact UTC time,
each surviving side's exact execution price/lots and lifetime result only once
the close occurs. It is hidden again on backward navigation or Restart.
Provenance values wrap instead of forcing long hashes off screen. These are
bounded acceptance/accessibility corrections, not a journal redesign.

Screenshot inspection also demonstrated a 1,694px-tall page at a 1,432×900
viewport. Provenance is now an expandable native details section, and the
desktop replay places the exact account/event panels beside a 280px chart.
The independent layout probe observed a 1,432×900 document with no horizontal
or vertical overflow and all replay controls, close details and account fields
visible together. The formal run passed on this presentation correction.

## Qualification method

`validate.mjs` drives the installed **Microsoft Edge browser** on native Windows against
the actual `next dev` application. It opens #276 with an explicit identity
check, uses Play/Pause at 4×, Restart, and continuous 64× Play from the start
to the Escape close. A DOM MutationObserver captures the rendered event prefix,
cursor occurrence, account text and source-row identity at every event.
It also captures every displayed account-row transition, including periodic
samples between events, and compares all ten displayed account values and row
identity exactly. Compact evidence retains every event snapshot plus the
periodic comparison counts and sequence digest, avoiding a duplicate telemetry archive.
`compare.mjs` independently compares those observations to raw package events
and snapshots, rather than using the renderer/loader as an oracle.

The same harness exercises backward scrub, Next through the entire stress
minute, Previous before liquidation and Next again, full-window navigation and
Restart. Every displayed account field, signed net, snapshot time, quote and
event id is compared exactly, including every forced close and all four
episode transitions. The checker also rejects missing/reordered/wrong event
values, wrong account/signed net, stale account and future/early exit states.
The existing fail-closed loader tests cover package identity mismatches and
contract corruption. Checker negative fixtures are distinct from browser
observations and component tests.

The first completed continuous Play run compared all 117 events and 1,749
displayed account-row transitions exactly, but was **not accepted**: its
follow-up Next loop read too early after a fixed 35ms delay and observed only
25 of 30 liquidation states. `attempts.json` retains that failed outcome.
The corrected navigation harness waits for the actual cursor/occurrence
identity to change, including same-time event ids. It does not weaken the
30-snapshot assertion. Because screen-fit changes also followed, the full
continuous Play qualification is repeated on the revised source.

Early browser attempts failed due to a case-sensitive heading check, pointer
selection during dropdown animation, interrupted/detached browser frames, and
hidden-window playback. They are not acceptance evidence. The harness now
asserts actual selection, invokes the selected option's click, verifies speed,
and uses headless Edge for the remaining uninterrupted run following the user's
request to avoid desktop interference. Headed baseline observations and headless
real-application qualification are explicitly distinguished. Screenshots
are viewed with the harness image reader; DOM exactness and visual inspection
are distinct validation types.

## Local results

`docs/evidence/phase-g/automated.json`: **612/612 tests pass**, zero skipped,
including 58 loader tests, 14 UI tests and eight real-package tests. Added
regressions cover every #276 occurrence/snapshot, same-time forced closes,
backward replay, and the exact causal close summary. Web/core/importer
typechecks pass on Windows, Node **24.19.0**, pnpm **11.0.8**.

`docs/evidence/phase-g/qualified.json`: **PASS**, on Windows installed Edge
**154.0.4258.53**, against the real local application in headless mode. Run:
**2026-10-04T11:22:58.048Z → 2026-10-04T11:31:10.192Z**. Continuous 64×
Play reaches the Escape close and observes all **117** authoritative event
occurrences in exact order, including every one of the **30** post-liquidation
snapshots. All exact execution identities, sides, lots, UTC times and prices
match the raw export. There are **zero** recorded page errors or comparison
failures, and the end view contains no alert or stale/other-basket account.

- **1,749** displayed account-row transitions checked, including **1,632**
  periodic samples; **17,490** exact account-field comparisons, plus exact
  time/quote/event-id/Margin Call state checks. The sequence digest is retained.
- Play/Pause at 4×, Restart, continuous 64× Play, backward scrub, all 30
  occurrence-stepped Next liquidation states, Previous to `12:05:00Z`, Next
  again, full-window navigation and Restart after full history all pass.
- **15/15** negative checker fixtures are rejected; identity/contract failure
  paths are additionally exercised by the 58 fail-closed loader tests.
- The final **1,432×900** document has **1,432×900** scroll dimensions. Chart,
  controls, exact account/event panels and close details fit the tested screen.
- Visual inspection completed on the pre-anchor start, Escape close, all four
  triggers, first forced close and each episode-end screenshot. Every retained
  screenshot is from the actual application; screenshots and exact DOM
  comparisons are distinct evidence types.

Qualified implementation commits:

- `60b4f42fc43d86516b33b646948997f057d52015`: occurrence stepping, synchronized
  account snapshots, causal close summary and regressions.
- `a3e43ee01bc00c210e6311da3ff1b8c69fe85fae`: bounded fast candle advances.
- `91a42a84b911a7d2465bb69c4ab7636880957cfd`: compact desktop layout.

Changed runtime/test paths: replay component; Backtests page; reveal route;
shared reveal response; server reveal selector; authoritative-package and UI
tests. The native chart renderer is unchanged. Added evidence/docs are confined
to `docs/evidence/phase-g/`, this record and `MARKETLAB_FORK.md`.
`manifest.json` binds the six runtime source files (LF-normalized SHA-256), the
implementation commit and every retained artifact's byte count/hash. Later
evidence/documentation commits do not alter the qualified runtime source.

## Local reproduction

Use the four runtime environment variables and `next dev` procedure in
`docs/marketlab-phase-f.md`, with the package and candle identities above.
From the application root on Windows, with the package/cache variables set:

```powershell
node docs/evidence/phase-g/source.mjs
node docs/evidence/phase-g/automated.mjs
node docs/evidence/phase-g/validate.mjs qualified
node docs/evidence/phase-g/seal.mjs
```

The browser harness requires installed Edge and an existing isolated
`puppeteer-core` installation. Set `BROWSER_MODULE_ROOT` to that installation's
`package.json` (the local run reuses the ignored temporary browser environment),
and `APP_URL` if the application is not at `http://127.0.0.1:4321`.
`LEAN_ROOT` defaults to `E:/MarketLab/Lean`. Automated output uses the existing
temporary directory, overridable with `TEMP_OUTPUT`. The harness is entirely
local and does not require hosted CI. `baseline` mode intentionally demonstrates
the old defect and must be run on the original Phase F source, not the correction.

## Boundaries and limitations

- No Phase H or Phase I work; no run-level replay/filters/timeline/integration.
- No strategy, account, hard-BE, margin, liquidation, ordering, execution economics
  or qualified market-data change. No LEAN implementation/export change.
- No historical characterization rerun, historical-data qualification rerun,
  parameter optimization or hosted CI dispatch. PR work is not merged.
- This qualifies the local Windows development-server experience; the existing
  production standalone-build symlink limitation is not reclassified as a pass.
- Between authoritative events, the account is the latest exported periodic
  sample. It is never interpolated. Candle OHLC is visualization, not execution
  authority; same-minute execution prices/times remain exact in the ledger.
- Same-minute native canvas annotations can overlap at shared coordinates.
  Exact execution review uses the readable event ledger, account panel and
  side-specific close summary. Visual inspection is not per-pixel canvas OCR.
- Screen fit was checked at 1,432×900; smaller/narrow layouts retain ordinary
  scrolling. This is local browser qualification, not owner/device validation.
- Phase E's documented Margin Call provenance limits remain; Phase G proves
  agreement with the finalized export, not an independent strategy reconstruction.
