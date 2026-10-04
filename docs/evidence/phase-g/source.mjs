import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export const packageHash = "d145a49b548fe9356f1355d33df3329f87ce667cd15b367369219b8f27a9ccb4";
export const candleHash = "ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d";
export const resultsHash = "bc3958b2629e8930ef8de3890cac9c80006f26d7c8dffdf5ecf54d6a6aa9bdad";
export const evidenceHash = "f98263618bde5d2cd24542e028d322d0bab35074c430ce6b0bdb4c7a4b22f685";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const lines = (path) => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);

// Independent oracle: only Node standard library and finalized LEAN files.
// No application loader, rendering helper, or strategy computation is imported.
export function source() {
  const root = process.env.MARKETLAB_REPLAY_PACKAGE;
  const candles = process.env.MARKETLAB_CANDLE_CACHE;
  const lean = process.env.LEAN_ROOT ?? "E:/MarketLab/Lean";
  const manifest = json(join(root, "manifest.json"));
  assert.equal(manifest.packageSha256, packageHash);
  assert.equal(
    hash(manifest.files.map((f) => `${f.name}\n${f.sha256}\n${f.bytes}\n`).join("")),
    packageHash,
  );
  for (const file of manifest.files) {
    const bytes = readFileSync(join(root, file.name));
    assert.equal(hash(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
    assert.equal(bytes.toString("utf8").trim().split("\n").length, file.lines);
  }
  assert.equal(hash(readFileSync(join(root, "..", "results.json"))), resultsHash);
  const evidence = join(lean, "MarketLab/evidence/20261003-phase-e-signed-net-export");
  assert.equal(hash(readFileSync(join(evidence, "manifest.json"))), evidenceHash);
  assert.deepEqual(manifest, json(join(evidence, "replay-manifest.json")));
  const candleManifest = json(join(candles, "manifest.json"));
  assert.equal(candleManifest.content_sha256, candleHash);
  assert.deepEqual(candleManifest, json(join(evidence, "candle-cache-manifest.json")));
  const all = lines(join(root, "events.jsonl"));
  const anchor = all.find((e) => e.type === "basket_anchored" && e.basket === 276);
  const exit = all.find((e) => e.type === "strategy_exit" && e.basket === 276);
  const events = all.filter(
    (e) =>
      e.time >= anchor.time &&
      e.time <= exit.time &&
      (e.basket === 276 || e.type.startsWith("margin_call_")),
  );
  const rows = manifest.files
    .filter((f) => f.name.startsWith("telemetry-"))
    .flatMap((f) => lines(join(root, f.name)))
    .filter((r) => r.time >= anchor.time && r.time <= exit.time);
  const snapshots = new Map(rows.filter((r) => r.kind === "event").map((r) => [r.eventId, r]));
  const counts = Object.fromEntries(
    [...new Set(events.map((e) => e.type))].map((t) => [
      t,
      events.filter((e) => e.type === t).length,
    ]),
  );
  assert.equal(counts.entry_executed, 36);
  assert.equal(counts.stop_out_triggered, 4);
  assert.equal(counts.forced_liquidation, 30);
  assert.equal(exit.reason, "Escape");
  for (const e of events) assert.ok(snapshots.has(e.id));
  const accountAt = (ms) =>
    rows.filter((r) => Date.parse(r.time) <= Math.min(ms, Date.parse(exit.time))).at(-1) ?? null;
  return { manifest, events, rows, snapshots, counts, anchor, exit, accountAt };
}

if (process.argv[1]?.endsWith("source.mjs")) {
  const s = source();
  console.log(
    JSON.stringify(
      {
        packageHash,
        evidenceHash,
        resultsHash,
        candleHash,
        counts: s.counts,
        anchor: s.anchor,
        exit: s.exit,
        episodes: s.events
          .filter((e) => e.type === "stop_out_triggered")
          .map((e) => ({
            id: e.id,
            time: e.time,
            liquidations: s.events.filter(
              (f) => f.type === "forced_liquidation" && f.triggerTime === e.time,
            ).length,
          })),
      },
      null,
      2,
    ),
  );
}
