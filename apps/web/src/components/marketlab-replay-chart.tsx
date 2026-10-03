"use client";

import { useEffect, useRef, useState } from "react";
import type { NativeIndicatorContext, NativeIndicatorOutput, Vela } from "@luxalgo/vela";
import {
  revealedAnchorLevels,
  toVelaBar,
  type BasketIdentity,
  type CompactBar,
  type ReplayEventView,
} from "@/lib/marketlab-replay";

interface ReplayPaint {
  bars: CompactBar[];
  events: ReplayEventView[];
  basket: BasketIdentity;
  cursorMs: number | null;
  paintKey: string;
}

const COLORS = {
  buy: "#0f9d58",
  sell: "#d93025",
  liquidation: "#7f1d1d",
  stopOut: "#ea8600",
  marginCall: "#7c3aed",
  hardBreakeven: "#2563eb",
  exit: "#475569",
  rejection: "#b45309",
  boundary: "#0ea5e9",
  anchor: "#6b7280",
  hardBoundary: "#f59e0b",
};

const readNumber = (value: unknown): number | null =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;

const readText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;

const marginText = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? `${value}%` : "not defined";

/**
 * Builds the Vela native-indicator output from authoritative events plus the
 * revealed derived candle bars. Only rows already revealed by the cursor are
 * passed in; nothing here invents an event, a price or a time.
 */
export function buildReplayPaint(paint: ReplayPaint): NativeIndicatorOutput {
  const { bars, events, basket, cursorMs } = paint;
  const low = bars.length > 0 ? Math.min(...bars.map((bar) => bar[3])) : 0;
  const high = bars.length > 0 ? Math.max(...bars.map((bar) => bar[2])) : 1;
  const pad = (high - low) * 0.05 || 1;
  const top = high + pad;
  const bottom = low - pad;

  const labels: NonNullable<NativeIndicatorOutput["labels"]> = [];
  const lines: NonNullable<NativeIndicatorOutput["lines"]> = [];
  const priceLines: NonNullable<NativeIndicatorOutput["priceLines"]> = [];

  // Draw a horizontal boundary only while it is near the revealed candle range,
  // so a far target cannot flatten the candles. The exact values stay in the
  // basket header and in the hard-BE activation annotation.
  const span = Math.max(high - low, high * 0.002);
  const near = (price: number): boolean => price >= low - span * 3 && price <= high + span * 3;

  const anchorRevealed = cursorMs !== null && cursorMs >= basket.anchorTimeMs;
  // The boundary levels exist in the browser only after the authoritative
  // `basket_anchored` event has been revealed; they are never preloaded.
  const levels = anchorRevealed ? revealedAnchorLevels(events) : null;
  if (levels) {
    const anchor = readNumber(levels.anchor);
    const upper = readNumber(levels.upper);
    const lower = readNumber(levels.lower);
    const lowerTarget = readNumber(levels.lowerTarget);
    const upperTarget = readNumber(levels.upperTarget);
    if (anchor !== null && near(anchor)) {
      priceLines.push({
        id: "marketlab-anchor",
        paneId: "price",
        price: anchor,
        color: COLORS.anchor,
        lineStyle: "solid",
        width: 1,
        title: `Anchor ${levels.anchor}`,
      });
    }
    if (upper !== null && near(upper)) {
      priceLines.push({
        id: "marketlab-upper",
        paneId: "price",
        price: upper,
        color: COLORS.boundary,
        lineStyle: "dashed",
        width: 1,
        title: `Upper entry boundary ${levels.upper}`,
      });
    }
    if (lower !== null && near(lower)) {
      priceLines.push({
        id: "marketlab-lower",
        paneId: "price",
        price: lower,
        color: COLORS.boundary,
        lineStyle: "dashed",
        width: 1,
        title: `Lower entry boundary ${levels.lower}`,
      });
    }
    if (lowerTarget !== null && near(lowerTarget)) {
      priceLines.push({
        id: "marketlab-hard-lower",
        paneId: "price",
        price: lowerTarget,
        color: COLORS.hardBoundary,
        lineStyle: "dotted",
        width: 1,
        title: `Hard-BE lower target ${levels.lowerTarget}`,
      });
    }
    if (upperTarget !== null && near(upperTarget)) {
      priceLines.push({
        id: "marketlab-hard-upper",
        paneId: "price",
        price: upperTarget,
        color: COLORS.hardBoundary,
        lineStyle: "dotted",
        width: 1,
        title: `Hard-BE upper target ${levels.upperTarget}`,
      });
    }
  }

  let index = 0;
  for (const view of events) {
    const payload = view.payload;
    const time = readNumber(view.timeMs);
    const label = (props: {
      text: string;
      y: number;
      yloc: "price" | "abovebar" | "belowbar" | "top" | "bottom";
      style: NonNullable<NativeIndicatorOutput["labels"]>[number]["style"];
      color: string;
      tooltip?: string;
      size?: "tiny" | "small" | "normal" | "large" | "huge";
    }): void => {
      if (time === null) return;
      labels.push({
        id: `marketlab-event-${view.id}-${index++}`,
        paneId: "price",
        xloc: "bar_time",
        x: time,
        y: props.y,
        yloc: props.yloc,
        text: props.text,
        style: props.style,
        color: props.color,
        textColor: "#ffffff",
        size: props.size ?? "small",
        textAlign: "center",
        fontFamily: "default",
        tooltip: props.tooltip,
        overlay: true,
      });
    };
    switch (view.type) {
      case "entry_executed": {
        const side = readText(payload.side, "?");
        const buy = side === "Buy";
        const sell = side === "Sell";
        const price = readNumber(payload.fillPrice) ?? 0;
        label({
          text: `#${readText(payload.tradeNumber)} ${
            buy ? "BUY" : sell ? "SELL" : `UNKNOWN SIDE ${side}`
          } ${readText(payload.placedLot)}`,
          y: price,
          yloc: buy ? "belowbar" : sell ? "abovebar" : "price",
          style: buy ? "triangleup" : sell ? "triangledown" : "cross",
          color: buy ? COLORS.buy : sell ? COLORS.sell : COLORS.exit,
          tooltip: `${view.time ?? ""} · ${side} · lot ${readText(payload.placedLot)} · fill ${readText(payload.fillPrice)} · ${readText(payload.regime)}`,
        });
        break;
      }
      case "forced_liquidation": {
        const price = readNumber(payload.closePrice) ?? 0;
        label({
          text: `LIQ ${readText(payload.ordinal)} · #${readText(payload.tradeNumber)} ${readText(payload.side)} ${readText(payload.placedLot)}\nrealized ${readText(payload.realizedProfit)}`,
          y: price,
          yloc: "price",
          style: "xcross",
          color: COLORS.liquidation,
          size: "small",
          tooltip: `Broker-forced close at ${readText(payload.closePrice)} · trigger ${readText(payload.triggerBid)}/${readText(payload.triggerAsk)} · reason ${readText(payload.reason)}`,
        });
        break;
      }
      case "strategy_exit":
      case "basket_liquidated": {
        const kind = view.type === "basket_liquidated" ? "LIQUIDATED" : "EXIT";
        const reason = readText(payload.reason, readText(payload.exitReason, view.type));
        const realizedProfit = readText(payload.realizedProfit);
        const buyLots = readNumber(payload.buyLots) ?? 0;
        const sellLots = readNumber(payload.sellLots) ?? 0;
        const buyClosePrice = readNumber(payload.buyClosePrice);
        const sellClosePrice = readNumber(payload.sellClosePrice);
        const tooltip = `${view.time ?? ""} · ${reason} · buy close ${readText(
          payload.buyClosePrice,
        )} · sell close ${readText(payload.sellClosePrice)} · realized ${realizedProfit}`;
        // Each open side closes at its own executable price: a sell-only
        // basket closes at the ask (sellClosePrice), not the buy price, and a
        // mixed basket has both exact close prices.
        const sides: Array<{ side: "BUY" | "SELL"; price: number }> = [];
        if (buyLots > 0 && buyClosePrice !== null)
          sides.push({ side: "BUY", price: buyClosePrice });
        if (sellLots > 0 && sellClosePrice !== null)
          sides.push({ side: "SELL", price: sellClosePrice });
        if (sides.length === 0) {
          const price = buyClosePrice ?? sellClosePrice ?? readNumber(payload.closePrice) ?? 0;
          label({
            text: `${kind} ${reason} · ${realizedProfit}`,
            y: price,
            yloc: "price",
            style: "label_left",
            color: COLORS.exit,
            size: "normal",
            tooltip,
          });
        } else if (sides.length === 1) {
          const only = sides[0]!;
          label({
            text: `${kind} ${reason} · ${only.side} CLOSE ${only.price} · ${realizedProfit}`,
            y: only.price,
            yloc: "price",
            style: "label_left",
            color: COLORS.exit,
            size: "normal",
            tooltip,
          });
        } else {
          for (const entry of sides) {
            label({
              text: `${kind} ${reason} · ${entry.side} CLOSE ${entry.price}`,
              y: entry.price,
              yloc: "price",
              style: "label_left",
              color: COLORS.exit,
              size: "normal",
              tooltip,
            });
          }
        }
        break;
      }
      case "stop_out_triggered": {
        if (time !== null) {
          lines.push({
            id: `marketlab-stopout-${view.id}`,
            paneId: "price",
            xloc: "bar_time",
            x1: time,
            y1: top,
            x2: time,
            y2: bottom,
            extend: "none",
            color: COLORS.stopOut,
            invisible: false,
            width: 2,
            style: "dashed",
            arrowLeft: false,
            arrowRight: false,
            overlay: true,
          });
        }
        label({
          text: `STOP OUT ${readText(payload.reason)} · margin level ${marginText(payload.marginLevelPercent)}`,
          y: 0,
          yloc: "top",
          style: "label_down",
          color: COLORS.stopOut,
          size: "normal",
          tooltip: `Trigger ${view.time ?? ""} · bid ${readText(payload.bid)} · ask ${readText(payload.ask)} · open ${readText(payload.openPositions)}`,
        });
        break;
      }
      case "margin_call_entered":
      case "margin_call_left": {
        const entering = view.type === "margin_call_entered";
        if (time !== null) {
          lines.push({
            id: `marketlab-${view.type}-${view.id}`,
            paneId: "price",
            xloc: "bar_time",
            x1: time,
            y1: top,
            x2: time,
            y2: bottom,
            extend: "none",
            color: COLORS.marginCall,
            invisible: false,
            width: 1,
            style: "dotted",
            arrowLeft: false,
            arrowRight: false,
            overlay: true,
          });
        }
        label({
          text: entering ? "MARGIN CALL" : "MARGIN CALL LEFT",
          y: 0,
          yloc: "top",
          style: "label_down",
          color: COLORS.marginCall,
          size: "tiny",
          tooltip: `${view.time ?? ""} · level ${marginText(payload.marginLevelPercent)} · equity ${readText(payload.equity)}`,
        });
        break;
      }
      case "hard_breakeven_activated":
        label({
          text: `HARD-BE ON · #${readText(payload.tradeNumber)}`,
          y: 0,
          yloc: "bottom",
          style: "label_up",
          color: COLORS.hardBreakeven,
          size: "small",
          tooltip: `Activation ${view.time ?? ""} · lower ${readText(payload.lowerTarget)} · upper ${readText(payload.upperTarget)}`,
        });
        break;
      case "trailing_activated":
        label({
          text: `TRAIL ON · ${readText(payload.activationThreshold)}`,
          y: 0,
          yloc: "bottom",
          style: "label_up",
          color: COLORS.exit,
          size: "tiny",
          tooltip: `${view.time ?? ""} · profit ${readText(payload.profit)} · threshold ${readText(payload.activationThreshold)}`,
        });
        break;
      case "entry_rejected":
        label({
          text: `REJECTED #${readText(payload.tradeNumber)} ${readText(payload.side)} · ${readText(payload.reason)}`,
          y: readNumber(payload.bid) ?? 0,
          yloc: "price",
          style: "cross",
          color: COLORS.rejection,
          size: "tiny",
          tooltip: readText(payload.message),
        });
        break;
      case "first_entry_skipped":
        label({
          text: `SKIPPED FIRST ENTRY · ${readText(payload.attempts)} attempts`,
          y: 0,
          yloc: "bottom",
          style: "flag",
          color: COLORS.rejection,
          size: "tiny",
          tooltip: view.time ?? "",
        });
        break;
      case "basket_close_failed":
        label({
          text: `CLOSE FAILED · ${readText(payload.reason)}`,
          y: readNumber(payload.bid) ?? 0,
          yloc: "price",
          style: "xcross",
          color: COLORS.sell,
          size: "tiny",
          tooltip: readText(payload.message),
        });
        break;
      case "hard_breakeven_violated":
        label({
          text: `HARD-BE VIOLATED · #${readText(payload.tradeNumber)}`,
          y: readNumber(payload.fillPrice) ?? 0,
          yloc: "price",
          style: "xcross",
          color: COLORS.liquidation,
          size: "small",
          tooltip: readText(payload.message),
        });
        break;
      case "entry_rejection_summary":
        label({
          text: `RUN-END RECAP · ${readText(payload.side)} #${readText(payload.tradeNumber)} · ${readText(payload.attempts)} attempts`,
          y: 0,
          yloc: "bottom",
          style: "label_up",
          color: COLORS.rejection,
          size: "tiny",
          tooltip: readText(payload.message),
        });
        break;
      default:
        break;
    }
  }
  return { labels, lines, priceLines };
}

/**
 * The MarketLab replay chart, on Vela. Candle bars are derived visualization
 * data; labels and lines are the authoritative LEAN events already revealed by
 * the cursor, passed through unchanged.
 */
export function MarketlabReplayChart({
  symbol,
  bars,
  events,
  basket,
  cursorMs,
  height = 460,
}: {
  symbol: string;
  bars: CompactBar[];
  events: ReplayEventView[];
  basket: BasketIdentity;
  cursorMs: number | null;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Vela | null>(null);
  const indicatorRef = useRef<{ remove: () => void } | null>(null);
  const typeRef = useRef<string>("");
  const paintRef = useRef<ReplayPaint>({
    bars,
    events,
    basket,
    cursorMs,
    paintKey: "",
  });
  paintRef.current = {
    bars,
    events,
    basket,
    cursorMs,
    paintKey: `${bars.length}:${events.length}:${cursorMs ?? "none"}`,
  };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setError("");
    setReady(false);
    void (async () => {
      const { Vela, registerNativeIndicator, unregisterNativeIndicator } =
        await import("@luxalgo/vela");
      if (disposed || !hostRef.current) return;
      const type = `marketlab-replay-${crypto.randomUUID()}`;
      typeRef.current = type;
      registerNativeIndicator({
        type,
        title: "MarketLab authoritative events",
        shortTitle: "MarketLab",
        paneHint: "price",
        overlay: true,
        inputsSchema: () => [],
        defaultInputs: () => ({}),
        create: () => {
          let context: NativeIndicatorContext | null = null;
          return {
            start(ctx: NativeIndicatorContext) {
              context = ctx;
              ctx.emit(buildReplayPaint(paintRef.current));
              ctx.setStatus("idle");
            },
            onBars() {
              context?.emit(buildReplayPaint(paintRef.current));
            },
            onViewport() {},
            setInputs() {},
            suspend() {},
            resume() {},
            stop() {},
          };
        },
      });
      const dark = () => document.documentElement.classList.contains("dark");
      const chart = new Vela(hostRef.current, {
        symbol,
        timeframe: "1",
        data: paintRef.current.bars.map(toVelaBar),
        live: false,
        height,
        theme: dark() ? "dark" : "light",
        priceStyle: "candles",
        volume: false,
        drawings: false,
      });
      chartRef.current = chart;
      indicatorRef.current = chart.addNativeIndicator(type);
      const observer = new MutationObserver(() => chart.setTheme(dark() ? "dark" : "light"));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      cleanup = () => {
        observer.disconnect();
        chart.destroy();
        unregisterNativeIndicator(type);
        chartRef.current = null;
        indicatorRef.current = null;
      };
      await chart.ready();
      if (!disposed) setReady(true);
    })().catch(() => {
      if (!disposed) setError("The MarketLab replay chart could not be rendered.");
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [symbol, height]);

  const lastBarsRef = useRef<CompactBar[] | null>(null);
  const lastPaintKeyRef = useRef<string>("");
  const flushingRef = useRef(false);

  const flush = async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (chartRef.current) {
        const paint = paintRef.current;
        if (lastBarsRef.current === paint.bars && lastPaintKeyRef.current === paint.paintKey) break;
        if (lastBarsRef.current !== paint.bars) {
          lastBarsRef.current = paint.bars;
          await chartRef.current.setMarket({ data: paint.bars.map(toVelaBar) });
          lastPaintKeyRef.current = paintRef.current.paintKey;
        } else {
          lastPaintKeyRef.current = paint.paintKey;
          const indicator = indicatorRef.current;
          if (indicator && typeRef.current) {
            indicator.remove();
            indicatorRef.current = chartRef.current.addNativeIndicator(typeRef.current);
          }
        }
      }
    } catch {
      setError("The MarketLab replay chart could not be updated.");
    } finally {
      flushingRef.current = false;
    }
  };

  useEffect(() => {
    if (ready) void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, bars, events, basket, cursorMs]);

  return (
    <figure>
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{ height }}
        aria-busy={!ready && !error}
      >
        {!ready && !error && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-muted/20 text-sm text-muted-foreground"
            role="status"
          >
            Preparing MarketLab replay…
          </div>
        )}
        <div ref={hostRef} className={`h-full ${ready ? "journal-replay-reveal" : "invisible"}`} />
      </div>
      <figcaption className="mt-1.5 px-1 text-xs text-muted-foreground">
        Derived M1 candles from the qualified Dukascopy cache. Execution, risk and boundary
        annotations are the authoritative LEAN events, revealed only up to the replay cursor.
      </figcaption>
    </figure>
  );
}
