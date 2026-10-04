"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import {
  barCloseMs,
  revealEvents,
  revealedAnchorLevels,
  type AccountRow,
  type BasketIdentity,
  type CompactBar,
  type ReplayEventView,
  type ReplayRevealResponse,
  type ReplayWindowResponse,
} from "@/lib/marketlab-replay";
import { usePrivacy } from "./privacy";
import { MarketlabReplayChart } from "./marketlab-replay-chart";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { OptionSelect } from "./ui/option-select";

/** Bounded candle context loaded before a scrubbed or stepped cursor position. */
const REPLAY_SCRUB_CONTEXT_MS = 6 * 60 * 60_000;

export interface MarketlabReplayProps {
  basket: BasketIdentity;
  /** Loads one bounded window of derived candles plus the carry-in account row. */
  loadWindow: (fromMs: number) => Promise<ReplayWindowResponse>;
  /** Returns only events and account state at or before the cursor. */
  loadReveal: (
    afterEventId: number,
    cursorMs: number,
    step?: boolean,
  ) => Promise<ReplayRevealResponse>;
}

const formatUtc = (ms: number | null): string =>
  ms === null ? "—" : new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");

const show = (value: unknown): string =>
  value === undefined || value === null || value === "" ? "—" : String(value);

const marginText = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? `${value}%` : "not defined";

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
      return `Stop Out ${show(payload.reason)} · margin level ${marginText(payload.marginLevelPercent)} · ${show(payload.openPositions)} open`;
    case "margin_call_entered":
      return `Margin Call entered · level ${marginText(payload.marginLevelPercent)}`;
    case "margin_call_left":
      return `Margin Call left · level ${marginText(payload.marginLevelPercent)}`;
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

export function MarketlabReplay({ basket, loadWindow, loadReveal }: MarketlabReplayProps) {
  const privacy = usePrivacy();
  const [bars, setBars] = useState<CompactBar[]>([]);
  const [nextFromMs, setNextFromMs] = useState<number | null>(null);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const [cursorEventId, setCursorEventId] = useState<number | null>(null);
  const [events, setEvents] = useState<ReplayEventView[]>([]);
  const [accountState, setAccountState] = useState<{
    cursorMs: number;
    eventId: number | null;
    row: AccountRow | null;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("4");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const revealRef = useRef(0);
  const lastEventIdRef = useRef(0);
  const pendingRevealRef = useRef<number | null>(null);
  const revealBusyRef = useRef(false);
  const advanceBusyRef = useRef(false);
  const stateRef = useRef({ bars, nextFromMs, cursorMs, cursorEventId, events });
  stateRef.current = { bars, nextFromMs, cursorMs, cursorEventId, events };

  /** Fetches every event at or before the cursor, in bounded batches. */
  const revealOnce = useCallback(
    async (cursor: number) => {
      const token = ++revealRef.current;
      let after = lastEventIdRef.current;
      const collected: ReplayEventView[] = [];
      let account: AccountRow | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await loadReveal(after, cursor);
        collected.push(...response.events);
        after = response.lastEventId;
        account = response.account;
        if (!response.hasMore) break;
      }
      if (revealRef.current !== token) return;
      lastEventIdRef.current = after;
      setEvents((previous) => {
        const known = new Set(previous.map((event) => event.id));
        const merged = [...previous, ...collected.filter((event) => !known.has(event.id))];
        merged.sort((a, b) => a.id - b.id);
        return merged;
      });
      setAccountState({ cursorMs: cursor, eventId: null, row: account });
    },
    [loadReveal],
  );

  /** Coalesces cursor changes into at most one in-flight reveal request. */
  const requestReveal = useCallback(
    (cursor: number) => {
      pendingRevealRef.current = cursor;
      if (revealBusyRef.current) return;
      void (async () => {
        revealBusyRef.current = true;
        try {
          while (pendingRevealRef.current !== null) {
            const target = pendingRevealRef.current;
            pendingRevealRef.current = null;
            await revealOnce(target);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Reveal request failed.");
        } finally {
          revealBusyRef.current = false;
        }
      })();
    },
    [revealOnce],
  );

  const reset = useCallback(async () => {
    setPlaying(false);
    const request = ++requestRef.current;
    revealRef.current += 1;
    pendingRevealRef.current = null;
    setLoading(true);
    setError("");
    setEvents([]);
    lastEventIdRef.current = 0;
    setAccountState(null);
    setCursorEventId(null);
    try {
      const chunk = await loadWindow(basket.windowStartMs);
      if (requestRef.current !== request) return;
      setBars(chunk.bars);
      setNextFromMs(chunk.nextFromMs);
      const first = chunk.bars[0];
      const cursor = first ? barCloseMs(first) : chunk.windowStartMs;
      setCursorMs(cursor);
      requestReveal(cursor);
    } catch (cause) {
      if (requestRef.current !== request) return;
      setBars([]);
      setNextFromMs(null);
      setCursorMs(null);
      setAccountState(null);
      setError(cause instanceof Error ? cause.message : "Replay window request failed.");
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [basket.windowStartMs, loadWindow, requestReveal]);

  useEffect(() => {
    void reset();
  }, [reset]);

  const stepTo = useCallback(
    async (target: number) => {
      const token = ++revealRef.current;
      const state = stateRef.current;
      const after =
        state.cursorEventId ??
        state.events
          .filter(
            (event) =>
              event.live && event.timeMs !== null && event.timeMs <= (state.cursorMs ?? -Infinity),
          )
          .at(-1)?.id ??
        0;
      const response = await loadReveal(after, target, true);
      if (revealRef.current !== token) return;
      const cursor = response.reachedCursorMs ?? target;
      const eventId = response.reachedEventId ?? null;
      lastEventIdRef.current = Math.max(lastEventIdRef.current, response.lastEventId);
      setEvents((previous) => {
        const known = new Set(previous.map((event) => event.id));
        return [...previous, ...response.events.filter((event) => !known.has(event.id))].sort(
          (a, b) => a.id - b.id,
        );
      });
      setCursorMs(cursor);
      setCursorEventId(eventId);
      setAccountState({ cursorMs: cursor, eventId, row: response.account });
    },
    [loadReveal],
  );

  const advanceOne = useCallback(
    async (candleStep = 1) => {
      const startCursor = stateRef.current.cursorMs;
      if (stateRef.current.bars.length === 0) return;
      const candidates = stateRef.current.bars.filter(
        (bar) => barCloseMs(bar) > (startCursor ?? -Infinity),
      );
      const next = candidates[Math.min(candleStep, candidates.length) - 1];
      if (next) {
        const cursor = barCloseMs(next);
        await stepTo(cursor);
        return;
      }
      let from = stateRef.current.nextFromMs;
      if (from === null) {
        // The final authoritative step is not a candle: when no candle can close
        // at or before the basket window end (for example the open basket at the
        // run end), move the cursor to the authoritative window end so the replay
        // can naturally finish instead of stopping short of it.
        if ((startCursor ?? Number.NEGATIVE_INFINITY) < basket.windowEndMs) {
          const cursor = basket.windowEndMs;
          await stepTo(cursor);
        } else {
          setPlaying(false);
        }
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
        setNextFromMs(chunk.nextFromMs);
        const candidates = chunk.bars.filter((bar) => barCloseMs(bar) > (startCursor ?? -Infinity));
        const candidate = candidates[Math.min(candleStep, candidates.length) - 1];
        if (candidate) {
          const cursor = barCloseMs(candidate);
          await stepTo(cursor);
          setLoading(false);
          return;
        }
        from = chunk.nextFromMs;
      }
      setLoading(false);
      setPlaying(false);
    },
    [basket.windowEndMs, basket.windowStartMs, loadWindow, stepTo],
  );

  const advance = useCallback(
    async (candleStep = 1) => {
      if (advanceBusyRef.current || revealBusyRef.current) return;
      advanceBusyRef.current = true;
      try {
        await advanceOne(candleStep);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Replay step failed.");
        setPlaying(false);
      } finally {
        advanceBusyRef.current = false;
      }
    },
    [advanceOne],
  );

  const retreat = useCallback(async () => {
    revealRef.current += 1;
    setCursorEventId(null);
    const { bars: currentBars, cursorMs: currentCursor } = stateRef.current;
    if (currentBars.length === 0 || currentCursor === null) return;
    const revealed = currentBars.filter((bar) => barCloseMs(bar) <= currentCursor);
    if (revealed.length > 1) {
      const cursor = barCloseMs(revealed[revealed.length - 2]!);
      setCursorMs(cursor);
      requestReveal(cursor);
      return;
    }
    const first = currentBars[0];
    if (!first || first[0] <= basket.windowStartMs) {
      setCursorMs(basket.windowStartMs);
      requestReveal(basket.windowStartMs);
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
      setNextFromMs(chunk.nextFromMs);
      setCursorMs(first[0]);
      requestReveal(first[0]);
    } catch (cause) {
      if (requestRef.current !== request) return;
      setError(cause instanceof Error ? cause.message : "Replay window request failed.");
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [basket.windowEndMs, basket.windowStartMs, loadWindow, requestReveal]);

  useEffect(() => {
    if (!playing) return;
    // High candle rates do not need a network round trip per M1 bar. At most
    // four visual advances per second reveal a small candle batch; the server
    // still stops at the FIRST authoritative occurrence and its exact snapshot.
    // Next remains a single-candle action, independent of playback speed.
    const interval = Math.max(250, 1000 / Number(speed));
    const candleStep = Math.max(1, Number(speed) / 4);
    const timer = window.setInterval(() => {
      if (!document.hidden) void advance(candleStep);
    }, interval);
    return () => window.clearInterval(timer);
  }, [playing, speed, advance]);

  const scrub = useCallback(
    async (fraction: number) => {
      revealRef.current += 1;
      setCursorEventId(null);
      setPlaying(false);
      const span = basket.windowEndMs - basket.windowStartMs;
      const target = basket.windowStartMs + Math.round(fraction * span);
      const { bars: currentBars } = stateRef.current;
      const first = currentBars[0];
      const last = currentBars[currentBars.length - 1];
      if (first && last && target >= first[0] && target <= barCloseMs(last)) {
        setCursorMs(target);
        requestReveal(target);
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
        setNextFromMs(chunk.nextFromMs);
        const cursor =
          chunk.bars.length > 0 ? Math.max(target, barCloseMs(chunk.bars[0]!)) : target;
        setCursorMs(cursor);
        requestReveal(cursor);
      } catch (cause) {
        if (requestRef.current !== request) return;
        setError(cause instanceof Error ? cause.message : "Replay window request failed.");
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    },
    [basket.windowEndMs, basket.windowStartMs, loadWindow, requestReveal],
  );

  const visibleEvents = useMemo(
    () =>
      revealEvents(events, cursorMs).filter(
        (event) => cursorEventId === null || event.id <= cursorEventId,
      ),
    [events, cursorMs, cursorEventId],
  );
  const accountRow =
    accountState !== null &&
    cursorMs !== null &&
    accountState.cursorMs === cursorMs &&
    accountState.eventId === cursorEventId
      ? accountState.row
      : null;
  const revealSynchronized =
    accountState !== null &&
    cursorMs !== null &&
    accountState.cursorMs === cursorMs &&
    accountState.eventId === cursorEventId;
  const accountSyncing = cursorMs !== null && !revealSynchronized;
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
    bars.length > 0 && nextFromMs === null && cursorMs !== null && cursorMs >= basket.windowEndMs;
  // A terminal outcome is pronounced only after the reveal for the terminal
  // cursor has actually arrived: while the terminal reveal is in flight the
  // close event may not be visible yet, and a closed basket must never
  // transiently read as "open at run end".
  const atRunEnd =
    revealSynchronized &&
    cursorMs !== null &&
    cursorMs >= basket.windowEndMs &&
    closeEvent === null;
  const outcome = closeEvent
    ? closeEvent.type === "basket_liquidated"
      ? `liquidated (${String(closeEvent.payload.reason ?? "")})`
      : `closed (${String(closeEvent.payload.reason ?? "")})`
    : atRunEnd
      ? "open at run end"
      : "replay in progress";
  const anchorLevels = useMemo(() => revealedAnchorLevels(visibleEvents), [visibleEvents]);
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
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="journal-replay-enter">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-3 pb-2">
          <CardTitle>
            Basket #{basket.number} · {outcome}
          </CardTitle>
          {anchorLevels && (
            <p className="text-xs text-muted-foreground">
              Anchor {anchorLevels.anchor ?? "—"} ({formatUtc(basket.anchorTimeMs)}) · upper{" "}
              {anchorLevels.upper ?? "—"} · lower {anchorLevels.lower ?? "—"} · hard-BE{" "}
              {anchorLevels.lowerTarget ?? "—"} / {anchorLevels.upperTarget ?? "—"}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-2 p-3 pt-2">
          {closeEvent && (
            <div className="rounded-lg border p-2 text-xs" aria-label="Authoritative basket close">
              <p className="font-semibold">
                Basket #{basket.number} closed · {show(closeEvent.payload.reason)} ·{" "}
                {formatUtc(closeEvent.timeMs)}
              </p>
              {closeEvent.type === "strategy_exit" && (
                <p>
                  {Number(closeEvent.payload.buyLots) > 0 &&
                    `BUY close ${show(closeEvent.payload.buyClosePrice)} (${show(closeEvent.payload.buyLots)} lots)`}
                  {Number(closeEvent.payload.buyLots) > 0 &&
                    Number(closeEvent.payload.sellLots) > 0 &&
                    " · "}
                  {Number(closeEvent.payload.sellLots) > 0 &&
                    `SELL close ${show(closeEvent.payload.sellClosePrice)} (${show(closeEvent.payload.sellLots)} lots)`}
                </p>
              )}
              <p>
                Lifetime basket result {show(closeEvent.payload.realizedProfit)} · prior
                broker-liquidation realized P/L {show(closeEvent.payload.liquidatedRealizedProfit)}
              </p>
              <p className="text-xs text-muted-foreground">
                Exact exported LEAN execution; candle OHLC is derived visualization data.
              </p>
            </div>
          )}
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
              height={280}
            />
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
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
            Cursor through {formatUtc(cursorMs)}
            {cursorEventId !== null ? ` · occurrence #${cursorEventId}` : ""} ·{" "}
            {revealedBars.length.toLocaleString()} candles revealed ·{" "}
            {visibleEvents.filter((event) => event.live).length.toLocaleString()} authoritative
            events revealed · candles are derived visualization data, revealed at bar close. Play
            and Next pause at each exported occurrence before the next candle close; same-time
            events retain their LEAN order.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle>Account state at the replay cursor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountSyncing ? (
              <p role="status" className="text-sm text-muted-foreground">
                Synchronizing the exported account state at the cursor…
              </p>
            ) : accountRow ? (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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
                  <AccountValue
                    label="Net exposure (lots, signed)"
                    value={accountRow.netLots}
                    title="Positive is net long, negative is net short, exactly as exported by LEAN."
                  />
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
                  them. Gross and signed net exposure are both the exported account values.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No exported account snapshot for this basket at the cursor.
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
              className="max-h-48 space-y-1 overflow-y-auto pr-1"
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
