import { handler, ok } from "@/server/api";
import { replayStatus } from "@/server/marketlab-replay";

/**
 * MarketLab Backtests: authoritative Phase E package status and basket index.
 * An invalid or unconfigured package returns `valid: false` and no baskets.
 */
export const GET = handler((request: Request) =>
  ok(replayStatus(new URL(request.url).searchParams.get("index") !== "0")),
);
