import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  source as verifyFinalized,
  packageHash,
  candleHash,
  resultsHash,
  evidenceHash,
} from "../phase-g/source.mjs";
export { packageHash, candleHash, resultsHash, evidenceHash };

// Independent comparison authority: raw finalized LEAN files + standard library.
// The Phase G source verifier checks the sealed records and all four identities.
export function source() {
  const verified = verifyFinalized();
  const root = process.env.MARKETLAB_REPLAY_PACKAGE;
  const lines = (name) =>
    readFileSync(join(root, name), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  const events = lines("events.jsonl");
  const rows = verified.manifest.files
    .filter((f) => f.name.startsWith("telemetry-"))
    .flatMap((f) => lines(f.name));
  const snapshots = new Map(rows.filter((r) => r.kind === "event").map((r) => [r.eventId, r]));
  const baskets = [];
  let context = null;
  const membership = new Map();
  for (const event of events) {
    if (event.type === "basket_anchored") {
      context = { number: event.basket, anchor: event, events: [] };
      baskets.push(context);
    }
    if (event.type === "run_started" || event.type === "run_ended" || !event.time) continue;
    assert.ok(context);
    if (event.basket !== undefined) assert.equal(event.basket, context.number);
    context.events.push(event);
    membership.set(event.id, context.number);
    if (event.type === "strategy_exit" || event.type === "basket_liquidated") context.close = event;
  }
  membership.set(events[0].id, baskets[0].number);
  membership.set(events.at(-1).id, baskets.at(-1).number);
  assert.equal(baskets.length, 280);
  return {
    ...verified,
    events,
    rows,
    snapshots,
    baskets,
    membership,
    runEnd: events.at(-1),
    expectedPrefix: (number, id) =>
      events.filter(
        (e) =>
          e.time &&
          e.id <= id &&
          membership.get(e.id) === number &&
          ((e.type !== "run_started" && e.type !== "run_ended") || e.id === id),
      ),
  };
}
