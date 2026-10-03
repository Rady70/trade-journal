# MarketLab Backtests — Phase F implementation record

Status: **implemented and ready for independent review (2026-10-03). Phase G–I
have not started. This is not a Phase G acceptance claim.**

This record covers the Phase F MarketLab adaptation of LuxAlgo Trade Journal: a
dedicated **MarketLab Backtests** path that consumes the finalized Phase E
replay package directly and presents the authoritative SingleAnchor history
visually.

The governing boundary is unchanged:

> **LEAN determines what happened. LuxAlgo shows what happened. Fincept launches
> and navigates the result.**

## 1. Provenance and base revision

| | |
|---|---|
| Upstream | `LuxAlgo/trade-journal`, MIT |
| Historical planning snapshot | `949bca1993ee284e1facf2e26cfd1fa820b8f5cf` |
| Selected base revision | `6e0bb0e94c863c39347a7be3283d6061fddc257f` (upstream `main`, 2026-09-30) |
| MarketLab fork | `https://github.com/Rady70/trade-journal` |
| Implementation branch | `marketlab/phase-f-single-anchor-replay` |
| Review PR | [Rady70/trade-journal#1](https://github.com/Rady70/trade-journal/pull/1) (open; not merged) |

The base is the current upstream `main`, one commit after the planning snapshot.
That commit (`Fix account currencies and hedged CSV imports (#32)`) improves
preserved-position semantics and currency handling; the MIT license is unchanged
and no later upstream commit existed at selection time. See
[MARKETLAB_FORK.md](../MARKETLAB_FORK.md).

## 2. What was implemented

New additive paths (nothing in the upstream round-trip engine, importers,
schema, broker sync or analytics is modified):

| Path | Role |
|---|---|
| `apps/web/src/lib/marketlab-replay.ts` | Phase E contracts, fail-closed error type, basket indexing, cursor reveal, exact account selection |
| `apps/web/src/server/marketlab-replay.ts` | read-only package/candle-cache loader with full verification, bounded window reader, status |
| `apps/web/src/app/api/marketlab-replay/route.ts` | package status + basket index |
| `apps/web/src/app/api/marketlab-replay/baskets/[number]/route.ts` | one basket: identity and full ordered event stream |
| `apps/web/src/app/api/marketlab-replay/baskets/[number]/window/route.ts` | bounded derived candles + exact exported account rows |
| `apps/web/src/app/backtests/page.tsx` | the MarketLab Backtests surface |
| `apps/web/src/components/marketlab-replay.tsx` | replay state machine, controls, account panel, event feed |
| `apps/web/src/components/marketlab-replay-chart.tsx` | Vela chart with authoritative event annotations |
| `apps/web/src/components/shell.tsx` | one `Backtests` navigation entry (minimal upstream edit) |
| `.env.example` | the two optional replay environment variables (minimal upstream edit) |

### Authoritative input

The loader reads the finalized Phase E package and never reconstructs it:

- `MARKETLAB_REPLAY_PACKAGE` points to `<run>\storage\single-anchor\replay`
  (or to the run directory); `MARKETLAB_CANDLE_CACHE` points to the derived M1
  candle cache directory.
- Before any row is served the loader verifies: the
  `marketlab-single-anchor-replay-package-v1` contract, the documented package
  fingerprint over the payload descriptors, every payload file's byte count,
  SHA-256 and line count, the published event-type whitelist, strictly
  increasing event ids, one `run_started` first / one `run_ended` last, every
  live event's canonical UTC time, the manifest per-type event counts against
  the actual stream, and the one-active-basket lifecycle. Telemetry rows are
  shape-checked when a window is served (exact decimal strings, canonical times,
  kinds).
- The candle cache is verified separately and fails closed: contract, symbol,
  M1/UTC/mid-of-best-bid-ask basis, per-file rows/bytes/SHA-256 and strict OHLC
  parsing.
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
  explicitly.
- The account panel shows the latest exported telemetry row at or before the
  cursor (event snapshot or ≤300 s periodic sample). It never interpolates and
  never recomputes a value; the UI shows the exact exported decimals.

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
  only, and are displayed unmodified.
- Basket windows are the authoritative anchor/last-live-event times plus a fixed
  30-minute context pad; nothing else is inferred.

### Replay controls and screen

- Basket selector over all 280 authoritative baskets (status, anchor time,
  entries).
- Historical M1 candles with progressive reveal at bar close; executions,
  forced liquidations, stop out, Margin Call, hard-BE and exit annotations are
  revealed only at or before the cursor.
- Controls: Restart, Previous candle, Play/Pause, Next candle, reveal full
  window, speed (1×/2×/4×/16×/64× candles per second), scrubber, cursor time.
- Account panel synchronized to the cursor from exported values: balance,
  equity, floating P/L, realized P/L, used margin, free margin, margin level,
  open positions, gross exposure (lots), |net exposure| (lots); plus the source
  row identity and Margin Call state.
- Event feed in exact package order with a run-end recap distinction.
- Header shows basket identity, anchor, upper/lower entry boundaries and
  hard-BE boundaries. Exact boundary values are also in the event annotations;
  horizontal boundary price lines are drawn only while near the revealed price
  range so a far target cannot flatten the candles.
- Privacy mode (existing app setting) masks account monetary values.

### Long history

Candles are loaded in bounded chunks of at most 12,000 M1 bars per request;
one chunk is held in the browser. Scrubbing loads a bounded 6-hour context
before the target. No quote population and no run-level candle array is sent to
the browser. Run-level navigation/timeline remains Phase H.

## 3. Local run instructions

Requirements: Node 22+ and pnpm 11.0.8 (the repository pins it; use
`corepack pnpm` if pnpm is not on `PATH`).

```powershell
corepack pnpm install --frozen-lockfile

$env:MARKETLAB_REPLAY_PACKAGE = '<run>\storage\single-anchor\replay'
$env:MARKETLAB_CANDLE_CACHE   = '<derived M1 candle cache>'

corepack pnpm --filter web dev -- -p 4321
# open http://127.0.0.1:4321/backtests
```

With neither variable set the page shows a clear not-configured state; with one
set incorrectly it shows the exact loader error.

## 4. Validation performed

All commands were run on Windows from the fork checkout.

| Check | Command | Result |
|---|---|---|
| Upstream suite (base revision) | `corepack pnpm vitest run` | 532/532 passed |
| Full suite with the finalized package | `corepack pnpm vitest run` with `MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE` / `MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE` set | **567/567 passed** (532 upstream + 35 Phase F) |
| Phase F contract/loader tests | `corepack pnpm vitest run apps/web/tests/marketlab-replay.test.ts` | 26/26 passed |
| Phase F UI tests (jsdom + Vela mock) | `corepack pnpm vitest run apps/web/tests/marketlab-replay-ui.test.ts` | 4/4 passed |
| Authoritative Phase E tests | `corepack pnpm vitest run apps/web/tests/marketlab-replay-authoritative.test.ts` with the finalized package | 5/5 passed |
| Typecheck | `corepack pnpm --filter web typecheck`, plus `packages/core` and `packages/importers` | passed |
| Formatting | `corepack pnpm exec prettier --check <changed files>` | passed |

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

1. The surface loads the package provenance with the finalized package SHA-256
   `5dcd8bfaffe76c9d2c8eec002073f62fe18b5d0d40b0602dbad0e59f6846097a` and the
   candle content SHA-256
   `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d`.
2. Basket #276 is selected from the 280-basket list (closed, Escape, 36
   entries).
3. Progressive reveal: entry #1 (`#1 Sell 0.10 @ 1499.868`) becomes visible by
   stepping; no forced liquidation is visible before the cursor reaches it.
4. Play advanced the cursor by 10 simulated minutes in 2.5 s at 4×; Pause
   stopped it.
5. Restart rewound to the first candle with no future events.
6. Scrubbing to the end revealed exactly 36 entries, 30 forced liquidations, 4
   Stop Outs and 1 strategy exit, in ascending package order, with the chart
   rendering; the account panel balance equalled the exported value
   (`25550.58500`).
7. No page errors were raised.
8. A corrupted copy of the package (one digit changed in `events.jsonl`) was
   rejected in the real UI with the exact SHA-256 failure and no replay
   rendered.

The invalid copy was created under the local temp directory; the authoritative
package and candle cache were never modified.

### Production build note (environmental)

`next build` completes compilation and route generation but this Windows host
cannot create the symlinks required by Next's standalone file-trace copy
(`EPERM: operation not permitted, symlink`). The untouched upstream base fails
identically at the same step, so this is a pre-existing environment limitation
(no symlink privilege), not a Phase F change. The real UI validation therefore
ran the development server. No upstream configuration was weakened or changed.

## 5. Known limitations

- One basket at a time. Run summary, basket table filters, run-level timeline
  and jump-to-event are Phase H.
- Replay is bar-close granularity on derived 1-minute candles, not a tick
  simulation and not an execution authority.
- The account panel depends on the exported sampling: exact snapshots at every
  significant event and periodic samples at most every 300 simulated seconds.
  Between samples the panel shows the last exported row; it does not
  interpolate.
- Margin Call transitions and trailing activations inherit the documented
  Phase E parity limits; the UI displays the exported rows as-is and does not
  reconstruct them.
- Boundary price lines are displayed only while near the revealed candle range;
  exact values remain in the basket header and the activation annotation.
- Long baskets are replayed in bounded chunks; stepping past a chunk boundary
  loads the next bounded chunk.
- Privacy mode masks account monetary values.
- This is a fork addition on `Rady70/trade-journal`; it has not been merged and
  does not claim Phase G acceptance.

## 6. What remains for Phase G

Phase G is the separately reviewed Basket #276 acceptance milestone: a user
watches the corrected basket from entry through Margin Call, Stop Out, every
forced liquidation and the subsequent Escape exit, with every visible value
matching the export. Phase F provides the surface and the tested plumbing for
that review; this record does not perform or claim it.
