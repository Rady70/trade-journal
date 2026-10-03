# Phase F real-UI validation evidence

These artifacts were produced by [`validate.mjs`](validate.mjs), a
puppeteer-core harness that drives the installed Microsoft Edge against a local
`next dev` server of the MarketLab Backtests surface.

## What was validated

- `transcript-valid.json` / `01-backtests-landing.png`: the surface loads the
  finalized package provenance (the package SHA-256 and the unchanged candle
  content SHA-256 `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d`),
  reports the replay/candle source compatibility, lists 280 baskets by number
  and anchor time only, and verifies that neither the basket index nor the
  status payload carries pre-cursor outcome, counts, totals, boundary levels or
  payload descriptors.
- `transcript-valid.json` / `02b-entry-revealed.png`: basket #276 selected;
  progressive reveal (entry visible, no forced liquidation before the cursor,
  `replay in progress`, no future totals).
- `transcript-valid.json` / `03-basket-276-end.png`: Play/Pause advances the
  cursor, Restart rewinds, and scrubbing to the end reveals exactly 36 entries,
  30 forced liquidations, 4 Stop Outs and 1 Escape exit in ascending package
  order with the candle chart rendered; the account panel balance equals the
  exported `25550.58500`, the signed net exposure equals the exported `netLots`,
  and the outcome reads `closed (Escape)`. This browser run proves
  cursor/account synchronization at the cursor and the exported-value match; the
  cross-basket isolation rule (basket #5 keeping its flat close state while
  basket #6 opens inside its post-close context) is proven by the authoritative
  automated test, not by this transcript. The candle window response carries no
  account data; account rows come only from the cursor-bounded reveal.
- `transcript-valid.json` / `05-basket-280-run-end.png`: the final open basket
  #280 is scrubbed near the run end and Play runs through the last candle and
  the explicit non-candle terminal step; `open at run end` appears only when
  the cursor reaches the authoritative run end.
- `transcript-invalid.json` / `04-invalid-package.png`: a corrupted copy of the
  package (one digit changed in `events.jsonl`, kept in a local temp directory)
  is rejected with the exact SHA-256 failure and no replay is rendered.

## Reproducing

Requirements: Node 22+, Microsoft Edge, and a local `puppeteer-core` (installed
outside this repository, for example in a temp directory:

```powershell
npm install puppeteer-core
$env:APP_URL = "http://127.0.0.1:4321"
$env:OUT_DIR = "."
node validate.mjs valid      # against MARKETLAB_REPLAY_PACKAGE=candles valid
node validate.mjs invalid    # against a deliberately corrupted package copy
```

The harness only reads the running app over HTTP; it never writes into the
authoritative package or candle cache.
