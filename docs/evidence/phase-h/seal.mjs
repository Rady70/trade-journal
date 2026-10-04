import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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
const implementation = "8e93aa10e9dd7accd158f75d6486cd027038b7a0";
const files = execFileSync(
  "git",
  ["diff", "--name-only", "99ff48cd4b71be51e220230480dadae048489ef3", implementation],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
