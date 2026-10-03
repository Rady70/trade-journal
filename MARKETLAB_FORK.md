# MarketLab fork of LuxAlgo Trade Journal

This repository is the **MarketLab-controlled fork** of
[`LuxAlgo/trade-journal`](https://github.com/LuxAlgo/trade-journal), used as the
replay/journal UI foundation for the MarketLab **SingleAnchor** program.

It exists so upstream changes stay trackable: the fork keeps upstream `main` as
a real remote (`upstream`), and every MarketLab change is additive and listed
below.

## Provenance

|                              |                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream                     | `https://github.com/LuxAlgo/trade-journal`                                                                                                                                                                                                                      |
| License                      | MIT © LuxAlgo Global, LLC (`LICENSE`); marks covered by `TRADEMARKS.md`                                                                                                                                                                                         |
| MarketLab fork               | `https://github.com/Rady70/trade-journal`                                                                                                                                                                                                                       |
| Historical planning snapshot | `949bca1993ee284e1facf2e26cfd1fa820b8f5cf`                                                                                                                                                                                                                      |
| **Selected base revision**   | `6e0bb0e94c863c39347a7be3283d6061fddc257f` (upstream `main`)                                                                                                                                                                                                    |
| Base selection reason        | current upstream `main` at fork time; one commit after the planning snapshot, carrying the upstream hedged-import/currency fixes (`#32`) that improve preserved-position semantics; MIT unchanged; no later upstream commit existed when this base was selected |
| Fork point                   | `6e0bb0e94c863c39347a7be3283d6061fddc257f`                                                                                                                                                                                                                      |

The upstream LICENSE, TRADEMARKS, README attribution, and package licenses are
preserved. MarketLab does not relicense the fork and does not remove the
upstream project identity from the parts it inherits.

## What MarketLab adds

The MarketLab adaptation is confined to new, reviewable paths:

- `apps/web/src/lib/marketlab-replay.ts` — the Phase E package contracts and
  pure indexing/reveal/account-selection functions.
- `apps/web/src/server/marketlab-replay.ts` — the fail-closed, read-only
  package and derived-candle-cache loader plus bounded window reader.
- `apps/web/src/app/api/marketlab-replay/**` — package status, basket selector
  identity, bounded replay-window and cursor-bounded reveal routes.
- `apps/web/src/app/backtests/**`, `apps/web/src/components/marketlab-replay*.tsx`
  — the **MarketLab Backtests** surface and Vela replay screen.
- `apps/web/tests/marketlab-replay*.test.ts`, `apps/web/tests/helpers/…` —
  contract, fail-closed, UI and authoritative-package tests.
- `docs/marketlab-phase-f.md` and `docs/evidence/phase-f/` — the Phase F record
  and validation evidence.

Upstream files edited by MarketLab (kept minimal so they merge easily):

- `apps/web/src/components/shell.tsx` — one `Backtests` navigation entry.
- `.env.example` — the four MarketLab replay environment variables (the two
  paths plus the two required expected-identity anchors).
- `README.md` — a short pointer to the MarketLab surface.

Nothing else is modified. The upstream round-trip engine, importers, database
schema, broker sync, AI features and analytics are untouched and remain usable
independently.

## Behavior boundary

The MarketLab surface follows the program rule:

> **LEAN determines what happened. LuxAlgo shows what happened.**

- Authoritative: the finalized LEAN Phase E replay package (events, executions,
  risk events, basket state, account snapshots/telemetry including the exported
  gross and signed net lots).
- Derived visualization data: the qualified Dukascopy M1 candle cache.
- The surface never recalculates a SingleAnchor decision, a fill, a sizing
  result, an account value or a liquidation, and it never runs the journal's
  round-trip engine over SingleAnchor history.

See [docs/marketlab-phase-f.md](docs/marketlab-phase-f.md) for the full record.

## Staying current with upstream

```bash
git fetch upstream
git log --oneline upstream/main ^main   # inspect new upstream work
git merge upstream/main                 # or rebase the MarketLab branch
```

MarketLab changes live in additive files, so upstream merges are expected to be
small. Do not push to `upstream`; all MarketLab work is pushed to `origin`.
