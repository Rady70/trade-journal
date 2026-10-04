/** Completed-run browsing metadata. Never a source of basket cursor state. */
import type { AccountRow, BasketStatus, ReplayEventType } from "./marketlab-replay";

export const RUN_PAGE_SIZE = 40;
export const MAJOR_EVENT_TYPES: ReplayEventType[] = [
  "run_started",
  "basket_anchored",
  "hard_breakeven_activated",
  "trailing_activated",
  "strategy_exit",
  "basket_liquidated",
  "stop_out_triggered",
  "forced_liquidation",
  "margin_call_entered",
  "margin_call_left",
  "entry_rejected",
  "basket_close_failed",
  "hard_breakeven_violated",
  "run_ended",
];
export type RunFilter = "all" | "stop-out" | "margin-call" | "forced-liquidation" | "strategy-exit";
export interface RunSource {
  packageSha256: string;
  manifestSha256: string;
  candleContentSha256: string;
}
/** Transparent, complete accepted identity; not a session or authorization token. */
export const runSourceToken = (source: RunSource): string =>
  `${source.packageSha256}:${source.manifestSha256}:${source.candleContentSha256}`;
export const RUN_SOURCE_TOKEN_PATTERN = /^[a-f0-9]{64}:[a-f0-9]{64}:[a-f0-9]{64}$/;
export interface RunSummary {
  source: RunSource;
  started: string;
  ended: string;
  completed: boolean;
  failureKind: string | null;
  failureCondition: string | null;
  counters: Record<string, string | number>;
  eventCounts: Record<string, number>;
  basketCount: number;
  openBaskets: number[];
  initialAccount: AccountRow;
  finalAccount: AccountRow;
}
export interface RunBasketRow {
  number: number;
  anchorTime: string;
  anchorEventId: number;
  status: BasketStatus;
  closeTime: string | null;
  closeEventId: number | null;
  exitReason: string | null;
  realizedProfit: string | null;
  entries: number;
  stopOutEpisodes: number;
  marginCallEntries: number;
  forcedLiquidations: number;
}
export interface RunOccurrence {
  id: number;
  time: string;
  type: ReplayEventType;
  basket: number;
  tradeNumber: number | null;
  reason: string | null;
}
export interface RunPage<T> {
  source: RunSource;
  items: T[];
  total: number;
  offset: number;
  nextOffset: number | null;
}
export interface ReplayTarget {
  id: number;
  timeMs: number;
}
