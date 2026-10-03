// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { PrivacyProvider } from "../src/components/privacy";
import type {
  AccountRow,
  BasketIdentity,
  CompactBar,
  ReplayEventView,
  ReplayRevealResponse,
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

const basket: BasketIdentity = {
  number: 1,
  anchorTime: iso(minuteMs(2)),
  anchorTimeMs: minuteMs(2),
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
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
  view(2, "basket_anchored", iso(minuteMs(2)), {
    basket: 1,
    anchor: "100.0",
    step: "1",
    upper: "101.0",
    lower: "99.0",
    lowerTarget: "90.0",
    upperTarget: "110.0",
  }),
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
  view(6, "forced_liquidation", "2024-01-01T00:05:30.000Z", {
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
): AccountRow => ({
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
  netLots: "-0.10",
  absoluteNetLots: "0.10",
});

const accounts: AccountRow[] = [
  accountRow(iso(minuteMs(1)), "1000.00000", 1),
  { ...accountRow(iso(minuteMs(2, 30)), "995.00000", null), floatingObservable: false },
  accountRow(iso(minuteMs(3, 30)), "990.00000", null),
  accountRow(iso(minuteMs(5, 30)), "880.00000", 6, true),
  accountRow(iso(minuteMs(6)), "880.00000", 7),
];

const bar = (minute: number): CompactBar => [
  minuteMs(minute),
  100 + minute,
  100.5 + minute,
  99.5 + minute,
  100.2 + minute,
  10,
];

const carryRow = (cursorMs: number): AccountRow | null => {
  const eligible = accounts.filter((row) => row.timeMs <= cursorMs);
  return eligible.length > 0 ? eligible[eligible.length - 1]! : null;
};

const chunkOne: ReplayWindowResponse = {
  fromMs: WINDOW_START,
  toMs: minuteMs(4),
  bars: [bar(0), bar(1), bar(2), bar(3)],
  nextFromMs: minuteMs(4),
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  account: carryRow(WINDOW_START),
  candleCache: { contract: "c", manifestSha256: "m", contentSha256: "x" },
};
const mergedChunk: ReplayWindowResponse = {
  fromMs: WINDOW_START,
  toMs: minuteMs(8),
  bars: [bar(0), bar(1), bar(2), bar(3), bar(4), bar(5), bar(6), bar(7)],
  nextFromMs: null,
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  account: carryRow(WINDOW_START),
  candleCache: { contract: "c", manifestSha256: "m", contentSha256: "x" },
};

const reveal = (eventList: ReplayEventView[]) =>
  vi.fn(async (afterEventId: number, cursorMs: number): Promise<ReplayRevealResponse> => {
    const batch = eventList.filter(
      (event) => event.id > afterEventId && event.timeMs !== null && event.timeMs <= cursorMs,
    );
    return {
      events: batch,
      account: carryRow(cursorMs),
      hasMore: false,
      lastEventId: batch.length > 0 ? batch[batch.length - 1]!.id : afterEventId,
    };
  });

const loadWindow = vi.fn(async (fromMs: number) =>
  fromMs >= minuteMs(4) ? mergedChunk : chunkOne,
);
const loadReveal = reveal(events);

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
  loadReveal.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.localStorage.clear();
});

const renderReplay = async (
  replayBasket: BasketIdentity = basket,
  overrides: {
    window?: typeof loadWindow;
    reveal?: typeof loadReveal;
  } = {},
) =>
  act(async () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(
          PrivacyProvider,
          null,
          createElement(MarketlabReplay, {
            basket: replayBasket,
            loadWindow: overrides.window ?? loadWindow,
            loadReveal: overrides.reveal ?? loadReveal,
          }),
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
  expect(loadReveal).toHaveBeenCalledWith(0, minuteMs(1));
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
  expect(loadWindow).toHaveBeenCalledWith(WINDOW_START);
  expect(feed()).toContain("Stop Out MarginLevel");
  expect(feed()).not.toContain("Forced close");

  await act(async () => button("Next candle").click());
  expect(feed()).toContain("Forced close 1: #1 Buy 0.10 @ 98.2");
  expect(feed()).toContain("Basket liquidated");
  expect(feed()).toContain("880.00000");
});

it("restarts to the first candle without revealing future events", async () => {
  await renderReplay();
  for (let index = 0; index < 5; index += 1) {
    await act(async () => button("Next candle").click());
  }
  expect(feed()).toContain("Forced close");
  await act(async () => button("Restart replay").click());
  expect(feed()).not.toContain("Forced close");
  expect(feed()).not.toContain("#1 Buy");
  expect(feed()).toContain("1000.00000");
});

it("keeps revealed history when stepping across a chunk boundary with context", async () => {
  let calls = 0;
  const contextLoader = vi.fn(async (_fromMs: number) => {
    calls += 1;
    return calls === 1 ? chunkOne : mergedChunk;
  });
  await renderReplay(basket, { window: contextLoader });
  for (let index = 0; index < 3; index += 1) {
    await act(async () => button("Next candle").click());
  }
  expect(feed()).not.toContain("Stop Out MarginLevel");
  await act(async () => button("Next candle").click());
  expect(contextLoader).toHaveBeenCalledWith(WINDOW_START);
  expect(feed()).toContain("Stop Out MarginLevel");
  const lastData = vela.setMarket.mock.calls.at(-1)?.[0] as { data: unknown[] };
  expect(lastData.data.length).toBeGreaterThanOrEqual(5);
});

it("does not reveal the basket outcome or future totals before the cursor", async () => {
  await renderReplay();
  expect(feed()).toContain("replay in progress");
  expect(feed()).not.toContain("liquidated (BrokerLiquidation)");
  expect(feed()).toContain("authoritative events revealed");
  expect(feed()).not.toMatch(/\/\s*\d+\s*significant/);
  for (let index = 0; index < 5; index += 1) {
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

it("labels an unresolved final basket open at run end only at the run end", async () => {
  const openBasket: BasketIdentity = { ...basket, windowEndMs: minuteMs(6) };
  const openEvents = events.slice(0, 4);
  await renderReplay(openBasket, { reveal: reveal(openEvents) });
  await act(async () => button("Next candle").click());
  await act(async () => button("Next candle").click());
  expect(feed()).toContain("replay in progress");
  expect(feed()).not.toContain("open at run end");
  await act(async () => button("Reveal the full basket window").click());
  expect(feed()).toContain("open at run end");
});

it("advances the final open basket to the authoritative run end without a final candle", async () => {
  const runEndMs = minuteMs(6, 59);
  const openBasket: BasketIdentity = { ...basket, windowEndMs: runEndMs };
  const openEvents = events.slice(0, 4);
  const terminalChunk: ReplayWindowResponse = {
    fromMs: minuteMs(4),
    toMs: minuteMs(6),
    bars: [bar(4), bar(5)],
    nextFromMs: null,
    windowStartMs: WINDOW_START,
    windowEndMs: runEndMs,
    account: null,
    candleCache: { contract: "c", manifestSha256: "m", contentSha256: "x" },
  };
  const loader = vi.fn(async (fromMs: number) =>
    fromMs >= minuteMs(4) ? terminalChunk : chunkOne,
  );
  await renderReplay(openBasket, { window: loader, reveal: reveal(openEvents) });
  for (let index = 0; index < 8; index += 1) {
    await act(async () => button("Next candle").click());
  }
  expect(feed()).toContain("open at run end");
  expect(button("Next candle").disabled).toBe(true);
});

it("shows the account as synchronizing until the reveal for the current cursor arrives", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = vi.fn(async (afterEventId: number, cursorMs: number) => {
    if (cursorMs === minuteMs(2)) await gate;
    const batch = events.filter(
      (event) => event.id > afterEventId && event.timeMs !== null && event.timeMs <= cursorMs,
    );
    return {
      events: batch,
      account: carryRow(cursorMs),
      hasMore: false,
      lastEventId: batch.length > 0 ? batch[batch.length - 1]!.id : afterEventId,
    };
  });
  await renderReplay(basket, { reveal: delayed });
  expect(feed()).toContain("1000.00000");
  await act(async () => button("Next candle").click());
  // The cursor moved to minute 2 but its reveal is still in flight: the old
  // account row must not be presented as the state at the new cursor.
  expect(feed()).toContain("Synchronizing the exported account state at the cursor");
  expect(feed()).not.toContain("1000.00000");
  await act(async () => {
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(feed()).not.toContain("Synchronizing the exported account state at the cursor");
});

it("never shows open at run end while the terminal reveal of a closed basket is pending", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = vi.fn(async (afterEventId: number, cursorMs: number) => {
    if (cursorMs >= WINDOW_END) await gate;
    const batch = events.filter(
      (event) => event.id > afterEventId && event.timeMs !== null && event.timeMs <= cursorMs,
    );
    return {
      events: batch,
      account: carryRow(cursorMs),
      hasMore: false,
      lastEventId: batch.length > 0 ? batch[batch.length - 1]!.id : afterEventId,
    };
  });
  await renderReplay(basket, { reveal: delayed });
  await act(async () => button("Reveal the full basket window").click());
  // The cursor is at the window end but the terminal reveal is still in
  // flight: the closed basket must not be presented as open at run end.
  expect(feed()).not.toContain("open at run end");
  expect(feed()).toContain("replay in progress");
  await act(async () => {
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(feed()).toContain("liquidated (BrokerLiquidation)");
  expect(feed()).not.toContain("open at run end");
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
          createElement(MarketlabReplay, { basket, loadWindow, loadReveal }),
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
    events: [events[0]!],
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

it("renders an undefined margin level as not defined instead of a percentage", () => {
  const stopOut = view(5, "stop_out_triggered", iso(minuteMs(5)), {
    basket: 1,
    reason: "NegativeEquity",
    marginLevelPercent: null,
    openPositions: 1,
  });
  const paint = buildReplayPaint({
    bars: [bar(4), bar(5)],
    events: [stopOut],
    basket,
    cursorMs: minuteMs(6),
    paintKey: "e",
  });
  const stopOutLabel = (paint.labels ?? []).find((label) => label.text?.includes("STOP OUT"));
  expect(stopOutLabel?.text).toContain("not defined");
  expect(stopOutLabel?.text).not.toContain("—%");
});
