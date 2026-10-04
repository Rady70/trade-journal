import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

// Reuse the finalized checker unchanged. Only its initial selector interaction
// is adapted to the new run-level table; all 117-occurrence/account/control and
// negative-checker assertions are retained. Output never rewrites Phase G.
let script = readFileSync(new URL("../phase-g/validate.mjs", import.meta.url), "utf8");
for (const name of ["source", "compare"]) {
  script = script.replace(
    `"./${name}.mjs"`,
    JSON.stringify(new URL(`../phase-g/${name}.mjs`, import.meta.url).href),
  );
}
const start = script.indexOf("  await page.click('button[aria-label=\"SingleAnchor basket\"]');");
const end = script.indexOf("  await page.waitForFunction(", start);
assert.ok(start > 0 && end > start);
script =
  script.slice(0, start) +
  `  await page.waitForSelector('select[aria-label="Run activity filter"]');
  await page.select('select[aria-label="Run activity filter"]', 'stop-out');
  await page.waitForFunction(() => document.querySelector('[data-run-basket="276"]'));
  await clickText('Open #276');
` +
  script.slice(end);
const temp = mkdtempSync(join(tmpdir(), "phase-h-g-regression-"));
const previous = new URL("regression/qualified.json", import.meta.url);
const attemptsFile = new URL("regression/attempts.json", import.meta.url);
if (existsSync(previous)) {
  const old = JSON.parse(readFileSync(previous, "utf8"));
  const attempts = existsSync(attemptsFile) ? JSON.parse(readFileSync(attemptsFile, "utf8")) : [];
  attempts.push({
    started: old.started,
    ended: old.ended,
    failure: old.failure ?? null,
    checks: old.checks,
  });
  writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
}
const file = join(temp, "validate.mjs");
assert.ok(existsSync(temp));
writeFileSync(file, script);
const run = spawnSync(process.execPath, [file, "qualified"], {
  stdio: "inherit",
  timeout: 900000,
  env: { ...process.env, OUT_DIR: fileURLToPath(new URL("regression", import.meta.url)) },
});
assert.equal(run.status, 0, "Phase G regression must pass");
