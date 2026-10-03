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
  basketWindow,
  replayStatus,
  ReplayPackageError,
} from "../src/server/marketlab-replay";
import {
  sha256,
  syntheticEvents,
  syntheticTelemetry,
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
    const basket1 = status.baskets.find((basket) => basket.number === 1)!;
    expect(basket1.status).toBe("liquidated");
    expect(basket1.exitReason).toBe("BrokerLiquidation");
    expect(basket1.entries).toBe(3);
    expect(basket1.tradeNumbers).toEqual([1, 2, 3]);
    expect(basket1.forcedLiquidations).toBe(1);
    expect(basket1.stopOutEpisodes).toBe(1);
    expect(basket1.marginCallEntries).toBe(1);
    expect(basket1.hardBreakevenActivations).toBe(1);
    const basket2 = status.baskets.find((basket) => basket.number === 2)!;
    expect(basket2.status).toBe("closed");
    expect(basket2.exitReason).toBe("Trailing");
    expect(basket2.liveRejections).toBe(1);
    expect(basket2.entries).toBe(1);
  });

  it("passes every event payload through unmodified and in package order", () => {
    fixture();
    const detail = basketDetail(1);
    const ids = detail.events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const entry = detail.events.find(
      (event) => event.type === "entry_executed" && event.payload.tradeNumber === 2,
    )!;
    expect(entry.payload.side).toBe("Sell");
    expect(entry.payload.fillPrice).toBe("100.5");
    expect(entry.payload.placedLot).toBe("0.20");
    expect(entry.payload.regime).toBe("Arithmetic");
    expect(entry.payload).toEqual(
      syntheticEvents().find((event) => event.tradeNumber === 2 && event.type === "entry_executed"),
    );
    const anchor = detail.events.find((event) => event.type === "basket_anchored")!;
    expect(anchor.payload.upper).toBe("101.0");
    expect(anchor.payload.lower).toBe("99.0");
    expect(anchor.payload.lowerTarget).toBe("90.0");
    expect(anchor.payload.upperTarget).toBe("110.0");
  });

  it("reveals no event before its authoritative time and hides the run-end recap", () => {
    fixture();
    const events = basketDetail(2).events;
    const recap = events.find((event) => event.type === "entry_rejection_summary")!;
    expect(recap.live).toBe(false);
    expect(revealEvents(events, ISO("2024-01-01T00:38:00.000Z")).length).toBe(1);
    expect(
      revealEvents(events, ISO("2024-01-01T00:39:00.000Z")).map((event) => event.type),
    ).toEqual(["basket_anchored", "entry_executed"]);
    const beforeRecap = revealEvents(events, ISO("2024-01-01T00:39:29.999Z"));
    expect(beforeRecap.some((event) => event.type === "entry_rejection_summary")).toBe(false);
    const atRecap = revealEvents(events, ISO("2024-01-01T00:39:30.000Z"));
    expect(atRecap.some((event) => event.type === "entry_rejection_summary")).toBe(true);
    expect(
      revealEvents(events, ISO("2024-01-01T00:39:30.000Z")).some(
        (event) => event.timeMs !== null && event.timeMs > ISO("2024-01-01T00:39:30.000Z"),
      ),
    ).toBe(false);
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

  it("rejects invalid JSON and malformed telemetry", () => {
    const ctx = fixture();
    writeFileSync(join(ctx.packageRoot, "events.jsonl"), "{not json}\n", "utf8");
    expectRejected();
  });

  it("rejects malformed telemetry values when a window is served", () => {
    const ctx = fixture();
    const telemetry = syntheticTelemetry(syntheticEvents()) as Array<Record<string, unknown>>;
    telemetry[0] = { ...telemetry[0], marginLevelPercent: 42 };
    writeReplayPackage(ctx.packageRoot, syntheticEvents(), telemetry, {});
    expect(replayStatus().valid).toBe(true);
    expect(() => basketWindow(1, 0)).toThrow(ReplayPackageError);
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

  it("rejects a tampered candle file when a window is served", () => {
    const ctx = fixture();
    const csv = join(ctx.candleRoot, "xauusd-m1-2024-01.csv");
    writeFileSync(csv, readFileSync(csv, "utf8").replace("100.00", "100.01"), "utf8");
    expect(replayStatus().candles.valid).toBe(true);
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
  it("returns derived bars inside the basket window and a telemetry carry-in row", () => {
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
      expect(bar[0]).toBeLessThanOrEqual(window.windowEndMs);
    }
    expect(window.nextFromMs).toBeNull();
    expect(window.account.length).toBeGreaterThan(0);
    expect(window.account[0]!.timeMs).toBeLessThanOrEqual(window.fromMs);
    for (let index = 1; index < window.account.length; index += 1) {
      expect(window.account[index]!.timeMs).toBeGreaterThanOrEqual(
        window.account[index - 1]!.timeMs,
      );
    }
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
});

describe("API route handlers", () => {
  it("serves package status, basket detail and a window", async () => {
    fixture();
    const { GET } = await import("../src/app/api/marketlab-replay/route");
    const index = await GET();
    expect(index.status).toBe(200);
    const indexBody = await index.json();
    expect(indexBody.valid).toBe(true);
    expect(indexBody.baskets).toHaveLength(2);
    expect(indexBody.package.packageSha256).toMatch(/^[0-9a-f]{64}$/);

    const { GET: GET_BASKET } =
      await import("../src/app/api/marketlab-replay/baskets/[number]/route");
    const detail = await GET_BASKET(new Request("http://test/api/marketlab-replay/baskets/1"), {
      params: Promise.resolve({ number: "1" }),
    });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.basket.number).toBe(1);
    expect(detailBody.events.length).toBeGreaterThan(0);

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
    expect(windowBody.account.length).toBeGreaterThan(0);

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
    const index = await GET();
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
    const detail = basketDetail(2);
    const entry: ReplayEventView = detail.events.find((event) => event.type === "entry_executed")!;
    expect(entry.timeMs).toBe(ISO("2024-01-01T00:39:00.000Z"));
    expect(entry.payload.time).toBe("2024-01-01T00:39:00.000Z");
    expect(Object.keys(entry.payload)).toContain("fillPrice");
  });
});
