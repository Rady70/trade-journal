import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountAtCursor,
  barCloseMs,
  parseUtcMs,
  revealEvents,
  type AccountRow,
  type ReplayEventView,
} from "../src/lib/marketlab-replay";
import {
  basketDetail,
  basketReveal,
  basketWindow,
  loadPackage,
  replayStatus,
  ReplayPackageError,
} from "../src/server/marketlab-replay";
import {
  sha256,
  SYNTHETIC_SOURCE_DIGEST,
  SYNTHETIC_SOURCE_ROWS,
  syntheticEvents,
  syntheticTelemetry,
  withProducerDefaults,
  writeCandleMonths,
  writeManifest,
  writeReplayEvents,
  writeReplayPackage,
  writeSyntheticCandleCache,
} from "./helpers/marketlab-package";

const scratchDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  base: string;
  packageRoot: string;
  candleRoot: string;
  manifest: Record<string, unknown>;
  events: Record<string, unknown>[];
  telemetry: Record<string, unknown>[];
}

function fixture(overrides: Record<string, unknown> = {}): Fixture {
  const base = mkdtempSync(join(tmpdir(), "marketlab-replay-"));
  scratchDirs.push(base);
  const packageRoot = join(base, "package");
  const candleRoot = join(base, "candles");
  const events = syntheticEvents();
  const telemetry = syntheticTelemetry(events);
  const manifest = writeReplayPackage(packageRoot, events, telemetry, overrides);
  writeSyntheticCandleCache(candleRoot);
  vi.stubEnv("MARKETLAB_REPLAY_PACKAGE", packageRoot);
  vi.stubEnv("MARKETLAB_CANDLE_CACHE", candleRoot);
  return { base, packageRoot, candleRoot, manifest, events, telemetry };
}

const ISO = (time: string): number => parseUtcMs(time)!;

describe("canonical time parsing", () => {
  it("accepts only the exact Phase E UTC text", () => {
    expect(parseUtcMs("2024-01-01T00:30:00.000Z")).toBe(Date.UTC(2024, 0, 1, 0, 30, 0, 0));
    expect(parseUtcMs("2024-13-01T00:00:00.000Z")).toBeNull();
    expect(parseUtcMs("2024-02-30T00:00:00.000Z")).toBeNull();
    expect(parseUtcMs("2024-01-01T00:00:00Z")).toBeNull();
    expect(parseUtcMs("2024-01-01")).toBeNull();
    expect(parseUtcMs(123)).toBeNull();
  });
});

describe("authoritative event semantics", () => {
  it("keeps opposing SingleAnchor legs separate with immutable trade numbers", () => {
    fixture();
    const status = replayStatus();
    expect(status.valid).toBe(true);
    const summary1 = loadPackage().byNumber.get(1)!;
    expect(summary1.status).toBe("liquidated");
    expect(summary1.exitReason).toBe("BrokerLiquidation");
    expect(summary1.entries).toBe(3);
    expect(summary1.tradeNumbers).toEqual([1, 2, 3]);
    expect(summary1.forcedLiquidations).toBe(1);
    expect(summary1.stopOutEpisodes).toBe(1);
    expect(summary1.marginCallEntries).toBe(1);
    expect(summary1.hardBreakevenActivations).toBe(1);
    const summary2 = loadPackage().byNumber.get(2)!;
    expect(summary2.status).toBe("closed");
    expect(summary2.exitReason).toBe("Trailing");
    expect(summary2.liveRejections).toBe(1);
    expect(summary2.entries).toBe(1);
    // The pre-cursor selector identity carries only the selector and window.
    const identity = status.baskets.find((basket) => basket.number === 1)!;
    expect(Object.keys(identity).sort()).toEqual([
      "anchorTime",
      "anchorTimeMs",
      "number",
      "windowEndMs",
      "windowStartMs",
    ]);
    expect(JSON.stringify(status.package)).not.toContain("eventCounts");
    expect(JSON.stringify(status.package)).not.toContain("telemetryCounts");
    expect(status.package).not.toHaveProperty("files");
    expect(status.package).not.toHaveProperty("outcome");
    expect(status.package).not.toHaveProperty("counters");
    expect(JSON.stringify(status)).not.toContain("1,454");
  });

  it("passes every event payload through unmodified and in package order", () => {
    fixture();
    const basket1 = loadPackage().byNumber.get(1)!;
    const revealed = basketReveal(1, 0, basket1.windowEndMs);
    const ids = revealed.events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const entry = revealed.events.find(
      (event) => event.type === "entry_executed" && event.payload.tradeNumber === 2,
    )!;
    expect(entry.payload.side).toBe("Sell");
    expect(entry.payload.fillPrice).toBe("100.5");
    expect(entry.payload.placedLot).toBe("0.20");
    expect(entry.payload.regime).toBe("Arithmetic");
    expect(entry.payload).toEqual(
      syntheticEvents().find((event) => event.tradeNumber === 2 && event.type === "entry_executed"),
    );
    const anchor = revealed.events.find((event) => event.type === "basket_anchored")!;
    expect(anchor.payload.upper).toBe("101.0");
    expect(anchor.payload.lower).toBe("99.0");
    expect(anchor.payload.lowerTarget).toBe("90.0");
    expect(anchor.payload.upperTarget).toBe("110.0");
  });

  it("reveals no event before its authoritative time and keeps run-end recaps out of the basket clock", () => {
    fixture();
    const at38 = basketReveal(2, 0, ISO("2024-01-01T00:38:00.000Z")).events;
    expect(at38.some((event) => event.type === "entry_rejection_summary")).toBe(false);
    expect(at38).toHaveLength(1);
    const at39 = basketReveal(2, 0, ISO("2024-01-01T00:39:00.000Z")).events;
    expect(at39.map((event) => event.type)).toEqual(["basket_anchored", "entry_executed"]);
    const incremental = basketReveal(2, at39[at39.length - 1]!.id, ISO("2024-01-01T00:41:00.000Z"));
    expect(incremental.events.map((event) => event.type)).toEqual([
      "entry_rejected",
      "trailing_activated",
      "strategy_exit",
    ]);
    const allEvents = loadPackage().events;
    const recap = allEvents.find((event) => event.type === "entry_rejection_summary")!;
    expect(recap.live).toBe(false);
    expect(
      revealEvents(allEvents, ISO("2024-01-01T00:39:29.999Z")).some((event) => !event.live),
    ).toBe(false);
    expect(
      revealEvents(allEvents, ISO("2024-01-01T00:39:30.000Z")).some((event) => !event.live),
    ).toBe(true);
  });

  it("returns the exact exported account row in force at the cursor, never an interpolation", () => {
    const rows: AccountRow[] = [
      {
        kind: "event",
        eventId: 1,
        time: "2024-01-01T00:00:00.000Z",
        timeMs: ISO("2024-01-01T00:00:00.000Z"),
        quoteSequence: 1,
        balance: "1000.00000",
        equity: "1000.00000",
        floatingProfit: "0.00000",
        floatingObservable: true,
        realizedProfit: "0.00000",
        usedMargin: "0.00000",
        freeMargin: "1000.00000",
        marginLevelPercent: null,
        marginCallActive: false,
        openPositions: 0,
        grossLots: "0.00",
        netLots: "0.00",
        absoluteNetLots: "0.00",
      },
      {
        kind: "event",
        eventId: 9,
        time: "2024-01-01T00:35:00.000Z",
        timeMs: ISO("2024-01-01T00:35:00.000Z"),
        quoteSequence: 600,
        balance: "900.00000",
        equity: "895.00000",
        floatingProfit: "-5.00000",
        floatingObservable: true,
        realizedProfit: "-100.00000",
        usedMargin: "10.00000",
        freeMargin: "885.00000",
        marginLevelPercent: "8950.000000000000000000000000000",
        marginCallActive: true,
        openPositions: 2,
        grossLots: "0.30",
        netLots: "0.10",
        absoluteNetLots: "0.10",
      },
    ];
    expect(accountAtCursor(rows, ISO("2024-01-01T00:30:00.000Z"))?.balance).toBe("1000.00000");
    const atLiquidation = accountAtCursor(rows, ISO("2024-01-01T00:35:00.000Z"))!;
    expect(atLiquidation.marginLevelPercent).toBe("8950.000000000000000000000000000");
    expect(atLiquidation.marginCallActive).toBe(true);
    expect(accountAtCursor(rows, ISO("2024-01-01T00:34:59.999Z"))?.eventId).toBe(1);
    expect(accountAtCursor(rows, null)).toBeNull();
  });
});

describe("fail-closed package validation", () => {
  const expectRejected = () => {
    const status = replayStatus();
    expect(status.configured).toBe(true);
    expect(status.valid).toBe(false);
    expect(status.error).toBeTruthy();
    expect(status.baskets).toEqual([]);
    expect(() => basketDetail(1)).toThrow(ReplayPackageError);
  };

  it("rejects an unsupported contract", () => {
    fixture({ contract: "marketlab-single-anchor-replay-package-v2" });
    expectRejected();
    expect(replayStatus().error).toContain("Unsupported replay package contract");
  });

  it("rejects a package fingerprint mismatch", () => {
    fixture({ packageSha256: "0".repeat(64) });
    expectRejected();
    expect(replayStatus().error).toContain("fingerprint mismatch");
  });

  it("rejects a payload hash mismatch", () => {
    const { packageRoot } = fixture();
    const path = join(packageRoot, "events.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace("99.5", "99.6"), "utf8");
    expectRejected();
    expect(replayStatus().error).toContain("SHA-256");
  });

  it("rejects a payload line-count mismatch even with a matching hash", () => {
    const ctx = fixture();
    const text = readFileSync(join(ctx.packageRoot, "events.jsonl"), "utf8");
    const files = (ctx.manifest.files as Array<Record<string, unknown>>).map((file) =>
      file.name === "events.jsonl"
        ? {
            ...file,
            sha256: sha256(text),
            bytes: Buffer.byteLength(text),
            lines: (file.lines as number) + 1,
          }
        : file,
    );
    const updated: Record<string, unknown> = { ...ctx.manifest, files };
    updated.packageSha256 = sha256(
      files.map((file) => `${file.name}\n${file.sha256}\n${file.bytes}\n`).join(""),
    );
    writeManifest(ctx.packageRoot, updated);
    expectRejected();
    expect(replayStatus().error).toContain("lines");
  });

  it("rejects an unknown event type", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "trailing_activated" ? { ...event, type: "mystery_event" } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("unsupported event type");
  });

  it("rejects duplicate or out-of-order event ids", () => {
    const ctx = fixture();
    const events = syntheticEvents();
    events[3] = { ...events[3]!, id: events[2]!.id };
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    const ctx2 = fixture();
    const reordered = syntheticEvents();
    reordered[2] = { ...reordered[2]!, id: 99 };
    reordered[3] = { ...reordered[3]!, id: 3 };
    writeReplayEvents(ctx2.packageRoot, ctx2.manifest, reordered);
    expectRejected();
  });

  it("rejects an event that references a basket before its anchor", () => {
    const ctx = fixture();
    const events = syntheticEvents();
    const entry = events.findIndex(
      (event) => event.type === "entry_executed" && event.basket === 2,
    );
    const basket = events.splice(entry, 1)[0]!;
    const anchor2 = events.findIndex(
      (event) => event.type === "basket_anchored" && event.basket === 2,
    );
    events.splice(anchor2, 0, basket);
    const renumbered = events.map((event, index) => ({ ...event, id: index + 1 }));
    writeReplayEvents(ctx.packageRoot, ctx.manifest, renumbered);
    expectRejected();
    expect(replayStatus().error).toContain("before its anchor");
  });

  it("rejects an anchor while the previous basket is still open", () => {
    const ctx = fixture();
    const events = syntheticEvents()
      .filter((event) => event.type !== "basket_liquidated")
      .map((event, index) => ({ ...event, id: index + 1 }));
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("still open");
  });

  it("rejects a recap that carries a live time", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "entry_rejection_summary" ? { ...event, time: event.lastTime } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("Recap");
  });

  it("rejects invalid JSON even when the manifest matches the broken bytes", () => {
    const ctx = fixture();
    const text = "{not json}\n";
    writeFileSync(join(ctx.packageRoot, "events.jsonl"), text, "utf8");
    const files = (ctx.manifest.files as Array<Record<string, unknown>>).map((file) =>
      file.name === "events.jsonl"
        ? { ...file, sha256: sha256(text), bytes: Buffer.byteLength(text), lines: 1 }
        : file,
    );
    const updated: Record<string, unknown> = { ...ctx.manifest, files, eventCounts: {} };
    updated.packageSha256 = sha256(
      files.map((file) => `${file.name}\n${file.sha256}\n${file.bytes}\n`).join(""),
    );
    writeManifest(ctx.packageRoot, updated);
    expectRejected();
    expect(replayStatus().error).toContain("invalid JSON");
  });

  it("rejects malformed telemetry values at package load", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents()) as Array<Record<string, unknown>>;
    telemetry[0] = { ...telemetry[0], marginLevelPercent: 42 };
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
    expectRejected();
    expect(replayStatus().error).toContain("marginLevelPercent");
  });

  it("rejects a missing telemetry payload", () => {
    const { packageRoot } = fixture();
    unlinkSync(join(packageRoot, "telemetry-2024.jsonl"));
    expectRejected();
    expect(replayStatus().error).toContain("missing");
  });

  it("rejects a telemetry shard whose year does not match its name", () => {
    fixture({
      files: [
        {
          name: "events.jsonl",
          year: null,
          sha256: "a".repeat(64),
          bytes: 1,
          lines: 1,
        },
        {
          name: "telemetry-2024.jsonl",
          year: 2023,
          sha256: "b".repeat(64),
          bytes: 1,
          lines: 1,
        },
      ],
    });
    expectRejected();
    expect(replayStatus().error).toContain("ascending year order");
  });
});

describe("derived candle cache validation", () => {
  it("rejects a mismatched candle cache before serving a window", () => {
    const ctx = fixture();
    const manifestPath = join(ctx.candleRoot, "manifest.json");
    const candleManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    candleManifest.contract = "marketlab-xauusd-m15-candle-cache-v9";
    writeFileSync(manifestPath, JSON.stringify(candleManifest), "utf8");
    const status = replayStatus();
    expect(status.valid).toBe(true);
    expect(status.candles.valid).toBe(false);
    expect(status.candles.error).toContain("marketlab-xauusd-m1-candle-cache-v1");
    expect(() => basketWindow(1, 0)).toThrow(ReplayPackageError);
  });

  it("rejects a tampered candle file before the cache can be valid", () => {
    const ctx = fixture();
    const csv = join(ctx.candleRoot, "xauusd-m1-2024-01.csv");
    writeFileSync(csv, readFileSync(csv, "utf8").replace("100.00", "100.01"), "utf8");
    // Full acceptance validation reads and SHA-checks every month, so the
    // tampered cache is rejected before any window is served.
    const status = replayStatus();
    expect(status.candles.valid).toBe(false);
    expect(status.candles.error).toContain("SHA-256");
    expect(() => basketWindow(1, 0)).toThrow(/SHA-256/);
  });

  it("rejects a candle cache for a different instrument", () => {
    const ctx = fixture();
    const manifestPath = join(ctx.candleRoot, "manifest.json");
    const candleManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    candleManifest.symbol = "EURUSD";
    writeFileSync(manifestPath, JSON.stringify(candleManifest), "utf8");
    expect(replayStatus().candles.error).toContain("XAUUSD");
  });
});

describe("bounded replay windows", () => {
  it("returns derived bars inside the basket window without account data", () => {
    const ctx = fixture();
    const status = replayStatus();
    const basket = status.baskets.find((candidate) => candidate.number === 1)!;
    const window = basketWindow(1, basket.windowStartMs);
    expect(window.windowStartMs).toBe(basket.windowStartMs);
    expect(window.windowEndMs).toBe(basket.windowEndMs);
    expect(window.bars.length).toBeGreaterThan(0);
    expect(window.fromMs).toBe(basket.windowStartMs);
    for (const bar of window.bars) {
      expect(bar[0]).toBeGreaterThanOrEqual(window.fromMs);
      // One consistent boundary: every loaded candle closes inside the window.
      expect(bar[0] + 60_000).toBeLessThanOrEqual(window.windowEndMs);
    }
    expect(window.nextFromMs).toBeNull();
    // Account state is served only by the cursor-bounded reveal endpoint.
    expect(Object.prototype.hasOwnProperty.call(window, "account")).toBe(false);
    const anchorAccount = basketReveal(1, 0, ISO("2024-01-01T00:30:00.000Z")).account;
    expect(anchorAccount).not.toBeNull();
    expect(anchorAccount!.openPositions).toBe(0);
    expect(window.candleCache.contract).toBe("marketlab-xauusd-m1-candle-cache-v1");
    expect(ctx.manifest.contract).toBe("marketlab-single-anchor-replay-package-v1");
  });

  it("clips requests to the basket window and refuses requests past it", () => {
    fixture();
    const status = replayStatus();
    const basket = status.baskets.find((candidate) => candidate.number === 2)!;
    const clipped = basketWindow(2, basket.windowStartMs - 60 * 60_000);
    expect(clipped.fromMs).toBe(basket.windowStartMs);
    expect(() => basketWindow(2, basket.windowEndMs + 1)).toThrow(/after the basket/);
    expect(() => basketDetail(999)).toThrow(ReplayPackageError);
  });

  it("never returns a basket event or account value after the reveal cursor", () => {
    fixture();
    const cursor = ISO("2024-01-01T00:36:00.000Z");
    const reveal = basketReveal(1, 0, cursor);
    expect(reveal.events.length).toBeGreaterThan(0);
    for (const event of reveal.events) {
      expect(event.timeMs).not.toBeNull();
      expect(event.timeMs!).toBeLessThanOrEqual(cursor);
    }
    expect(reveal.account).not.toBeNull();
    expect(reveal.account!.timeMs).toBeLessThanOrEqual(cursor);
    const after = reveal.lastEventId;
    const nextBatch = basketReveal(1, after, cursor);
    expect(nextBatch.events).toHaveLength(0);
    const later = basketReveal(1, after, ISO("2024-01-01T00:38:00.000Z"));
    expect(later.events.length).toBeGreaterThan(0);
    expect(later.events.every((event) => event.id > after)).toBe(true);
  });

  it("scopes the exported account state to the selected basket", () => {
    fixture();
    const loaded = loadPackage();
    const basket1 = loaded.byNumber.get(1)!;
    const close1 = loaded.eventsByBasket
      .get(1)!
      .find((event) => event.type === "strategy_exit" || event.type === "basket_liquidated")!;
    const anchor2 = loaded.eventsByBasket
      .get(2)!
      .find((event) => event.type === "basket_anchored")!;
    const entry2 = loaded.eventsByBasket.get(2)!.find((event) => event.type === "entry_executed")!;
    // The next basket opens its first position inside basket 1's post-close
    // replay context (the 30-minute candle pad after the close).
    expect(anchor2.timeMs!).toBeGreaterThan(close1.timeMs!);
    expect(entry2.timeMs!).toBeLessThanOrEqual(basket1.windowEndMs);
    // Post-close context: the account stays basket 1's final snapshot instead
    // of advancing into basket 2's open position.
    const postClose = basketReveal(1, 0, ISO("2024-01-01T00:40:00.000Z"));
    expect(postClose.account).not.toBeNull();
    expect(postClose.account!.timeMs).toBe(close1.timeMs);
    expect(postClose.account!.openPositions).toBe(0);
    // Pre-anchor context of basket 2: no account row for this basket at all.
    expect(basketReveal(2, 0, ISO("2024-01-01T00:20:00.000Z")).account).toBeNull();
  });

  it("rejects a reveal cursor outside the basket replay window", () => {
    fixture();
    const summary = loadPackage().byNumber.get(1)!;
    expect(() => basketReveal(1, 0, summary.windowStartMs - 1)).toThrow(/outside the basket/);
    expect(() => basketReveal(1, 0, summary.windowEndMs + 1)).toThrow(/outside the basket/);
  });

  it("extends an open final basket's window to the authoritative run end", () => {
    const ctx = fixture();
    const runEnd = "2024-01-31T23:59:59.678Z";
    const events = [
      {
        type: "run_started",
        time: "2024-01-01T00:00:00.000Z",
        modelRevision: "marketlab-single-anchor-broker-liquidation-v1",
        stopOutModel: "BrokerLiquidation",
        symbol: "XAUUSD",
        market: "dukascopy",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        quoteTimeZone: "UTC",
      },
      {
        type: "basket_anchored",
        basket: 1,
        quoteSequence: 1,
        time: "2024-01-01T00:00:00.000Z",
        bid: "99.8",
        ask: "100.2",
        anchor: "100.0",
        step: "1",
        upper: "101.0",
        lower: "99.0",
        lowerTarget: "90.0",
        upperTarget: "110.0",
      },
      {
        type: "entry_executed",
        basket: 1,
        tradeNumber: 1,
        quoteSequence: 2,
        time: "2024-01-01T00:01:00.000Z",
        side: "Buy",
        placedLot: "0.10",
        fillPrice: "100.0",
        regime: "Arithmetic",
      },
      {
        type: "run_ended",
        time: runEnd,
        completed: true,
        quoteTicksProcessed: 2,
      },
    ].map((event, index) => ({ ...withProducerDefaults(event), id: index + 1 }));
    const rows = events.map((event: Record<string, unknown>, index: number) => ({
      kind: "event",
      eventId: event.id,
      time: event.time,
      quoteSequence: index + 1,
      balance: "1000.00000",
      equity: "1000.00000",
      floatingProfit: "0.00000",
      floatingObservable: true,
      realizedProfit: "0.00000",
      usedMargin: "0.00000",
      freeMargin: "1000.00000",
      marginLevelPercent: null,
      marginCallActive: false,
      openPositions: 1,
      grossLots: "0.10",
      netLots: "0.10",
      absoluteNetLots: "0.10",
    }));
    writeReplayPackage(ctx.packageRoot, events, rows, {});
    const summary = loadPackage().byNumber.get(1)!;
    expect(summary.status).toBe("open");
    expect(summary.runEndMs).toBe(ISO(runEnd));
    expect(summary.windowEndMs).toBe(ISO(runEnd));
    expect(summary.lastLiveTimeMs).toBe(ISO("2024-01-01T00:01:00.000Z"));
    const reveal = basketReveal(1, 0, summary.windowEndMs);
    expect(reveal.events.some((event) => event.type === "strategy_exit")).toBe(false);
    expect(() => basketWindow(1, ISO(runEnd) + 1)).toThrow(/after the basket/);
  });
});

describe("API route handlers", () => {
  it("serves package status, basket identity, a window and a cursor reveal", async () => {
    fixture();
    const { GET } = await import("../src/app/api/marketlab-replay/route");
    const index = await GET(new Request("http://test/api/marketlab-replay"));
    expect(index.status).toBe(200);
    const indexBody = await index.json();
    expect(indexBody.valid).toBe(true);
    expect(indexBody.baskets).toHaveLength(2);
    expect(indexBody.baskets[0]).not.toHaveProperty("status");
    expect(indexBody.baskets[0]).not.toHaveProperty("entries");
    expect(indexBody.baskets[0]).not.toHaveProperty("tradeNumbers");
    expect(indexBody.package.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(indexBody.compatibility.valid).toBe(true);
    const bounded = await GET(new Request("http://test/api/marketlab-replay?index=0"));
    expect(bounded.status).toBe(200);
    const boundedBody = await bounded.json();
    expect(boundedBody.baskets).toEqual([]);
    expect(boundedBody.package).toEqual(indexBody.package);

    const { GET: GET_BASKET } =
      await import("../src/app/api/marketlab-replay/baskets/[number]/route");
    const detail = await GET_BASKET(new Request("http://test/api/marketlab-replay/baskets/1"), {
      params: Promise.resolve({ number: "1" }),
    });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.basket.number).toBe(1);
    expect(detailBody.basket.windowStartMs).toBeLessThan(detailBody.basket.windowEndMs);
    // Boundary levels are only carried by the revealed basket_anchored event.
    expect(detailBody.basket).not.toHaveProperty("anchor");
    expect(detailBody.basket).not.toHaveProperty("upper");
    expect(detailBody.basket).not.toHaveProperty("step");
    expect(detailBody).not.toHaveProperty("events");

    const missing = await GET_BASKET(new Request("http://test/api/marketlab-replay/baskets/999"), {
      params: Promise.resolve({ number: "999" }),
    });
    expect(missing.status).toBe(422);

    const invalid = await GET_BASKET(new Request("http://test/api/marketlab-replay/baskets/x"), {
      params: Promise.resolve({ number: "x" }),
    });
    expect(invalid.status).toBe(400);

    const { GET: GET_WINDOW } =
      await import("../src/app/api/marketlab-replay/baskets/[number]/window/route");
    const windowResponse = await GET_WINDOW(
      new Request(
        "http://test/api/marketlab-replay/baskets/1/window?from=2024-01-01T00%3A00%3A00.000Z",
      ),
      { params: Promise.resolve({ number: "1" }) },
    );
    expect(windowResponse.status).toBe(200);
    const windowBody = await windowResponse.json();
    expect(windowBody.bars.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(windowBody, "account")).toBe(false);

    const { GET: GET_REVEAL } =
      await import("../src/app/api/marketlab-replay/baskets/[number]/reveal/route");
    const revealResponse = await GET_REVEAL(
      new Request(
        "http://test/api/marketlab-replay/baskets/1/reveal?after=0&cursor=2024-01-01T00%3A37%3A00.000Z",
      ),
      { params: Promise.resolve({ number: "1" }) },
    );
    expect(revealResponse.status).toBe(200);
    const revealBody = await revealResponse.json();
    expect(revealBody.events.length).toBeGreaterThan(0);
    expect(
      revealBody.events.every(
        (event: { timeMs: number }) => event.timeMs <= ISO("2024-01-01T00:37:00.000Z"),
      ),
    ).toBe(true);
    expect(revealBody.account.timeMs).toBeLessThanOrEqual(ISO("2024-01-01T00:37:00.000Z"));
    const badReveal = await GET_REVEAL(
      new Request("http://test/api/marketlab-replay/baskets/1/reveal?after=0&cursor=nope"),
      { params: Promise.resolve({ number: "1" }) },
    );
    expect(badReveal.status).toBe(400);

    const badFrom = await GET_WINDOW(
      new Request("http://test/api/marketlab-replay/baskets/1/window?from=not-a-time"),
      { params: Promise.resolve({ number: "1" }) },
    );
    expect(badFrom.status).toBe(400);

    const noFrom = await GET_WINDOW(
      new Request("http://test/api/marketlab-replay/baskets/1/window"),
      { params: Promise.resolve({ number: "1" }) },
    );
    expect(noFrom.status).toBe(400);
  });

  it("reports an invalid package without exposing a replay", async () => {
    const ctx = fixture();
    writeFileSync(join(ctx.packageRoot, "events.jsonl"), "{broken}\n", "utf8");
    const { GET } = await import("../src/app/api/marketlab-replay/route");
    const index = await GET(new Request("http://test/api/marketlab-replay?index=0"));
    expect(index.status).toBe(200);
    const body = await index.json();
    expect(body.configured).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.baskets).toEqual([]);
    const { GET: GET_BASKET } =
      await import("../src/app/api/marketlab-replay/baskets/[number]/route");
    const detail = await GET_BASKET(new Request("http://test/api/marketlab-replay/baskets/1"), {
      params: Promise.resolve({ number: "1" }),
    });
    expect(detail.status).toBe(422);
  });
});

describe("typed event views", () => {
  it("exposes derived lookup fields without touching the payload", () => {
    fixture();
    const summary = loadPackage().byNumber.get(2)!;
    const detail = basketReveal(2, 0, summary.windowEndMs);
    const entry: ReplayEventView = detail.events.find((event) => event.type === "entry_executed")!;
    expect(entry.timeMs).toBe(ISO("2024-01-01T00:39:00.000Z"));
    expect(entry.payload.time).toBe("2024-01-01T00:39:00.000Z");
    expect(Object.keys(entry.payload)).toContain("fillPrice");
  });
});

describe("hardening: malformed but hash-consistent packages", () => {
  const expectRejected = () => {
    const status = replayStatus();
    expect(status.configured).toBe(true);
    expect(status.valid).toBe(false);
    expect(status.error).toBeTruthy();
    expect(status.baskets).toEqual([]);
    expect(() => basketDetail(1)).toThrow(ReplayPackageError);
  };
  const renumber = (events: Record<string, unknown>[]): Record<string, unknown>[] =>
    events.map((event, index) => ({ ...withProducerDefaults(event), id: index + 1 }));
  const without = (event: Record<string, unknown>, key: string) => {
    const copy = { ...event };
    delete copy[key];
    return copy;
  };

  it("rejects a duplicate run_started", () => {
    const ctx = fixture();
    const events = syntheticEvents();
    const inserted = renumber([
      ...events.slice(0, 2),
      { ...events[0]!, type: "run_started" },
      ...events.slice(2),
    ]);
    writeReplayEvents(ctx.packageRoot, ctx.manifest, inserted);
    expectRejected();
    expect(replayStatus().error).toContain("exactly one run_started");
  });

  it("rejects an event-id gap", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event, index) => ({
      ...event,
      id: index >= 3 ? index + 2 : index + 1,
    }));
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("1..N");
  });

  it("rejects a strategy exit without its reason instead of inventing one", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "strategy_exit" ? without(event, "reason") : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain('"reason"');
  });

  it("rejects a basket-scoped event without a basket", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "entry_executed" ? without(event, "basket") : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("must carry a basket");
  });

  it("rejects a basket number on a run-level event", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "margin_call_entered" ? { ...event, basket: 1 } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain("must not carry a basket");
  });

  it("rejects a live event that no basket span contains", () => {
    const ctx = fixture();
    const events = syntheticEvents();
    const anchor2 = events.findIndex(
      (event) => event.type === "basket_anchored" && event.basket === 2,
    );
    const orphan = {
      type: "margin_call_left",
      quoteSequence: 150,
      time: "2024-01-01T00:37:30.000Z",
      bid: "98.6",
      ask: "99.0",
      balance: "900.0",
      equity: "900.0",
      usedMargin: "0.0",
      freeMargin: "900.0",
      marginLevelPercent: null,
      openPositions: 0,
    };
    const inserted = renumber([...events.slice(0, anchor2), orphan, ...events.slice(anchor2)]);
    writeReplayEvents(ctx.packageRoot, ctx.manifest, inserted);
    expectRejected();
    expect(replayStatus().error).toContain("outside every basket");
  });

  const orderedTelemetry = (rows: Record<string, unknown>[]) =>
    rows
      .slice()
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((row, index) => ({ ...row, quoteSequence: index + 1 }));

  it("rejects a telemetry snapshot that references a missing event", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents());
    const phantom = {
      kind: "event",
      eventId: 999,
      time: "2024-01-01T00:33:30.000Z",
      quoteSequence: 900,
      balance: "1000.00000",
      equity: "1000.00000",
      floatingProfit: "0.00000",
      floatingObservable: true,
      realizedProfit: "0.00000",
      usedMargin: "0.00000",
      freeMargin: "1000.00000",
      marginLevelPercent: null,
      marginCallActive: false,
      openPositions: 0,
      grossLots: "0.00",
      netLots: "0.00",
      absoluteNetLots: "0.00",
    };
    writeReplayPackage(
      ctx.packageRoot,
      syntheticEvents(),
      orderedTelemetry([...telemetry, phantom]),
      {},
    );
    expectRejected();
    expect(replayStatus().error).toContain("does not bind");
  });

  it("rejects a telemetry row whose time does not match its event", () => {
    const ctx = fixture();
    const telemetry = orderedTelemetry(
      syntheticTelemetry(syntheticEvents()).map((row) =>
        row.eventId === 3 ? { ...row, time: "2024-01-01T00:31:30.000Z" } : row,
      ),
    );
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
    expectRejected();
    expect(replayStatus().error).toContain("does not bind");
  });

  it("rejects non-canonical telemetry decimals", () => {
    for (const form of ["1,000.00", "+1", ".5", "1.", "1e3"]) {
      const ctx = fixture();
      const telemetry = syntheticTelemetry(syntheticEvents()).map((row, index) =>
        index === 0 ? { ...row, balance: form } : row,
      );
      writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
      expectRejected();
      expect(replayStatus().error).toContain('exact decimal "balance"');
    }
  });

  it("rejects an event that drops an always-present producer field", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "strategy_exit" ? { ...event, netLots: undefined } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain('"netLots"');
  });

  it("rejects an unsupported authoritative side", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "entry_executed" ? { ...event, side: "Long" } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain('"side"');
  });

  it("rejects a non-canonical nested event timestamp", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "forced_liquidation"
        ? { ...event, triggerTime: "2024-01-01 00:35:00" }
        : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expectRejected();
    expect(replayStatus().error).toContain('"triggerTime"');
  });

  it("accepts a Stop Out event with an undefined margin level", () => {
    const ctx = fixture();
    const events = syntheticEvents().map((event) =>
      event.type === "stop_out_triggered" ? { ...event, marginLevelPercent: null } : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, events);
    expect(replayStatus().valid).toBe(true);
    expect(loadPackage().byNumber.get(1)!.stopOutEpisodes).toBe(1);
  });

  it("rejects a telemetry row outside its shard year", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents());
    const stray = {
      ...telemetry.find((row) => row.kind === "periodic")!,
      time: "2023-12-31T23:59:00.000Z",
    };
    writeReplayPackage(
      ctx.packageRoot,
      syntheticEvents(),
      orderedTelemetry([...telemetry, stray]),
      {},
    );
    expectRejected();
    expect(replayStatus().error).toContain("outside its shard year");
  });

  it("rejects telemetry that is out of order rather than sorting it into plausibility", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents());
    const swapped = [...telemetry];
    const first = swapped[0]!;
    swapped[0] = swapped[1]!;
    swapped[1] = first;
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), swapped, {});
    expectRejected();
    expect(replayStatus().error).toContain("not chronologically ordered");
  });

  it("rejects a live event stream whose id order breaks authoritative time order", () => {
    const ctx = fixture();
    const events = syntheticEvents();
    const first = events.find(
      (event) => event.type === "entry_executed" && event.tradeNumber === 1,
    )!;
    const second = events.find(
      (event) => event.type === "entry_executed" && event.tradeNumber === 2,
    )!;
    const swapped = events.map((event) =>
      event === first
        ? { ...event, time: second.time }
        : event === second
          ? { ...event, time: first.time }
          : event,
    );
    writeReplayEvents(ctx.packageRoot, ctx.manifest, swapped);
    expectRejected();
    expect(replayStatus().error).toContain("backwards in time");
  });

  it("requires the expected package and candle identity anchors", () => {
    const ctx = fixture();
    vi.stubEnv("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256", "");
    let status = replayStatus();
    expect(status.valid).toBe(true);
    expect(status.compatibility.valid).toBe(false);
    expect(status.compatibility.error).toContain("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256");
    expect(() => basketWindow(1, 0)).toThrow(/MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256/);
    vi.stubEnv("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256", String(ctx.manifest.packageSha256));
    vi.stubEnv("MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256", "");
    status = replayStatus();
    expect(status.compatibility.valid).toBe(false);
    expect(status.compatibility.error).toContain("MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256");
    expect(() => basketReveal(1, 0, ISO("2024-01-01T00:40:00.000Z"))).toThrow(
      /MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256/,
    );
  });

  it("rejects a candle cache with a missing interior month", () => {
    const ctx = fixture();
    writeCandleMonths(ctx.candleRoot, [
      { month: "2024-01", startIso: "2024-01-01T00:00:00.000Z", rows: 76 },
      { month: "2024-03", startIso: "2024-03-01T00:00:00.000Z", rows: 10 },
    ]);
    const status = replayStatus();
    expect(status.candles.valid).toBe(false);
    expect(status.candles.error).toContain("missing the month after 2024-01");
  });

  it("requires the exported signed net lots on every telemetry row", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents()).map((row) => {
      const copy = { ...row };
      delete copy.netLots;
      return copy;
    });
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
    expectRejected();
    expect(replayStatus().error).toContain('exact decimal "netLots"');
  });

  it("rejects a duplicate telemetry snapshot", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents());
    const duplicate = { ...telemetry.find((row) => row.kind === "event")! };
    writeReplayPackage(
      ctx.packageRoot,
      syntheticEvents(),
      orderedTelemetry([...telemetry, duplicate]),
      {},
    );
    expectRejected();
    expect(replayStatus().error).toMatch(/repeats the snapshot/);
  });

  it("rejects missing snapshots for live events", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents()).filter((row) => row.eventId !== 3);
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
    expectRejected();
    expect(replayStatus().error).toContain("missing the snapshot for live event #3");
  });

  it("rejects telemetry whose counts do not match the manifest", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents());
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {
      telemetryCounts: { event: telemetry.length + 1, periodic: 0 },
    });
    expectRejected();
    expect(replayStatus().error).toContain("counts do not match");
  });

  it("rejects a replay package that is incompatible with the candle source", () => {
    const ctx = fixture({
      symbol: "EURUSD",
    });
    const status = replayStatus();
    expect(status.valid).toBe(true);
    expect(status.compatibility.valid).toBe(false);
    expect(status.compatibility.error).toContain("does not match candle cache symbol");
    expect(() => basketWindow(1, 0)).toThrow(/does not match candle cache symbol/);
  });

  it("rejects a replay package whose delivered identity does not match the candle source", () => {
    const ctx = fixture({
      delivered: {
        quoteCount: SYNTHETIC_SOURCE_ROWS,
        semanticDigest: `sha256:${"0".repeat(64)}`,
      },
    });
    const status = replayStatus();
    expect(status.compatibility.valid).toBe(false);
    expect(status.compatibility.error).toContain("semantic digest");
    expect(() => basketWindow(1, 0)).toThrow(/semantic digest/);
  });

  it("rejects a candle cache that repeats a month descriptor", () => {
    const ctx = fixture();
    const manifestPath = join(ctx.candleRoot, "manifest.json");
    const candleManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    candleManifest.files = [...candleManifest.files, { ...candleManifest.files[0] }];
    writeFileSync(manifestPath, JSON.stringify(candleManifest), "utf8");
    const status = replayStatus();
    expect(status.candles.valid).toBe(false);
    expect(status.candles.error).toContain("repeats month 2024-01");
  });

  it("rejects a package that does not match the expected identity anchor", () => {
    fixture();
    vi.stubEnv("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256", "0".repeat(64));
    expectRejected();
    expect(replayStatus().error).toContain("identity mismatch");
  });

  it("rejects a candle cache whose content fingerprint does not match", () => {
    const ctx = fixture();
    const manifestPath = join(ctx.candleRoot, "manifest.json");
    const candleManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    candleManifest.content_sha256 = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(candleManifest), "utf8");
    const status = replayStatus();
    expect(status.candles.valid).toBe(false);
    expect(status.candles.error).toContain("content fingerprint mismatch");
  });

  it("serves the next chunk when the 12,000-bar cap lands exactly on a month end", () => {
    const ctx = fixture();
    const events = renumber([
      {
        type: "run_started",
        time: "2024-01-01T00:00:00.000Z",
        modelRevision: "marketlab-single-anchor-broker-liquidation-v1",
        stopOutModel: "BrokerLiquidation",
        symbol: "XAUUSD",
        market: "dukascopy",
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        quoteTimeZone: "UTC",
      },
      {
        type: "basket_anchored",
        basket: 1,
        quoteSequence: 1,
        time: "2024-01-01T00:00:00.000Z",
        bid: "99.8",
        ask: "100.2",
        anchor: "100.0",
        step: "1",
        upper: "101.0",
        lower: "99.0",
        lowerTarget: "90.0",
        upperTarget: "110.0",
      },
      {
        type: "entry_executed",
        basket: 1,
        tradeNumber: 1,
        quoteSequence: 2,
        time: "2024-01-01T00:01:00.000Z",
        side: "Buy",
        placedLot: "0.10",
        fillPrice: "100.0",
        regime: "Arithmetic",
      },
      {
        type: "strategy_exit",
        basket: 1,
        reason: "Escape",
        quoteSequence: 3,
        time: "2024-02-01T00:10:00.000Z",
        bid: "99.0",
        ask: "99.2",
        anchor: "100.0",
        realizedProfit: "0.0",
      },
      {
        type: "run_ended",
        time: "2024-02-01T00:10:01.000Z",
        completed: true,
        quoteTicksProcessed: 3,
      },
    ]);
    const base = {
      balance: "1000.00000",
      equity: "1000.00000",
      floatingProfit: "0.00000",
      floatingObservable: true,
      realizedProfit: "0.00000",
      usedMargin: "0.00000",
      freeMargin: "1000.00000",
      marginLevelPercent: null,
      marginCallActive: false,
      openPositions: 0,
      grossLots: "0.00",
      netLots: "0.00",
      absoluteNetLots: "0.00",
    };
    const telemetry = events.map((event, index) => ({
      kind: "event",
      eventId: event.id,
      time: event.time,
      quoteSequence: index + 1,
      ...base,
    }));
    writeReplayPackage(ctx.packageRoot, events, telemetry, {});
    writeCandleMonths(ctx.candleRoot, [
      { month: "2024-01", startIso: "2024-01-01T00:00:00.000Z", rows: 12_000 },
      { month: "2024-02", startIso: "2024-02-01T00:00:00.000Z", rows: 41 },
    ]);
    const first = basketWindow(1, Date.parse("2024-01-01T00:00:00.000Z"));
    expect(first.bars).toHaveLength(12_000);
    expect(first.bars[first.bars.length - 1]![0]).toBe(Date.parse("2024-01-09T07:59:00.000Z"));
    expect(first.nextFromMs).toBe(Date.parse("2024-02-01T00:00:00.000Z"));
    const second = basketWindow(1, first.nextFromMs!);
    expect(second.bars[0]![0]).toBe(Date.parse("2024-02-01T00:00:00.000Z"));
    // The candle closing at the window end is the last one served.
    expect(second.bars[second.bars.length - 1]![0]).toBe(Date.parse("2024-02-01T00:39:00.000Z"));
    expect(second.nextFromMs).toBeNull();
  });
});
