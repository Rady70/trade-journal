import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { source, packageHash, candleHash } from "./source.mjs";
import { alternateCandleCache } from "../../../apps/web/tests/helpers/marketlab-alternate-candles.ts";

assert.equal(process.platform, "win32");
source();
const repo = process.cwd();
// Next's Windows dev resolver needs source and dependencies on the same drive.
// All snapshot/build/runtime files stay in this application's ignored cache.
assert.ok(existsSync(repo));
const cache = join(repo, ".cache");
mkdirSync(cache, { recursive: true });
const scratch = mkdtempSync(join(cache, "marketlab-phase-h-failure-"));
assert.ok(existsSync(scratch));
// Isolated source snapshot of this application's tracked/selected Phase H files,
// using the existing unchanged dependencies through Windows directory junctions.
// No user runtime, journal data, secrets, or existing development build is copied.
for (const path of execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")) {
  if (!/^(apps\/web\/|packages\/|package.json$|pnpm-|tsconfig.base.json$)/.test(path)) continue;
  const dest = join(scratch, path);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(repo, path), dest);
}
for (const path of [
  "node_modules",
  "apps/web/node_modules",
  "packages/core/node_modules",
  "packages/importers/node_modules",
]) {
  if (existsSync(join(repo, path)))
    symlinkSync(resolve(repo, path), join(scratch, path), "junction");
}
const packageCopy = join(scratch, "replay");
cpSync(process.env.MARKETLAB_REPLAY_PACKAGE, packageCopy, { recursive: true });
const require = createRequire(join(repo, "apps/web/package.json"));
const next = require.resolve("next/dist/bin/next");
const browserRequire = createRequire(
  process.env.BROWSER_MODULE_ROOT ??
    "C:/Users/non_s/AppData/Local/Temp/opencode/marketlab-ui-validation/package.json",
);
const browser = await browserRequire("puppeteer-core").launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  defaultViewport: { width: 1432, height: 900 },
});
const report = {
  platform: process.platform,
  started: new Date().toISOString(),
  cases: [],
  errors: [],
};
const oldFile = new URL("fail-closed.json", import.meta.url);
const attemptsFile = new URL("failure-attempts.json", import.meta.url);
if (existsSync(oldFile)) {
  const old = JSON.parse(readFileSync(oldFile, "utf8"));
  const attempts = existsSync(attemptsFile) ? JSON.parse(readFileSync(attemptsFile, "utf8")) : [];
  attempts.push({
    started: old.started,
    ended: old.ended,
    result: old.result,
    failure: old.failure,
    cases: old.cases.length,
    build: old.build,
    pageText: old.pageText,
  });
  writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
}
const freshPage = async () => {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  const session = await page.createCDPSession();
  await session.send("Network.enable");
  // Supported browser request blocking isolates development-only HMR reloads.
  // All application/API requests remain real and unmodified. Old contexts must
  // survive the isolated server restart to exercise stale navigation itself.
  await session.send("Network.setBlockedURLs", { urls: ["*webpack-hmr*"] });
  page.on("pageerror", (e) => report.errors.push(String(e)));
  return page;
};
let page = await freshPage();
report.developmentHmrBlocked = true;
const url = "http://127.0.0.1:4324";
let server;
let serverLogs = "";
const start = async (env) => {
  server = spawn(process.execPath, [next, "dev", "-p", "4324", "--hostname", "127.0.0.1"], {
    cwd: join(scratch, "apps/web"),
    windowsHide: true,
    env: {
      ...process.env,
      MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256: packageHash,
      MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256: candleHash,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (b) => {
    logs += b;
    serverLogs += b;
  });
  server.stderr.on("data", (b) => {
    logs += b;
    serverLogs += b;
  });
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      await fetch(`${url}/api/marketlab-replay?index=0`);
      // Compile the real page/preferences routes before browser hydration so
      // on-demand development compilation cannot interrupt its initial reads.
      await fetch(`${url}/backtests`);
      await fetch(`${url}/api/settings`);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Application did not start: ${logs}`);
};
const stop = async () => {
  if (!server || server.exitCode !== null) return;
  // Only the process tree launched by this harness is terminated.
  execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
  await new Promise((r) => setTimeout(r, 1000));
};
const rejected = async (name, expectedText) => {
  const response = await fetch(`${url}/api/marketlab-replay/run`);
  const body = await response.json();
  assert.ok(response.status >= 400);
  assert.ok(body.error.includes(expectedText));
  assert.ok(!body.counters);
  // Each independently configured rejection starts with a fresh document/cache;
  // development HMR reconnects must not carry a previous case's error screen.
  await page.close();
  page = await freshPage();
  await page.goto(`${url}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    { timeout: 180000 },
    expectedText,
  );
  assert.equal(await page.$('[aria-label="Authoritative run summary"]'), null);
  assert.equal(await page.$('[aria-label="Run baskets"]'), null);
  assert.equal(await page.$('[aria-label="Restart replay"]'), null);
  report.cases.push({
    name,
    status: response.status,
    error: body.error,
    summaryHidden: true,
    replayHidden: true,
  });
};
const staleCandles = async () => {
  const alternate = join(scratch, "alternate-candles");
  const changedHash = alternateCandleCache(process.env.MARKETLAB_CANDLE_CACHE, alternate);
  await start({});
  const accepted = await (await fetch(`${url}/api/marketlab-replay/run`)).json();
  const token = (s) => `${s.packageSha256}:${s.manifestSha256}:${s.candleContentSha256}`;
  const oldToken = token(accepted.source);
  await page.close();
  page = await freshPage();
  await page.goto(`${url}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector('[data-run-basket="1"]', { timeout: 180000 });
  const replay = await freshPage();
  await replay.goto(`${url}/backtests`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await replay.waitForSelector('[data-run-basket="1"]', { timeout: 180000 });
  const click = async (p, text) => {
    await p.bringToFront();
    await p.evaluate((t) => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === t,
      );
      if (!button) throw new Error(`Missing button ${t}`);
      button.click();
    }, text);
  };
  await click(replay, "Open #1");
  await replay.waitForFunction(
    () =>
      document.querySelector('[aria-label="Restart replay"]') &&
      !document.querySelector('[aria-label="Restart replay"]').disabled,
    { timeout: 180000 },
  );
  const beforeCursor = await replay.$eval(
    '[aria-label="Restart replay"]',
    () => document.body.innerText.match(/Cursor through [^\n]+/)[0],
  );
  // Keep both already-open browser contexts. Only the isolated server's explicitly
  // accepted cache/configuration changes; package and replay manifest stay identical.
  await stop();
  await start({
    MARKETLAB_CANDLE_CACHE: alternate,
    MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256: changedHash,
  });
  const currentResponse = await fetch(`${url}/api/marketlab-replay/run`);
  assert.equal(currentResponse.status, 200);
  const current = await currentResponse.json();
  assert.equal(current.source.packageSha256, accepted.source.packageSha256);
  assert.equal(current.source.manifestSha256, accepted.source.manifestSha256);
  assert.equal(current.source.candleContentSha256, changedHash);
  assert.notEqual(changedHash, candleHash);
  const paths = [
    "/run?view=baskets",
    "/run?view=timeline",
    "/baskets/1?event=2",
    "/baskets/1/window?from=1546383908037",
    "/baskets/1/reveal?after=0&cursor=1546383908037&event=2",
  ];
  const requests = [];
  for (const path of paths) {
    const base = `${url}/api/marketlab-replay${path}`;
    const response = await fetch(`${base}&source=${oldToken}`);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.deepEqual(body, { error: "Run navigation source identity changed; reload the run." });
    const fresh = await fetch(`${base}&source=${token(current.source)}`);
    assert.equal(fresh.status, 200, await fresh.text());
    requests.push({ path, staleStatus: response.status, freshStatus: fresh.status });
  }
  const staleResponses = [];
  const observe = (response) => {
    if (!response.url().includes("/api/marketlab-replay/")) return;
    if (response.status() === 422) {
      assert.equal(new URL(response.url()).searchParams.get("source"), oldToken);
      staleResponses.push(new URL(response.url()).pathname);
    }
  };
  page.on("response", observe);
  replay.on("response", observe);
  await click(page, "Open #1");
  const waitError = (p) =>
    p.waitForFunction(
      () =>
        document.body.innerText.includes("Run navigation source identity changed; reload the run."),
      { timeout: 120000, polling: 100 },
    );
  await waitError(page);
  assert.equal(await page.$('[aria-label="Restart replay"]'), null);
  await page.screenshot({
    path: fileURLToPath(new URL("stale-candle-navigation.png", import.meta.url)),
  });
  await replay.bringToFront();
  await replay.click('[aria-label="Next candle"]');
  await waitError(replay);
  const afterCursor = await replay.$eval(
    '[aria-label="Restart replay"]',
    () => document.body.innerText.match(/Cursor through [^\n]+/)[0],
  );
  assert.equal(afterCursor, beforeCursor);
  await replay.click('[aria-label="Restart replay"]');
  await replay.waitForFunction(
    () =>
      document.body.innerText.includes("Run navigation source identity changed") &&
      document.body.innerText.includes("0 / 0 loaded candles"),
    { timeout: 120000 },
  );
  await click(page, "Return to run overview");
  await page.click('[aria-label="Basket next page"]');
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Run baskets"]') &&
      document.body.innerText.includes("Run navigation source identity changed"),
    { timeout: 120000 },
  );
  await page.click('[aria-label="Timeline next page"]');
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Run chronological events"]'),
    { timeout: 120000 },
  );
  for (const suffix of ["/baskets/1", "/baskets/1/window", "/baskets/1/reveal", "/run"]) {
    assert.ok(
      staleResponses.some((p) => p.endsWith(suffix)),
      suffix,
    );
  }
  // An explicit reload accepts the new complete identity and restores navigation.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector('[data-run-basket="1"]', { timeout: 180000 });
  await click(page, "Open #1");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Restart replay"]') &&
      !document.querySelector('[aria-label="Restart replay"]').disabled,
    { timeout: 120000 },
  );
  await replay.close();
  report.cases.push({
    name: "accepted candle identity changes with unchanged replay package/manifest",
    oldSource: accepted.source,
    newSource: current.source,
    fixture:
      "Isolated cache copy; one CSV decimal gains a trailing zero. Numerical observations unchanged.",
    requests,
    browserRejectedRoutes: staleResponses,
    staleDetailHidden: true,
    stalePagesHidden: true,
    revealCursorUnchanged: true,
    windowCleared: true,
    explicitReloadRecovers: true,
  });
  await stop();
};
try {
  await start({ MARKETLAB_REPLAY_PACKAGE: packageCopy });
  const accepted = await fetch(`${url}/api/marketlab-replay/run`);
  assert.equal(accepted.status, 200, await accepted.text());
  appendFileSync(join(packageCopy, "events.jsonl"), " ");
  await rejected("payload changed after acceptance", "bytes");
  await stop();
  await start({ MARKETLAB_REPLAY_EXPECTED_PACKAGE_SHA256: "0".repeat(64) });
  await rejected("unexpected authoritative package identity", "identity mismatch");
  await stop();
  await start({ MARKETLAB_EXPECTED_CANDLE_CONTENT_SHA256: "0".repeat(64) });
  await rejected("unexpected derived candle identity", "identity mismatch");
  await page.screenshot({ path: fileURLToPath(new URL("invalid-input.png", import.meta.url)) });
  await stop();
  await staleCandles();
  assert.equal(report.errors.length, 0);
  report.result = "PASS";
  await stop();
  if (process.argv.includes("--build")) {
    const build = spawnSync(process.execPath, [next, "build"], {
      cwd: join(scratch, "apps/web"),
      encoding: "utf8",
      timeout: 300000,
      windowsHide: true,
    });
    const text = `${build.stdout}\n${build.stderr}`;
    writeFileSync(join(scratch, "build.log"), text);
    report.build = {
      command: "node <installed next/dist/bin/next> build",
      environment: "isolated same-source Windows snapshot, unchanged installed dependencies",
      exit: build.status,
      compiled: /Compiled successfully/.test(text),
      errors: text.match(/.{0,80}(?:EPERM|Type error|Error:).{0,180}/g) ?? [],
      log: join(scratch, "build.log"),
    };
  }
} catch (error) {
  report.result = "FAIL";
  report.failure = String(error.stack);
  report.serverLogs = serverLogs;
  report.pageText = await page.evaluate(() => document.body.innerText).catch(() => "unavailable");
  throw error;
} finally {
  await stop();
  await browser.close();
  report.ended = new Date().toISOString();
  writeFileSync(new URL("fail-closed.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
