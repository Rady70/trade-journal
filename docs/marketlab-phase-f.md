# MarketLab Backtests — Phase F implementation record

Status: **implemented, corrected for the independent re-review, and ready for
re-review (2026-10-03). Phase G–I have not started. This is not a Phase G
acceptance claim.**

> **Signed net exposure — resolved as an export-only Phase E addition.** The
> governing requirement is gross/net exposure as exported LEAN values, and this
> strategy is defined by simultaneous opposing legs, so absolute net lots are
> not equivalent. The earlier record asked for a decision; the review's decision
> was to keep the requirement and add the value in Phase E through the smallest
> export-only change. Phase E now exports `netLots` (signed: positive net long,
> negative net short) in every event and periodic telemetry snapshot, captured
> by the research account that owns the position ledger; Phase F consumes and
> displays it unchanged. No strategy, margin, liquidation, sizing or trade
> behavior changed, and `results.json` remains byte-identical to Phase D. This
> created a new replay-package identity; its SHA-256 is recorded below. The
> field is an additive extension of the v1 package contract (documented in
> `REPLAY_PACKAGE.md` section 9); the original v1 package without it remains
> valid.

The independent re-review of the previous revision found nine issues; all were
verified true and corrected in this revision: the signed-net requirement, future
totals/boundary levels reaching the client before the cursor, the final open
basket not finishing through Play/Next, a stale account row under a newer
cursor, missing live-event chronological enforcement for reveal pagination,
optional expected identity anchors, lazy candle-cache acceptance, a missing
interior candle month, and stale documentation. The sections below reflect the
corrected behavior.

This record covers the Phase F MarketLab adaptation of LuxAlgo Trade Journal: a
dedicated **MarketLab Backtests** path that consumes the finalized Phase E
replay package directly and presents the authoritative SingleAnchor history
visually.

The governing boundary is unchanged:

> **LEAN determines what happened. LuxAlgo shows what happened. Fincept launches
> and navigates the result.**

## 1. Provenance and base revision

|                              |                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Upstream                     | `LuxAlgo/trade-journal`, MIT                                                                |
| Historical planning snapshot | `949bca1993ee284e1facf2e26cfd1fa820b8f5cf`                                                  |
| Selected base revision       | `6e0bb0e94c863c39347a7be3283d6061fddc257f` (upstream `main`, 2026-09-30)                    |
| MarketLab fork               | `https://github.com/Rady70/trade-journal`                                                   |
| Implementation branch        | `marketlab/phase-f-single-anchor-replay`                                                    |
| Review PR                    | [Rady70/trade-journal#1](https://github.com/Rady70/trade-journal/pull/1) (open; not merged) |

The base is the current upstream `main`, one commit after the planning snapshot.
That commit (`Fix account currencies and hedged CSV imports (#32)`) improves
preserved-position semantics and currency handling; the MIT license is unchanged
and no later upstream commit existed at selection time. See
[MARKETLAB_FORK.md](../MARKETLAB_FORK.md).

## 2. What was implemented

New additive paths (nothing in the upstream round-trip engine, importers,
schema, broker sync or analytics is modified):

| Path                                                                     | Role                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/marketlab-replay.ts`                                   | Phase E contracts, fail-closed error type, basket indexing, cursor reveal, exact account selection |
| `apps/web/src/server/marketlab-replay.ts`                                | read-only package/candle-cache loader with full verification, compatibility binding, reveal reader |
| `apps/web/src/app/api/marketlab-replay/route.ts`                         | package status + pre-cursor basket identity index                                                  |
| `apps/web/src/app/api/marketlab-replay/baskets/[number]/route.ts`        | one basket: pre-cursor selector identity only                                                      |
| `apps/web/src/app/api/marketlab-replay/baskets/[number]/window/route.ts` | bounded derived candles (close-bounded) + carry-in account row                                     |
| `apps/web/src/app/api/marketlab-replay/baskets/[number]/reveal/route.ts` | cursor-bounded events + the exact exported account row at the cursor                               |
| `apps/web/src/app/backtests/page.tsx`                                    | the MarketLab Backtests surface                                                                    |
| `apps/web/src/components/marketlab-replay.tsx`                           | replay state machine, controls, account panel, event feed                                          |
| `apps/web/src/components/marketlab-replay-chart.tsx`                     | Vela chart with authoritative event annotations                                                    |
| `apps/web/src/components/shell.tsx`                                      | one `Backtests` navigation entry (minimal upstream edit)                                           |
| `.env.example`                                                           | the replay environment variables (minimal upstream edit)                                           |

### Authoritative input

The loader reads the finalized Phase E package and never reconstructs it:

- `MARKETLAB_REPLAY_PACKAGE` points to `<run>\storage\single-anchor\replay`
  (or to the run directory); `MARKETLAB_CANDLE_CACHE` points to the derived M1
  candle cache directory. The `MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256` and
  `MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256` anchors are **required** for this
  dedicated surface: a missing or malformed anchor disables replay with a named
  error, and a loaded package/cache that does not match its anchor is rejected.
  Concretely, the replay endpoints (`window`, `reveal`) and the status
  compatibility gate refuse to serve without the anchored identities; the
  status, basket-index and basket-identity metadata endpoints remain readable
  for diagnosis; no replay is enabled, and a mutually self-consistent but
  unapproved pair can never be replayed. The signed `netLots` field is
  consumed from the Phase E v1 contract's additive signed-net extension (the
  original v1 package without it remains valid; this surface binds the exact
  re-exported identity by SHA-256).
- Before any row is served the loader verifies: the
  `marketlab-single-anchor-replay-package-v1` contract, the documented package
  fingerprint over the payload descriptors, every payload file's byte count,
  SHA-256 and line count, the expected package identity, the published
  event-type whitelist, contiguous `1..N` event ids, exactly one `run_started`
  first and one `run_ended` last, every live event's canonical UTC time, the
  complete always-present field set of every event type — including the
  producer's nullable-but-always-present properties — with canonical invariant
  decimals only (an optional minus, digits and an optional fraction; `+1`,
  `.5`, `1.`, `1e3` and separators are rejected), the basket scope of every
  event type (basket-scoped types must carry a basket; run-level types must
  not), the manifest per-type event counts against the actual stream, and the
  one-active-basket lifecycle (an event may not reference a basket outside its
  anchor, an anchor may not open while another basket is open, and a live
  time-only event must fall inside a basket's live span).
- The complete telemetry history is read and validated before the package is
  served: actual `event`/`periodic` counts against the manifest, strict
  chronological order in the file (time and quote sequence are never sorted into
  plausibility), the live-event occurrence invariant that reveal pagination
  depends on (live event times and quote sequences must be non-decreasing in id
  order — a package that violated it would otherwise allow a reveal batch to
  skip an earlier-time event permanently), exactly one bound snapshot for every
  live event, no repeated or phantom snapshot, canonical times inside the shard
  year, canonical decimal strings and typed account fields, including the
  exported signed `netLots`.
- Authoritative source binding: the replay and candle contracts must declare the
  same symbol and market, the replay `delivered.semanticDigest` must equal the
  candle composition's `ordered_source_semantic_digest`, the delivered quote
  count must equal the composition's accepted row count, and the candle months
  must cover the replay window. A mismatch blocks replay.
- The candle cache is verified in full at acceptance and fails closed: contract,
  symbol (`XAUUSD`), market (`dukascopy`), M1/UTC/mid-of-best-bid-ask basis, the
  documented `content_sha256` fingerprint, the expected content identity, and
  every monthly CSV is read and SHA-checked (bytes, rows, header, LF) before the
  cache can be valid — a later missing or corrupted month cannot hide behind an
  early-basket replay. Monthly descriptors must be strictly ascending, unique
  and contiguous with no interior gap; per-month reads re-verify the touched
  file; integer ticks and strict OHLC parsing.
- A malformed, incompatible or tampered package produces a named error and an
  empty basket list; it is never rendered as a plausible replay.

### Authoritative events vs derived candles

- Events, basket identity, executions, risk events and account values are
  passed through from `events.jsonl` / `telemetry-*.jsonl` unchanged. The API
  wraps each event with derived lookup fields (`timeMs`, `live`) but the payload
  is the exact package object; the authoritative tests deep-compare it against
  the raw lines.
- Candles are derived visualization data from the qualified Dukascopy M1 cache.
  They are never used to decide, move or infer an event. The UI states this
  explicitly, and every loaded candle closes inside the declared window.
- Nothing after the cursor crosses the API boundary: the basket index carries
  only the selector identity (basket number, anchor time and the authoritative
  replay window extent); boundary levels (`anchor`, `step`, `upper`, `lower`,
  the hard-BE targets) exist in the browser only once the revealed
  `basket_anchored` event arrives. The status payload carries no run outcome,
  counters, event totals, telemetry totals or payload file descriptors. The
  reveal endpoint returns only events and the account row at or before the
  requested cursor, and only within the selected basket's authoritative replay
  window (a cursor outside it is rejected); the candle window endpoint carries
  no account data at all. The UI hides nothing that was sent early.
- The account panel shows the exact exported telemetry row in force at the
  cursor (event snapshot or ≤300 s periodic sample), scoped to the selected
  basket's own lifecycle: before its anchor there is no account row for it
  (another basket's state is never shown), and after a closed basket's close its
  final authoritative snapshot is retained through the post-close candle context
  instead of advancing into the next basket; the final open basket continues
  through the authoritative run end. The panel never interpolates and never
  recomputes a value; decimals are shown exactly as exported. Gross exposure and
  the exported signed `netLots` are both displayed as LEAN values. The panel is
  cursor-coherent: while the reveal for a newer cursor is in flight it shows an
  explicit synchronizing state instead of presenting the previous row as
  current.

### SingleAnchor semantics preserved

- No round-trip netting: opposing BUY/SELL legs stay separate entries with
  their immutable trade numbers (tested against a synthetic opposing-leg basket
  and against basket #276).
- Forced liquidations stay distinct broker-forced closes with ordinal, trigger
  quote and exact before/after account state; they are never converted into a
  generic trade close.
- Baskets are segmented only by `basket_anchored` events and their close
  events; the loader rejects an anchor while another basket is open and an
  event that references a basket before its anchor.
- Margin Call events carry no basket field in the Phase E contract; they are
  attached to the basket whose authoritative live span contains them, by time
  only, and are displayed unmodified. A live event that no basket span contains
  is rejected rather than dropped.
- Run-end `entry_rejection_summary` recaps are outside the live clock and are
  run-level; they are not part of a basket's replay timeline (run-level surfaces
  are Phase H).
- Basket windows are the authoritative anchor/last-live-event times plus a fixed
  30-minute context pad. The basket still open at the end of the run remains
  replayable through the authoritative `run_ended` time, and its window end is
  exactly that run end; nothing else is inferred.

### Replay controls and screen

- Basket selector over all 280 authoritative baskets (number and anchor time
  only; no outcome, future totals or boundary levels are preloaded).
- Historical M1 candles with progressive reveal at bar close; executions,
  forced liquidations, stop out, Margin Call, hard-BE and exit annotations are
  revealed only at or before the cursor. The card title shows
  `replay in progress` until the close event is revealed, then the authoritative
  outcome; an open basket shows `open at run end` only when its window is fully
  loaded. An incomplete candle cache never substitutes for the close event.
  When no candle can close at or before the authoritative window end (the final
  open basket at the run end), Play/Next make one explicit non-candle final step
  to that window end, so the replay finishes naturally instead of stopping short.
- Controls: Restart, Previous candle, Play/Pause, Next candle, reveal full
  window, speed (1×/2×/4×/16×/64× candles per second), scrubber, cursor time.
- Account panel synchronized to the cursor from exported values: balance,
  equity, floating P/L, realized P/L, used margin, free margin, margin level,
  open positions, gross exposure (lots), signed net exposure (lots, positive
  net long); while a newer cursor awaits its reveal the panel shows a
  synchronizing state instead of a stale row. Decimals are shown exactly as
  exported (margin level unrounded); a non-observable floating P/L is labelled
  `not observable at this sample` instead of being shown as a value.
- Event feed in exact package order with a revealed-event count (no future
  totals) and per-type annotations (`data-marketlab-event` attributes).
- Header shows basket identity and the anchor/upper/lower entry boundaries and
  hard-BE boundaries once the revealed `basket_anchored` event carries them;
  before that they are not present in the browser at all. Horizontal boundary
  price lines are drawn only while near the revealed price range so a far target
  cannot flatten the candles.
- Privacy mode (existing app setting) masks account monetary values, including
  the exact-value tooltips.

### Long history

Candles are loaded in bounded chunks of at most 12,000 M1 bars per request;
one chunk is held in the browser. Chunk continuation handles the case where the
cap lands exactly on a month end (the next in-window bar is located across
months), and both stepping past a boundary and scrubbing load a bounded 6-hour
context before the target so the chart keeps recent history and is never empty
at the cursor. No quote population and no run-level candle array is sent to the
browser. Run-level navigation/timeline remains Phase H.

## 3. Local run instructions

Requirements: Node 22+ and pnpm 11.0.8 (the repository pins it; use
`corepack pnpm` if pnpm is not on `PATH`).

```powershell
corepack pnpm install --frozen-lockfile

$env:MARKETLAB_REPLAY_PACKAGE = '<run>\storage\single-anchor\replay'
$env:MARKETLAB_CANDLE_CACHE   = '<derived M1 candle cache>'
$env:MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256 = 'd145a49b...9ccb4'
$env:MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256 = 'ab1b0c7f...65d9d'

corepack pnpm --filter web exec next dev -p 4321
# open http://127.0.0.1:4321/backtests
```

The two identity anchors are required; without them the surface reports the
missing variable and does not enable replay. With the replay path variables
unset the page shows a clear not-configured state; with any variable set
incorrectly it shows the exact loader error.

## 4. Validation performed

All commands were run on Windows from the fork checkout.

| Check                                 | Command                                                                                                                      | Result                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Upstream suite (base revision)        | `corepack pnpm vitest run`                                                                                                   | 532/532 passed                                 |
| Full suite with the finalized package | `corepack pnpm vitest run` with `MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE` / `MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE` set | **606/606 passed** (532 upstream + 74 Phase F) |
| Phase F contract/loader tests         | `corepack pnpm vitest run apps/web/tests/marketlab-replay.test.ts`                                                           | 55/55 passed                                   |
| Phase F UI tests (jsdom + Vela mock)  | `corepack pnpm vitest run apps/web/tests/marketlab-replay-ui.test.ts`                                                        | 12/12 passed                                   |
| Authoritative Phase E tests           | `corepack pnpm vitest run apps/web/tests/marketlab-replay-authoritative.test.ts` with the finalized package                  | 7/7 passed                                     |
| Typecheck                             | `corepack pnpm --filter web typecheck`, plus `packages/core` and `packages/importers`                                        | passed                                         |
| Formatting                            | `corepack pnpm exec prettier --check <changed files>`                                                                        | passed                                         |

The fail-closed tests include, beyond the earlier mutations: an unsupported
contract, fingerprint mismatches, payload hash/line mismatches, unknown event
types, duplicate/out-of-order/gapped ids, duplicate `run_started`, an event
before its anchor, an anchor while a basket is open, a recap with a live time,
a dropped always-present event field (no reason is invented and no producer
field may be dropped), a basket-scoped event without a basket, a basket number
on a run-level event, a live event no basket span contains, a live event stream
whose id order breaks authoritative time order (reveal pagination must never
skip an earlier-time event), a missing `netLots` decimal, invalid JSON with a
matching manifest, phantom/mistimed/duplicate/missing telemetry snapshots,
out-of-order telemetry (rejected, never sorted), telemetry counts that do not
match the manifest, telemetry rows outside their shard year, non-canonical
decimals (including `+1`, `.5`, `1.`, `1e3` and separators), an
expected-identity mismatch, a missing required identity anchor, a candle
content-fingerprint mismatch, a repeated candle month, a missing interior
candle month, a tampered candle payload rejected at acceptance (not only when a
window is served), replay/candle symbol and source-digest mismatches, a
cursor-bounded reveal that returns no future event or account value, a reveal
cursor outside the selected basket window, an open basket whose window ends at
the authoritative run end, the candle close-boundary rule, the terminal
non-candle step that lets the final open basket finish at run end through
Play/Next, a delayed terminal reveal proving a closed basket never transiently
reads `open at run end`, the delayed account/cursor synchronization race, and
the basket-scoped account regression: with the next basket opening a position
inside a closed basket's post-close context, the account stays the closed
basket's final snapshot and a pre-anchor cursor has no row for it. A dedicated
test drives the 12,000-bar monthly chunk boundary and proves the next chunk is
served without silent truncation.

The authoritative tests independently parse the raw package in the test and
prove: the exact package SHA-256, all 1,454 events present exactly once, in
package order and payload-identical, the finalized counters (65 forced
liquidations, 5 Stop Outs, 1 liquidated basket, 555 entries, 278 exits, 2
rejections, 1,452 event snapshots / 98,866 periodic samples), basket #276's 36
immutable entries / 30 forced liquidations / 4 Stop Outs / Escape exit, the
derived candle cache content SHA-256, raw monthly CSV equality for sampled
bars, and byte-level account-row equality with the raw telemetry.

### Real UI functional validation (Edge + puppeteer-core)

The running `next dev` application was exercised against the finalized package
on 2026-10-03. Transcripts and screenshots:
[docs/evidence/phase-f](evidence/phase-f/).

Checked in the real browser UI:

1. The surface loads the package provenance with the re-exported package SHA-256
   `d145a49b548fe9356f1355d33df3329f87ce667cd15b367369219b8f27a9ccb4` and the
   unchanged candle content SHA-256
   `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d`.
2. Basket #276 is selected from the 280-basket list (number and anchor time
   only).
3. Progressive reveal: entry #1 (`#1 Sell 0.10 @ 1499.868`) becomes visible by
   stepping; no forced liquidation is visible before the cursor reaches it; the
   card still reads `replay in progress` and no outcome or future totals are
   shown.
4. Play advanced the cursor by 10 simulated minutes in 2.5 s at 4×; Pause
   stopped it.
5. Restart rewound to the first candle with no future events.
6. Scrubbing to the end revealed exactly 36 entries, 30 forced liquidations, 4
   Stop Outs and 1 strategy exit, in ascending package order, with the chart
   rendering; the account panel balance equalled the exported value
   (`25550.58500`) and the outcome then read `closed (Escape)`.
7. No page errors were raised (one harmless favicon 404 console entry).
8. A corrupted copy of the package (one digit changed in `events.jsonl`) was
   rejected in the real UI with the exact SHA-256 failure and no replay
   rendered.

The invalid copy was created under the local temp directory; the authoritative
package and candle cache were never modified. The browser harness is committed
for reproduction as [`docs/evidence/phase-f/validate.mjs`](evidence/phase-f/validate.mjs)
(requires a local `puppeteer-core` install and Microsoft Edge).

### Production build note (environmental)

`next build` completes compilation and route generation but this Windows host
cannot create the symlinks required by Next's standalone file-trace copy
(`EPERM: operation not permitted, symlink`). The untouched upstream base fails
identically at the same step, so this is a pre-existing environment limitation
(no symlink privilege), not a Phase F change. The real UI validation therefore
ran the development server. No upstream configuration was weakened or changed.

## 5. Known limitations

- Signed net exposure is displayed from the Phase E export addition (`netLots`,
  captured by the account that owns the position ledger). It is not derived or
  signed by Phase F; the package verifier checks `absoluteNetLots = |netLots|`
  on every row and the sign against its derived basket inventory.
- One basket at a time. Run summary, basket table filters, run-level timeline
  and jump-to-event are Phase H, including the run-level view of the
  `entry_rejection_summary` run-end recaps.
- The Phase E export addition changes only telemetry serialization; it created a
  new replay-package identity (recorded below) but not a new strategy, and the
  run's `results.json` is byte-identical to the Phase D artifact. The candle
  cache identity is unchanged.
- Replay is bar-close granularity on derived 1-minute candles, not a tick
  simulation and not an execution authority. A loaded candle always closes
  inside the replay window.
- Events and account rows reach the browser strictly through the cursor
  endpoints; the price series in a loaded chunk extends beyond the cursor but is
  derived visualization data, not authoritative state. Boundary levels arrive
  only with the revealed `basket_anchored` event.
- The account panel depends on the exported sampling: exact snapshots at every
  significant event and periodic samples at most every 300 simulated seconds.
  Between samples the panel shows the last exported row; it does not
  interpolate, and a non-observable floating P/L is labelled rather than valued.
- The final basket remains open through the authoritative run end; its window
  is the full remaining run and is replayed in bounded chunks. Labelling it
  `open at run end` requires the cursor to reach that run end.
- Margin Call transitions and trailing activations inherit the documented
  Phase E parity limits; the UI displays the exported rows as-is and does not
  reconstruct them. A NotDefined margin level renders as `not defined`, never as
  a percentage.
- Boundary price lines are displayed only while near the revealed candle range;
  exact values remain in the basket header and the activation annotation.
- Long baskets are replayed in bounded chunks; stepping past a chunk boundary
  loads the next bounded chunk with 6 hours of context, so only that chunk is
  in browser memory.
- Privacy mode masks account monetary values and their exact-value tooltips.
- This is a fork addition on `Rady70/trade-journal`; it has not been merged and
  does not claim Phase G acceptance.

## 6. What remains for Phase G

Phase G is the separately reviewed Basket #276 acceptance milestone: a user
watches the corrected basket from entry through Margin Call, Stop Out, every
forced liquidation and the subsequent Escape exit, with every visible value
matching the export. Phase F provides the surface and the tested plumbing for
that review; this record does not perform or claim it.
