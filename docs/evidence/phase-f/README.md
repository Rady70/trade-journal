# Phase F real-UI validation evidence

These artifacts were produced by [`validate.mjs`](validate.mjs), a
puppeteer-core harness that drives the installed Microsoft Edge against a local
`next dev` server of the MarketLab Backtests surface.

## What was validated

- `transcript-valid.json` / `01-backtests-landing.png`: the surface loads the
  finalized package provenance (package SHA-256
  `5dcd8bfaffe76c9d2c8eec002073f62fe18b5d0d40b0602dbad0e59f6846097a`, candle
  content SHA-256
  `ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d`), reports
  the replay/candle source compatibility, lists 280 baskets by number and
  anchor time only, and verifies that the basket index and detail responses
  carry no pre-cursor outcome or counts.
- `transcript-valid.json` / `02b-entry-revealed.png`: basket #276 selected;
  progressive reveal (entry visible, no forced liquidation before the cursor,
  `replay in progress`, no future totals).
- `transcript-valid.json` / `03-basket-276-end.png`: Play/Pause advances the
  cursor, Restart rewinds, and scrubbing to the end reveals exactly 36 entries,
  30 forced liquidations, 4 Stop Outs and 1 Escape exit in ascending package
  order with the candle chart rendered; the account panel balance equals the
  exported `25550.58500` and the outcome reads `closed (Escape)`.
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
