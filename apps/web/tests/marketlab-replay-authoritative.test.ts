/**
 * Authoritative Phase E replay-package validation for the MarketLab Backtests
 * loader. Runs only when the finalized package is supplied locally:
 *
 *   MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE=<run>\storage\single-anchor\replay
 *   MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE=<derived M1 cache dir>
 *
 * Everything is compared against the raw package files independently parsed in
 * this test; no second strategy implementation is used as an oracle.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountAtCursor, barCloseMs } from "../src/lib/marketlab-replay";
import { basketWindow, loadPackage, replayStatus } from "../src/server/marketlab-replay";

const packageRoot = process.env.MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE?.trim();
const candleRoot = process.env.MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE?.trim();
const enabled = Boolean(packageRoot && candleRoot);

const PHASE_E_PACKAGE_SHA256 = "5dcd8bfaffe76c9d2c8eec002073f62fe18b5d0d40b0602dbad0e59f6846097a";
const PHASE_E_CANDLE_CONTENT_SHA256 =
  "ab1b0c7f4321afc7ba31e149e31631a6c61deba40a88091ba951d5d886165d9d";

interface RawLine {
  id: number;
  type: string;
  time?: string;
  basket?: number;
  [key: string]: unknown;
}

describe.skipIf(!enabled)("authoritative finalized Phase E package", () => {
  let rawById: Map<number, RawLine>;
  let rawIds: number[];

  beforeAll(() => {
    vi.stubEnv("MARKETLAB_REPLAY_PACKAGE", packageRoot!);
    vi.stubEnv("MARKETLAB_CANDLE_CACHE", candleRoot!);
    const lines = readFileSync(join(packageRoot!, "events.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    rawById = new Map(
      lines.map((line) => {
        const event = JSON.parse(line) as RawLine;
        return [event.id, event];
      }),
    );
    rawIds = [...rawById.keys()].sort((a, b) => a - b);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("loads the exact package identity", () => {
    const status = replayStatus();
    expect(status.valid).toBe(true);
    expect(status.package?.contract).toBe("marketlab-single-anchor-replay-package-v1");
    expect(status.package?.modelRevision).toBe("marketlab-single-anchor-broker-liquidation-v1");
    expect(status.package?.stopOutModel).toBe("BrokerLiquidation");
    expect(status.package?.symbol).toBe("XAUUSD");
    expect(status.package?.packageSha256).toBe(PHASE_E_PACKAGE_SHA256);
    expect(status.candles.valid).toBe(true);
    expect(status.candles.contentSha256).toBe(PHASE_E_CANDLE_CONTENT_SHA256);
    expect(status.baskets).toHaveLength(280);
  });

  it("preserves every authoritative event exactly once and in package order", () => {
    const loaded = loadPackage();
    expect(loaded.events).toHaveLength(rawIds.length);
    expect(loaded.events).toHaveLength(1454);
    for (let index = 0; index < loaded.events.length; index += 1) {
      const view = loaded.events[index]!;
      const raw = rawById.get(view.id);
      expect(raw).toBeDefined();
      expect(view.payload).toEqual(raw);
      expect(view.id).toBe(rawIds[index]);
    }
    const basketEventIds: number[] = [];
    for (const list of loaded.eventsByBasket.values()) {
      for (const view of list) basketEventIds.push(view.id);
    }
    const runLevel = loaded.events
      .filter((view) => view.type === "run_started" || view.type === "run_ended")
      .map((view) => view.id);
    const union = [...basketEventIds, ...runLevel].sort((a, b) => a - b);
    expect(union).toEqual(rawIds);
    expect(new Set(union).size).toBe(union.length);
  });

  it("keeps the finalized counters and immutable identities", () => {
    const status = replayStatus();
    const counts = status.package!.eventCounts;
    expect(counts.forced_liquidation).toBe(65);
    expect(counts.stop_out_triggered).toBe(5);
    expect(counts.basket_liquidated).toBe(1);
    expect(counts.entry_executed).toBe(555);
    expect(counts.strategy_exit).toBe(278);
    expect(counts.entry_rejected).toBe(2);
    expect(status.package?.telemetryCounts).toEqual({ event: 1452, periodic: 98866 });
  });

  it("reproduces basket #276 exactly from the authoritative events", () => {
    const loaded = loadPackage();
    const basket = loaded.byNumber.get(276)!;
    const rawEvents = [...rawById.values()].filter((event) => event.basket === 276);
    const entries = rawEvents.filter((event) => event.type === "entry_executed");
    const liquidations = rawEvents.filter((event) => event.type === "forced_liquidation");
    const stopOuts = rawEvents.filter((event) => event.type === "stop_out_triggered");
    expect(basket.entries).toBe(36);
    expect(basket.entries).toBe(entries.length);
    expect(basket.forcedLiquidations).toBe(30);
    expect(basket.forcedLiquidations).toBe(liquidations.length);
    expect(basket.stopOutEpisodes).toBe(4);
    expect(basket.stopOutEpisodes).toBe(stopOuts.length);
    expect(basket.status).toBe("closed");
    expect(basket.exitReason).toBe("Escape");
    expect(basket.tradeNumbers).toEqual(entries.map((event) => event.tradeNumber));
    const windows = basketWindow(276, basket.windowStartMs);
    expect(windows.bars.length).toBeGreaterThan(0);
    const firstEntry = entries[0]!;
    expect(firstEntry.side).toBe("Sell");
    expect(firstEntry.fillPrice).toBe("1499.868");
    expect(firstEntry.time).toBe("2020-03-16T15:48:53.366Z");
    const firstLiquidation = liquidations[0]!;
    expect(firstLiquidation.ordinal).toBe(1);
    expect(firstLiquidation.tradeNumber).toBe(35);
    expect(firstLiquidation.closePrice).toBe("1506.182");
    expect(firstLiquidation.realizedProfit).toBe("-3982.96800");
    expect(firstLiquidation.time).toBe("2020-03-23T12:06:26.292Z");
    const exit = rawEvents.find((event) => event.type === "strategy_exit")!;
    expect(exit.reason).toBe("Escape");
    expect(exit.realizedProfit).toBe("30.65700");
    expect(exit.liquidatedRealizedProfit).toBe("-25051.42100");
  });

  it("returns only derived candles inside the window and exact exported account rows", () => {
    const status = replayStatus();
    const basket = status.baskets.find((candidate) => candidate.number === 276)!;
    const window = basketWindow(276, basket.windowStartMs);
    for (const bar of window.bars) {
      expect(bar[0]).toBeGreaterThanOrEqual(window.fromMs);
      expect(bar[0]).toBeLessThanOrEqual(window.windowEndMs);
    }
    // Cross-check the derived cache against the raw monthly CSV bytes.
    const csv = readFileSync(join(candleRoot!, "xauusd-m1-2020-03.csv"), "utf8")
      .split("\n")
      .slice(1)
      .filter((line) => line.length > 0);
    const rawCandle = new Map(
      csv.map((line) => {
        const parts = line.split(",");
        const time = Date.parse(parts[0]!);
        return [
          time,
          [
            time,
            Number(parts[1]),
            Number(parts[2]),
            Number(parts[3]),
            Number(parts[4]),
            Number(parts[5]),
          ],
        ];
      }),
    );
    for (const bar of window.bars.slice(0, 200)) {
      const expected = rawCandle.get(bar[0]);
      if (expected) expect(bar).toEqual(expected);
    }
    // Every returned account row must exist byte-for-byte in the raw telemetry.
    const telemetry = readFileSync(join(packageRoot!, "telemetry-2020.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const rawRows = new Map(
      telemetry.map((row) => [`${row.kind}|${row.eventId}|${row.time}`, row]),
    );
    for (const row of window.account) {
      const raw = rawRows.get(`${row.kind}|${row.eventId}|${row.time}`);
      expect(raw).toBeDefined();
      expect(raw!.balance).toBe(row.balance);
      expect(raw!.equity).toBe(row.equity);
      expect(raw!.marginLevelPercent).toBe(row.marginLevelPercent);
      expect(raw!.quoteSequence).toBe(row.quoteSequence);
    }
    const cursor = window.bars[10]![0] + 60_000;
    const expectedAtCursor = window.account.filter((row) => row.timeMs <= cursor).at(-1);
    expect(accountAtCursor(window.account, cursor)).toEqual(expectedAtCursor ?? null);
  });
});
