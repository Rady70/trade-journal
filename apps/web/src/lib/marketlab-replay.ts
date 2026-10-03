/**
 * MarketLab Backtests replay contracts (Phase F).
 *
 * Authority boundary, exactly as finalized in the LEAN Phase E replay package:
 *
 * - authoritative: event stream, basket identity, execution identities/prices/
 *   timestamps, risk events, account snapshots and account telemetry. These are
 *   passed through unchanged from `events.jsonl` / `telemetry-*.jsonl`.
 * - derived visualization data: M1 candle bars from the qualified Dukascopy
 *   source. Candles are never an authority over an execution, a risk event or an
 *   account value, and nothing here recalculates a strategy, sizing, margin,
 *   liquidation or P/L decision.
 *
 * The functions in this module only index, slice and select authoritative rows.
 */

export const REPLAY_PACKAGE_CONTRACT = "marketlab-single-anchor-replay-package-v1";
export const CANDLE_CACHE_CONTRACT = "marketlab-xauusd-m1-candle-cache-v1";

/**
 * The published Phase E event whitelist. A package line with any other type is
 * an unsupported contract and must fail closed rather than render.
 */
export const REPLAY_EVENT_TYPES = [
  "run_started",
  "basket_anchored",
  "hard_breakeven_activated",
  "entry_executed",
  "entry_rejected",
  "entry_rejection_summary",
  "first_entry_skipped",
  "trailing_activated",
  "strategy_exit",
  "basket_liquidated",
  "stop_out_triggered",
  "forced_liquidation",
  "basket_close_failed",
  "hard_breakeven_violated",
  "margin_call_entered",
  "margin_call_left",
  "run_ended",
] as const;

export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[number];

/** Run-end recap events are outside the live clock (Phase E section 3). */
export const REPLAY_RECAP_TYPE: ReplayEventType = "entry_rejection_summary";

export const REPLAY_CONTEXT_PAD_MS = 30 * 60_000;
export const REPLAY_CHUNK_BARS = 12_000;
/** The maximum number of events a single cursor reveal may return. */
export const REPLAY_REVEAL_BATCH = 1_000;

export class ReplayPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayPackageError";
  }
}

export interface ReplayManifestFile {
  name: string;
  year: number | null;
  sha256: string;
  bytes: number;
  lines: number;
}

export interface ReplayManifest {
  contract: string;
  modelRevision: string;
  stopOutModel: string;
  symbol: string;
  market: string;
  securityType?: string;
  algorithmTimeZone?: string;
  quoteTimeZone?: string;
  startDate?: string;
  endDate?: string;
  startUtc: string;
  endUtc: string;
  researchAccountEnabled?: boolean;
  marginEnabled?: boolean;
  telemetryIntervalSeconds?: number;
  parameters?: Record<string, unknown>;
  marginParameters?: Record<string, unknown>;
  outcome?: {
    completed?: boolean;
    failureKind?: string | null;
    failureCondition?: string | null;
  };
  counters?: Record<string, unknown>;
  delivered?: {
    quoteCount?: number;
    semanticDigest?: string;
    firstCanonicalUtc?: string | null;
    lastCanonicalUtc?: string | null;
  };
  eventCounts: Record<string, number>;
  telemetryCounts?: { event: number; periodic: number };
  files: ReplayManifestFile[];
  packageSha256: string;
}

/** One authoritative event, wrapped with derived lookup fields only. */
export interface ReplayEventView {
  id: number;
  type: ReplayEventType;
  /** Authoritative UTC text when the event is on the live clock. */
  time: string | null;
  /** Derived index of `time` (live) or `lastTime` (run-end recap). */
  timeMs: number | null;
  live: boolean;
  /** The exact authoritative event object. Never rewritten. */
  payload: Record<string, unknown>;
}

export type BasketStatus = "closed" | "liquidated" | "open";

export interface BasketSummary {
  number: number;
  status: BasketStatus;
  exitReason: string | null;
  anchorTime: string;
  anchorTimeMs: number;
  anchorQuoteSequence: number | null;
  anchor: string | null;
  step: string | null;
  upper: string | null;
  lower: string | null;
  lowerTarget: string | null;
  upperTarget: string | null;
  lastLiveTimeMs: number;
  windowStartMs: number;
  windowEndMs: number;
  /** The authoritative run end for the basket still open there; null once closed. */
  runEndMs: number | null;
  entries: number;
  forcedLiquidations: number;
  stopOutEpisodes: number;
  marginCallEntries: number;
  hardBreakevenActivations: number;
  liveRejections: number;
  tradeNumbers: number[];
}

/**
 * The pre-cursor selector identity of a basket. No outcome, counts, trade
 * numbers or events: those are only revealed through the bounded cursor
 * endpoints.
 */
export interface BasketIdentity {
  number: number;
  anchorTime: string;
  anchorTimeMs: number;
  anchor: string | null;
  step: string | null;
  upper: string | null;
  lower: string | null;
  lowerTarget: string | null;
  upperTarget: string | null;
  windowStartMs: number;
  windowEndMs: number;
}

export const toBasketIdentity = (basket: BasketSummary): BasketIdentity => ({
  number: basket.number,
  anchorTime: basket.anchorTime,
  anchorTimeMs: basket.anchorTimeMs,
  anchor: basket.anchor,
  step: basket.step,
  upper: basket.upper,
  lower: basket.lower,
  lowerTarget: basket.lowerTarget,
  upperTarget: basket.upperTarget,
  windowStartMs: basket.windowStartMs,
  windowEndMs: basket.windowEndMs,
});

/** One exact exported account observation from `telemetry-*.jsonl`. */
export interface AccountRow {
  kind: "event" | "periodic";
  eventId: number | null;
  time: string;
  timeMs: number;
  quoteSequence: number;
  balance: string;
  equity: string;
  floatingProfit: string;
  floatingObservable: boolean;
  realizedProfit: string;
  usedMargin: string;
  freeMargin: string;
  marginLevelPercent: string | null;
  marginCallActive: boolean;
  openPositions: number;
  grossLots: string;
  absoluteNetLots: string;
}

/** [open time ms, open, high, low, close, source ticks] */
export type CompactBar = [number, number, number, number, number, number];

export interface ReplayStatus {
  configured: boolean;
  valid: boolean;
  error: string | null;
  hint: string | null;
  package: {
    contract: string;
    modelRevision: string;
    stopOutModel: string;
    symbol: string;
    market: string;
    securityType: string | null;
    startUtc: string;
    endUtc: string;
    quoteTimeZone: string | null;
    telemetryIntervalSeconds: number | null;
    outcome: ReplayManifest["outcome"] | null;
    counters: Record<string, unknown> | null;
    eventCounts: Record<string, number>;
    telemetryCounts: { event: number; periodic: number } | null;
    packageSha256: string;
    manifestSha256: string;
    /** True when MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256 anchored the load. */
    identityEnforced: boolean;
    files: ReplayManifestFile[];
  } | null;
  candles: {
    configured: boolean;
    valid: boolean;
    error: string | null;
    contract: string | null;
    manifestSha256: string | null;
    contentSha256: string | null;
    /** True when MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256 anchored the load. */
    identityEnforced: boolean;
    fileCount: number;
    firstMonth: string | null;
    lastMonth: string | null;
  };
  baskets: BasketIdentity[];
  compatibility: {
    valid: boolean;
    error: string | null;
  };
}

export interface ReplayWindowResponse {
  fromMs: number;
  toMs: number;
  bars: CompactBar[];
  nextFromMs: number | null;
  windowStartMs: number;
  windowEndMs: number;
  /** The exact exported row in force at `fromMs` (carry-in), or null. */
  account: AccountRow | null;
  candleCache: { contract: string; manifestSha256: string; contentSha256: string };
}

export interface ReplayRevealResponse {
  /** Live basket events with id greater than `after` and time at or before the cursor. */
  events: ReplayEventView[];
  /** The exact exported account row in force at the cursor, or null. */
  account: AccountRow | null;
  hasMore: boolean;
  lastEventId: number;
}

export interface IndexedBaskets {
  baskets: BasketSummary[];
  eventsByBasket: Map<number, ReplayEventView[]>;
  byNumber: Map<number, BasketSummary>;
}

const UTC_MS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/** Parses the exact Phase E canonical UTC text. Anything else is invalid. */
export function parseUtcMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = UTC_MS_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millis = Number(match[7]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

export const barTimeMs = (bar: CompactBar): number => bar[0];
export const barCloseMs = (bar: CompactBar): number => bar[0] + 60_000;

const readBasketNumber = (payload: Record<string, unknown>): number | null => {
  const value = payload.basket;
  if (value === undefined || value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
};

const requireBasketNumber = (view: ReplayEventView): number => {
  const value = readBasketNumber(view.payload);
  if (value === null) {
    throw new ReplayPackageError(
      `Event ${view.id} (${view.type}) does not carry a valid basket number.`,
    );
  }
  return value;
};

const readString = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * Segments the authoritative stream into baskets using only event order and the
 * package's own lifecycle rules. No round-trip netting, no renumbering, no
 * re-sizing, no opposing-leg merging.
 */
export function indexBaskets(events: ReplayEventView[]): IndexedBaskets {
  const baskets: BasketSummary[] = [];
  const byNumber = new Map<number, BasketSummary>();
  const eventsByBasket = new Map<number, ReplayEventView[]>();
  const timeOnly: ReplayEventView[] = [];
  let active: BasketSummary | null = null;
  const runEnded = events.find((view) => view.type === "run_ended");
  if (!runEnded || runEnded.timeMs === null) {
    throw new ReplayPackageError("The replay package has no authoritative run end.");
  }
  const runEndMs = runEnded.timeMs;
  let maxLiveTimeMs = Number.NEGATIVE_INFINITY;

  for (const view of events) {
    if (view.type === "run_started" || view.type === "run_ended") continue;
    // Run-end recaps are outside the live clock and are run-level; they are not
    // part of a basket's replay timeline (run-level surfaces are Phase H).
    if (view.type === REPLAY_RECAP_TYPE) continue;
    if (view.live && view.timeMs !== null) {
      maxLiveTimeMs = Math.max(maxLiveTimeMs, view.timeMs);
    }

    if (view.type === "basket_anchored") {
      const number = requireBasketNumber(view);
      if (view.timeMs === null || view.time === null) {
        throw new ReplayPackageError(`Basket ${number} anchor has no authoritative time.`);
      }
      if (byNumber.has(number)) {
        throw new ReplayPackageError(`Basket ${number} is anchored more than once.`);
      }
      if (active && active.status === "open") {
        throw new ReplayPackageError(
          `Basket ${number} is anchored while basket ${active.number} is still open.`,
        );
      }
      const summary: BasketSummary = {
        number,
        status: "open",
        exitReason: null,
        anchorTime: view.time,
        anchorTimeMs: view.timeMs,
        anchorQuoteSequence:
          typeof view.payload.quoteSequence === "number" ? view.payload.quoteSequence : null,
        anchor: readString(view.payload, "anchor"),
        step: readString(view.payload, "step"),
        upper: readString(view.payload, "upper"),
        lower: readString(view.payload, "lower"),
        lowerTarget: readString(view.payload, "lowerTarget"),
        upperTarget: readString(view.payload, "upperTarget"),
        lastLiveTimeMs: view.timeMs,
        windowStartMs: view.timeMs - REPLAY_CONTEXT_PAD_MS,
        windowEndMs: view.timeMs + REPLAY_CONTEXT_PAD_MS,
        runEndMs: null,
        entries: 0,
        forcedLiquidations: 0,
        stopOutEpisodes: 0,
        marginCallEntries: 0,
        hardBreakevenActivations: 0,
        liveRejections: 0,
        tradeNumbers: [],
      };
      active = summary;
      baskets.push(summary);
      byNumber.set(number, summary);
      eventsByBasket.set(number, [view]);
      continue;
    }

    const number = readBasketNumber(view.payload);
    if (number === null) {
      if (view.live) timeOnly.push(view);
      continue;
    }

    const summary = byNumber.get(number);
    if (!summary) {
      throw new ReplayPackageError(
        `Event ${view.id} (${view.type}) references basket ${number} before its anchor.`,
      );
    }
    if (view.live && active?.number !== number) {
      throw new ReplayPackageError(
        `Event ${view.id} (${view.type}) references basket ${number} while basket ${
          active?.number ?? "none"
        } is active.`,
      );
    }
    eventsByBasket.get(number)!.push(view);
    if (view.live && view.timeMs !== null) {
      summary.lastLiveTimeMs = Math.max(summary.lastLiveTimeMs, view.timeMs);
    }
    switch (view.type) {
      case "entry_executed": {
        summary.entries += 1;
        const tradeNumber = view.payload.tradeNumber;
        if (typeof tradeNumber === "number" && Number.isInteger(tradeNumber)) {
          summary.tradeNumbers.push(tradeNumber);
        }
        break;
      }
      case "forced_liquidation":
        summary.forcedLiquidations += 1;
        break;
      case "stop_out_triggered":
        summary.stopOutEpisodes += 1;
        break;
      case "hard_breakeven_activated":
        summary.hardBreakevenActivations += 1;
        break;
      case "entry_rejected":
        summary.liveRejections += 1;
        break;
      case "strategy_exit":
        summary.status = "closed";
        summary.exitReason = readString(view.payload, "reason");
        active = null;
        break;
      case "basket_liquidated":
        summary.status = "liquidated";
        summary.exitReason = readString(view.payload, "reason");
        active = null;
        break;
      default:
        break;
    }
  }

  // Time-scoped run events (e.g. Margin Call transitions carry no basket field).
  // They are attached to the basket whose authoritative live span contains them;
  // an unattributable live event is a package defect, not something to drop.
  for (const view of timeOnly) {
    if (view.timeMs === null) continue;
    let target: BasketSummary | null = null;
    for (const summary of baskets) {
      if (view.timeMs < summary.anchorTimeMs) continue;
      const end = summary.status === "open" ? Number.POSITIVE_INFINITY : summary.lastLiveTimeMs;
      if (view.timeMs <= end && (!target || summary.anchorTimeMs > target.anchorTimeMs)) {
        target = summary;
      }
    }
    if (!target) {
      throw new ReplayPackageError(
        `Live event ${view.id} (${view.type}) falls outside every basket's live span.`,
      );
    }
    eventsByBasket.get(target.number)!.push(view);
    if (view.timeMs > target.lastLiveTimeMs) target.lastLiveTimeMs = view.timeMs;
    if (view.type === "margin_call_entered") target.marginCallEntries += 1;
  }

  for (const summary of baskets) {
    if (summary.status === "open") {
      // The final basket stays unresolved through the authoritative run end.
      summary.windowEndMs = runEndMs;
      summary.runEndMs = runEndMs;
    } else {
      summary.windowEndMs = summary.lastLiveTimeMs + REPLAY_CONTEXT_PAD_MS;
      summary.runEndMs = null;
    }
  }
  if (maxLiveTimeMs > runEndMs) {
    throw new ReplayPackageError(
      "A live event occurs after the authoritative run end; the package is inconsistent.",
    );
  }
  for (const list of eventsByBasket.values()) {
    list.sort((a, b) => a.id - b.id);
  }
  baskets.sort((a, b) => a.number - b.number);
  return { baskets, eventsByBasket, byNumber };
}

/**
 * Reveals only events whose authoritative time is at or before the cursor (the
 * close of the last revealed candle). Run-end recaps reveal at their last
 * summarized time. No future event is ever returned.
 */
export function revealEvents(
  events: ReplayEventView[],
  cursorMs: number | null,
): ReplayEventView[] {
  if (cursorMs === null) return [];
  return events.filter((event) => event.timeMs !== null && event.timeMs <= cursorMs);
}

/** The exact exported telemetry row in force at the cursor, or null. */
export function accountAtCursor(rows: AccountRow[], cursorMs: number | null): AccountRow | null {
  if (cursorMs === null) return null;
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const row = rows[mid];
    if (!row) break;
    if (row.timeMs <= cursorMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const result = found >= 0 ? rows[found] : null;
  return result ?? null;
}

/** The bar whose close is at or before the target time (cursor placement). */
export function barIndexAtOrBefore(bars: CompactBar[], timeMs: number): number {
  let low = 0;
  let high = bars.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const bar = bars[mid];
    if (!bar) break;
    if (barCloseMs(bar) <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export const toVelaBar = (bar: CompactBar) => ({
  time: bar[0],
  open: bar[1],
  high: bar[2],
  low: bar[3],
  close: bar[4],
  volume: 0,
});
