import { bad, handler, ok, requireValue } from "@/server/api";
import { runSummary, runBaskets, runTimeline } from "@/server/marketlab-run";
import { ReplayPackageError } from "@/lib/marketlab-replay";
import type { RunFilter } from "@/lib/marketlab-run";

export const GET = handler(async (request: Request) => {
  const search = new URL(request.url).searchParams;
  const view = search.get("view") ?? "summary";
  requireValue(["summary", "baskets", "timeline"].includes(view), "Unsupported run view.");
  const filter = search.get("filter") ?? "all";
  requireValue(
    ["all", "stop-out", "margin-call", "forced-liquidation", "strategy-exit"].includes(filter),
    "Unsupported run filter.",
  );
  const offset = search.get("offset") ?? "0";
  requireValue(
    /^\d+$/.test(offset) && Number.isSafeInteger(Number(offset)),
    "Invalid page offset.",
  );
  const source = search.get("source");
  requireValue(
    view === "summary" || (source !== null && /^[a-f0-9]{64}$/.test(source)),
    "Run source identity is required.",
  );
  const year = search.get("year");
  requireValue(year === null || /^\d{4}$/.test(year), "Invalid timeline year.");
  const all = search.get("all");
  requireValue(all === null || all === "1", "Invalid occurrence selection.");
  try {
    return ok(
      view === "summary"
        ? runSummary()
        : view === "baskets"
          ? runBaskets(Number(offset), filter as RunFilter, source!)
          : runTimeline(
              Number(offset),
              filter as RunFilter,
              year === null ? null : Number(year),
              source!,
              all === "1",
            ),
    );
  } catch (error) {
    if (error instanceof ReplayPackageError) return bad(error.message, 422);
    throw error;
  }
});
