import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = process.env.APP_URL ?? "http://127.0.0.1:4321";
const mode = process.argv[2] ?? "valid";
const outDir = process.env.OUT_DIR ?? ".";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-extensions", "--window-size=1600,1200"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("response", (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
});

const bodyText = () => page.evaluate(() => document.body.innerText);
const waitForText = (needle, timeout = 120000) =>
  page.waitForFunction(
    (text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()),
    { timeout },
    needle,
  );
const clickButtonByText = async (text) => {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`button "${text}" not found`);
};
const readBalance = () => readAccountValue("Balance");
const readAccountValue = (label) =>
  page.evaluate((name) => {
    const dt = [...document.querySelectorAll("dt")].find((el) => el.textContent === name);
    return dt?.nextElementSibling?.textContent ?? null;
  }, label);
const transcript = { mode, app: APP, steps: [], consoleErrors, pageErrors };

try {
  await page.goto(`${APP}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  if (mode === "invalid") {
    await waitForText("The configured replay package was rejected");
    const text = (await bodyText()).toLowerCase();
    if (!text.includes("sha-256")) throw new Error("invalid-package error did not mention SHA-256");
    if (text.includes("authoritative package provenance"))
      throw new Error("invalid package still rendered a replay");
    await page.screenshot({ path: `${outDir}\\04-invalid-package.png`, fullPage: true });
    transcript.steps.push({ check: "invalid package rejected with a clear reason", pass: true });
  } else {
    await waitForText("Authoritative package provenance");
    transcript.steps.push({
      check: "backtests surface loaded with package provenance",
      pass: true,
    });
    await page.screenshot({ path: `${outDir}\\01-backtests-landing.png`, fullPage: true });

    const status = await (await fetch(`${APP}/api/marketlab-replay`)).json();
    const basket = status.baskets.find((candidate) => candidate.number === 276);
    for (const forbidden of [
      "entries",
      "status",
      "anchor",
      "step",
      "upper",
      "lower",
      "lowerTarget",
      "upperTarget",
    ]) {
      if (Object.prototype.hasOwnProperty.call(basket, forbidden))
        throw new Error(`the basket index exposes pre-cursor ${forbidden}`);
    }
    for (const forbidden of ["eventCounts", "telemetryCounts", "outcome", "counters", "files"]) {
      if (status.package && Object.prototype.hasOwnProperty.call(status.package, forbidden))
        throw new Error(`the status payload exposes future ${forbidden}`);
    }
    const revealAll = await (
      await fetch(
        `${APP}/api/marketlab-replay/baskets/276/reveal?after=0&cursor=${basket.windowEndMs}`,
      )
    ).json();
    const authoritative = {
      entries: revealAll.events.filter((event) => event.type === "entry_executed").length,
      forced: revealAll.events.filter((event) => event.type === "forced_liquidation").length,
      stopOuts: revealAll.events.filter((event) => event.type === "stop_out_triggered").length,
      exits: revealAll.events.filter((event) => event.type === "strategy_exit").length,
    };
    transcript.package = {
      packageSha256: status.package.packageSha256,
      candlesContentSha256: status.candles.contentSha256,
      compatibility: status.compatibility,
      basket276: authoritative,
    };

    await page.click('button[aria-label="SingleAnchor basket"]');
    await page.waitForSelector('[role="option"]', { timeout: 30000 });
    const selected = await page.evaluate(() => {
      const option = [...document.querySelectorAll('[role="option"]')].find((candidate) =>
        candidate.textContent?.includes("#276"),
      );
      if (!option) return false;
      option.click();
      return true;
    });
    if (!selected) throw new Error("basket #276 option not found");
    await waitForText("Basket #276");
    await waitForText("Exported LEAN value", 180000);
    await sleep(500);
    await page.screenshot({ path: `${outDir}\\02-basket-276-start.png`, fullPage: true });
    transcript.steps.push({
      check: "selected basket #276 from the authoritative basket list",
      pass: true,
    });
    const startText = (await bodyText()).toLowerCase();
    if (!startText.includes("replay in progress"))
      throw new Error("the basket outcome is visible before the replay reaches it");
    if (
      !startText.includes("authoritative events revealed") ||
      /\/\s*\d+\s*significant/.test(startText)
    )
      throw new Error("the replay shows future event totals");

    let revealedEntry = false;
    for (let index = 0; index < 80; index += 1) {
      await page.click('button[aria-label="Next candle"]');
      await sleep(60);
      if ((await bodyText()).includes("#1 Sell 0.10 lots @ 1499.868")) {
        revealedEntry = true;
        break;
      }
    }
    if (!revealedEntry) throw new Error("entry #1 was not revealed by stepping the cursor");
    const beforeLiquidation = await bodyText();
    if (beforeLiquidation.includes("Forced close"))
      throw new Error("forced liquidation was visible before the cursor reached it");
    const revealedForced = await page.$$eval(
      '[data-marketlab-event="forced_liquidation"]',
      (els) => els.length,
    );
    if (revealedForced !== 0)
      throw new Error(`expected 0 revealed forced liquidations, saw ${revealedForced}`);
    // The signed net exposure on screen must equal the exported row in force at
    // the same cursor.
    const panelNet = await readAccountValue("Net exposure (lots, signed)");
    const netCursorText = (await bodyText()).match(/Cursor through ([\d-]+ [\d:]+Z)/)?.[1];
    if (netCursorText) {
      const netCursorMs = Date.parse(netCursorText.replace(" ", "T"));
      const netReveal = await (
        await fetch(
          `${APP}/api/marketlab-replay/baskets/276/reveal?after=0&cursor=${netCursorMs}`,
        )
      ).json();
      if (panelNet !== netReveal.account?.netLots) {
        throw new Error(
          `panel signed net ${panelNet} does not match exported ${netReveal.account?.netLots} at ${netCursorText}`,
        );
      }
    }
    transcript.steps.push({
      check: "progressive reveal: entry visible, forced liquidation still hidden, signed net matches export",
      pass: true,
      panelSignedNet: panelNet,
    });
    await page.screenshot({ path: `${outDir}\\02b-entry-revealed.png`, fullPage: true });

    const cursorBefore = (await bodyText()).match(/Cursor through ([^\n·]+)/)?.[1] ?? null;
    await clickButtonByText("Play");
    await sleep(2500);
    await clickButtonByText("Pause");
    const cursorAfter = (await bodyText()).match(/Cursor through ([^\n·]+)/)?.[1] ?? null;
    if (!cursorAfter || cursorAfter === cursorBefore)
      throw new Error(`Play did not advance the cursor (${cursorBefore} -> ${cursorAfter})`);
    transcript.steps.push({
      check: "Play advances the cursor; Pause stops it",
      pass: true,
      cursorBefore,
      cursorAfter,
    });

    await page.click('button[aria-label="Restart replay"]');
    await sleep(600);
    const restarted = await bodyText();
    if (restarted.includes("#1 Sell") || restarted.includes("Forced close"))
      throw new Error("Restart did not rewind to the first candle");
    transcript.steps.push({ check: "Restart rewinds without future events", pass: true });

    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Replay position"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "1000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForText("Forced close 1:", 120000);
    await waitForText("Strategy exit Escape", 120000);
    await sleep(1000);
    if (!(await bodyText()).toLowerCase().includes("closed (escape)"))
      throw new Error("the authoritative outcome is not shown after the close event is revealed");
    const counts = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[data-marketlab-event-id]")].map((el) =>
        Number(el.getAttribute("data-marketlab-event-id")),
      );
      const count = (type) => document.querySelectorAll(`[data-marketlab-event="${type}"]`).length;
      return {
        entries: count("entry_executed"),
        forced: count("forced_liquidation"),
        stopOuts: count("stop_out_triggered"),
        exits: count("strategy_exit"),
        ascending: ids.every((id, index) => index === 0 || id > ids[index - 1]),
        total: ids.length,
      };
    });
    if (counts.entries !== authoritative.entries)
      throw new Error(
        `revealed entries ${counts.entries} != authoritative ${authoritative.entries}`,
      );
    if (counts.forced !== authoritative.forced)
      throw new Error(
        `revealed forced liquidations ${counts.forced} != authoritative ${authoritative.forced}`,
      );
    if (counts.stopOuts !== authoritative.stopOuts)
      throw new Error(
        `revealed Stop Outs ${counts.stopOuts} != authoritative ${authoritative.stopOuts}`,
      );
    if (counts.exits !== authoritative.exits)
      throw new Error(`revealed strategy exits ${counts.exits} != ${authoritative.exits}`);
    if (!counts.ascending) throw new Error("revealed event ids are not in ascending package order");
    const chartState = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/([\d,]+) \/ ([\d,]+) loaded candles/);
      return {
        loaded: match?.[2] ?? null,
        revealed: match?.[1] ?? null,
        noCandles: text.includes("No derived candles available at the cursor."),
        chartReady: Boolean(document.querySelector(".journal-replay-reveal")),
      };
    });
    if (chartState.noCandles || !chartState.chartReady)
      throw new Error("the derived candle chart is not rendered at the scrubbed cursor");
    const balance = await readBalance();
    const netExposure = await readAccountValue("Net exposure (lots, signed)");

    const endReveal = await (
      await fetch(
        `${APP}/api/marketlab-replay/baskets/276/reveal?after=0&cursor=${basket.windowEndMs}`,
      )
    ).json();
    const expectedBalance = endReveal.account?.balance;
    const expectedNet = endReveal.account?.netLots;
    if (!balance || balance !== expectedBalance) {
      throw new Error(
        `account panel balance ${balance} does not match exported ${expectedBalance}`,
      );
    }
    if (!netExposure || netExposure !== expectedNet) {
      throw new Error(
        `account panel signed net exposure ${netExposure} does not match exported ${expectedNet}`,
      );
    }
    transcript.steps.push({
      check:
        "scrub reveals all authoritative events exactly once and in order; candle chart and exported balance/signed net at the cursor",
      pass: true,
      exportedBalance: expectedBalance,
      exportedNetExposure: expectedNet,
      counts,
      chartState,
    });
    await page.screenshot({ path: `${outDir}\\03-basket-276-end.png`, fullPage: true });

    // Finding 3 (real UI): the final open basket must finish through Next/Play
    // even though its last candle closes slightly before the authoritative run
    // end. The cursor is placed ~90 simulated minutes before the run end and
    // stepped; the explicit non-candle terminal step must reach run end.
    await page.click('button[aria-label="SingleAnchor basket"]');
    await page.waitForSelector('[role="option"]', { timeout: 30000 });
    const selectedOpen = await page.evaluate(() => {
      const option = [...document.querySelectorAll('[role="option"]')].find((candidate) =>
        candidate.textContent?.includes("#280"),
      );
      if (!option) return false;
      option.click();
      return true;
    });
    if (!selectedOpen) throw new Error("basket #280 option not found");
    await waitForText("Basket #280", 120000);
    await waitForText("Exported LEAN value", 180000);
    // Place the cursor about 1/1000 of the six-year window before the run end
    // (a few days) and let Play at 64x run to the last candle and then through
    // the explicit non-candle terminal step to the authoritative run end.
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Replay position"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForText("Exported LEAN value", 180000);
    await sleep(400);
    if ((await bodyText()).toLowerCase().includes("open at run end"))
      throw new Error("the open outcome is shown before the cursor reaches the run end");
    // The default replay speed is 4x; the remaining ~2 days of candles need
    // 64x to finish inside the harness budget.
    await page.click('button[aria-label="Replay speed"]');
    await page.waitForSelector('[role="option"]', { timeout: 30000 });
    const speedSelected = await page.evaluate(() => {
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === "64×",
      );
      if (!option) return false;
      option.click();
      return true;
    });
    if (!speedSelected) throw new Error("64x replay speed option not found");
    await clickButtonByText("Play");
    await waitForText("open at run end", 300000);
    const pause = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "Pause",
      );
      if (!button) return false;
      button.click();
      return true;
    });
    void pause;
    transcript.steps.push({
      check: "the final open basket finishes at run end through terminal Play progression",
      pass: true,
    });
    await page.screenshot({ path: `${outDir}\\05-basket-280-run-end.png`, fullPage: true });

    transcript.steps.push({ check: "no page errors", pass: pageErrors.length === 0, pageErrors });
  }
} catch (error) {
  transcript.failure = String(error);
  try {
    await page.screenshot({ path: `${outDir}\\failure-${mode}.png`, fullPage: true });
  } catch {}
} finally {
  transcript.consoleErrors = consoleErrors;
  transcript.pageErrors = pageErrors;
  transcript.failedRequests = failedRequests;
  writeFileSync(`${outDir}\\transcript-${mode}.json`, JSON.stringify(transcript, null, 2));
  await browser.close();
}
if (transcript.failure) {
  console.error(transcript.failure);
  process.exit(1);
}
console.log(`PASS: ${mode}`);
