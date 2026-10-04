import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
assert.equal(process.platform, "win32");
const temp = process.env.TEMP_OUTPUT ?? "C:/Users/non_s/AppData/Local/Temp/opencode";
assert.ok(existsSync(temp));
process.env.MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE = process.env.MARKETLAB_REPLAY_PACKAGE;
process.env.MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE = process.env.MARKETLAB_CANDLE_CACHE;
const output = join(temp, "phase-h-vitest.json");
const priorFile = new URL("automated.json", import.meta.url);
if (existsSync(priorFile)) {
  const prior = JSON.parse(readFileSync(priorFile, "utf8"));
  if (prior.result === "FAIL" && existsSync(output)) {
    const tests = JSON.parse(readFileSync(output, "utf8"));
    prior.failedTests = tests.testResults.flatMap((suite) =>
      suite.assertionResults
        .filter((test) => test.status === "failed")
        .map((test) => ({ name: test.fullName, messages: test.failureMessages })),
    );
  }
  const attemptsFile = new URL("automated-attempts.json", import.meta.url);
  const attempts = existsSync(attemptsFile) ? JSON.parse(readFileSync(attemptsFile, "utf8")) : [];
  attempts.push(prior);
  writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
}
const paths = [
  ...new Set([
    ...execFileSync("git", ["diff", "--name-only", "99ff48cd4b71be51e220230480dadae048489ef3"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" })
      .trim()
      .split("\n"),
  ]),
].filter((path) => /\.(?:ts|tsx|mjs)$/.test(path));
const commands = [
  `corepack pnpm exec vitest run --reporter=json --outputFile="${output}"`,
  "corepack pnpm --filter web typecheck",
  "corepack pnpm --filter @luxalgo/journal-core typecheck",
  "corepack pnpm --filter @luxalgo/journal-importers typecheck",
  `corepack pnpm exec prettier --check ${paths.map((p) => `"${p}"`).join(" ")}`,
];
const report = {
  started: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  commands: [],
};
try {
  for (const command of commands) {
    const run = spawnSync(command, { shell: true, encoding: "utf8", timeout: 300000 });
    report.commands.push({
      command,
      exit: run.status,
      output: `${run.stdout}\n${run.stderr}`.trim(),
    });
    assert.equal(run.status, 0, command);
  }
  const tests = JSON.parse(readFileSync(output, "utf8"));
  report.tests = {
    total: tests.numTotalTests,
    passed: tests.numPassedTests,
    failed: tests.numFailedTests,
    pending: tests.numPendingTests,
    success: tests.success,
  };
  assert.equal(tests.numPendingTests, 0);
  assert.equal(tests.numFailedTests, 0);
  assert.ok(tests.success);
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.failure = String(error.stack);
  throw error;
} finally {
  report.ended = new Date().toISOString();
  writeFileSync(new URL("automated.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, tests: report.tests }));
}
