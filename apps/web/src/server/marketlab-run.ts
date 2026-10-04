/** Read-only navigation over the verified Phase E package; no persisted index. */
import { loadPackage, loadCandleCache, requireReplayCompatibility } from "./marketlab-replay";
import { ReplayPackageError } from "@/lib/marketlab-replay";
import {
  MAJOR_EVENT_TYPES,
  RUN_PAGE_SIZE,
  type RunFilter,
  type RunPage,
  type RunSource,
  type RunSummary,
  type RunBasketRow,
  type RunOccurrence,
} from "@/lib/marketlab-run";

function ready(expected?: string) {
  const loaded = loadPackage();
  const candles = loadCandleCache();
  requireReplayCompatibility(loaded, candles);
  const source: RunSource = {
    packageSha256: loaded.manifest.packageSha256,
    manifestSha256: loaded.manifestSha256,
    candleContentSha256: candles.manifest.content_sha256!,
  };
  if (expected !== undefined && expected !== source.manifestSha256) {
    throw new ReplayPackageError("Run navigation source identity changed; reload the run.");
  }
  return { loaded, source };
}

export function runSummary(): RunSummary {
  const { loaded, source } = ready();
  const start = loaded.events[0]!;
  const end = loaded.events.at(-1)!;
  const snapshot = (id: number) => {
    const row = loaded.telemetry.find((r) => r.eventId === id);
    if (!row) throw new ReplayPackageError("Run boundary snapshot is missing.");
    return row;
  };
  // Read counters from the fingerprint-bound run_ended payload, not mutable
  // manifest convenience counters and never a reconstruction of economics.
  const counters = Object.fromEntries(
    [
      "basketsClosed",
      "basketsLiquidated",
      "forcedLiquidations",
      "legsOpened",
      "distinctRejectedEntries",
      "rejectedEntryAttempts",
      "skippedFirstEntryQuotes",
      "strategyEligibleQuotes",
      "quoteOnlyQuotes",
      "quoteTicksProcessed",
      "engineRealizedProfit",
    ].map((key) => [key, end.payload[key] as string | number]),
  );
  return {
    source,
    started: start.time!,
    ended: end.time!,
    completed: end.payload.completed as boolean,
    failureKind: end.payload.failureKind as string | null,
    failureCondition: end.payload.failureCondition as string | null,
    counters,
    eventCounts: loaded.manifest.eventCounts,
    basketCount: loaded.baskets.length,
    openBaskets: loaded.baskets.filter((b) => b.status === "open").map((b) => b.number),
    initialAccount: snapshot(start.id),
    finalAccount: snapshot(end.id),
  };
}

function matches(type: string, filter: RunFilter) {
  return (
    filter === "all" ||
    (filter === "stop-out"
      ? type === "stop_out_triggered"
      : filter === "margin-call"
        ? type === "margin_call_entered" || type === "margin_call_left"
        : filter === "forced-liquidation"
          ? type === "forced_liquidation"
          : type === "strategy_exit")
  );
}
function page<T>(items: T[], offset: number, source: RunSource): RunPage<T> {
  if (!Number.isSafeInteger(offset) || offset < 0 || (offset >= items.length && offset !== 0)) {
    throw new ReplayPackageError("Run navigation page offset is invalid.");
  }
  return {
    source,
    items: items.slice(offset, offset + RUN_PAGE_SIZE),
    total: items.length,
    offset,
    nextOffset: offset + RUN_PAGE_SIZE < items.length ? offset + RUN_PAGE_SIZE : null,
  };
}
export function runBaskets(
  offset: number,
  filter: RunFilter,
  expected: string,
): RunPage<RunBasketRow> {
  const { loaded, source } = ready(expected);
  const rows = loaded.baskets
    .filter(
      (b) =>
        filter === "all" ||
        loaded.eventsByBasket.get(b.number)!.some((e) => matches(e.type, filter)),
    )
    .map((b) => {
      const events = loaded.eventsByBasket.get(b.number)!;
      const close = events.find(
        (e) => e.type === "strategy_exit" || e.type === "basket_liquidated",
      );
      return {
        number: b.number,
        anchorTime: b.anchorTime,
        anchorEventId: events[0]!.id,
        status: b.status,
        closeTime: close?.time ?? null,
        closeEventId: close?.id ?? null,
        exitReason: b.exitReason,
        realizedProfit: (close?.payload.realizedProfit as string) ?? null,
        entries: b.entries,
        stopOutEpisodes: b.stopOutEpisodes,
        marginCallEntries: b.marginCallEntries,
        forcedLiquidations: b.forcedLiquidations,
      };
    });
  return page(rows, offset, source);
}
export function runTimeline(
  offset: number,
  filter: RunFilter,
  year: number | null,
  expected: string,
  allOccurrences = false,
): RunPage<RunOccurrence> {
  const { loaded, source } = ready(expected);
  // Membership comes from the existing qualified lifecycle index, including
  // run-scoped Margin Call transitions. Boundaries navigate to first/final basket.
  const membership = new Map<number, number>();
  for (const [basket, events] of loaded.eventsByBasket) {
    for (const event of events) membership.set(event.id, basket);
  }
  const rows = loaded.events
    .filter(
      (e) =>
        e.live &&
        e.time !== null &&
        (allOccurrences || MAJOR_EVENT_TYPES.includes(e.type)) &&
        matches(e.type, filter) &&
        (year === null || new Date(e.timeMs!).getUTCFullYear() === year),
    )
    .map((e) => {
      const basket =
        e.type === "run_started"
          ? loaded.baskets[0]!.number
          : e.type === "run_ended"
            ? loaded.baskets.at(-1)!.number
            : membership.get(e.id);
      if (!basket)
        throw new ReplayPackageError(`Occurrence #${e.id} has no basket navigation context.`);
      return {
        id: e.id,
        time: e.time!,
        type: e.type,
        basket,
        tradeNumber: typeof e.payload.tradeNumber === "number" ? e.payload.tradeNumber : null,
        reason: typeof e.payload.reason === "string" ? e.payload.reason : null,
      };
    });
  return page(rows, offset, source);
}
