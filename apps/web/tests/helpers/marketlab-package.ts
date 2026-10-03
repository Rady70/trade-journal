/**
 * Synthetic, contract-consistent replay package fixture for Phase F tests.
 *
 * This is NOT an engine run and NOT authoritative data: it only exercises the
 * MarketLab Backtests loader/UI contracts. Authoritative validation uses the
 * real finalized Phase E package through MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { CANDLE_CACHE_CONTRACT, REPLAY_PACKAGE_CONTRACT } from "../../src/lib/marketlab-replay";

export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * The dedicated MarketLab path requires the expected identity anchors. Fixture
 * rewrites re-anchor the environment to the package/candle content they wrote,
 * so a mutation is reported by the loader's own contract checks instead of the
 * identity gate (tests that want an identity mismatch stub the environment
 * themselves after the last fixture write).
 */
const anchorPackageIdentity = (manifest: Record<string, unknown>): void => {
  if (typeof manifest.packageSha256 === "string") {
    vi.stubEnv("MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256", manifest.packageSha256);
  }
};

const anchorCandleIdentity = (contentSha256: string): void => {
  vi.stubEnv("MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256", contentSha256);
};

/** A deterministic synthetic source identity shared by both fixture manifests. */
export const SYNTHETIC_SOURCE_DIGEST = `sha256:${sha256("synthetic-marketlab-source")}`;
export const SYNTHETIC_SOURCE_ROWS = 1300;

export const SYNTHETIC_START = "2024-01-01T00:00:00.000Z";
export const SYNTHETIC_ANCHOR_TIME = "2024-01-01T00:30:00.000Z";
export const SYNTHETIC_END = "2024-01-01T00:42:00.000Z";

const at = (minute: number, second = 0): string =>
  `2024-01-01T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

export function syntheticEvents(): Record<string, unknown>[] {
  return [
    {
      type: "run_started",
      time: SYNTHETIC_START,
      modelRevision: "marketlab-single-anchor-broker-liquidation-v1",
      stopOutModel: "BrokerLiquidation",
      symbol: "XAUUSD",
      market: "dukascopy",
      startDate: "2024-01-01",
      endDate: "2024-01-01",
      quoteTimeZone: "UTC",
    },
    {
      type: "basket_anchored",
      basket: 1,
      quoteSequence: 100,
      time: SYNTHETIC_ANCHOR_TIME,
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
      quoteSequence: 200,
      time: at(31),
      decisionBid: "99.4",
      decisionAsk: "99.6",
      side: "Buy",
      placedLot: "0.10",
      fillPrice: "99.5",
      regime: "Arithmetic",
    },
    {
      type: "entry_executed",
      basket: 1,
      tradeNumber: 2,
      quoteSequence: 300,
      time: at(32),
      decisionBid: "100.4",
      decisionAsk: "100.6",
      side: "Sell",
      placedLot: "0.20",
      fillPrice: "100.5",
      regime: "Arithmetic",
    },
    {
      type: "hard_breakeven_activated",
      basket: 1,
      tradeNumber: 3,
      quoteSequence: 400,
      time: at(33),
      lowerTarget: "90.0",
      upperTarget: "110.0",
    },
    {
      type: "entry_executed",
      basket: 1,
      tradeNumber: 3,
      quoteSequence: 400,
      time: at(33),
      decisionBid: "99.9",
      decisionAsk: "100.1",
      side: "Buy",
      placedLot: "0.30",
      fillPrice: "100.0",
      regime: "HardBreakeven",
    },
    {
      type: "margin_call_entered",
      quoteSequence: 500,
      time: at(34),
      bid: "98.0",
      ask: "98.4",
      equity: "895.0",
      usedMargin: "10.0",
      freeMargin: "885.0",
      marginLevelPercent: "8950.0",
      openPositions: 3,
    },
    {
      type: "stop_out_triggered",
      basket: 1,
      reason: "MarginLevel",
      quoteSequence: 600,
      time: at(35),
      bid: "97.8",
      ask: "98.2",
      balance: "1000.0",
      floatingProfit: "-105.0",
      equity: "895.0",
      usedMargin: "10.0",
      freeMargin: "885.0",
      marginLevelPercent: "8950.0",
      openPositions: 3,
    },
    {
      type: "forced_liquidation",
      basket: 1,
      ordinal: 1,
      tradeNumber: 2,
      side: "Sell",
      placedLot: "0.20",
      entryPrice: "100.5",
      entryTime: at(32),
      regime: "Arithmetic",
      time: at(35),
      liquidationTime: at(35),
      triggerTime: at(35),
      triggerQuoteSequence: 600,
      triggerBid: "97.8",
      triggerAsk: "98.2",
      closePrice: "98.2",
      commission: "0.00",
      realizedProfit: "-100.0",
      reason: "MarginLevel",
      beforeBalance: "1000.0",
      beforeEquity: "895.0",
      afterBalance: "900.0",
      afterEquity: "895.0",
      afterOpenPositions: 2,
    },
    {
      type: "margin_call_left",
      quoteSequence: 700,
      time: at(36),
      bid: "98.6",
      ask: "99.0",
      equity: "900.0",
      usedMargin: "8.0",
      freeMargin: "892.0",
      marginLevelPercent: "11250.0",
      openPositions: 2,
    },
    {
      type: "basket_liquidated",
      basket: 1,
      reason: "BrokerLiquidation",
      quoteSequence: 800,
      time: at(37),
      bid: "98.5",
      ask: "98.9",
      anchor: "100.0",
      legs: 0,
      buyLots: "0.00",
      sellLots: "0.00",
      grossLots: "0.00",
      netLots: "0.00",
      hardBreakevenModeActive: true,
      rawProfit: "0",
      exitProfit: "0",
      threshold: "0",
      buyClosePrice: "98.5",
      sellClosePrice: "98.9",
      commission: "0.00",
      realizedProfit: "-100.0",
      liquidatedRealizedProfit: "-100.0",
      liquidatedPositions: 3,
      historicalEntries: 3,
    },
    {
      type: "basket_anchored",
      basket: 2,
      quoteSequence: 900,
      time: at(38),
      bid: "98.8",
      ask: "99.2",
      anchor: "99.0",
      step: "1",
      upper: "100.0",
      lower: "98.0",
      lowerTarget: "89.0",
      upperTarget: "109.0",
    },
    {
      type: "entry_executed",
      basket: 2,
      tradeNumber: 4,
      quoteSequence: 1000,
      time: at(39),
      decisionBid: "100.9",
      decisionAsk: "101.1",
      side: "Sell",
      placedLot: "0.10",
      fillPrice: "101.0",
      regime: "Arithmetic",
    },
    {
      type: "entry_rejected",
      basket: 2,
      tradeNumber: 5,
      side: "Buy",
      reason: "InsufficientMargin",
      quoteSequence: 1100,
      time: at(39, 30),
      bid: "100.5",
      ask: "100.9",
      message: "Trade 5 Buy of 0.10 lots was not placed.",
    },
    {
      type: "trailing_activated",
      basket: 2,
      quoteSequence: 1200,
      time: at(40),
      bid: "99.0",
      ask: "99.3",
      profit: "16.0",
      activationThreshold: "15.5",
    },
    {
      type: "strategy_exit",
      basket: 2,
      reason: "Trailing",
      quoteSequence: 1300,
      time: at(41),
      bid: "98.9",
      ask: "99.2",
      anchor: "99.0",
      legs: 1,
      buyLots: "0",
      sellLots: "0.10",
      grossLots: "0.10",
      netLots: "-0.10",
      hardBreakevenModeActive: false,
      rawProfit: "20.0",
      exitProfit: "20.0",
      threshold: "15.5",
      buyClosePrice: "98.9",
      sellClosePrice: "99.2",
      commission: "0.00",
      realizedProfit: "20.0",
      liquidatedRealizedProfit: "0",
      liquidatedPositions: 0,
      historicalEntries: 1,
    },
    {
      type: "entry_rejection_summary",
      basket: 2,
      tradeNumber: 5,
      side: "Buy",
      reason: "InsufficientMargin",
      attempts: 7,
      firstQuoteSequence: 1100,
      firstTime: at(39, 30),
      firstBid: "100.5",
      firstAsk: "100.9",
      lastQuoteSequence: 1100,
      lastTime: at(39, 30),
      lastBid: "100.5",
      lastAsk: "100.9",
      message: "Trade 5 Buy of 0.10 lots was not placed.",
    },
    {
      type: "run_ended",
      time: SYNTHETIC_END,
      completed: true,
      quoteTicksProcessed: 1300,
    },
  ].map((event, index) => ({ ...withProducerDefaults(event), id: index + 1 }));
}

/**
 * Adds the producer's always-present fields that a fixture does not vary, so
 * every synthetic event satisfies the full Phase E event-contract schema.
 */
export function withProducerDefaults(event: Record<string, unknown>): Record<string, unknown> {
  const lot = typeof event.placedLot === "string" ? event.placedLot : "0.00";
  const time = typeof event.time === "string" ? event.time : SYNTHETIC_START;
  const fill = typeof event.fillPrice === "string" ? event.fillPrice : "0.0";
  switch (event.type) {
    case "entry_executed":
      return {
        decisionBid: fill,
        decisionAsk: fill,
        normalizedRequiredLot: lot,
        rawRequestedLot: lot,
        exactRequiredLot: null,
        hardBreakevenTarget: null,
        targetSpread: null,
        targetBid: null,
        targetAsk: null,
        existingProfitAtTarget: null,
        marginalProfitPerLot: null,
        projectedProfitAfter: null,
        sizingOutcome: null,
        ...event,
      };
    case "forced_liquidation":
      return {
        rawRequestedLot: null,
        exactRequiredLot: null,
        normalizedRequiredLot: event.placedLot ?? "0.00",
        liquidationTime: time,
        triggerTime: time,
        beforeFloatingProfit: "0.0",
        beforeUsedMargin: "0.0",
        beforeFreeMargin: "0.0",
        beforeMarginLevelPercent: null,
        beforeOpenPositions: 3,
        afterFloatingProfit: "0.0",
        afterUsedMargin: "0.0",
        afterFreeMargin: "0.0",
        afterMarginLevelPercent: null,
        ...event,
      };
    case "strategy_exit":
    case "basket_liquidated":
      return {
        legs: 0,
        buyLots: "0.0",
        sellLots: "0.0",
        grossLots: "0.0",
        netLots: "0.0",
        hardBreakevenModeActive: false,
        rawProfit: "0.0",
        exitProfit: "0.0",
        threshold: "0.0",
        buyClosePrice: "0.0",
        sellClosePrice: "0.0",
        commission: "0.0",
        realizedProfit: "0.0",
        liquidatedRealizedProfit: "0.0",
        liquidatedPositions: 0,
        historicalEntries: 0,
        ...event,
      };
    case "margin_call_entered":
    case "margin_call_left":
      return { balance: "1000.0", ...event };
    case "entry_rejected":
      return {
        rawRequestedLots: "0.10",
        maximumVolume: "50.0",
        normalizedRequiredLots: "0.10",
        accountUsedMargin: "10.0",
        accountFreeMargin: "990.0",
        accountMarginLevelPercent: null,
        projectedUsedMargin: "10.0",
        projectedFreeMargin: "990.0",
        exactRequiredLots: null,
        hardBreakevenTarget: null,
        targetSpread: null,
        targetBid: null,
        targetAsk: null,
        existingProfitAtTarget: null,
        marginalProfitPerLot: null,
        projectedProfitAfter: null,
        sizingOutcome: null,
        ...event,
      };
    case "entry_rejection_summary":
      return {
        minNormalizedRequiredLots: "0.10",
        maxNormalizedRequiredLots: "0.10",
        minProjectedFreeMargin: "990.0",
        maxProjectedFreeMargin: "990.0",
        parityAlgorithm: "sha256",
        parityHash: sha256("synthetic-parity"),
        outcome: null,
        ...event,
      };
    case "run_ended":
      return {
        basketsClosed: 2,
        basketsLiquidated: 1,
        forcedLiquidations: 1,
        legsOpened: 4,
        distinctRejectedEntries: 1,
        rejectedEntryAttempts: 1,
        skippedFirstEntryQuotes: 1,
        strategyEligibleQuotes: 4,
        quoteOnlyQuotes: 10,
        deliveryFirstUtc: SYNTHETIC_START,
        deliveryLastUtc: SYNTHETIC_END,
        deliveryQuoteCount: SYNTHETIC_SOURCE_ROWS,
        deliverySemanticDigest: SYNTHETIC_SOURCE_DIGEST,
        engineRealizedProfit: "20.0",
        failureKind: null,
        failureCondition: null,
        failureMessage: null,
        failureQuoteTime: null,
        failureBid: null,
        failureAsk: null,
        ...event,
      };
    default:
      return event;
  }
}

export function syntheticTelemetry(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let sequence = 1;
  const push = (
    kind: "event" | "periodic",
    time: string,
    eventId: number | null,
    values: Record<string, unknown>,
  ) => {
    rows.push({
      kind,
      eventId,
      time,
      quoteSequence: sequence++,
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
      ...values,
    });
  };
  for (const event of events) {
    const type = String(event.type);
    if (type === "entry_rejection_summary") continue;
    const time = String(event.time);
    if (type === "forced_liquidation") {
      push("event", time, Number(event.id), {
        balance: "900.00000",
        equity: "895.00000",
        floatingProfit: "-5.00000",
        realizedProfit: "-100.00000",
        usedMargin: "10.00000",
        freeMargin: "885.00000",
        marginLevelPercent: "8950.000000000000000000000000000",
        marginCallActive: true,
        openPositions: 2,
        grossLots: "0.30",
        netLots: "0.10",
        absoluteNetLots: "0.10",
      });
    } else if (type === "margin_call_entered") {
      push("event", time, Number(event.id), {
        marginCallActive: true,
        openPositions: 3,
        usedMargin: "10.00000",
        equity: "895.00000",
      });
    } else if (type === "strategy_exit") {
      push("event", time, Number(event.id), {
        balance: "1020.00000",
        equity: "1020.00000",
        realizedProfit: "20.00000",
        freeMargin: "1020.00000",
        openPositions: 0,
      });
    } else {
      push("event", time, Number(event.id), {});
    }
  }
  push("periodic", at(31, 30), null, { openPositions: 1, grossLots: "0.10" });
  push("periodic", at(34, 30), null, {
    openPositions: 3,
    usedMargin: "10.00000",
    equity: "890.00000",
  });
  rows.sort(
    (a, b) =>
      String(a.time).localeCompare(String(b.time)) ||
      Number(a.quoteSequence) - Number(b.quoteSequence),
  );
  // The producer numbers telemetry quotes chronologically; renumber after the
  // fixture interleaves periodic samples with the event snapshots.
  rows.forEach((row, index) => {
    row.quoteSequence = index + 1;
  });
  return rows;
}

export function writeReplayPackage(
  root: string,
  events: Record<string, unknown>[],
  telemetry: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  mkdirSync(root, { recursive: true });
  const eventLines = events.map((event) => JSON.stringify(event));
  const telemetryLines = telemetry.map((row) => JSON.stringify(row));
  const eventsText = `${eventLines.join("\n")}\n`;
  const telemetryText = `${telemetryLines.join("\n")}\n`;
  writeFileSync(join(root, "events.jsonl"), eventsText, "utf8");
  writeFileSync(join(root, "telemetry-2024.jsonl"), telemetryText, "utf8");
  const eventCounts: Record<string, number> = {};
  for (const event of events) {
    const type = String(event.type);
    eventCounts[type] = (eventCounts[type] ?? 0) + 1;
  }
  const files = [
    {
      name: "events.jsonl",
      year: null,
      sha256: sha256(eventsText),
      bytes: Buffer.byteLength(eventsText),
      lines: eventLines.length,
    },
    {
      name: "telemetry-2024.jsonl",
      year: 2024,
      sha256: sha256(telemetryText),
      bytes: Buffer.byteLength(telemetryText),
      lines: telemetryLines.length,
    },
  ];
  const manifest: Record<string, unknown> = {
    contract: REPLAY_PACKAGE_CONTRACT,
    modelRevision: "marketlab-single-anchor-broker-liquidation-v1",
    stopOutModel: "BrokerLiquidation",
    symbol: "XAUUSD",
    market: "dukascopy",
    securityType: "Cfd",
    quoteTimeZone: "UTC",
    startDate: "2024-01-01",
    endDate: "2024-01-01",
    startUtc: SYNTHETIC_START,
    endUtc: SYNTHETIC_END,
    researchAccountEnabled: true,
    marginEnabled: true,
    telemetryIntervalSeconds: 300,
    outcome: { completed: true, failureKind: null, failureCondition: null },
    counters: { quoteTicksProcessed: 1300 },
    delivered: {
      quoteCount: SYNTHETIC_SOURCE_ROWS,
      semanticDigest: SYNTHETIC_SOURCE_DIGEST,
      firstCanonicalUtc: SYNTHETIC_START,
      lastCanonicalUtc: SYNTHETIC_END,
    },
    eventCounts,
    telemetryCounts: {
      event: telemetry.filter((row) => row.kind === "event").length,
      periodic: telemetry.filter((row) => row.kind === "periodic").length,
    },
    files,
    packageSha256: sha256(
      files.map((file) => `${file.name}\n${file.sha256}\n${file.bytes}\n`).join(""),
    ),
    ...overrides,
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  anchorPackageIdentity(manifest);
  return manifest;
}

export function writeManifest(root: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  anchorPackageIdentity(manifest);
}

export function writeReplayEvents(
  root: string,
  manifest: Record<string, unknown>,
  events: Record<string, unknown>[],
): Record<string, unknown> {
  const eventLines = events.map((event) => JSON.stringify(event));
  const text = `${eventLines.join("\n")}\n`;
  writeFileSync(join(root, "events.jsonl"), text, "utf8");
  const files = (manifest.files as Array<Record<string, unknown>>).map((file) =>
    file.name === "events.jsonl"
      ? { ...file, sha256: sha256(text), bytes: Buffer.byteLength(text), lines: eventLines.length }
      : file,
  );
  const eventCounts: Record<string, number> = {};
  for (const event of events)
    eventCounts[String(event.type)] = (eventCounts[String(event.type)] ?? 0) + 1;
  const updated: Record<string, unknown> = { ...manifest, files, eventCounts };
  updated.packageSha256 = sha256(
    files.map((file) => `${file.name}\n${file.sha256}\n${file.bytes}\n`).join(""),
  );
  writeManifest(root, updated);
  return updated;
}

export function writeCandleMonths(
  root: string,
  months: Array<{ month: string; startIso: string; rows: number }>,
): void {
  mkdirSync(root, { recursive: true });
  const files: Array<Record<string, unknown>> = [];
  let index = 0;
  for (const spec of months) {
    const rows: string[] = [CANDLE_HEADER];
    let timeMs = Date.parse(spec.startIso);
    for (let row = 0; row < spec.rows; row += 1) {
      const open = 100 + index * 0.1;
      const high = open + 0.5;
      const low = open - 0.5;
      const close = open + 0.2;
      rows.push(
        `${new Date(timeMs).toISOString()},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},10`,
      );
      timeMs += 60_000;
      index += 1;
    }
    const text = `${rows.join("\n")}\n`;
    const [year, month] = spec.month.split("-");
    const name = `xauusd-m1-${year}-${month}.csv`;
    writeFileSync(join(root, name), text, "utf8");
    files.push({
      name,
      rows: spec.rows,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      first_candle_utc: new Date(Date.parse(spec.startIso)).toISOString(),
      last_candle_utc: new Date(Date.parse(spec.startIso) + (spec.rows - 1) * 60_000).toISOString(),
    });
  }
  const contentSha256 = sha256(
    files.map((file) => `${file.name}\0${file.sha256}\0${file.bytes}\n`).join(""),
  );
  const manifest = {
    contract: CANDLE_CACHE_CONTRACT,
    symbol: "XAUUSD",
    market: "dukascopy",
    resolution: "M1",
    price_basis: "mid_of_best_bid_ask",
    time_basis: "UTC",
    empty_minutes: "absent",
    content_sha256: contentSha256,
    inputs: {
      composition: {
        ordered_source_semantic_digest: SYNTHETIC_SOURCE_DIGEST,
        accepted_row_count: SYNTHETIC_SOURCE_ROWS,
      },
    },
    files,
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  anchorCandleIdentity(contentSha256);
}

export function writeSyntheticCandleCache(root: string): void {
  writeCandleMonths(root, [{ month: "2024-01", startIso: "2024-01-01T00:00:00.000Z", rows: 76 }]);
}

export const CANDLE_HEADER = "time,open,high,low,close,ticks";
