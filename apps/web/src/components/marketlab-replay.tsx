"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import {
  accountAtCursor,
  barCloseMs,
  revealEvents,
  type AccountRow,
  type BasketSummary,
  type CompactBar,
  type ReplayEventView,
  type ReplayWindowResponse,
} from "@/lib/marketlab-replay";
import { usePrivacy } from "./privacy";
import { MarketlabReplayChart } from "./marketlab-replay-chart";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { OptionSelect } from "./ui/option-select";

export interface MarketlabReplayProps {
  basket: BasketSummary;
  /** All authoritative events for this basket, in exact package order. */
  events: ReplayEventView[];
  /** Loads one bounded window of derived candles plus exported account rows. */
  loadWindow: (fromMs: number) => Promise<ReplayWindowResponse>;
}

const formatUtc = (ms: number | null): string =>
  ms === null ? "—" : new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");

/** Bounded candle context loaded before a scrubbed cursor position. */
const REPLAY_SCRUB_CONTEXT_MS = 6 * 60 * 60_000;

const show = (value: unknown): string =>
  value === undefined || value === null || value === "" ? "—" : String(value);

const eventTitle = (view: ReplayEventView): string => {
  const payload = view.payload;
  switch (view.type) {
    case "entry_executed":
      return `#${show(payload.tradeNumber)} ${show(payload.side)} ${show(payload.placedLot)} lots @ ${show(payload.fillPrice)} (${show(payload.regime)})`;
    case "forced_liquidation":
      return `Forced close ${show(payload.ordinal)}: #${show(payload.tradeNumber)} ${show(payload.side)} ${show(payload.placedLot)} @ ${show(payload.closePrice)} · realized ${show(payload.realizedProfit)}`;
    case "strategy_exit":
      return `Strategy exit ${show(payload.reason)} · realized ${show(payload.realizedProfit)} · liquidated ${show(payload.liquidatedRealizedProfit)}`;
    case "basket_liquidated":
      return `Basket liquidated · ${show(payload.reason)} · realized ${show(payload.realizedProfit)}`;
    case "stop_out_triggered":
      return `Stop Out ${show(payload.reason)} · margin level ${show(payload.marginLevelPercent)}% · ${show(payload.openPositions)} open`;
    case "margin_call_entered":
      return `Margin Call entered · level ${show(payload.marginLevelPercent)}%`;
    case "margin_call_left":
      return `Margin Call left · level ${show(payload.marginLevelPercent)}%`;
    case "hard_breakeven_activated":
      return `Hard-BE activated · lower ${show(payload.lowerTarget)} · upper ${show(payload.upperTarget)}`;
    case "trailing_activated":
      return `Trailing activated · profit ${show(payload.profit)} · threshold ${show(payload.activationThreshold)}`;
    case "entry_rejected":
      return `Entry rejected #${show(payload.tradeNumber)} ${show(payload.side)} · ${show(payload.reason)}`;
    case "entry_rejection_summary":
      return `Run-end recap: ${show(payload.attempts)} ${show(payload.reason)} attempts (${show(payload.side)} #${show(payload.tradeNumber)})`;
    case "first_entry_skipped":
      return `Ambiguous first entry skipped · ${show(payload.attempts)} attempt(s)`;
    case "basket_close_failed":
      return `Basket close failed · ${show(payload.reason)}`;
    case "hard_breakeven_violated":
      return `Hard-BE violated · #${show(payload.tradeNumber)}`;
    case "basket_anchored":
      return `Basket anchored @ ${show(payload.anchor)} · upper ${show(payload.upper)} · lower ${show(payload.lower)}`;
    default:
      return view.type;
  }
};

const statusLabel = (basket: BasketSummary): string => {
  if (basket.status === "open") return "open at run end";
  if (basket.status === "liquidated")
    return `liquidated (${basket.exitReason ?? "BrokerLiquidation"})`;
  return `closed (${basket.exitReason ?? "strategy exit"})`;
};

export function MarketlabReplay({ basket, events, loadWindow }: MarketlabReplayProps) {
  const privacy = usePrivacy();
  const [bars, setBars] = useState<CompactBar[]>([]);
  const [account, setAccount] = useState<AccountRow[]>([]);
  const [nextFromMs, setNextFromMs] = useState<number | null>(null);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const stateRef = useRef({ bars, nextFromMs, cursorMs });
  stateRef.current = { bars, nextFromMs, cursorMs };

  const reset = useCallback(async () => {
    setPlaying(false);
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const chunk = await loadWindow(basket.windowStartMs);
      if (requestRef.current !== request) return;
      setBars(chunk.bars);
      setAccount(chunk.account);
      setNextFromMs(chunk.nextFromMs);
      setCursorMs(chunk.bars.length > 0 ? barCloseMs(chunk.bars[0]!) : chunk.windowStartMs);
    } catch (cause) {
      if (requestRef.current !== request) return;
      setBars([]);
      setAccount([]);
      setNextFromMs(null);
      setCursorMs(null);
      setError(cause instanceof Error ? cause.message : "Replay window request failed.");
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [basket.windowStartMs, loadWindow]);

  useEffect(() => {
    void reset();
  }, [reset]);

  const advance = useCallback(async () => {
    const startCursor = stateRef.current.cursorMs;
    if (stateRef.current.bars.length === 0) return;
    const next = stateRef.current.bars.find((bar) => barCloseMs(bar) > (startCursor ?? -Infinity));
    if (next) {
      setCursorMs(barCloseMs(next));
      return;
    }
    let from = stateRef.current.nextFromMs;
    if (from === null) {
      setPlaying(false);
      return;
    }
    // Load with bounded context before the boundary so revealed history stays
    // on the chart; a repeat without context only if that chunk did not cross it.
    for (let attempt = 0; attempt < 3 && from !== null; attempt += 1) {
      const request = ++requestRef.current;
      setLoading(true);
      setError("");
      const requestFrom =
        attempt === 0 ? Math.max(basket.windowStartMs, from - REPLAY_SCRUB_CONTEXT_MS) : from;
      let chunk: ReplayWindowResponse;
      try {
        chunk = await loadWindow(requestFrom);
      } catch (cause) {
        if (requestRef.current !== request) return;
        setError(cause instanceof Error ? cause.message : "Replay window request failed.");
        setPlaying(false);
        if (requestRef.current === request) setLoading(false);
        return;
      }
      if (requestRef.current !== request) return;
      setBars(chunk.bars);
      setAccount(chunk.account);
      setNextFromMs(chunk.nextFromMs);
      const candidate = chunk.bars.find((bar) => barCloseMs(bar) > (startCursor ?? -Infinity));
      if (candidate) {
        setCursorMs(barCloseMs(candidate));
        setLoading(false);
        return;
      }
      from = chunk.nextFromMs;
    }
    setLoading(false);
    setPlaying(false);
  }, [basket.windowStartMs, loadWindow]);

  const retreat = useCallback(async () => {
    const { bars: currentBars, cursorMs: currentCursor } = stateRef.current;
    if (currentBars.length === 0 || currentCursor === null) return;
    const revealed = currentBars.filter((bar) => barCloseMs(bar) <= currentCursor);
    if (revealed.length > 1) {
      setCursorMs(barCloseMs(revealed[revealed.length - 2]!));
      return;
    }
    const first = currentBars[0];
    if (!first || first[0] <= basket.windowStartMs) {
      setCursorMs(basket.windowStartMs);
      return;
    }
    const span =
      currentBars.length > 1
        ? currentBars[currentBars.length - 1]![0] - first[0]
        : Math.max(basket.windowEndMs - basket.windowStartMs, 60_000);
    const from = Math.max(basket.windowStartMs, first[0] - Math.max(span, 60_000));
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const chunk = await loadWindow(from);
      if (requestRef.current !== request) return;
      setBars(chunk.bars);
      setAccount(chunk.account);
      setNextFromMs(chunk.nextFromMs);
      setCursorMs(first[0]);
    } catch (cause) {
      if (requestRef.current !== request) return;
      setError(cause instanceof Error ? cause.message : "Replay window request failed.");
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [basket.windowEndMs, basket.windowStartMs, loadWindow]);

  useEffect(() => {
    if (!playing) return;
    const interval = Math.max(8, 1000 / Number(speed));
    const timer = window.setInterval(() => {
      if (!document.hidden) void advance();
    }, interval);
    return () => window.clearInterval(timer);
  }, [playing, speed, advance]);

  const scrub = useCallback(
    async (fraction: number) => {
      setPlaying(false);
      const span = basket.windowEndMs - basket.windowStartMs;
      const target = basket.windowStartMs + Math.round(fraction * span);
      const { bars: currentBars } = stateRef.current;
      const first = currentBars[0];
      const last = currentBars[currentBars.length - 1];
      if (first && last && target >= first[0] && target <= barCloseMs(last)) {
        setCursorMs(target);
        return;
      }
      // Load bounded context before the target so the chart is never empty at
      // the cursor (for example when scrubbing to the end of the basket window).
      const from = Math.max(basket.windowStartMs, target - REPLAY_SCRUB_CONTEXT_MS);
      const request = ++requestRef.current;
      setLoading(true);
      setError("");
      try {
        const chunk = await loadWindow(from);
        if (requestRef.current !== request) return;
        setBars(chunk.bars);
        setAccount(chunk.account);
        setNextFromMs(chunk.nextFromMs);
        setCursorMs(chunk.bars.length > 0 ? Math.max(target, barCloseMs(chunk.bars[0]!)) : target);
      } catch (cause) {
        if (requestRef.current !== request) return;
        setError(cause instanceof Error ? cause.message : "Replay window request failed.");
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    },
    [basket.windowEndMs, basket.windowStartMs, loadWindow],
  );

  const visibleEvents = useMemo(() => revealEvents(events, cursorMs), [events, cursorMs]);
  const accountRow = useMemo(() => accountAtCursor(account, cursorMs), [account, cursorMs]);
  const closeEvent = useMemo(
    () =>
      visibleEvents.find(
        (event) => event.type === "strategy_exit" || event.type === "basket_liquidated",
      ) ?? null,
    [visibleEvents],
  );
  const revealedBars = useMemo(
    () => bars.filter((bar) => barCloseMs(bar) <= (cursorMs ?? Number.NEGATIVE_INFINITY)),
    [bars, cursorMs],
  );
  const complete =
    bars.length > 0 &&
    nextFromMs === null &&
    cursorMs !== null &&
    cursorMs >= barCloseMs(bars[bars.length - 1]!);
  const outcome = closeEvent
    ? basket.status === "liquidated"
      ? `liquidated (${String(closeEvent.payload.reason ?? "")})`
      : `closed (${String(closeEvent.payload.reason ?? "")})`
    : complete && basket.status === "open"
      ? statusLabel(basket)
      : "replay in progress";
  const anchorRevealed = cursorMs !== null && cursorMs >= basket.anchorTimeMs;
  const progress =
    basket.windowEndMs > basket.windowStartMs
      ? Math.min(
          1,
          Math.max(
            0,
            ((cursorMs ?? basket.windowStartMs) - basket.windowStartMs) /
              (basket.windowEndMs - basket.windowStartMs),
          ),
        )
      : 1;
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [visibleEvents.length]);

  return (
    <div className="space-y-3">
      <Card className="journal-replay-enter">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Basket #{basket.number} · {outcome}
          </CardTitle>
          {anchorRevealed && (
            <p className="text-xs text-muted-foreground">
              Anchor {basket.anchor ?? "—"} ({formatUtc(basket.anchorTimeMs)}) · upper{" "}
              {basket.upper ?? "—"} · lower {basket.lower ?? "—"} · hard-BE{" "}
              {basket.lowerTarget ?? "—"} / {basket.upperTarget ?? "—"}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {visibleEvents.length === 0 && !error && (
            <p className="text-xs text-muted-foreground">
              Replay starts before the basket anchor; press Play or Next candle to reveal the
              authoritative events in exact order.
            </p>
          )}
          {revealedBars.length > 0 ? (
            <MarketlabReplayChart
              symbol="XAUUSD"
              bars={revealedBars}
              events={visibleEvents}
              basket={basket}
              cursorMs={cursorMs}
            />
          ) : (
            <div className="flex h-[460px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {loading
                ? "Loading derived M1 candles…"
                : "No derived candles available at the cursor."}
            </div>
          )}
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2"
            role="group"
            aria-label="MarketLab replay controls"
          >
            <Button
              variant="outline"
              size="icon"
              aria-label="Restart replay"
              disabled={loading}
              onClick={() => void reset()}
            >
              <RotateCcw />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous candle"
              disabled={loading || revealedBars.length <= 1}
              onClick={() => void retreat()}
            >
              <ChevronLeft />
            </Button>
            <Button
              className="min-w-24"
              disabled={loading || complete || bars.length === 0}
              onClick={() => setPlaying((current) => !current)}
            >
              {playing ? <Pause /> : <Play />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next candle"
              disabled={loading || complete || bars.length === 0}
              onClick={() => void advance()}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Reveal the full basket window"
              disabled={loading || complete || bars.length === 0}
              onClick={() => void scrub(1)}
            >
              <SkipForward />
            </Button>
            <span className="mx-1 text-xs tabular-nums text-muted-foreground" aria-live="off">
              {revealedBars.length.toLocaleString()} / {bars.length.toLocaleString()} loaded candles
            </span>
            <OptionSelect
              aria-label="Replay speed"
              className="ml-auto w-24"
              value={speed}
              onValueChange={setSpeed}
            >
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
              <option value="16">16×</option>
              <option value="64">64×</option>
            </OptionSelect>
          </div>
          <input
            aria-label="Replay position"
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            className="w-full accent-primary"
            disabled={loading}
            onChange={(event) => void scrub(Number(event.target.value) / 1000)}
          />
          <p className="text-xs text-muted-foreground">
            Cursor through {formatUtc(cursorMs)} · {revealedBars.length.toLocaleString()} candles
            revealed · {visibleEvents.filter((event) => event.live).length.toLocaleString()}{" "}
            authoritative events revealed · candles are derived visualization data, revealed at bar
            close.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account state at the replay cursor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountRow ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <AccountValue label="Balance" value={accountRow.balance} privacy={privacy} />
                  <AccountValue label="Equity" value={accountRow.equity} privacy={privacy} />
                  <AccountValue
                    label="Floating P/L"
                    value={
                      accountRow.floatingObservable
                        ? accountRow.floatingProfit
                        : "not observable at this sample"
                    }
                    privacy={accountRow.floatingObservable && privacy}
                  />
                  <AccountValue
                    label="Realized P/L"
                    value={accountRow.realizedProfit}
                    privacy={privacy}
                  />
                  <AccountValue
                    label="Used margin"
                    value={accountRow.usedMargin}
                    privacy={privacy}
                  />
                  <AccountValue
                    label="Free margin"
                    value={accountRow.freeMargin}
                    privacy={privacy}
                  />
                  <AccountValue
                    label="Margin level"
                    value={
                      accountRow.marginLevelPercent === null
                        ? "not defined"
                        : `${accountRow.marginLevelPercent}%`
                    }
                    privacy={privacy}
                  />
                  <AccountValue label="Open positions" value={String(accountRow.openPositions)} />
                  <AccountValue label="Gross exposure (lots)" value={accountRow.grossLots} />
                  <AccountValue label="|Net exposure| (lots)" value={accountRow.absoluteNetLots} />
                </dl>
                <p className="text-xs text-muted-foreground">
                  Exported LEAN value at {formatUtc(accountRow.timeMs)} · quote #
                  {accountRow.quoteSequence} ·{" "}
                  {accountRow.kind === "event"
                    ? `event snapshot #${String(accountRow.eventId)}`
                    : "periodic sample"}
                  {accountRow.marginCallActive ? " · Margin Call active" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Values are displayed exactly as exported by LEAN; this screen does not recompute
                  them.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No exported account snapshot at or before the cursor.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authoritative events · {visibleEvents.length} revealed</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={feedRef}
              className="max-h-80 space-y-1 overflow-y-auto pr-1"
              aria-label="Revealed authoritative events"
            >
              {visibleEvents.length === 0 && (
                <p className="text-sm text-muted-foreground">No events revealed yet.</p>
              )}
              {visibleEvents.map((view) => (
                <div
                  key={view.id}
                  data-marketlab-event={view.type}
                  data-marketlab-event-id={view.id}
                  className={`rounded-md border p-2 text-xs ${
                    view.live ? "" : "border-dashed bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <p className="tabular-nums text-muted-foreground">
                    {formatUtc(view.timeMs)} · {view.type}
                    {view.live ? "" : " · run-end recap"}
                  </p>
                  <p>{eventTitle(view)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AccountValue({
  label,
  value,
  title,
  privacy = false,
}: {
  label: string;
  value: string;
  title?: string;
  privacy?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className="break-all text-right font-medium tabular-nums"
        title={privacy ? undefined : title}
      >
        {privacy ? "••••" : value}
      </dd>
    </>
  );
}
