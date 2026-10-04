import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";
import { readFileSync, appendFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSummary, runBaskets, runTimeline } from "../src/server/marketlab-run";
import { basketDetail, basketReveal, loadPackage } from "../src/server/marketlab-replay";

const root = process.env.MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE;
const candles = process.env.MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE;
const packageHash = "d145a49b548fe9356f1355d33df3329f87ce667cd15b367369219b8f27a9ccb4";
const candleHash = "ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d";

describe.skipIf(!root || !candles)("Phase H against independent raw Phase E source", () => {
  let raw: Record<string, any>[];
  let rows: Record<string, any>[];
  beforeAll(() => {
    vi.stubEnv("MARKETLAB_REPLAY_PACKAGE", root!);
    vi.stubEnv("MARKETLAB_CANDLE_CACHE", candles!);
    vi.stubEnv("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256", packageHash);
    vi.stubEnv("MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256", candleHash);
    const lines = (name: string) =>
      readFileSync(join(root!, name), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    raw = lines("events.jsonl");
    const manifest = JSON.parse(readFileSync(join(root!, "manifest.json"), "utf8"));
    rows = manifest.files
      .filter((f: any) => f.name.startsWith("telemetry-"))
      .flatMap((f: any) => lines(f.name));
  });
  afterAll(() => vi.unstubAllEnvs());
  const allPages = <T>(fetch: (offset: number) => { items: T[]; nextOffset: number | null }) => {
    const items: T[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = fetch(offset);
      expect(page.items.length).toBeLessThanOrEqual(40);
      items.push(...page.items);
      offset = page.nextOffset;
    }
    return items;
  };
  it("presents exact exported run counters and boundary snapshots, not inferred economics", () => {
    const summary = runSummary();
    const end = raw.at(-1)!;
    for (const [key, value] of Object.entries(summary.counters)) expect(value).toBe(end[key]);
    expect(summary.completed).toBe(end.completed);
    expect(summary.ended).toBe(end.time);
    expect(summary.basketCount).toBe(280);
    expect(summary.openBaskets).toEqual([280]);
    const { timeMs: _, ...snapshot } = summary.finalAccount;
    expect(snapshot).toEqual(rows.find((r) => r.eventId === end.id));
  });
  it("paginates all 280 immutable baskets and matches every exported anchor/close lifecycle", () => {
    const source = runSummary().source.manifestSha256;
    const items = allPages((offset) => runBaskets(offset, "all", source));
    expect(items.map((b) => b.number)).toEqual(
      raw.filter((e) => e.type === "basket_anchored").map((e) => e.basket),
    );
    for (const b of items) {
      const anchor = raw.find((e) => e.type === "basket_anchored" && e.basket === b.number)!;
      const close = raw.find(
        (e) => ["strategy_exit", "basket_liquidated"].includes(e.type) && e.basket === b.number,
      );
      expect(b.anchorEventId).toBe(anchor.id);
      expect(b.anchorTime).toBe(anchor.time);
      expect(b.closeTime).toBe(close?.time ?? null);
      expect(b.realizedProfit).toBe(close?.realizedProfit ?? null);
      expect(b.status).toBe(
        !close ? "open" : close.type === "basket_liquidated" ? "liquidated" : "closed",
      );
    }
    expect(items.at(-1)).toMatchObject({
      number: 280,
      entries: 0,
      status: "open",
      closeTime: null,
      realizedProfit: null,
    });
  });
  it("discovers five Stop Outs and all 46 Margin Call transitions with their original context", () => {
    const source = runSummary().source.manifestSha256;
    for (const [filter, types, count] of [
      ["stop-out", ["stop_out_triggered"], 5],
      ["margin-call", ["margin_call_entered", "margin_call_left"], 46],
    ] as const) {
      const expected = raw.filter((e) => (types as readonly string[]).includes(e.type));
      const events = allPages((offset) => runTimeline(offset, filter, null, source));
      expect(events.map((e) => e.id)).toEqual(expected.map((e) => e.id));
      expect(events).toHaveLength(count);
      expect(allPages((offset) => runBaskets(offset, filter, source)).map((b) => b.number)).toEqual(
        [276, 279],
      );
    }
  });
  it("preserves all live chronology and exact same-time jump prefixes/account states for every occurrence", () => {
    const source = runSummary().source.manifestSha256;
    const events = allPages((offset) => runTimeline(offset, "all", null, source, true));
    expect(events.map((e) => e.id)).toEqual(raw.filter((e) => e.time).map((e) => e.id));
    for (const event of events) {
      const detail = basketDetail(event.basket, event.id);
      expect(detail.target).toEqual({ id: event.id, timeMs: Date.parse(event.time) });
      const jump = basketReveal(event.basket, 0, detail.target!.timeMs, false, event.id);
      expect(jump.reachedEventId).toBe(event.id);
      expect(jump.events.at(-1)!.id).toBe(event.id);
      expect(jump.events.every((e) => e.id <= event.id)).toBe(true);
      const { timeMs: _, ...snapshot } = jump.account!;
      expect(snapshot).toEqual(rows.find((r) => r.eventId === event.id));
    }
  }, 60000);
  it("rejects stale sources, cross-basket/recap jumps, inconsistent occurrence times, and invalid pages", () => {
    const source = runSummary().source.manifestSha256;
    expect(() => runBaskets(0, "all", "0".repeat(64))).toThrow(/identity changed/);
    expect(() => runBaskets(99999, "all", source)).toThrow(/offset/);
    expect(() => basketDetail(1, 1323)).toThrow(/does not belong/);
    const recap = raw.find((e) => e.type === "entry_rejection_summary")!;
    expect(() => basketDetail(recap.basket, recap.id)).toThrow();
    expect(() => basketReveal(276, 0, Date.parse("2020-03-23T12:06:26.293Z"), false, 1323)).toThrow(
      /inconsistent/,
    );
  });
  it("fails closed after an accepted package payload is modified without updating its manifest", () => {
    const temp = mkdtempSync(join(tmpdir(), "marketlab-phase-h-"));
    try {
      cpSync(root!, temp, { recursive: true });
      vi.stubEnv("MARKETLAB_REPLAY_PACKAGE", temp);
      expect(runSummary().basketCount).toBe(280);
      appendFileSync(join(temp, "events.jsonl"), " ");
      expect(() => runSummary()).toThrow(/bytes|SHA-256/);
      expect(() => loadPackage()).toThrow();
    } finally {
      vi.stubEnv("MARKETLAB_REPLAY_PACKAGE", root!);
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
