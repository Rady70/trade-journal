// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { PrivacyProvider } from "../src/components/privacy";
import type {
  BasketSummary,
  CompactBar,
  ReplayEventView,
  ReplayWindowResponse,
} from "../src/lib/marketlab-replay";

const vela = vi.hoisted(() => ({
  setMarket: vi.fn(),
  destroy: vi.fn(),
  addNativeIndicator: vi.fn(() => ({ remove: vi.fn() })),
  setTheme: vi.fn(),
  ready: vi.fn(),
}));
vi.mock("@luxalgo/vela", () => ({
  Vela: class {
    ready = vela.ready;
    setMarket = vela.setMarket;
    destroy = vela.destroy;
    addNativeIndicator = vela.addNativeIndicator;
    setTheme = vela.setTheme;
  },
  registerNativeIndicator: vi.fn(),
  unregisterNativeIndicator: vi.fn(),
}));
const { MarketlabReplay } = await import("../src/components/marketlab-replay");
const { buildReplayPaint } = await import("../src/components/marketlab-replay-chart");

const MINUTE = 60_000;
const WINDOW_START = Date.parse("2024-01-01T00:00:00.000Z");
const WINDOW_END = Date.parse("2024-01-01T00:20:00.000Z");
const minuteMs = (minute: number, second = 0) =>
  Date.parse("2024-01-01T00:00:00.000Z") + minute * MINUTE + second * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const basket: BasketSummary = {
  number: 1,
  status: "liquidated",
  exitReason: "BrokerLiquidation",
  anchorTime: iso(minuteMs(2)),
  anchorTimeMs: minuteMs(2),
  anchorQuoteSequence: 10,
  anchor: "100.0",
  step: "1",
  upper: "101.0",
  lower: "99.0",
  lowerTarget: "90.0",
  upperTarget: "110.0",
  lastLiveTimeMs: minuteMs(6),
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  entries: 1,
  forcedLiquidations: 1,
  stopOutEpisodes: 1,
  marginCallEntries: 0,
  hardBreakevenActivations: 1,
  liveRejections: 0,
  tradeNumbers: [1],
};

const view = (
  id: number,
  type: string,
  time: string,
  payload: Record<string, unknown>,
): ReplayEventView => ({
  id,
  type: type as ReplayEventView["type"],
  time,
  timeMs: Date.parse(time),
  live: true,
  payload: { type, time, id, ...payload },
});

const events: ReplayEventView[] = [
  view(2, "basket_anchored", iso(minuteMs(2)), { basket: 1, anchor: "100.0" }),
  view(3, "entry_executed", iso(minuteMs(3)), {
    basket: 1,
    tradeNumber: 1,
    side: "Buy",
    placedLot: "0.10",
    fillPrice: "99.5",
    regime: "Arithmetic",
  }),
  view(4, "hard_breakeven_activated", iso(minuteMs(4)), { basket: 1, tradeNumber: 2 }),
  view(5, "stop_out_triggered", iso(minuteMs(5)), {
    basket: 1,
    reason: "MarginLevel",
    marginLevelPercent: "17.0",
    openPositions: 1,
  }),
  view(6, "forced_liquidation", `${iso(minuteMs(5)).slice(0, 17)}30.000Z`, {
    basket: 1,
    ordinal: 1,
    tradeNumber: 1,
    side: "Buy",
    placedLot: "0.10",
    closePrice: "98.2",
    realizedProfit: "-100.0",
  }),
  view(7, "basket_liquidated", iso(minuteMs(6)), {
    basket: 1,
    reason: "BrokerLiquidation",
    realizedProfit: "-100.0",
  }),
];

const accountRow = (
  time: string,
  balance: string,
  eventId: number | null,
  marginCallActive = false,
): ReplayWindowResponse["account"][number] => ({
  kind: eventId === null ? "periodic" : "event",
  eventId,
  time,
  timeMs: Date.parse(time),
  quoteSequence: 1,
  balance,
  equity: balance,
  floatingProfit: "0.00000",
  floatingObservable: true,
  realizedProfit: "0.00000",
  usedMargin: "0.00000",
  freeMargin: balance,
  marginLevelPercent: "500.000000000000000000000000",
  marginCallActive,
  openPositions: 1,
  grossLots: "0.10",
  absoluteNetLots: "0.10",
});

const bar = (minute: number): CompactBar => [
  minuteMs(minute),
  100 + minute,
  100.5 + minute,
  99.5 + minute,
  100.2 + minute,
  10,
];

const chunkOne: ReplayWindowResponse = {
  fromMs: WINDOW_START,
  toMs: minuteMs(4),
  bars: [bar(0), bar(1), bar(2), bar(3)],
  account: [
    accountRow(iso(minuteMs(1)), "1000.00000", 1),
    { ...accountRow(iso(minuteMs(2, 30)), "995.00000", null), floatingObservable: false },
    accountRow(iso(minuteMs(3, 30)), "990.00000", null),
  ],
  nextFromMs: minuteMs(4),
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  candleCache: { contract: "c", manifestSha256: "m", contentSha256: "x" },
};
const chunkTwo: ReplayWindowResponse = {
  fromMs: minuteMs(4),
  toMs: minuteMs(8),
  bars: [bar(4), bar(5), bar(6), bar(7)],
  account: [
    accountRow(iso(minuteMs(3, 30)), "990.00000", null),
    accountRow(iso(minuteMs(5, 30)), "880.00000", 6, true),
    accountRow(iso(minuteMs(6)), "880.00000", 7),
  ],
  nextFromMs: null,
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  candleCache: { contract: "c", manifestSha256: "m", contentSha256: "x" },
};

const loadWindow = vi.fn(async (fromMs: number) => (fromMs >= minuteMs(4) ? chunkTwo : chunkOne));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("journal-privacy-v1", "false");
  for (const mock of Object.values(vela)) mock.mockClear();
  vela.setMarket.mockResolvedValue(undefined);
  vela.ready.mockResolvedValue(undefined);
  vela.addNativeIndicator.mockReturnValue({ remove: vi.fn() });
  loadWindow.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.localStorage.clear();
});

const renderReplay = async () =>
  act(async () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(
          PrivacyProvider,
          null,
          createElement(MarketlabReplay, { basket, events, loadWindow }),
        ),
      ),
    ),
  );
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const feed = () => container.textContent ?? "";

it("reveals authoritative events only up to the cursor and syncs the exported account state", async () => {
  await renderReplay();
  expect(loadWindow).toHaveBeenCalledWith(WINDOW_START);
  expect(feed()).not.toContain("#1 Buy");
  expect(feed()).not.toContain("Forced close");
  expect(feed()).toContain("1000.00000");

  await act(async () => button("Next candle").click());
  expect(feed()).not.toContain("#1 Buy");
  expect(feed()).toContain("Basket anchored @ 100.0");

  await act(async () => button("Next candle").click());
  expect(feed()).toContain("#1 Buy 0.10 lots @ 99.5");

  await act(async () => button("Next candle").click());
  expect(feed()).not.toContain("Stop Out MarginLevel");

  await act(async () => button("Next candle").click());
  expect(loadWindow).toHaveBeenCalledWith(minuteMs(4));
  expect(feed()).toContain("Stop Out MarginLevel");
  expect(feed()).not.toContain("Forced close");

  await act(async () => button("Next candle").click());
  expect(feed()).toContain("Forced close 1: #1 Buy 0.10 @ 98.2");
  expect(feed()).toContain("Basket liquidated");
  expect(feed()).toContain("880.00000");
});

it("restarts to the first candle without revealing future events", async () => {
  await renderReplay();
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  expect(feed()).toContain("Forced close");
  await act(async () => button("Restart replay").click());
  expect(feed()).not.toContain("Forced close");
  expect(feed()).not.toContain("#1 Buy");
  expect(feed()).toContain("1000.00000");
});

it("keeps candle context when scrubbing to the end of the window", async () => {
  await renderReplay();
  const input = container.querySelector<HTMLInputElement>('[aria-label="Replay position"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "1000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(loadWindow).toHaveBeenLastCalledWith(Math.max(WINDOW_START, WINDOW_END - 6 * 60 * 60_000));
  expect(feed()).toContain("Forced close 1: #1 Buy 0.10 @ 98.2");
  expect(feed()).not.toContain("No derived candles available at the cursor.");
});

it("does not reveal the basket outcome or future totals before the cursor", async () => {
  await renderReplay();
  expect(feed()).toContain("replay in progress");
  expect(feed()).not.toContain("liquidated (BrokerLiquidation)");
  expect(feed()).toContain("authoritative events revealed");
  expect(feed()).not.toMatch(/\/\s*\d+\s*significant/);
  for (let index = 0; index < 6; index += 1) {
    await act(async () => button("Next candle").click());
  }
  expect(feed()).toContain("liquidated (BrokerLiquidation)");
});

it("shows exact exported margin levels and marks a non-observable floating P/L", async () => {
  await renderReplay();
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  expect(feed()).toContain("not observable at this sample");
  expect(feed()).toContain("500.000000000000000000000000%");
});

it("destroys the Vela chart and unregisters the indicator on unmount", async () => {
  const local = document.createElement("div");
  document.body.append(local);
  const localRoot = createRoot(local);
  await act(async () =>
    localRoot.render(
      createElement(
        TooltipProvider,
        null,
        createElement(
          PrivacyProvider,
          null,
          createElement(MarketlabReplay, { basket, events, loadWindow }),
        ),
      ),
    ),
  );
  expect(vela.addNativeIndicator).toHaveBeenCalled();
  expect(vela.setMarket).toHaveBeenCalled();
  const lastData = vela.setMarket.mock.calls.at(-1)?.[0] as { data: unknown[] };
  expect(lastData.data.length).toBeGreaterThan(0);
  await act(async () => localRoot.unmount());
  expect(vela.destroy).toHaveBeenCalled();
  local.remove();
});

it("builds chart annotations only from revealed events", () => {
  const bars = [bar(0), bar(1), bar(2), bar(3), bar(4), bar(5), bar(6)];
  const beforeAnchor = buildReplayPaint({
    bars: bars.slice(0, 1),
    events: [],
    basket,
    cursorMs: minuteMs(1),
    paintKey: "a",
  });
  expect(beforeAnchor.priceLines ?? []).toHaveLength(0);
  const atEntry = buildReplayPaint({
    bars: bars.slice(0, 3),
    events: events.slice(0, 2),
    basket,
    cursorMs: minuteMs(3),
    paintKey: "b",
  });
  expect((atEntry.labels ?? []).some((label) => label.text?.includes("#1 BUY"))).toBe(true);
  expect((atEntry.labels ?? []).some((label) => label.text?.includes("LIQ"))).toBe(false);
  expect((atEntry.priceLines ?? []).some((line) => line.id === "marketlab-anchor")).toBe(true);
  expect((atEntry.priceLines ?? []).some((line) => line.id === "marketlab-upper")).toBe(true);
  // Far hard-BE targets are not drawn across the pane while the candles are far away.
  expect((atEntry.priceLines ?? []).some((line) => line.id === "marketlab-hard-lower")).toBe(false);
  const nearTarget = buildReplayPaint({
    bars: [[minuteMs(0), 90.5, 91, 90, 90.8, 1]],
    events: [],
    basket,
    cursorMs: minuteMs(3),
    paintKey: "d",
  });
  expect((nearTarget.priceLines ?? []).some((line) => line.id === "marketlab-hard-lower")).toBe(
    true,
  );
  expect((nearTarget.priceLines ?? []).some((line) => line.id === "marketlab-anchor")).toBe(false);
  const atLiquidation = buildReplayPaint({
    bars,
    events,
    basket,
    cursorMs: minuteMs(6),
    paintKey: "c",
  });
  expect((atLiquidation.labels ?? []).some((label) => label.text?.includes("STOP OUT"))).toBe(true);
  expect((atLiquidation.labels ?? []).some((label) => label.text?.includes("LIQ 1"))).toBe(true);
  expect((atLiquidation.priceLines ?? []).some((line) => line.id === "marketlab-upper")).toBe(true);
});
