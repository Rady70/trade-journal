import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const qualified = JSON.parse(readFileSync(new URL("qualified.json", import.meta.url), "utf8"));
assert.equal(qualified.result, "PASS: Basket #276 Phase G local browser acceptance");
assert.ok(!qualified.failure);
assert.equal(qualified.observations.length, 117);
for (const [path, digest] of Object.entries(qualified.runtimeSourceLfSha256)) {
  assert.equal(
    hash(readFileSync(path, "utf8").replaceAll("\r\n", "\n")),
    digest,
    `qualified source unchanged: ${path}`,
  );
}
const paths = [
  "source.mjs",
  "compare.mjs",
  "validate.mjs",
  "automated.mjs",
  "seal.mjs",
  "baseline.json",
  "baseline-skipped-liquidation-states.png",
  "attempts.json",
  "automated.json",
  "qualified.json",
  "01-basket-276-start.png",
  "02-escape-close.png",
  ...[1323, 1324, 1343, 1346, 1354, 1357, 1358, 1361, 1362].map((id) => `risk-${id}.png`),
];
const manifest = {
  contract: "marketlab-phase-g-basket-276-evidence-v1",
  status: "implemented/qualified; ready for independent review, not finalized",
  applicationImplementationCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  startingHeads: {
    Market_Lab: "3f2e7a46521722f77ff279059d87b86fecf02c70",
    tradeJournal: "66ac370fd74a2d13613b21141bafcbeab4eff122",
    Lean: "2722bc3c2d67ebfb2b67fdec401904abfa825359",
  },
  packageSha256: qualified.packageHash,
  evidenceManifestSha256: qualified.evidenceHash,
  resultsSha256: qualified.resultsHash,
  candleContentSha256: qualified.candleHash,
  runtimeSourceLfSha256: qualified.runtimeSourceLfSha256,
  artifacts: paths.map((path) => {
    const bytes = readFileSync(new URL(path, import.meta.url));
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }),
};
writeFileSync(new URL("manifest.json", import.meta.url), JSON.stringify(manifest, null, 2));
console.log("PASS: source binding and compact Phase G evidence sealed");
