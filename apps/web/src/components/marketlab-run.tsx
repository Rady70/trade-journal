"use client";

import { useState } from "react";
import { useApi } from "@/lib/use-api";
import type { RunBasketRow, RunOccurrence, RunPage, RunSummary } from "@/lib/marketlab-run";
import { RUN_PAGE_SIZE } from "@/lib/marketlab-run";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { usePrivacy } from "./privacy";

export function MarketlabRun({
  open,
  active = true,
}: {
  open: (basket: number, event?: number) => void;
  active?: boolean;
}) {
  const { data: summary, error } = useApi<RunSummary>("/api/marketlab-replay/run");
  const [filter, setFilter] = useState("all");
  const [basketOffset, setBasketOffset] = useState(0);
  const [eventOffset, setEventOffset] = useState(0);
  const [year, setYear] = useState("");
  const [all, setAll] = useState(false);
  const source = summary?.source.manifestSha256;
  const query = source ? `source=${source}&filter=${filter}` : null;
  const baskets = useApi<RunPage<RunBasketRow>>(
    query ? `/api/marketlab-replay/run?view=baskets&${query}&offset=${basketOffset}` : null,
  );
  const timeline = useApi<RunPage<RunOccurrence>>(
    query
      ? `/api/marketlab-replay/run?view=timeline&${query}&offset=${eventOffset}${year ? `&year=${year}` : ""}${all ? "&all=1" : ""}`
      : null,
  );
  const privacy = usePrivacy();
  const money = (v: string | null) => (v === null ? "—" : privacy ? "••••" : v);
  const changeFilter = (value: string) => {
    setFilter(value);
    setBasketOffset(0);
    setEventOffset(0);
  };
  const years = summary
    ? Array.from(
        { length: Number(summary.ended.slice(0, 4)) - Number(summary.started.slice(0, 4)) + 1 },
        (_, i) => String(Number(summary.started.slice(0, 4)) + i),
      )
    : [];
  if (!active) return null;
  return (
    <div className="space-y-4" aria-label="Completed historical run navigation">
      <p className="text-sm text-muted-foreground">
        Completed historical run overview · these totals and lifecycle records describe the entire
        result, not a replay cursor. LEAN determines what happened; Trade Journal shows and
        navigates what happened.
      </p>
      {error && <p role="alert">{error}</p>}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Run summary · XAUUSD / Dukascopy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" aria-label="Authoritative run summary">
            <p>
              {summary.started} → {summary.ended} ·{" "}
              {summary.completed
                ? "completed"
                : `failed: ${summary.failureKind} / ${summary.failureCondition}`}
            </p>
            <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Fact label="Baskets anchored (event count)" value={summary.basketCount} />
              <Fact label="Strategy closes" value={summary.counters.basketsClosed} />
              <Fact label="Fully liquidated baskets" value={summary.counters.basketsLiquidated} />
              <Fact
                label="Open at run end"
                value={summary.openBaskets.map((n) => `#${n}`).join(", ") || "none"}
              />
              <Fact label="Entries" value={summary.counters.legsOpened} />
              <Fact label="Stop Out triggers" value={summary.eventCounts.stop_out_triggered ?? 0} />
              <Fact
                label="Margin Call entered / left"
                value={`${summary.eventCounts.margin_call_entered ?? 0} / ${summary.eventCounts.margin_call_left ?? 0}`}
              />
              <Fact
                label="Broker-forced liquidations"
                value={summary.counters.forcedLiquidations}
              />
              <Fact label="Initial balance (USD)" value={money(summary.initialAccount.balance)} />
              <Fact label="Final balance (USD)" value={money(summary.finalAccount.balance)} />
              <Fact label="Final equity (USD)" value={money(summary.finalAccount.equity)} />
              <Fact
                label="Engine realized P/L (USD)"
                value={money(String(summary.counters.engineRealizedProfit))}
              />
              <Fact
                label="Final gross / signed net lots"
                value={`${summary.finalAccount.grossLots} / ${summary.finalAccount.netLots}`}
              />
              <Fact label="Final open positions" value={summary.finalAccount.openPositions} />
              <Fact
                label="Processed quotes (count only)"
                value={summary.counters.quoteTicksProcessed}
              />
              <Fact
                label="Rejected attempts (run counter)"
                value={summary.counters.rejectedEntryAttempts}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              Counters/outcome: exported run_ended. Account: exact run boundary snapshots. Risk
              totals: exported event counts. Basket/open lists: lifecycle indexing only. No
              economics recalculation. Compressed rejection recaps remain outside the live timeline.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Discover activity{" "}
          <select
            aria-label="Run activity filter"
            className="rounded border bg-background p-2"
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
          >
            <option value="all">All baskets / major events</option>
            <option value="stop-out">Stop Out triggers</option>
            <option value="margin-call">Margin Call transitions</option>
            <option value="forced-liquidation">Broker-forced liquidations</option>
            <option value="strategy-exit">Ordinary strategy exits</option>
          </select>
        </label>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Basket table</CardTitle>
        </CardHeader>
        <CardContent>
          {baskets.error && <p role="alert">{baskets.error}</p>}
          {baskets.loading && <p role="status">Loading baskets…</p>}
          {baskets.data && (
            <>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-left text-xs" aria-label="Run baskets">
                  <thead>
                    <tr>
                      {[
                        "Basket",
                        "Anchor UTC",
                        "Lifecycle / close UTC",
                        "Entries",
                        "Stop Outs",
                        "MC enters",
                        "Forced closes",
                        "Exported lifetime P/L (USD)",
                      ].map((h) => (
                        <th className="p-2" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {baskets.data.items.map((b) => (
                      <tr className="border-t" key={b.number} data-run-basket={b.number}>
                        <td className="p-2">
                          <Button size="sm" variant="outline" onClick={() => open(b.number)}>
                            Open #{b.number}
                          </Button>
                        </td>
                        <td className="p-2 whitespace-nowrap">{b.anchorTime}</td>
                        <td className="p-2">
                          {b.status === "open"
                            ? "Open at run end · no exported close"
                            : `${b.status} · ${b.exitReason}`}
                          <br />
                          {b.closeTime && (
                            <button
                              className="underline"
                              aria-label={`Jump to Basket ${b.number} close`}
                              onClick={() => open(b.number, b.closeEventId!)}
                            >
                              {b.closeTime}
                            </button>
                          )}
                        </td>
                        <td className="p-2">{b.entries}</td>
                        <td className="p-2">{b.stopOutEpisodes}</td>
                        <td className="p-2">{b.marginCallEntries}</td>
                        <td className="p-2">{b.forcedLiquidations}</td>
                        <td className="p-2">{money(b.realizedProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pages label="Basket" data={baskets.data} setOffset={setBasketOffset} />
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Run-level timeline · authoritative occurrence order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" aria-label="Timeline years">
            {["", ...years].map((y) => (
              <Button
                key={y}
                size="sm"
                variant={year === y ? "default" : "outline"}
                onClick={() => {
                  setYear(y);
                  setEventOffset(0);
                }}
              >
                {y || "All years"}
              </Button>
            ))}
            <label className="text-xs">
              <input
                aria-label="Include all live occurrences"
                type="checkbox"
                checked={all}
                onChange={(e) => {
                  setAll(e.target.checked);
                  setEventOffset(0);
                }}
              />{" "}
              Include entries and all live occurrences
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Exact UTC and occurrence ids preserve distinct same-time events. Major events include
            anchors, hard-BE/trailing activations, exits, risk transitions, individual forced
            closes, rejected-entry episodes, diagnostics and run boundaries. Jump opens the existing
            basket replay at that exact occurrence and snapshot.
          </p>
          {timeline.error && <p role="alert">{timeline.error}</p>}
          {timeline.loading && <p role="status">Loading timeline…</p>}
          {timeline.data && (
            <>
              <ol
                className="max-h-80 overflow-auto border-l pl-3"
                aria-label="Run chronological events"
              >
                {timeline.data.total === 0 && (
                  <li className="py-2 text-sm text-muted-foreground">
                    No exported live occurrences in this selection.
                  </li>
                )}
                {timeline.data.items.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-xs"
                    data-run-occurrence={e.id}
                  >
                    <span>
                      <time>{e.time}</time> · occurrence #{e.id} · {e.type} · Basket #{e.basket}
                      {e.tradeNumber !== null ? ` · trade #${e.tradeNumber}` : ""}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Jump to occurrence ${e.id}`}
                      onClick={() => open(e.basket, e.id)}
                    >
                      Jump
                    </Button>
                  </li>
                ))}
              </ol>
              <Pages label="Timeline" data={timeline.data} setOffset={setEventOffset} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}
function Pages({
  label,
  data,
  setOffset,
}: {
  label: string;
  data: RunPage<unknown>;
  setOffset: (v: number) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs">
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} previous page`}
        disabled={data.offset === 0}
        onClick={() => setOffset(Math.max(0, data.offset - RUN_PAGE_SIZE))}
      >
        Previous
      </Button>
      <span>
        {data.total === 0 ? "0" : `${data.offset + 1}–${data.offset + data.items.length}`} of{" "}
        {data.total}
      </span>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} next page`}
        disabled={data.nextOffset === null}
        onClick={() => setOffset(data.nextOffset!)}
      >
        Next
      </Button>
    </div>
  );
}
