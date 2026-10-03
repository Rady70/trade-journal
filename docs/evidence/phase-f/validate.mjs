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
const readBalance = () =>
  page.evaluate(() => {
    const dt = [...document.querySelectorAll("dt")].find((el) => el.textContent === "Balance");
    return dt?.nextElementSibling?.textContent ?? null;
  });
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
    transcript.package = {
      packageSha256: status.package.packageSha256,
      candlesContentSha256: status.candles.contentSha256,
      basket276: {
        entries: basket.entries,
        forced: basket.forcedLiquidations,
        stopOuts: basket.stopOutEpisodes,
        status: basket.status,
        exitReason: basket.exitReason,
      },
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
    transcript.steps.push({
      check: "progressive reveal: entry visible, forced liquidation still hidden",
      pass: true,
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
    if (counts.entries !== basket.entries)
      throw new Error(`revealed entries ${counts.entries} != authoritative ${basket.entries}`);
    if (counts.forced !== basket.forcedLiquidations)
      throw new Error(
        `revealed forced liquidations ${counts.forced} != authoritative ${basket.forcedLiquidations}`,
      );
    if (counts.stopOuts !== basket.stopOutEpisodes)
      throw new Error(
        `revealed Stop Outs ${counts.stopOuts} != authoritative ${basket.stopOutEpisodes}`,
      );
    if (counts.exits !== 1) throw new Error(`revealed strategy exits ${counts.exits} != 1`);
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

    const endWindow = await (
      await fetch(
        `${APP}/api/marketlab-replay/baskets/276/window?from=${basket.windowEndMs - 1000}`,
      )
    ).json();
    const expectedBalance = endWindow.account[endWindow.account.length - 1]?.balance;
    if (!balance || balance !== expectedBalance) {
      throw new Error(
        `account panel balance ${balance} does not match exported ${expectedBalance}`,
      );
    }
    transcript.steps.push({
      check:
        "scrub reveals all authoritative events exactly once and in order; candle chart and exported balance at the cursor",
      pass: true,
      exportedBalance: expectedBalance,
      counts,
      chartState,
    });
    await page.screenshot({ path: `${outDir}\\03-basket-276-end.png`, fullPage: true });
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
