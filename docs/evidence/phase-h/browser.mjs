import { createRequire } from "node:module";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { source, packageHash, candleHash, resultsHash, evidenceHash } from "./source.mjs";
import { accountText } from "../phase-g/compare.mjs";

assert.equal(process.platform, "win32");
const require = createRequire(
  process.env.BROWSER_MODULE_ROOT ??
    "C:/Users/non_s/AppData/Local/Temp/opencode/marketlab-ui-validation/package.json",
);
const puppeteer = require("puppeteer-core");
const s = source();
const app = process.env.APP_URL ?? "http://127.0.0.1:4321";
const out = new URL(".", import.meta.url);
const prior = new URL("browser.json", out);
const attemptsFile = new URL("attempts.json", out);
if (existsSync(prior)) {
  const old = JSON.parse(readFileSync(prior, "utf8"));
  const attempts = existsSync(attemptsFile) ? JSON.parse(readFileSync(attemptsFile, "utf8")) : [];
  attempts.push({
    started: old.started,
    ended: old.ended,
    result: old.result,
    failure: old.failure,
    checks: old.checks.length,
    jumps: old.jumps.length,
  });
  writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
}
const report = {
  started: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  packageHash,
  candleHash,
  resultsHash,
  evidenceHash,
  checks: [],
  jumps: [],
  windows: [],
  errors: [],
};
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  defaultViewport: { width: 1432, height: 900 },
  args: ["--no-first-run", "--disable-extensions"],
});
report.browser = await browser.version();
const page = await browser.newPage();
page.on("pageerror", (e) => report.errors.push(String(e)));
const pending = new Set();
page.on("response", (response) => {
  if (!response.url().includes("/window?")) return;
  const work = (async () => {
    if (response.ok()) {
      const bytes = await response.buffer();
      const data = JSON.parse(bytes);
      assert.ok(data.bars.length <= 12000);
      assert.equal(data.candleCache.contentSha256, candleHash);
      report.windows.push({
        url: response.url().replace(app, ""),
        bytes: bytes.length,
        bars: data.bars.length,
        first: data.bars[0]?.[0],
        last: data.bars.at(-1)?.[0],
      });
    }
  })();
  pending.add(work);
  work.finally(() => pending.delete(work));
});
const api = async (path) => {
  const began = performance.now();
  const response = await fetch(`${app}/api/marketlab-replay${path}`);
  const bytes = await response.text();
  assert.equal(response.status, 200, bytes);
  return {
    data: JSON.parse(bytes),
    bytes: Buffer.byteLength(bytes),
    ms: performance.now() - began,
  };
};
const click = async (text) => {
  const handle = await page.evaluateHandle(
    (t) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === t && b.getClientRects().length,
      ),
    text,
  );
  assert.ok(handle.asElement(), text);
  await handle.evaluate((e) => e.click());
  await handle.dispose();
};
const waitOverview = () =>
  page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Run baskets"]')?.getClientRects().length &&
      ![...document.querySelectorAll('[role="status"]')].some((e) => e.getClientRects().length),
    { timeout: 120000 },
  );
const settle = () =>
  page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Restart replay"]') &&
      !document.querySelector('[aria-label="Restart replay"]').disabled &&
      !document.body.innerText.includes("Synchronizing the exported account"),
    { timeout: 120000 },
  );
const filter = async (value) => {
  const current = await page.$eval('select[aria-label="Run activity filter"]', (e) => e.value);
  if (current === value) {
    await page.select(
      'select[aria-label="Run activity filter"]',
      value === "all" ? "stop-out" : "all",
    );
    await waitOverview();
  }
  await page.select('select[aria-label="Run activity filter"]', value);
  await waitOverview();
};
const overview = async () => {
  await click("Return to run overview");
  await waitOverview();
};
const read = () =>
  page.evaluate(() => {
    const text = document.body.innerText;
    const cursor = text.match(/Cursor through ([\d-]+ [\d:.]+Z)(?: · occurrence #(\d+))?/);
    const sample = [...document.querySelectorAll("p")].find((e) =>
      e.textContent.startsWith("Exported LEAN value at "),
    )?.textContent;
    return {
      cursor: cursor?.[1],
      occurrence: cursor?.[2] ? Number(cursor[2]) : null,
      ids: [...document.querySelectorAll("[data-marketlab-event-id]")].map((e) =>
        Number(e.dataset.marketlabEventId),
      ),
      account: Object.fromEntries(
        [...document.querySelectorAll('[aria-label="Replay cursor account"] dt')].map((e) => [
          e.textContent,
          e.nextElementSibling.textContent,
        ]),
      ),
      snapshot: sample?.match(/event snapshot #(\d+)/)?.[1],
      text,
      candles: Number((text.match(/\/ ([\d,]+) loaded candles/)?.[1] ?? "0").replaceAll(",", "")),
    };
  });
const navigate = async (label) => {
  const before = await read();
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForFunction(
    (prior) => {
      const m = document.body.innerText.match(
        /Cursor through ([\d-]+ [\d:.]+Z)(?: · occurrence #(\d+))?/,
      );
      return m && (m[1] !== prior.cursor || (m[2] ? Number(m[2]) : null) !== prior.occurrence);
    },
    { timeout: 120000 },
    { cursor: before.cursor, occurrence: before.occurrence },
  );
  await settle();
};
const exact = async (number, event) => {
  await page.waitForFunction(
    (id) => document.body.innerText.includes(`occurrence #${id} ·`),
    { timeout: 120000 },
    event.id,
  );
  await settle();
  const state = await read();
  assert.equal(state.occurrence, event.id);
  assert.equal(Date.parse(state.cursor.replace(" ", "T")), Date.parse(event.time));
  assert.deepEqual(
    state.ids,
    s.expectedPrefix(number, event.id).map((e) => e.id),
  );
  assert.equal(Number(state.snapshot), event.id);
  assert.deepEqual(state.account, accountText(s.snapshots.get(event.id)));
  assert.ok(state.candles <= 12000);
  assert.ok(!state.text.includes("replay package was rejected"));
  report.jumps.push({
    basket: number,
    id: event.id,
    type: event.type,
    time: event.time,
    snapshot: Number(state.snapshot),
    revealed: state.ids.length,
    loadedCandles: state.candles,
  });
  if (event.id === 1324 || event.id === s.runEnd.id)
    await page.screenshot({
      path: fileURLToPath(
        new URL(event.id === 1324 ? "exact-liquidation-jump.png" : "final-open.png", out),
      ),
    });
  return state;
};
let manifest;
const jump = async (id, kind = "all", year = "") => {
  await filter(kind);
  await click(year || "All years");
  await waitOverview();
  const { data } = await api(
    `/run?view=timeline&source=${manifest}&filter=${kind}${year ? `&year=${year}` : ""}`,
  );
  let target = data.items.find((e) => e.id === id);
  let offset = data.nextOffset;
  while (!target && offset !== null) {
    await page.click('button[aria-label="Timeline next page"]');
    await waitOverview();
    const result = await api(
      `/run?view=timeline&source=${manifest}&filter=${kind}&offset=${offset}${year ? `&year=${year}` : ""}`,
    );
    target = result.data.items.find((e) => e.id === id);
    offset = result.data.nextOffset;
  }
  assert.ok(target, `timeline target ${id}`);
  await page.click(`button[aria-label="Jump to occurrence ${id}"]`);
  return exact(
    target.basket,
    s.events.find((e) => e.id === id),
  );
};
try {
  const status = (await api("")).data;
  assert.equal(status.package.packageSha256, packageHash);
  assert.equal(status.candles.contentSha256, candleHash);
  manifest = status.package.manifestSha256;
  const summary = await api("/run");
  assert.deepEqual((await api("?index=0")).data.baskets, []);
  const end = s.runEnd;
  for (const [key, value] of Object.entries(summary.data.counters)) assert.equal(value, end[key]);
  assert.equal(summary.data.finalAccount.balance, s.snapshots.get(end.id).balance);
  assert.equal(summary.data.basketCount, 280);
  assert.deepEqual(summary.data.openBaskets, [280]);
  report.summary = summary.data;
  report.summaryPayloadBytes = summary.bytes;
  await page.goto(`${app}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitOverview();
  assert.ok(
    (await page.$eval('[aria-label="Authoritative run summary"]', (e) => e.innerText)).includes(
      "-20090.41800",
    ),
  );
  await page.screenshot({ path: fileURLToPath(new URL("overview.png", out)) });
  const allBaskets = [];
  const pages = [];
  let offset = 0;
  do {
    const result = await api(`/run?view=baskets&source=${manifest}&offset=${offset}`);
    const ids = await page.$$eval("[data-run-basket]", (elements) =>
      elements.map((e) => Number(e.dataset.runBasket)),
    );
    assert.deepEqual(
      ids,
      result.data.items.map((b) => b.number),
    );
    assert.ok(ids.length <= 40);
    allBaskets.push(...ids);
    pages.push({ offset, bytes: result.bytes, ms: result.ms, count: ids.length });
    offset = result.data.nextOffset;
    if (offset !== null) {
      await page.click('button[aria-label="Basket next page"]');
      await waitOverview();
    }
  } while (offset !== null);
  assert.deepEqual(
    allBaskets,
    s.baskets.map((b) => b.number),
  );
  report.basketPages = pages;
  report.checks.push("All seven browser table pages match all 280 authoritative basket identities");
  for (const [value, types, count] of [
    ["stop-out", ["stop_out_triggered"], 5],
    ["margin-call", ["margin_call_entered", "margin_call_left"], 46],
    ["forced-liquidation", ["forced_liquidation"], 65],
    ["strategy-exit", ["strategy_exit"], 278],
  ]) {
    await filter(value);
    const baskets = (await api(`/run?view=baskets&source=${manifest}&filter=${value}`)).data;
    if (value !== "strategy-exit")
      assert.deepEqual(
        baskets.items.map((b) => b.number),
        [276, 279],
      );
    const timeline = [];
    let next = 0;
    do {
      const result = (
        await api(`/run?view=timeline&source=${manifest}&filter=${value}&offset=${next}`)
      ).data;
      const dom = await page.$$eval("[data-run-occurrence]", (elements) =>
        elements.map((e) => Number(e.dataset.runOccurrence)),
      );
      assert.deepEqual(
        dom,
        result.items.map((e) => e.id),
      );
      timeline.push(...dom);
      next = result.nextOffset;
      if (next !== null) {
        await page.click('button[aria-label="Timeline next page"]');
        await waitOverview();
      }
    } while (next !== null);
    assert.equal(timeline.length, count);
    assert.deepEqual(
      timeline,
      s.events.filter((e) => types.includes(e.type)).map((e) => e.id),
    );
    report.checks.push(
      `${value}: ${count} exact occurrences, browser pagination/identities match raw source`,
    );
  }
  await filter("all");
  await page.click('input[aria-label="Include all live occurrences"]');
  await waitOverview();
  const live = [];
  let next = 0;
  do {
    const result = (await api(`/run?view=timeline&source=${manifest}&all=1&offset=${next}`)).data;
    const dom = await page.$$eval("[data-run-occurrence]", (elements) =>
      elements.map((e) => Number(e.dataset.runOccurrence)),
    );
    assert.deepEqual(
      dom,
      result.items.map((e) => e.id),
    );
    live.push(...dom);
    next = result.nextOffset;
    if (next !== null) {
      await page.click('button[aria-label="Timeline next page"]');
      await waitOverview();
    }
  } while (next !== null);
  assert.deepEqual(
    live,
    s.events.filter((e) => e.time).map((e) => e.id),
  );
  report.liveTimelineOccurrences = live.length;
  await page.click('input[aria-label="Include all live occurrences"]');
  await waitOverview();
  // Representative ordinary/boundary/partial/full/open contexts, all from real export.
  const ordinaryEscape = s.baskets.find((b) => b.close?.reason === "Escape" && b.number !== 276);
  for (const number of [1, 5, 6, ordinaryEscape.number, 276, 279, 280]) {
    await filter(number >= 276 && number !== 280 ? "stop-out" : "all");
    if (number === 280) {
      for (let i = 0; i < 6; i++) {
        await page.click('button[aria-label="Basket next page"]');
        await waitOverview();
      }
    } else if (number > 40 && number < 276) {
      for (let i = 0; i < Math.floor((number - 1) / 40); i++) {
        await page.click('button[aria-label="Basket next page"]');
        await waitOverview();
      }
    }
    await click(`Open #${number}`);
    await settle();
    const state = await read();
    assert.equal(state.ids.length, 0);
    assert.ok(!Object.hasOwn(state.account, "Balance"));
    assert.ok(
      state.text.toLowerCase().includes(`basket #${number} · replay in progress`),
      state.text,
    );
    assert.ok(!state.text.includes("Lifetime basket result"));
    report.checks.push(`Basket #${number}: direct table navigation, pre-anchor causal hiding`);
    await overview();
    await filter("all");
  }
  // Major-event jumps, including same-time liquidation/account states.
  const candidates = [
    s.events[0],
    s.baskets[0].anchor,
    s.baskets[0].events.find((e) => e.type === "trailing_activated"),
    s.baskets[0].close,
    ordinaryEscape.close,
    s.events.find((e) => e.type === "hard_breakeven_activated" && e.basket === 276),
    s.events.find((e) => e.type === "margin_call_entered"),
    s.events.find((e) => e.type === "margin_call_left"),
    ...s.events.filter((e) => e.type === "stop_out_triggered"),
    ...s.events.filter((e) => e.type === "forced_liquidation" && [1324, 1325, 1447].includes(e.id)),
    s.baskets.find((b) => b.number === 276).close,
    s.baskets.find((b) => b.number === 279).close,
    ...s.events.filter((e) => e.type === "entry_rejected"),
    s.runEnd,
  ].filter(Boolean);
  for (const event of candidates) {
    const kind =
      event.type === "forced_liquidation"
        ? "forced-liquidation"
        : event.type === "stop_out_triggered"
          ? "stop-out"
          : event.type.startsWith("margin_call_")
            ? "margin-call"
            : "all";
    const state = await jump(event.id, kind, event.time.slice(0, 4));
    if (event.type === "forced_liquidation" && event.id === 1324) {
      await navigate("Next candle");
      await exact(
        276,
        s.events.find((e) => e.id === 1325),
      );
      await navigate("Previous candle");
      const previous = await read();
      assert.ok(!previous.ids.some((id) => id >= 1323));
      assert.ok(!previous.text.includes("Lifetime basket result"));
      for (let i = 0; i < 100 && (await read()).occurrence !== 1323; i++) {
        await navigate("Next candle");
        const forward = await read();
        assert.ok(forward.occurrence === null || forward.occurrence <= 1323);
        if (forward.occurrence !== null)
          await exact(
            276,
            s.events.find((e) => e.id === forward.occurrence),
          );
      }
      await exact(
        276,
        s.events.find((e) => e.id === 1323),
      );
      report.checks.push(
        "Exact jump followed by Next/Previous/Next hides cached future same-time liquidations",
      );
    }
    if (event.id === s.runEnd.id) {
      assert.ok(state.text.toLowerCase().includes("open at run end"));
      assert.ok(!state.text.includes("Lifetime basket result"));
    }
    await overview();
  }
  // Empty event years still have truthful navigation, not fabricated events.
  await filter("all");
  await click("2024");
  await waitOverview();
  assert.equal(await page.$$eval("[data-run-occurrence]", (e) => e.length), 0);
  await click("2026");
  await waitOverview();
  await page.$eval('[aria-label="Run chronological events"]', (e) =>
    e.scrollIntoView({ block: "center" }),
  );
  await page.screenshot({ path: fileURLToPath(new URL("timeline-run-end.png", out)) });
  // Scrub the long anchored-but-unfunded basket across distant calendar dates.
  await filter("all");
  for (let i = 0; i < 6; i++) {
    await page.click('button[aria-label="Basket next page"]');
    await waitOverview();
  }
  await click("Open #280");
  await settle();
  const identity = status.baskets.find((b) => b.number === 280);
  report.distantDates = [];
  for (const date of [
    "2021-06-15T12:00:00.000Z",
    "2024-06-15T12:00:00.000Z",
    "2026-06-29T12:00:00.000Z",
  ]) {
    const priorCursor = (await read()).cursor;
    const fraction = Math.round(
      ((Date.parse(date) - identity.windowStartMs) /
        (identity.windowEndMs - identity.windowStartMs)) *
        1000,
    );
    await page.$eval(
      'input[aria-label="Replay position"]',
      (input, f) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
          input,
          String(f),
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      fraction,
    );
    await page.waitForFunction(
      (prior) =>
        document.body.innerText.includes("Cursor through") &&
        !document.body.innerText.includes(`Cursor through ${prior}`),
      {},
      priorCursor,
    );
    await settle();
    const current = await read();
    assert.ok(current.candles <= 12000);
    assert.ok(!current.text.includes("Lifetime basket result"));
    const latest = s.rows
      .filter((row) => Date.parse(row.time) <= Date.parse(current.cursor.replace(" ", "T")))
      .at(-1);
    assert.deepEqual(current.account, accountText(latest));
    report.distantDates.push({
      requested: date,
      cursor: current.cursor,
      candles: current.candles,
      accountSnapshot: current.snapshot,
    });
  }
  await page.$eval('input[aria-label="SingleAnchor basket number"]', (input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "6");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Open basket");
  await settle();
  assert.equal((await read()).ids.length, 0);
  report.checks.push(
    "Direct basket-number navigation from distant Basket #280 to ordinary Basket #6 is causal",
  );
  await page.$eval('input[aria-label="SingleAnchor basket number"]', (input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "999999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Open basket");
  await page.waitForFunction(() =>
    document.body.innerText.includes("not present in the replay package"),
  );
  assert.equal(await page.$('[aria-label="Restart replay"]'), null);
  report.checks.push("Unavailable basket fails closed with no stale replay");
  await Promise.all([...pending]);
  report.invalidRequests = [];
  for (const path of [
    `/run?view=baskets&source=${"0".repeat(64)}`,
    `/run?view=timeline&source=${manifest}&filter=unknown`,
    `/baskets/1?event=1323&source=${manifest}`,
    `/baskets/276/reveal?after=0&cursor=1584965186293&event=1323&source=${manifest}`,
  ]) {
    const result = await page.evaluate(async (path) => {
      const r = await fetch(`/api/marketlab-replay${path}`);
      return { status: r.status, body: await r.json() };
    }, path);
    assert.ok(result.status >= 400);
    assert.ok(result.body.error);
    assert.ok(!result.body.items && !result.body.events);
    report.invalidRequests.push({ path, ...result });
  }
  assert.equal(report.errors.length, 0);
  report.maxWindowBars = Math.max(...report.windows.map((w) => w.bars));
  report.maxWindowBytes = Math.max(...report.windows.map((w) => w.bytes));
  assert.ok(report.maxWindowBars <= 12000);
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.failure = String(error.stack);
  throw error;
} finally {
  report.ended = new Date().toISOString();
  writeFileSync(new URL("browser.json", out), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(
    JSON.stringify({
      result: report.result,
      checks: report.checks.length,
      jumps: report.jumps.length,
      failure: report.failure,
    }),
  );
}
