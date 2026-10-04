import assert from "node:assert/strict";

const utc = (time) => time.replace("T", " ").replace(".000Z", "Z");
export const accountText = (r) => ({
  Balance: r.balance,
  Equity: r.equity,
  "Floating P/L": r.floatingObservable ? r.floatingProfit : "not observable at this sample",
  "Realized P/L": r.realizedProfit,
  "Used margin": r.usedMargin,
  "Free margin": r.freeMargin,
  "Margin level": r.marginLevelPercent === null ? "not defined" : `${r.marginLevelPercent}%`,
  "Open positions": String(r.openPositions),
  "Gross exposure (lots)": r.grossLots,
  "Net exposure (lots, signed)": r.netLots,
});

// Specification-based DOM assertions. Decimal strings never pass through Number.
export function compare(state, source) {
  const cursor = Date.parse(state.cursor.replace(" ", "T"));
  assert.ok(Number.isFinite(cursor));
  const cap = state.occurrence;
  const expected = source.events.filter(
    (e) => Date.parse(e.time) <= cursor && (cap === null || e.id <= cap),
  );
  assert.deepEqual(
    state.events.map((e) => e.id),
    expected.map((e) => e.id),
    "exact occurrence prefix (missing/reordered/future event)",
  );
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const rendered = state.events[i];
    assert.equal(rendered.type, e.type);
    assert.equal(rendered.time, `${utc(e.time)} · ${e.type}`, "exact execution/event timestamp");
    const title = rendered.title;
    if (e.type === "entry_executed")
      assert.equal(
        title,
        `#${e.tradeNumber} ${e.side} ${e.placedLot} lots @ ${e.fillPrice} (${e.regime})`,
      );
    if (e.type === "forced_liquidation")
      assert.equal(
        title,
        `Forced close ${e.ordinal}: #${e.tradeNumber} ${e.side} ${e.placedLot} @ ${e.closePrice} · realized ${e.realizedProfit}`,
      );
    if (e.type === "hard_breakeven_activated")
      assert.equal(title, `Hard-BE activated · lower ${e.lowerTarget} · upper ${e.upperTarget}`);
    if (e.type === "stop_out_triggered")
      assert.equal(
        title,
        `Stop Out ${e.reason} · margin level ${e.marginLevelPercent}% · ${e.openPositions} open`,
      );
    if (e.type.startsWith("margin_call_"))
      assert.equal(
        title,
        `Margin Call ${e.type.endsWith("entered") ? "entered" : "left"} · level ${e.marginLevelPercent}%`,
      );
    if (e.type === "strategy_exit")
      assert.equal(
        title,
        `Strategy exit ${e.reason} · realized ${e.realizedProfit} · liquidated ${e.liquidatedRealizedProfit}`,
      );
    if (e.type === "basket_anchored")
      assert.equal(title, `Basket anchored @ ${e.anchor} · upper ${e.upper} · lower ${e.lower}`);
  }
  const exitVisible = expected.some((e) => e.type === "strategy_exit");
  assert.equal(
    state.outcome,
    exitVisible ? "closed (escape)" : "replay in progress",
    "causal exit outcome",
  );
  if (exitVisible) {
    assert.ok(
      state.closeSummary.includes(`Basket #276 closed · Escape · ${utc(source.exit.time)}`),
    );
    assert.ok(
      state.closeSummary.includes(
        `BUY close ${source.exit.buyClosePrice} (${source.exit.buyLots} lots)`,
      ),
    );
    assert.ok(
      state.closeSummary.includes(
        `SELL close ${source.exit.sellClosePrice} (${source.exit.sellLots} lots)`,
      ),
    );
    assert.ok(state.closeSummary.includes(`Lifetime basket result ${source.exit.realizedProfit}`));
    assert.ok(state.closeSummary.includes(source.exit.liquidatedRealizedProfit));
  } else assert.equal(state.closeSummary, "", "close time/price/result must not be exposed early");
  if (!state.syncing) {
    const row = cap === null ? source.accountAt(cursor) : source.snapshots.get(cap);
    if (row) {
      for (const [label, value] of Object.entries(accountText(row)))
        assert.equal(state.account[label], value, `exact ${label}`);
      assert.equal(state.accountTime, utc(row.time));
      assert.equal(state.quote, String(row.quoteSequence));
      assert.equal(state.snapshotId, row.kind === "event" ? row.eventId : null);
      assert.equal(state.marginCallActive, row.marginCallActive);
    } else
      assert.ok(!Object.hasOwn(state.account, "Balance"), "no other basket/pre-anchor account");
  } else
    assert.ok(!Object.hasOwn(state.account, "Balance"), "no stale account while synchronizing");
  if (expected.some((e) => e.type === "basket_anchored")) {
    assert.ok(state.header.includes(`Anchor ${source.anchor.anchor}`));
    for (const field of ["upper", "lower", "lowerTarget", "upperTarget"])
      assert.ok(state.header.includes(source.anchor[field]));
  } else assert.equal(state.header, "");
  return true;
}

export function failurePaths(state, source) {
  const cases = {
    missing_entry: (v) =>
      v.events.splice(
        v.events.findIndex((e) => e.type === "entry_executed"),
        1,
      ),
    reordered_entry: (v) => {
      const i = v.events.findIndex((e) => e.type === "entry_executed");
      [v.events[i], v.events[i + 1]] = [v.events[i + 1], v.events[i]];
    },
    wrong_trade_identity: (v) => {
      v.events.find((e) => e.type === "entry_executed").title =
        "#999 Sell 0.10 lots @ 1499.868 (Arithmetic)";
    },
    wrong_side: (v) => {
      const e = v.events.find((e) => e.type === "entry_executed");
      e.title = e.title.replace("Sell", "Buy");
    },
    wrong_entry_price: (v) => {
      const e = v.events.find((e) => e.type === "entry_executed");
      e.title = e.title.replace("1499.868", "1499.869");
    },
    wrong_entry_time: (v) => {
      v.events.find((e) => e.type === "entry_executed").time =
        "2020-03-16 15:48:53.367Z · entry_executed";
    },
    missing_stop_out: (v) =>
      v.events.splice(
        v.events.findIndex((e) => e.type === "stop_out_triggered"),
        1,
      ),
    missing_liquidation: (v) =>
      v.events.splice(
        v.events.findIndex((e) => e.type === "forced_liquidation"),
        1,
      ),
    reordered_liquidation: (v) => {
      const i = v.events.findIndex((e) => e.type === "forced_liquidation");
      [v.events[i], v.events[i + 1]] = [v.events[i + 1], v.events[i]];
    },
    wrong_liquidation_price: (v) => {
      const e = v.events.find((e) => e.type === "forced_liquidation");
      e.title = e.title.replace("1506.182", "1506.183");
    },
    incorrect_account: (v) => {
      v.account.Equity = "0";
    },
    incorrect_signed_net: (v) => {
      v.account["Net exposure (lots, signed)"] = "-99.00";
    },
    stale_account: (v) => {
      v.account = accountText(source.snapshots.get(1323));
    },
    future_leak: (v) => {
      v.cursor = "2020-03-23 12:06:00Z";
    },
    early_normal_exit: (v) => {
      v.events = v.events.filter((e) => e.type !== "strategy_exit");
      v.cursor = "2020-04-13 18:24:00Z";
    },
  };
  return Object.entries(cases).map(([name, mutate]) => {
    const copy = structuredClone(state);
    mutate(copy);
    assert.throws(() => compare(copy, source), undefined, `${name} must fail acceptance`);
    return { name, rejected: true };
  });
}
