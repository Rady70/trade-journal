/** Isolated cache-identity fixture: numerical observations are unchanged. */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export function alternateCandleCache(source: string, target: string): string {
  cpSync(source, target, { recursive: true });
  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const file = manifest.files[0];
  const path = join(target, file.name);
  const lines = readFileSync(path, "utf8").split("\n");
  const fields = lines[1]!.split(",");
  const previous = fields[1]!;
  fields[1] = previous.includes(".") ? `${previous}0` : `${previous}.0`;
  assert.equal(Number(fields[1]), Number(previous));
  lines[1] = fields.join(",");
  const bytes = Buffer.from(lines.join("\n"));
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  writeFileSync(path, bytes);
  file.bytes = bytes.length;
  file.sha256 = hash(bytes);
  const old = manifest.content_sha256;
  // Independent implementation of the documented descriptor fingerprint.
  manifest.content_sha256 = hash(
    manifest.files
      .map(
        (f: { name: string; sha256: string; bytes: number }) =>
          `${f.name}\0${f.sha256}\0${f.bytes}\n`,
      )
      .join(""),
  );
  assert.notEqual(manifest.content_sha256, old);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest.content_sha256;
}
