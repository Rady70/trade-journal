# Phase H — completed-run replay and navigation

Status: **implemented and ready for independent review; not finalized or merged.**
Phase F and Phase G remain finalized. Phase I remains **not started**.

## Provenance and scope

Live default heads independently queried before implementation:

| Repository | Default | Starting SHA |
| --- | --- | --- |
| Rady70/Market_Lab | main | `f77ecdb8588ba6ccc4453da6916365d2a399aa4d` |
| Rady70/trade-journal | main | `99ff48cd4b71be51e220230480dadae048489ef3` |
| Rady70/Lean | master | `2722bc3c2d67ebfb2b67fdec401904abfa825359` |

Application and LEAN were clean at those defaults. Application branch:
`marketlab/phase-h-run-navigation`, qualified implementation commit
`121cc595f57ab2c45ecec83ec4eaf60b9522f5d4` after the focused source-binding
review correction (original implementation `8e93aa10e9dd7accd158f75d6486cd027038b7a0`).
Subsequent evidence/doc commits do not change that runtime. Control branch: `marketlab/single-anchor-phase-h-record`,
isolated from the unrelated dirty `E:\Market_Lab` checkout.

During validation, control main advanced to
`f9fe09f44f21c50f746f92478c2fa027eb1b6887` through IBKR collector PR #47 and
its finalization. The intervening diff was inspected: SingleAnchor plan/Phase G
records and the LuxAlgo registry section are unchanged. The clean control review
branch fast-forwarded before adding Phase H records. A later compatible control
commit `f0c49cd945d28d1b5c7fe5ad1c8ab635a2677230` changes only
`docs/IBKR_DATA_ACQUISITION_PLAN.md`; the branch fast-forwarded again with Phase H
edits preserved. **`f0c49cd945d28d1b5c7fe5ad1c8ab635a2677230` is the review base.**
Application/LEAN defaults remained unchanged. The original control worktree's
unrelated changes are preserved.

Verified final Phase G chronology (GitHub PR metadata and repository history):
application #3 approved head `f0766d5800ee8ebe29cbb6442fdf358ede706d3d`,
merge `77377f5275e4ceb6094f9f6f31abadafb116598b` at
`2026-10-04T15:42:15Z`; application #4 merge
`99ff48cd4b71be51e220230480dadae048489ef3` at `15:44:17Z`; control #48
final head `9e919aaada8cbcd3c8a8c9daa69a60c2dd424d06`, merge
`a61c43def695d6cbbfa89af3f31aaa61ac14f64b` at `15:47:10Z`; control #49
finalization head `50bd0295f25d8b57539f1bbd56cd5714f4d0d880`, merge
`f77ecdb8588ba6ccc4453da6916365d2a399aa4d` at `15:49:34Z`.

Governing scope: control `docs/SINGLE_ANCHOR_LIQUIDATION_LUXALGO_PLAN.md`,
Phase H; finalized LEAN `MarketLab/REPLAY_PACKAGE.md`; Phase F implementation
and sealed Phase G qualification. Historical Phase A–G records are unchanged.

## Exact input identities

| Input | SHA-256 |
| --- | --- |
| Signed-net replay package | `d145a49b548fe9356f1355d33df3329f87ce667cd15b367369219b8f27a9ccb4` |
| Signed-net evidence manifest | `f98263618bde5d2cd24542e028d322d0bab35074c430ce6b0bdb4c7a4b22f685` |
| Authoritative results.json | `bc3958b2629e8930ef8de3890cac9c80006f26d7c8dffdf5ecf54d6a6aa9bdad` |
| Derived M1 candle content | `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d` |
| Replay manifest bytes | `825d98232e79e6d6f5d381118985ee3efea30ad86a29d485972193af47231a18` |

These are checked against the actual finalized LEAN files and committed signed-net
records, including results bytes, rather than accepted from the task prompt.
Package: `E:\MarketLab\Lean\MarketLab\output\20261003-143124-SingleAnchorVNextAlgorithm\storage\single-anchor\replay`.
Candles: `E:\MarketLab\data\lean\xauusd-m1-candles`. Runtime reads the finalized
events/telemetry export; results.json is an independent validation authority,
not an alternate strategy/account reconstruction path.

> **LEAN determines what happened. Trade Journal shows and navigates what happened.**

## User capabilities and authority sources

Opening **MarketLab Backtests** now starts at a clearly labeled **completed
historical run overview**. It intentionally describes the completed result,
not the active replay cursor.

- **Run summary:** actual UTC boundaries and completed/failure status; 280 anchored
  baskets; 278 ordinary strategy closes; one fully liquidated basket; open basket
  #280; 555 entries; five Stop Out triggers; 23 Margin Call enters and 23 leaves;
  65 individual forced closes; initial balance `20000`; final balance/equity
  `-90.41800`; engine realized P/L `-20090.41800` USD; final open positions zero,
  gross/signed net lots `0 / 0`; processed quote count `413750130`; rejected
  attempt counter `346942369` (not individual attempt records).
  Outcome/counters come unchanged from fingerprint-bound `run_ended`; account
  values are exact run-boundary snapshots. Risk counts match the validated
  event stream. Basket/open lists are lifecycle indexing, not new economics.
- **Basket table:** all 280 immutable identities in 40-row pages; exact anchor and
  close UTC/id, closed/liquidated/open lifecycle, exported close reason, entry,
  Stop Out, Margin Call enter and individual forced-close counts, and the exact
  exported lifetime result when a close exists. Open baskets have no invented
  close time or P/L. A close-time link jumps to that close occurrence.
- **Direct navigation:** Open on any row or the basket-number field opens the
  existing qualified replay. Returning to the overview preserves its filter,
  year, and page state. Overview DOM is removed while replay is active, and no
  overview values are supplied to the replay's event/account state.
- **Distinct filters:** Stop Out triggers, Margin Call transitions, broker-forced
  liquidations, and ordinary strategy exits. Stop Out matches five triggers in
  #276 (four) and #279 (one); Margin Call matches all 46 transitions in #276
  (22 enters/22 leaves) and #279 (one/one). Forced closes match 65 events (30/35).
  Ordinary strategy exits match 278 events in their own distinct filter.
- **Run timeline:** chronological occurrence list with year navigation, 40-row
  pages, exact UTC + occurrence id + basket/trade context. Default major events
  number 897; include-all mode covers all 1,452 live occurrences. Nothing is
  grouped by candle or timestamp. Two run-end rejection recaps are explicitly
  outside the live timeline; their run counters remain in the summary.
- **Major-event jumps:** anchors, hard-BE/trailing activations, strategy exits,
  fully liquidated outcomes, Stop Outs, both Margin Call transitions, every
  individual forced close, live rejected-entry episodes, supported diagnostics
  (none in this run), and run boundaries. Run start/end use first/final basket
  context while retaining the exact boundary occurrence/snapshot.

The server validates event membership. A jump requests only the selected
basket's prefix through the exact id and the snapshot **by event id**, so later
same-time occurrences remain hidden. Detail metadata carries only target id/time,
not future execution/account payloads. Restart returns to the pre-anchor start.
Play/Next continue from the selected occurrence; Previous/scrub retain the
existing time-based candle behavior and hide future cached records. The browser
qualification also exposed a delayed response advancing after Pause; Phase H
cancels only the in-flight playback advance, preserving pending causal reveals.

## Bounded history and failure handling

- The browser requests status with `index=0`, avoiding the old complete selector
  index. New summary has fixed fields; table/timeline pages have at most 40 rows.
  The old status index remains available for legacy diagnostic clients.
- Candle windows remain capped at **12,000 M1 bars**, with six hours of local
  context on distant navigation. Each new window **replaces** the previous array.
  Candles reveal only at bar close. No quotes are read by this application.
- A distant basket/event is reached directly; no replay of earlier baskets or
  intervening candle history is required. The final open basket's six-year tail
  is navigated through the same bounded window path.
- No new database, worker, service, persisted index, dependencies or distributed
  machinery. Server selection reuses the fully verified Phase E index/telemetry
  and existing 12-month candle-file cache. Server metadata scales with the export;
  this is not a claim of constant server memory for arbitrary future datasets.
- Both expected identities and existing replay/candle source compatibility remain
  mandatory. New pages carry package, manifest and candle identities; page and
  browser replay requests require the complete accepted tuple
  `packageSha256:manifestSha256:candleContentSha256`. Manifest-only, malformed and
  omitted bindings are rejected. Initial status/summary reads accept a new context;
  every table, timeline, detail, window and reveal request retains all three hashes.
  A stale client cannot cross into another accepted candle identity even when the
  replay package/manifest stay unchanged. Stale source,
  unsupported filter, wrong basket/event, recap jump and inconsistent event/time
  fail closed. Package acceptance now invalidates on payload size/mtime changes
  as well as manifest changes; a candle-file cache entry also binds its hash.

Measured final browser run (`browser.json`): summary **1,880 bytes**; seven basket
pages **11,390–11,545 bytes**. Warm page requests were approximately **33–59 ms**;
the first measured page took **11.4 s** during concurrent local qualification
qualification. Its cause was not separately isolated; this is an observed
development-server result, not a
performance guarantee. Maximum observed candle response: **12,000 bars /
692,475 bytes**. Distant cursor checks cover June 2021, June 2024 and June 2026,
with exact exported account state independently compared. The existing 1,000-step
scrubber is approximate in time (including absent candle minutes); event jumps
are exact and do not use that scrubber.

## Validation and representative cases

Native Windows; Node **24.19.0**, pnpm **11.0.8**, installed Edge
**154.0.4258.53**. Actual application development-server qualification uses
headless installed Edge at 1432×900; it is not owner/device validation or a fixture
browser. Retained screenshot inspection covers overview, timeline, exact first
forced-close jump, final-open state, invalid input, and regression replay/close.

`docs/evidence/phase-h/` retains:

- `source.mjs`: independent raw finalized LEAN oracle, using only the standard
  library and the preserved Phase G identity verifier. No application loader or
  Phase H transformation is imported as the comparison oracle.
- `automated.json`: **621/621 tests pass, zero skipped**; web, core and importer
  typechecks pass; changed-source Prettier and recorded
  `git diff --check 99ff48cd4b71be51e220230480dadae048489ef3` pass. New tests compare all
  280 lifecycles and all 1,452 exact jump prefixes/snapshots to raw package rows,
  check source/cursor errors and mutation-after-acceptance, and exercise exact
  jump/Restart hiding and delayed-Pause cancellation. Existing Phase F/G tests
  continue to pass. Route tests now supply the real Request used by HTTP handlers.
- `browser.json`: **PASS**, `2026-10-04T20:58:10.939Z → 21:01:52.192Z` after correction.
  Actual browser checks all seven basket pages; all live timeline pages; all
  four filters; 61 exact occurrence states including jumps and forward re-entry;
  return navigation; empty event years; distant date windows; direct number
  entry; unavailable basket; stale source/cross-basket/time/unsupported errors.
  Representative baskets **#1, #4, #5, #6, #276, #279, #280** cover ordinary
  Trailing, ordinary Escape, adjacent lifecycle boundaries, partial liquidation
  followed by Escape, total liquidation, and the final anchored/unfunded basket.
- `regression/qualified.json`: preserved Phase G checker **PASS** on current
  runtime, entering #276 through the run table. Final run
  `2026-10-04T20:58:10.410Z → 21:09:05.072Z` (exact receipt is authoritative).
  Continuous 64× Play observes all **117 occurrences**, **36 entries**, hard-BE,
  **22/22** MC transitions, **4** Stop Outs, **30** distinct forced closes,
  partial continuation and final Escape. **1,749** account-row transitions,
  **1,632** periodic comparisons and **17,490** exact field comparisons; zero
  failures/page errors. Every forced-close snapshot is also checked after backward
  navigation. All controls, signed net, causal close hiding and 15 negative
  checker fixtures pass. Final replay document fits 1432×900 without page overflow.
- `fail-closed.json`: four real application/Edge cases **PASS**. Original three: HTTP 422 with
  summary/table/replay hidden: payload corruption after successful acceptance,
  unexpected authoritative package, unexpected candle content. Uses an isolated
  same-source snapshot under ignored `.cache/` and unchanged dependency junctions;
  only its own spawned process tree is stopped. Fourth: an isolated cache copy
  changes one decimal's trailing-zero representation, preserving numerical values;
  its different content identity is explicitly accepted by the isolated server.
  The package and replay manifest hashes remain identical. All five old-bound
  navigation routes return only an error (422); fresh bindings succeed (200).
  Two already-open browser contexts prove stale overview/jumps/replay fail closed:
  rejected detail hides replay, stale pages hide rows, Next leaves cursor unchanged,
  Restart clears candles, explicit reload recovers. Screenshot:
  `stale-candle-navigation.png`. Native browser request blocking disables only
  development `webpack-hmr` reloads so the old contexts survive the server restart;
  application/API responses are real and unmodified. Fresh pages and explicit
  foreground selection in the headless browser avoid dev-rehydration/background
  animation-frame polling issues observed in retained unsuccessful attempts.
- `attempts.json`, `automated-attempts.json`, `failure-attempts.json`,
  `regression/attempts.json`: unsuccessful attempts preserved. Harness issues
  included Windows screenshot paths, case-sensitive CSS heading text, overly short
  backward-navigation assumptions and cross-drive Next dependency resolution.
  Product issues found were delayed Pause and replay screen height; both fixed
  before the final runs. Early status-route unit probes omitted Request after the
  route became query-aware; corrected native-request tests pass. No failed attempt
  is counted as qualification.
- `manifest.json`: binds the implementation commit, normalized runtime source,
  tests, all retained artifacts and the exact authoritative identities.
  `pre-review-manifest.json` preserves the original seal for its original
  publication at `804f7b072ff58f0e93ce4bca577dfb18e4f2624d`, not the refreshed
  artifact bytes. Historical qualification remains recoverable from that commit.

Final open **#280** remains open, with **zero entries**, no strategy/forced close
and no close result. Its final account is the exported run-end snapshot #1454;
earlier cursors correctly retain the latest earlier exported sample (#1451 after
the March 2021 rejection). Anchored does not mean funded or holding positions.

### Commands

Use the unchanged four environment variables from `.env.example` and Phase F,
then `corepack pnpm --filter web exec next dev -p 4321`; open `/backtests`.
Stop the launched development server with Ctrl+C. From the application root:

```powershell
node docs/evidence/phase-h/automated.mjs
node docs/evidence/phase-h/browser.mjs
node docs/evidence/phase-h/regression.mjs
node docs/evidence/phase-h/fail-closed.mjs
node docs/evidence/phase-h/seal.mjs
```

The automated runner executes `corepack pnpm exec vitest run --reporter=json
--outputFile=<local temp>`, the three `corepack pnpm --filter <package> typecheck`
commands, changed-source `corepack pnpm exec prettier --check ...` and
`git diff --check 99ff48cd4b71be51e220230480dadae048489ef3`.
`BROWSER_MODULE_ROOT` names the existing isolated puppeteer-core package.json;
`APP_URL` overrides localhost:4321; `LEAN_ROOT` overrides the oracle's LEAN root.
The ordinary monorepo `corepack pnpm typecheck` wrapper initially failed because
this host has no bare pnpm shim; the actual three package checks above pass.

### Remaining limitations and boundary audit

- Production `next build` was attempted in the original Phase H Windows qualification:
  compilation succeeds, full build exits **1** on standalone trace-copy symlinks
  with **EPERM**. This is the documented Phase F/G host limitation; no dependency,
  upstream, privilege or packaging workaround is introduced. Production standalone
  deployment is not qualified. The Phase H browser workflows qualify the local
  Windows development-server experience. It was not repeated for this focused
  source-binding delta; the original build receipt is retained in
  `failure-attempts.json` and the original publication commit.
- Existing derived M1 bar-close, latest-exported-periodic-sample and Phase E MC/
  trailing provenance limits remain. Same-minute canvas annotations can overlap;
  the exact ledger/account panels retain identities and values.
- No LEAN strategy/account/margin/liquidation change; no Phase E semantics change;
  no new authoritative export; no historical characterization rerun; no historical
  data qualification rerun; no optimization; no broker account/route; no hosted
  CI added or dispatched. Application Actions were confirmed disabled; control
  has zero workflows. No merge is performed.
- Phase I launcher/service startup/Fincept actions, navigation and web views remain
  **not started** and require Phase H independent review/finalization first.

Self-audit covers all Phase H scope/acceptance items above. No known Phase H
acceptance defect remains in the qualified local Windows workflow.

## Published independent-review PRs

- Application: [Rady70/trade-journal#5](https://github.com/Rady70/trade-journal/pull/5),
  branch `marketlab/phase-h-run-navigation`. Initial sealed publication head
  `ce339aa39843743aea53e4f80947ea39a87d3365`; this follow-up only adds review links.
- Control: [Rady70/Market_Lab#51](https://github.com/Rady70/Market_Lab/pull/51),
  branch `marketlab/single-anchor-phase-h-record`, documentation only; initial
  publication head `2c09f78df2356d2c9e00ee0a9dbea282042b2142`.
- [Paired control qualification record](https://github.com/Rady70/Market_Lab/blob/marketlab/single-anchor-phase-h-record/docs/SINGLE_ANCHOR_PHASE_H_QUALIFICATION.md)
  records exact review provenance and the final application publication head.
  Current review heads are in PR metadata. Both PRs remain open, unmerged and
  awaiting independent review; Phase H is not finalized and Phase I is not started.
- The original evidence manifest SHA-256 was
  `91d7f6a1469c8399fb575b5845d70f173cd9fe63aef87acee2ff16fc3090c24d`.
  It is preserved in `pre-review-manifest.json`. The review correction refreshes
  the current seal; its hash and publication heads are in the paired control
  record and PR metadata.

## Independent-review correction — complete source binding

Review of application `804f7b072ff58f0e93ce4bca577dfb18e4f2624d` and control
`1d8792ea0ea3ddfa13636a702c0bb6e6fe013fba` found a blocking manifest-only
navigation binding and a missing retained whitespace command. The original
ready-for-review claim did not establish readiness to merge.

Correction `121cc595f57ab2c45ecec83ec4eaf60b9522f5d4` closes that hole using the
existing three-field RunSource and a transparent required tuple, with no new
architecture. Native-request regression covers the accepted-candle-only switch,
all five routes, fresh bindings and omitted/manifest-only rejection. The affected
Windows automated, complete run-navigation browser, four fail-closed cases and
full preserved Phase G regression pass; whitespace validation is now in the
automated receipt. Review corrections are **ready for delta re-review**, with
approval, merge and Phase H finalization still pending. Phase I remains unstarted.

Refreshed evidence manifest SHA-256:
**`4e503ac916faaec27561a9e436b67d59e8934cc1c52e5ac41dc7fd1cf1d08983`**,
binding 35 artifacts, 13 runtime paths and four test paths. Exact current review
heads are recorded in the paired control record and PR metadata.
