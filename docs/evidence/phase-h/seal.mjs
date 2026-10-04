import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { source, packageHash, candleHash, resultsHash, evidenceHash } from "./source.mjs";
process.env.MARKETLAB_REPLAY_PACKAGE ??=
  "E:/MarketLab/Lean/MarketLab/output/20261003-143124-SingleAnchorVNextAlgorithm/storage/single-anchor/replay";
process.env.MARKETLAB_CANDLE_CACHE ??= "E:/MarketLab/data/lean/xauusd-m1-candles";
const s = source();
const repo = process.cwd();
const dir = fileURLToPath(new URL(".", import.meta.url));
const json = (path) => JSON.parse(readFileSync(join(dir, path), "utf8"));
assert.equal(json("browser.json").result, "PASS");
assert.equal(json("fail-closed.json").result, "PASS");
assert.equal(json("automated.json").result, "PASS");
assert.ok(json("regression/qualified.json").result.startsWith("PASS"));
const implementation = "121cc595f57ab2c45ecec83ec4eaf60b9522f5d4";
const files = execFileSync(
  "git",
  ["diff", "--name-only", "99ff48cd4b71be51e220230480dadae048489ef3", implementation],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((p) => /^apps\/web\/(?:src|tests)\//.test(p));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalSeal = "91d7f6a1469c8399fb575b5845d70f173cd9fe63aef87acee2ff16fc3090c24d";
const previous = join(dir, "pre-review-manifest.json");
if (!existsSync(previous)) {
  const bytes = readFileSync(join(dir, "manifest.json"));
  assert.equal(hash(bytes), originalSeal);
  writeFileSync(previous, bytes);
}
assert.equal(hash(readFileSync(previous)), originalSeal);
const stale = json("fail-closed.json").cases.find((c) => c.oldSource && c.newSource);
assert.ok(stale);
assert.equal(stale.oldSource.packageSha256, stale.newSource.packageSha256);
assert.equal(stale.oldSource.manifestSha256, stale.newSource.manifestSha256);
assert.notEqual(stale.oldSource.candleContentSha256, stale.newSource.candleContentSha256);
assert.equal(stale.requests.length, 5);
for (const request of stale.requests) {
  assert.equal(request.staleStatus, 422);
  assert.equal(request.freshStatus, 200);
}
assert.ok(stale.explicitReloadRecovers && stale.revealCursorUnchanged && stale.windowCleared);
const whitespace = json("automated.json").commands.find((c) =>
  c.command.startsWith("git diff --check"),
);
assert.equal(whitespace?.exit, 0);
const runtimeSourceLfSha256 = {
  ...json("regression/qualified.json").runtimeSourceLfSha256,
  ...Object.fromEntries(
    files
      .filter((p) => p.startsWith("apps/web/src/"))
      .map((p) => [p, hash(readFileSync(join(repo, p), "utf8").replaceAll("\r\n", "\n"))]),
  ),
};
for (const [path, digest] of Object.entries(
  json("regression/qualified.json").runtimeSourceLfSha256,
)) {
  assert.equal(hash(readFileSync(join(repo, path), "utf8").replaceAll("\r\n", "\n")), digest);
}
// Evidence/doc follow-ups must not alter the qualified implementation.
for (const path of files) {
  const committed = execFileSync("git", ["show", `${implementation}:${path}`]);
  assert.equal(
    hash(readFileSync(join(repo, path), "utf8").replaceAll("\r\n", "\n")),
    hash(committed),
  );
}
const collect = (folder) =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return collect(path);
    if (path === join(dir, "manifest.json")) return [];
    const bytes = readFileSync(path);
    return [
      {
        path: relative(dir, path).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: hash(bytes),
      },
    ];
  });
const manifest = {
  status: "Phase H implemented and ready for independent review; not finalized",
  sealed: new Date().toISOString(),
  implementation,
  reviewCorrection: {
    reviewedApplicationHead: "804f7b072ff58f0e93ce4bca577dfb18e4f2624d",
    reviewedControlHead: "1d8792ea0ea3ddfa13636a702c0bb6e6fe013fba",
    originalSeal,
    binding: "packageSha256:manifestSha256:candleContentSha256; required on all navigation routes",
    staleCandleCheck:
      "fail-closed.json / unchanged package and manifest / stale clients rejected / fresh clients accepted",
    whitespaceCommand: whitespace.command,
  },
  packageHash,
  candleHash,
  resultsHash,
  evidenceHash,
  replayManifestSha256: hash(
    readFileSync(join(process.env.MARKETLAB_REPLAY_PACKAGE, "manifest.json")),
  ),
  runtimeSourceLfSha256,
  testsSourceLfSha256: Object.fromEntries(
    files
      .filter((p) => p.startsWith("apps/web/tests/"))
      .map((p) => [p, hash(readFileSync(join(repo, p), "utf8").replaceAll("\r\n", "\n"))]),
  ),
  startingDefaults: {
    control: "f77ecdb8588ba6ccc4453da6916365d2a399aa4d",
    application: "99ff48cd4b71be51e220230480dadae048489ef3",
    lean: "2722bc3c2d67ebfb2b67fdec401904abfa825359",
  },
  controlReviewBase: "f0c49cd945d28d1b5c7fe5ad1c8ab635a2677230",
  browserMode: "native Windows / headless installed Edge / real application",
  tests: json("automated.json").tests,
  bounds: {
    pageRows: 40,
    candleBars: 12000,
    observedMaxCandleBytes: json("browser.json").maxWindowBytes,
  },
  evidence: collect(dir).sort((a, b) => a.path.localeCompare(b.path)),
  phaseI: "not started",
  hostedCiDispatched: false,
  sourceCounts: {
    baskets: s.baskets.length,
    events: s.events.length,
    liveEvents: s.events.filter((e) => e.time).length,
  },
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: manifest.status,
    implementation,
    artifacts: manifest.evidence.length,
    manifestSha256: hash(readFileSync(join(dir, "manifest.json"))),
  }),
);
