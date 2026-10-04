import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { source, packageHash, candleHash, resultsHash, evidenceHash } from "./source.mjs";
import { accountText, compare, failurePaths } from "./compare.mjs";

const require = createRequire(
  process.env.BROWSER_MODULE_ROOT ??
    "C:/Users/non_s/AppData/Local/Temp/opencode/marketlab-ui-validation/package.json",
);
const puppeteer = require("puppeteer-core");
const s = source();
const app = process.env.APP_URL ?? "http://127.0.0.1:4321";
const out =
  process.env.OUT_DIR ?? new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const mode = process.argv[2] ?? "baseline";
const report = {
  mode,
  platform: process.platform,
  started: new Date().toISOString(),
  packageHash,
  candleHash,
  resultsHash,
  evidenceHash,
  counts: s.counts,
  checks: [],
  observations: [],
  errors: [],
};
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  defaultViewport: { width: 1432, height: 900 },
  args: [
    "--no-first-run",
    "--disable-extensions",
    "--start-maximized",
    "--remote-debugging-port=9333",
  ],
});
const page = await browser.newPage();
report.browser = await browser.version();
report.browserMode = "headless installed Edge, actual local Next.js application";
report.runtimeSourceLfSha256 = Object.fromEntries(
  [
    "apps/web/src/components/marketlab-replay.tsx",
    "apps/web/src/components/marketlab-replay-chart.tsx",
    "apps/web/src/server/marketlab-replay.ts",
    "apps/web/src/lib/marketlab-replay.ts",
    "apps/web/src/app/backtests/page.tsx",
    "apps/web/src/app/api/marketlab-replay/baskets/[number]/reveal/route.ts",
  ].map((path) => [
    path,
    createHash("sha256").update(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).digest("hex"),
  ]),
);
page.on("pageerror", (e) => report.errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text) => {
  const handle = await page.evaluateHandle(
    (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label),
    text,
  );
  assert.ok(handle.asElement(), `button ${text}`);
  await handle.evaluate((element) => element.click());
  await handle.dispose();
};
const state = () =>
  page.evaluate(() => {
    const text = document.body.innerText;
    return {
      text,
      cursor: text.match(/Cursor through ([\d-]+ [\d:.]+Z)/)?.[1],
      events: [...document.querySelectorAll("[data-marketlab-event-id]")].map((e) => ({
        id: +e.dataset.marketlabEventId,
        type: e.dataset.marketlabEvent,
        text: e.innerText,
      })),
      account: Object.fromEntries(
        [...document.querySelectorAll("dt")].map((e) => [
          e.textContent,
          e.nextElementSibling.textContent,
        ]),
      ),
      provenance: text.match(/Exported LEAN value at [^\n]+/)?.[0],
      candles: text
        .match(/([\d,]+) \/ ([\d,]+) loaded candles/)
        ?.slice(1)
        .map((v) => +v.replaceAll(",", "")),
      syncing: text.includes("Synchronizing the exported account"),
    };
  });
const settled = () =>
  page.waitForFunction(
    () =>
      !document.body.innerText.includes("Synchronizing the exported account") &&
      !document.querySelector('button[aria-label="Restart replay"]')?.disabled,
    { timeout: 120000 },
  );
const observe = () =>
  page.evaluate(() => {
    const read = () => {
      const text = document.body.innerText;
      const match = text.match(/Cursor through ([\d-]+ [\d:.]+Z)(?: · occurrence #(\d+))?/);
      const sample =
        [...document.querySelectorAll("p")].find((p) =>
          p.textContent.startsWith("Exported LEAN value at "),
        )?.textContent ?? "";
      const header =
        [...document.querySelectorAll("p")].find((p) => p.textContent.startsWith("Anchor "))
          ?.textContent ?? "";
      return {
        cursor: match?.[1] ?? "",
        occurrence: match?.[2] ? +match[2] : null,
        events: [...document.querySelectorAll("[data-marketlab-event-id]")].map((e) => ({
          id: +e.dataset.marketlabEventId,
          type: e.dataset.marketlabEvent,
          time: e.children[0].textContent,
          title: e.children[1].textContent,
        })),
        account: Object.fromEntries(
          [...document.querySelectorAll("dt")].map((e) => [
            e.textContent,
            e.nextElementSibling.textContent,
          ]),
        ),
        syncing: text.includes("Synchronizing the exported account"),
        accountTime: sample.match(/at ([\d-]+ [\d:.]+Z)/)?.[1] ?? null,
        quote: sample.match(/quote #(\d+)/)?.[1] ?? null,
        snapshotId: sample.match(/event snapshot #(\d+)/)?.[1]
          ? +sample.match(/event snapshot #(\d+)/)[1]
          : null,
        marginCallActive: sample.includes("Margin Call active"),
        header,
        closeSummary:
          document.querySelector('[aria-label="Authoritative basket close"]')?.textContent ?? "",
        outcome: text.toLowerCase().match(/basket #276 · ([^\n]+)/)?.[1] ?? "",
        candles: +(text.match(/([\d,]+) \/ [\d,]+ loaded candles/)?.[1] ?? "0").replaceAll(",", ""),
        playing: [...document.querySelectorAll("button")].some(
          (button) => button.textContent.trim() === "Pause",
        ),
        hidden: document.hidden,
      };
    };
    window.__phaseG = {
      read,
      occurrences: [],
      accounts: [],
      lastAccount: "",
      last: "",
      candleSamples: [],
      futureFailures: [],
    };
    const observer = new MutationObserver(() => {
      const value = read();
      if (!value.cursor) return;
      const key = `${value.cursor}|${value.occurrence}|${value.syncing}|${value.snapshotId}`;
      if (window.__phaseG.last === key) return;
      window.__phaseG.last = key;
      const cursor = Date.parse(value.cursor.replace(" ", "T"));
      for (const event of value.events) {
        if (
          Date.parse(event.time.split(" · ")[0].replace(" ", "T")) > cursor ||
          (value.occurrence !== null && event.id > value.occurrence)
        )
          window.__phaseG.futureFailures.push({ cursor: value.cursor, event });
      }
      if (value.syncing && Object.hasOwn(value.account, "Balance"))
        window.__phaseG.futureFailures.push({ staleAccount: true });
      if (!value.syncing && value.occurrence !== null) window.__phaseG.occurrences.push(value);
      const accountKey = `${value.accountTime}|${value.quote}|${value.snapshotId}|${value.occurrence}`;
      if (!value.syncing && value.accountTime && window.__phaseG.lastAccount !== accountKey) {
        window.__phaseG.lastAccount = accountKey;
        window.__phaseG.accounts.push({
          cursor: value.cursor,
          occurrence: value.occurrence,
          account: value.account,
          accountTime: value.accountTime,
          quote: value.quote,
          snapshotId: value.snapshotId,
          marginCallActive: value.marginCallActive,
        });
      }
      if (
        window.__phaseG.candleSamples.length < 8 ||
        window.__phaseG.candleSamples.at(-1).candles < value.candles - 3000
      )
        window.__phaseG.candleSamples.push({ cursor: value.cursor, candles: value.candles });
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.__phaseG.observer = observer;
  });
const exactState = () => page.evaluate(() => window.__phaseG.read());
// A forward step holds the old cursor until its event/account commit arrives.
// Wait for identity, including occurrence id for consecutive same-time closes.
const navigate = async (label) => {
  const before = await exactState();
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForFunction(
    (previous) => {
      const current = window.__phaseG.read();
      return current.cursor !== previous.cursor || current.occurrence !== previous.occurrence;
    },
    { timeout: 120000 },
    { cursor: before.cursor, occurrence: before.occurrence },
  );
  await settled();
};
const scrub = async (fraction) => {
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
  await wait(300);
  await settled();
};
try {
  console.log("Opening real Edge application", new Date().toISOString());
  await page.goto(`${app}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => {
    document.title = "Phase G qualification — leave controls untouched";
  });
  await page.waitForFunction(
    () => document.body.innerText.toLowerCase().includes("authoritative package provenance"),
    { timeout: 180000 },
  );
  const status = await (await fetch(`${app}/api/marketlab-replay`)).json();
  console.log("Verified application status; selecting Basket #276");
  assert.equal(status.package.packageSha256, packageHash);
  assert.equal(status.candles.contentSha256, candleHash);
  const basket = status.baskets.find((b) => b.number === 276);
  assert.deepEqual(
    Object.keys(basket).sort(),
    ["anchorTime", "anchorTimeMs", "number", "windowEndMs", "windowStartMs"].sort(),
  );
  await page.click('button[aria-label="SingleAnchor basket"]');
  await page.waitForSelector('[role="option"]');
  const option = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[role="option"]')].find((e) => e.textContent.includes("#276")),
  );
  await option.evaluate((element) => element.click());
  await page.waitForFunction(
    () =>
      document.body.innerText.toLowerCase().includes("basket #276") &&
      document.body.innerText.includes("loaded candles"),
    { timeout: 180000 },
  );
  await settled();
  console.log("Basket #276 opened");
  const start = await state();
  assert.equal(start.events.length, 0);
  assert.ok(!start.text.includes("Anchor 1503.750"));
  assert.ok(start.text.toLowerCase().includes("replay in progress"));
  report.layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  report.checks.push("Basket #276 opened; pre-anchor events, levels, outcome and account hidden");
  if (mode === "baseline") {
    const minute = Date.parse("2020-03-23T12:06:00.000Z");
    await scrub(
      Math.floor(
        ((minute - basket.windowStartMs) / (basket.windowEndMs - basket.windowStartMs)) * 1000,
      ),
    );
    let before = await state();
    for (let i = 0; i < 70 && !before.events.some((e) => e.type === "forced_liquidation"); i++) {
      await page.click('button[aria-label="Next candle"]');
      await settled();
      const after = await state();
      if (after.events.some((e) => e.type === "forced_liquidation")) {
        report.observations.push({
          before: {
            cursor: before.cursor,
            account: before.account,
            eventIds: before.events.map((e) => e.id),
          },
          after: {
            cursor: after.cursor,
            account: after.account,
            provenance: after.provenance,
            newEvents: after.events.filter((e) => !before.events.some((b) => b.id === e.id)),
          },
        });
        assert.equal(after.events.filter((e) => e.type === "forced_liquidation").length, 30);
        assert.equal(after.account["Open positions"], "6");
        assert.notEqual(after.account.Balance, s.snapshots.get(1324).balance);
        await page.screenshot({ path: `${out}/baseline-skipped-liquidation-states.png` });
        report.result =
          "FAIL acceptance: one Next/Play candle step reveals all four Stop Outs and all 30 liquidations, skipping 29 intermediate post-liquidation account rows";
        break;
      }
      before = after;
    }
    assert.ok(report.observations.length);
  } else {
    await observe();
    compare(await exactState(), s);
    // Natural browser viewport: no forced off-screen emulated viewport.
    assert.ok(
      report.layout.scrollWidth <= report.layout.clientWidth + 1,
      "no horizontal page overflow",
    );
    await clickText("Play");
    console.log("Testing Play/Pause at 4x");
    await wait(1600);
    await clickText("Pause");
    await settled();
    const paused = await exactState();
    await wait(500);
    assert.equal((await exactState()).cursor, paused.cursor);
    compare(paused, s);
    report.checks.push("4× Play advances; Pause holds the cursor");
    await page.click('button[aria-label="Restart replay"]');
    await wait(300);
    await settled();
    compare(await exactState(), s);
    await page.screenshot({ path: `${out}/01-basket-276-start.png`, fullPage: true });
    console.log("Restart passed; selecting 64x");
    await page.click('button[aria-label="Replay speed"]');
    await page.waitForSelector('[role="option"]');
    const speed = await page.evaluateHandle(() =>
      [...document.querySelectorAll('[role="option"]')].find((e) => e.textContent.trim() === "64×"),
    );
    await speed.evaluate((element) => element.click());
    await page.waitForFunction(() =>
      document.querySelector('button[aria-label="Replay speed"]')?.textContent.includes("64×"),
    );
    await page.evaluate(() => {
      window.__phaseG.occurrences = [];
      window.__phaseG.accounts = [];
      window.__phaseG.lastAccount = "";
    });
    await clickText("Play");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Pause",
      ),
    );
    console.log("Continuous lifecycle Play started", new Date().toISOString());
    const deadline = Date.now() + 2400000;
    let closed = false;
    let lastLog = 0;
    while (Date.now() < deadline) {
      const current = await exactState();
      if (current.outcome === "closed (escape)") {
        closed = true;
        break;
      }
      if (Date.now() - lastLog > 30000) {
        console.log("Play progress", current.cursor, current.events.length);
        writeFileSync(
          "C:/Users/non_s/AppData/Local/Temp/opencode/phase-g-heartbeat.json",
          JSON.stringify({
            cursor: current.cursor,
            events: current.events.length,
            playing: current.playing,
            hidden: current.hidden,
            date: new Date().toISOString(),
          }),
        );
        lastLog = Date.now();
      }
      await wait(200);
    }
    assert.ok(
      closed,
      "continuous Play reaches the Escape close within the qualification time bound",
    );
    await clickText("Pause");
    await settled();
    const played = await page.evaluate(() => ({
      occurrences: window.__phaseG.occurrences,
      accounts: window.__phaseG.accounts,
      candleSamples: window.__phaseG.candleSamples,
      futureFailures: window.__phaseG.futureFailures,
    }));
    assert.deepEqual(played.futureFailures, []);
    const occurrences = [...new Map(played.occurrences.map((v) => [v.occurrence, v])).values()];
    assert.deepEqual(
      occurrences.map((v) => v.occurrence),
      s.events.map((e) => e.id),
      "Play must visit every authoritative occurrence, not jump to an end state",
    );
    for (const value of occurrences) compare(value, s);
    const accountDigest = createHash("sha256");
    let periodicComparisons = 0;
    for (const value of played.accounts) {
      const row =
        value.occurrence === null
          ? s.accountAt(Date.parse(value.cursor.replace(" ", "T")))
          : s.snapshots.get(value.occurrence);
      assert.ok(row);
      for (const [label, expected] of Object.entries(accountText(row)))
        assert.equal(
          value.account[label],
          expected,
          `periodic/event exact ${label} at ${value.cursor}`,
        );
      assert.equal(value.accountTime.replace(" ", "T"), row.time.replace(".000Z", "Z"));
      assert.equal(value.quote, String(row.quoteSequence));
      assert.equal(value.snapshotId, row.eventId);
      assert.equal(value.marginCallActive, row.marginCallActive);
      if (row.kind === "periodic") periodicComparisons++;
      accountDigest.update(
        JSON.stringify({
          cursor: value.cursor,
          occurrence: value.occurrence,
          row: accountText(row),
          time: row.time,
          quote: row.quoteSequence,
          eventId: row.eventId,
        }) + "\n",
      );
    }
    report.accountComparisons = {
      observedRowTransitions: played.accounts.length,
      periodicComparisons,
      exactFieldComparisons: played.accounts.length * 10,
      sequenceSha256: accountDigest.digest("hex"),
      failures: 0,
    };
    report.observations = occurrences.map((v) => ({
      id: v.occurrence,
      cursor: v.cursor,
      event: v.events.at(-1),
      account: Object.fromEntries(
        Object.entries(v.account).filter(([k]) =>
          [
            "Balance",
            "Equity",
            "Floating P/L",
            "Realized P/L",
            "Used margin",
            "Free margin",
            "Margin level",
            "Open positions",
            "Gross exposure (lots)",
            "Net exposure (lots, signed)",
          ].includes(k),
        ),
      ),
      accountTime: v.accountTime,
      quote: v.quote,
      snapshotId: v.snapshotId,
      marginCallActive: v.marginCallActive,
      candles: v.candles,
    }));
    report.candleSamples = played.candleSamples;
    report.checks.push(
      "64× continuous Play from Restart visits all 117 event occurrences with exact DOM event values and exact bound account snapshots",
    );
    const end = await exactState();
    compare(end, s);
    report.failurePaths = failurePaths(end, s);
    await page.waitForSelector(".journal-replay-reveal", { timeout: 120000 });
    assert.equal(await page.$$eval('[role="alert"]', (nodes) => nodes.length), 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    report.endLayout = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    assert.ok(report.endLayout.scrollWidth <= report.endLayout.clientWidth + 1);
    assert.ok(
      report.endLayout.scrollHeight <= report.endLayout.clientHeight + 1,
      "collapsed-provenance replay, controls and account/event panels fit the tested screen",
    );
    await page.screenshot({ path: `${out}/02-escape-close.png`, fullPage: true });
    // Scrub backwards before the stress minute, then step through every risk
    // occurrence. These are actual supported browser controls, not API cursor edits.
    const minute = Date.parse("2020-03-23T12:06:00.000Z");
    await scrub(
      Math.floor(
        ((minute - basket.windowStartMs) / (basket.windowEndMs - basket.windowStartMs)) * 1000,
      ),
    );
    compare(await exactState(), s);
    let checked = new Set();
    for (let i = 0; i < 180; i++) {
      await navigate("Next candle");
      const current = await exactState();
      compare(current, s);
      const event = s.events.find((e) => e.id === current.occurrence);
      if (event?.type === "forced_liquidation") checked.add(event.id);
      if (
        event?.type === "stop_out_triggered" ||
        (event?.type === "forced_liquidation" && [1324, 1343, 1354, 1358, 1362].includes(event.id))
      ) {
        await page.screenshot({ path: `${out}/risk-${event.id}.png`, fullPage: true });
      }
      if (checked.size === 30) break;
    }
    assert.equal(checked.size, 30);
    const last = await exactState();
    await navigate("Previous candle");
    const backward = await exactState();
    compare(backward, s);
    assert.equal(backward.events.filter((e) => e.type === "forced_liquidation").length, 0);
    await navigate("Next candle");
    compare(await exactState(), s);
    report.checks.push(
      "Backward scrub, Next through all 30 liquidations, Previous before the risk minute, and Next again remain occurrence/account coherent",
    );
    report.navigation = {
      lastLiquidation: { cursor: last.cursor, snapshotId: last.snapshotId },
      backward: { cursor: backward.cursor, snapshotId: backward.snapshotId },
    };
    await page.click('button[aria-label="Reveal the full basket window"]');
    await wait(300);
    await settled();
    compare(await exactState(), s);
    report.checks.push(
      "Full-window navigation retains the basket close snapshot rather than another basket's account",
    );
    await page.click('button[aria-label="Restart replay"]');
    await wait(300);
    await settled();
    compare(await exactState(), s);
    report.checks.push(
      "Restart after full-history navigation removes future events, account and levels",
    );
    assert.deepEqual(report.errors, []);
    report.result = "PASS: Basket #276 Phase G local browser acceptance";
  }
} catch (e) {
  report.failure = String(e);
  report.failureStack = e.stack;
  try {
    await page.screenshot({ path: `${out}/failure-${mode}.png` });
  } catch {}
} finally {
  report.ended = new Date().toISOString();
  writeFileSync(`${out}/${mode}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.failure) throw new Error(report.failure);
console.log(report.result ?? "PASS");
