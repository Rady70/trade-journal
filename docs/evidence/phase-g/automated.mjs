import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

assert.equal(process.platform, "win32", "Phase G validation is Windows-only");
const temp = process.env.TEMP_OUTPUT ?? "C:/Users/non_s/AppData/Local/Temp/opencode";
const testOutput = join(temp, "phase-g-vitest.json");
process.env.MARKETLAB_REPLAY_AUTHORITATIVE_PACKAGE = process.env.MARKETLAB_REPLAY_PACKAGE;
process.env.MARKETLAB_REPLAY_AUTHORITATIVE_CANDLE_CACHE = process.env.MARKETLAB_CANDLE_CACHE;
const checks = [
  `corepack pnpm vitest run --reporter=json --outputFile="${testOutput}"`,
  "corepack pnpm --filter web typecheck",
  "corepack pnpm --filter @luxalgo/journal-core typecheck",
  "corepack pnpm --filter @luxalgo/journal-importers typecheck",
];
const report = {
  platform: process.platform,
  node: process.version,
  date: new Date().toISOString(),
  commands: [],
};
for (const command of checks) {
  const run = spawnSync(command, { shell: true, encoding: "utf8", timeout: 300000 });
  report.commands.push({
    command,
    exit: run.status,
    output: `${run.stdout}\n${run.stderr}`.trim(),
  });
  assert.equal(run.status, 0, command);
}
const tests = JSON.parse(readFileSync(testOutput, "utf8"));
report.tests = {
  total: tests.numTotalTests,
  passed: tests.numPassedTests,
  failed: tests.numFailedTests,
  pending: tests.numPendingTests,
  success: tests.success,
};
assert.equal(tests.numFailedTests, 0);
assert.equal(tests.numPendingTests, 0);
assert.ok(tests.success);
writeFileSync(new URL("automated.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.tests));
