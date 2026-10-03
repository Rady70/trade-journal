/**
 * Server-side Phase E replay package loader for the MarketLab Backtests surface.
 *
 * The loader is read-only and fail-closed. It verifies the manifest contract,
 * the package fingerprint, every payload file hash/byte count/line count, the
 * event whitelist and ordering, and (separately) the derived candle cache
 * manifest before any row is served. A malformed, incompatible or unsupported
 * package is reported as an error and never turned into a plausible replay.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  accountAtCursor,
  CANDLE_CACHE_CONTRACT,
  indexBaskets,
  parseUtcMs,
  ReplayPackageError,
  REPLAY_CHUNK_ACCOUNT_ROWS,
  REPLAY_CHUNK_BARS,
  REPLAY_EVENT_TYPES,
  REPLAY_PACKAGE_CONTRACT,
  REPLAY_RECAP_TYPE,
  type AccountRow,
  type BasketSummary,
  type CompactBar,
  type ReplayEventType,
  type ReplayEventView,
  type ReplayManifest,
  type ReplayManifestFile,
  type ReplayStatus,
} from "@/lib/marketlab-replay";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const TELEMETRY_FILE = /^telemetry-(\d{4})\.jsonl$/;
const CANDLE_MONTH_FILE = /^xauusd-m1-(\d{4})-(\d{2})\.csv$/;
const CANDLE_HEADER = "time,open,high,low,close,ticks";
const EVENT_TYPE_SET = new Set<string>(REPLAY_EVENT_TYPES);

export interface ReplayPackageConfig {
  configured: boolean;
  packageRoot: string | null;
  candleRoot: string | null;
  hint: string | null;
}

export interface CandleManifestFile {
  name: string;
  rows: number;
  bytes: number;
  sha256: string;
  first_candle_utc?: string;
  last_candle_utc?: string;
}

export interface CandleManifest {
  contract: string;
  symbol?: string;
  market?: string;
  resolution?: string;
  price_basis?: string;
  time_basis?: string;
  empty_minutes?: string;
  content_sha256?: string;
  files: CandleManifestFile[];
}

interface LoadedCandleCache {
  root: string;
  manifest: CandleManifest;
  manifestSha256: string;
  byMonth: Map<string, CandleManifestFile>;
}

export interface LoadedReplayPackage {
  root: string;
  manifest: ReplayManifest;
  manifestSha256: string;
  events: ReplayEventView[];
  baskets: BasketSummary[];
  eventsByBasket: Map<number, ReplayEventView[]>;
  byNumber: Map<number, BasketSummary>;
}

type CacheEntry<T> = { key: string; value: T };
let packageCache: CacheEntry<LoadedReplayPackage> | null = null;
let candleCache: CacheEntry<LoadedCandleCache> | null = null;
const telemetryFileCache = new Map<string, CacheEntry<AccountRow[]>>();
const candleFileCache = new Map<string, CacheEntry<CompactBar[]>>();
const CANDLE_FILE_CACHE_LIMIT = 12;

/** Resolves the optional package and candle-cache roots from the environment. */
export function replayPackageConfig(): ReplayPackageConfig {
  const packageRoot = resolvePackageRootFromEnv(process.env.MARKETLAB_REPLAY_PACKAGE);
  const candleRoot = resolveCandleRootFromEnv(process.env.MARKETLAB_CANDLE_CACHE);
  return {
    configured: packageRoot !== null,
    packageRoot,
    candleRoot,
    hint:
      packageRoot === null
        ? "Set MARKETLAB_REPLAY_PACKAGE to a finalized Phase E replay directory " +
          "(...\\storage\\single-anchor\\replay) or to its run directory."
        : candleRoot === null
          ? "Set MARKETLAB_CANDLE_CACHE to the derived M1 candle cache directory " +
            "(the directory containing manifest.json and xauusd-m1-YYYY-MM.csv)."
          : null,
  };
}

function resolvePackageRootFromEnv(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = resolve(raw);
  if (existsSync(join(candidate, "manifest.json"))) return candidate;
  const nested = join(candidate, "storage", "single-anchor", "replay");
  if (existsSync(join(nested, "manifest.json"))) return nested;
  throw new ReplayPackageError(
    `MARKETLAB_REPLAY_PACKAGE (${basename(candidate)}) contains no replay manifest.json.`,
  );
}

function resolveCandleRootFromEnv(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = resolve(raw);
  if (!existsSync(join(candidate, "manifest.json"))) {
    throw new ReplayPackageError(
      `MARKETLAB_CANDLE_CACHE (${basename(candidate)}) contains no candle-cache manifest.json.`,
    );
  }
  return candidate;
}

const fileKey = (path: string): string => {
  const info = statSync(path);
  return `${info.mtimeMs}:${info.size}`;
};

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Splits a payload into logical lines, rejecting blank lines and CRLF. */
function payloadLines(text: string): string[] {
  if (text.includes("\r")) {
    throw new ReplayPackageError("Replay package payload is not LF-normalized.");
  }
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.some((line) => line.length === 0)) {
    throw new ReplayPackageError("Replay package payload contains a blank line.");
  }
  return lines;
}

/** Reads and fully verifies one manifest-described payload file. */
function readVerifiedPayload(
  root: string,
  descriptor: ReplayManifestFile,
): { path: string; text: string; buffer: Buffer } {
  const path = join(root, descriptor.name);
  if (!existsSync(path)) {
    throw new ReplayPackageError(`Replay payload ${descriptor.name} is missing.`);
  }
  const buffer = readFileSync(path);
  if (buffer.length !== descriptor.bytes) {
    throw new ReplayPackageError(
      `Replay payload ${descriptor.name} is ${buffer.length} bytes; the manifest records ${descriptor.bytes}.`,
    );
  }
  const digest = sha256(buffer);
  if (digest !== descriptor.sha256) {
    throw new ReplayPackageError(
      `Replay payload ${descriptor.name} failed its SHA-256 check (${digest}).`,
    );
  }
  return { path, text: buffer.toString("utf8"), buffer };
}

function validateManifest(body: unknown): ReplayManifest {
  if (!isPlainObject(body)) {
    throw new ReplayPackageError("Replay package manifest is not a JSON object.");
  }
  if (body.contract !== REPLAY_PACKAGE_CONTRACT) {
    throw new ReplayPackageError(
      `Unsupported replay package contract: ${JSON.stringify(body.contract)}. ` +
        `Expected ${REPLAY_PACKAGE_CONTRACT}.`,
    );
  }
  for (const key of ["modelRevision", "stopOutModel", "symbol", "market"] as const) {
    if (typeof body[key] !== "string" || body[key] === "") {
      throw new ReplayPackageError(`Replay manifest is missing a valid "${key}".`);
    }
  }
  for (const key of ["startUtc", "endUtc"] as const) {
    if (parseUtcMs(body[key]) === null) {
      throw new ReplayPackageError(`Replay manifest "${key}" is not canonical UTC text.`);
    }
  }
  if (typeof body.packageSha256 !== "string" || !SHA256_HEX.test(body.packageSha256)) {
    throw new ReplayPackageError("Replay manifest packageSha256 is not a SHA-256 hex digest.");
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new ReplayPackageError("Replay manifest has no payload files.");
  }
  const files: ReplayManifestFile[] = body.files.map((entry: unknown) => {
    if (!isPlainObject(entry)) {
      throw new ReplayPackageError("Replay manifest contains an invalid file entry.");
    }
    const { name, year, sha256: digest, bytes, lines } = entry;
    if (
      typeof name !== "string" ||
      !SHA256_HEX.test(String(digest)) ||
      !isPositiveInt(bytes) ||
      !isNonNegativeInt(lines)
    ) {
      throw new ReplayPackageError("Replay manifest contains an invalid file entry.");
    }
    if (year !== null && !isNonNegativeInt(year)) {
      throw new ReplayPackageError(`Replay manifest file ${name} has an invalid year.`);
    }
    return { name, year: year as number | null, sha256: String(digest), bytes, lines };
  });
  const first = files[0];
  if (!first || first.name !== "events.jsonl" || first.year !== null) {
    throw new ReplayPackageError("Replay manifest must list events.jsonl first.");
  }
  let previousYear = 0;
  for (const file of files.slice(1)) {
    const match = TELEMETRY_FILE.exec(file.name);
    if (!match) {
      throw new ReplayPackageError(
        `Replay manifest lists an unexpected payload file ${file.name}.`,
      );
    }
    if (file.year !== Number(match[1]) || file.year <= previousYear) {
      throw new ReplayPackageError(
        `Replay telemetry shard ${file.name} is not in ascending year order.`,
      );
    }
    previousYear = file.year;
  }
  if (!isPlainObject(body.eventCounts)) {
    throw new ReplayPackageError("Replay manifest has no event-type counts.");
  }
  const eventCounts: Record<string, number> = {};
  for (const [type, count] of Object.entries(body.eventCounts)) {
    if (!EVENT_TYPE_SET.has(type)) {
      throw new ReplayPackageError(`Replay manifest counts unsupported event type "${type}".`);
    }
    if (!isPositiveInt(count)) {
      throw new ReplayPackageError(`Replay manifest count for "${type}" is invalid.`);
    }
    eventCounts[type] = count;
  }
  if (body.telemetryCounts !== undefined) {
    if (
      !isPlainObject(body.telemetryCounts) ||
      !isNonNegativeInt(body.telemetryCounts.event) ||
      !isNonNegativeInt(body.telemetryCounts.periodic)
    ) {
      throw new ReplayPackageError("Replay manifest telemetryCounts is invalid.");
    }
  }
  if (
    body.telemetryIntervalSeconds !== undefined &&
    !isPositiveInt(body.telemetryIntervalSeconds)
  ) {
    throw new ReplayPackageError("Replay manifest telemetryIntervalSeconds is invalid.");
  }
  return { ...(body as unknown as ReplayManifest), files, eventCounts };
}

/** Recomputes the documented package fingerprint (payload descriptors only). */
export function packageFingerprint(files: ReplayManifestFile[]): string {
  const rows = files.map((file) => `${file.name}\n${file.sha256}\n${file.bytes}\n`).join("");
  return sha256(rows);
}

function parseEvents(text: string, manifest: ReplayManifest): ReplayEventView[] {
  const lines = payloadLines(text);
  const eventsLines = manifest.files[0]?.lines;
  if (eventsLines === undefined || lines.length !== eventsLines) {
    throw new ReplayPackageError(
      `events.jsonl has ${lines.length} lines; the manifest records ${String(eventsLines)}.`,
    );
  }
  const actualCounts: Record<string, number> = {};
  const events: ReplayEventView[] = [];
  let lastId = -1;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ReplayPackageError(
        `events.jsonl contains invalid JSON at event ${events.length + 1}.`,
      );
    }
    if (!isPlainObject(parsed)) {
      throw new ReplayPackageError("events.jsonl contains a non-object line.");
    }
    const { type, id, time } = parsed;
    if (typeof type !== "string" || !EVENT_TYPE_SET.has(type)) {
      throw new ReplayPackageError(
        `events.jsonl contains an unsupported event type ${String(type)}.`,
      );
    }
    if (!isPositiveInt(id) || id <= lastId) {
      throw new ReplayPackageError("events.jsonl event ids are not strictly increasing.");
    }
    lastId = id;
    actualCounts[type] = (actualCounts[type] ?? 0) + 1;

    const isRecap = type === REPLAY_RECAP_TYPE;
    if (!isRecap && parseUtcMs(time) === null) {
      throw new ReplayPackageError(`Event ${id} (${type}) has no canonical UTC time.`);
    }
    if (isRecap && parseUtcMs(time) !== null) {
      throw new ReplayPackageError(`Recap event ${id} must not carry a live time.`);
    }
    const recapTime = isRecap ? parseUtcMs(parsed.lastTime) : null;
    if (isRecap && recapTime === null) {
      throw new ReplayPackageError(`Recap event ${id} has no canonical lastTime.`);
    }
    if (isRecap) {
      if (parseUtcMs(parsed.firstTime) === null) {
        throw new ReplayPackageError(`Recap event ${id} has no canonical firstTime.`);
      }
      if (
        typeof parsed.lastTime === "string" &&
        typeof parsed.firstTime === "string" &&
        parsed.firstTime > parsed.lastTime
      ) {
        throw new ReplayPackageError(`Recap event ${id} firstTime is after lastTime.`);
      }
    }
    if (parsed.basket !== undefined && parsed.basket !== null && !isPositiveInt(parsed.basket)) {
      throw new ReplayPackageError(`Event ${id} (${type}) has an invalid basket number.`);
    }
    events.push({
      id,
      type: type as ReplayEventType,
      time: isRecap ? null : (time as string),
      timeMs: isRecap ? recapTime : parseUtcMs(time),
      live: !isRecap,
      payload: parsed,
    });
  }

  for (const [type, count] of Object.entries(actualCounts)) {
    if (manifest.eventCounts[type] !== count) {
      throw new ReplayPackageError(
        `Event count mismatch for "${type}": stream has ${count}, manifest records ${String(
          manifest.eventCounts[type],
        )}.`,
      );
    }
  }
  for (const type of Object.keys(manifest.eventCounts)) {
    if ((actualCounts[type] ?? 0) !== manifest.eventCounts[type]) {
      throw new ReplayPackageError(
        `Event count mismatch for "${type}": stream has ${actualCounts[type] ?? 0}, manifest records ${
          manifest.eventCounts[type]
        }.`,
      );
    }
  }
  if (events[0]?.type !== "run_started" || events[events.length - 1]?.type !== "run_ended") {
    throw new ReplayPackageError(
      "events.jsonl must start with run_started and end with run_ended.",
    );
  }
  if (events[0].time !== manifest.startUtc) {
    throw new ReplayPackageError("run_started time does not match the manifest startUtc.");
  }
  return events;
}

/** Loads and fully verifies the configured package. Cached per manifest identity. */
export function loadPackage(): LoadedReplayPackage {
  const packageRoot = resolvePackageRootFromEnv(process.env.MARKETLAB_REPLAY_PACKAGE);
  if (packageRoot === null) {
    throw new ReplayPackageError("MARKETLAB_REPLAY_PACKAGE is not configured.");
  }
  const manifestPath = join(packageRoot, "manifest.json");
  const key = `${packageRoot}|${fileKey(manifestPath)}`;
  if (packageCache?.key === key) return packageCache.value;

  const manifestText = readFileSync(manifestPath, "utf8");
  let manifestBody: unknown;
  try {
    manifestBody = JSON.parse(manifestText);
  } catch {
    throw new ReplayPackageError("Replay manifest is not valid JSON.");
  }
  const manifest = validateManifest(manifestBody);
  const fingerprint = packageFingerprint(manifest.files);
  if (fingerprint !== manifest.packageSha256) {
    throw new ReplayPackageError(
      `Replay package fingerprint mismatch: computed ${fingerprint}, manifest records ${manifest.packageSha256}.`,
    );
  }
  // Verify every payload file before serving any row.
  let eventsText: string | null = null;
  for (const file of manifest.files) {
    const { text } = readVerifiedPayload(packageRoot, file);
    const lineCount = payloadLines(text).length;
    if (lineCount !== file.lines) {
      throw new ReplayPackageError(
        `${file.name} has ${lineCount} lines; the manifest records ${file.lines}.`,
      );
    }
    if (file.name === "events.jsonl") eventsText = text;
  }
  if (eventsText === null) throw new ReplayPackageError("events.jsonl was not verified.");
  const events = parseEvents(eventsText, manifest);
  const { baskets, eventsByBasket, byNumber } = indexBaskets(events);
  const loaded: LoadedReplayPackage = {
    root: packageRoot,
    manifest,
    manifestSha256: sha256(manifestText),
    events,
    baskets,
    eventsByBasket,
    byNumber,
  };
  packageCache = { key, value: loaded };
  return loaded;
}

/** Loads and fully verifies the derived candle cache. Cached per manifest identity. */
export function loadCandleCache(): LoadedCandleCache {
  const candleRoot = resolveCandleRootFromEnv(process.env.MARKETLAB_CANDLE_CACHE);
  if (candleRoot === null) {
    throw new ReplayPackageError("MARKETLAB_CANDLE_CACHE is not configured.");
  }
  const manifestPath = join(candleRoot, "manifest.json");
  const key = `${candleRoot}|${fileKey(manifestPath)}`;
  if (candleCache?.key === key) return candleCache.value;

  let body: unknown;
  try {
    body = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new ReplayPackageError("Candle-cache manifest is not valid JSON.");
  }
  if (!isPlainObject(body) || body.contract !== CANDLE_CACHE_CONTRACT) {
    throw new ReplayPackageError(
      `Unsupported candle cache: expected ${CANDLE_CACHE_CONTRACT}, found ${JSON.stringify(
        isPlainObject(body) ? body.contract : null,
      )}.`,
    );
  }
  if (body.symbol !== "XAUUSD" || body.resolution !== "M1" || body.time_basis !== "UTC") {
    throw new ReplayPackageError("Candle cache is not the qualified XAUUSD M1 UTC dataset.");
  }
  if (body.price_basis !== "mid_of_best_bid_ask" || body.empty_minutes !== "absent") {
    throw new ReplayPackageError(
      "Candle cache price/emptiness basis is not the qualified contract.",
    );
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    throw new ReplayPackageError("Candle-cache manifest has no monthly files.");
  }
  const byMonth = new Map<string, CandleManifestFile>();
  const files: CandleManifestFile[] = body.files.map((entry: unknown) => {
    if (!isPlainObject(entry)) {
      throw new ReplayPackageError("Candle-cache manifest contains an invalid file entry.");
    }
    const { name, rows, bytes, sha256: digest } = entry;
    if (
      typeof name !== "string" ||
      !CANDLE_MONTH_FILE.test(name) ||
      !isPositiveInt(rows) ||
      !isPositiveInt(bytes) ||
      !SHA256_HEX.test(String(digest))
    ) {
      throw new ReplayPackageError("Candle-cache manifest contains an invalid file entry.");
    }
    return {
      ...(entry as unknown as CandleManifestFile),
      name,
      rows,
      bytes,
      sha256: String(digest),
    };
  });
  for (const file of files) {
    const match = CANDLE_MONTH_FILE.exec(file.name)!;
    byMonth.set(`${match[1]}-${match[2]}`, file);
  }
  const manifest: CandleManifest = { ...(body as unknown as CandleManifest), files };
  const loaded: LoadedCandleCache = {
    root: candleRoot,
    manifest,
    manifestSha256: sha256(readFileSync(manifestPath)),
    byMonth,
  };
  candleCache = { key, value: loaded };
  return loaded;
}

const monthKey = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const nextMonthKey = (key: string): string => {
  const parts = key.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new ReplayPackageError(`Invalid candle month key ${key}.`);
  }
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

function parseCandleCsv(text: string, descriptor: CandleManifestFile): CompactBar[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines[0] !== CANDLE_HEADER) {
    throw new ReplayPackageError(`Candle file ${descriptor.name} has an unexpected header.`);
  }
  const rows = lines.slice(1);
  if (rows.length !== descriptor.rows) {
    throw new ReplayPackageError(
      `Candle file ${descriptor.name} has ${rows.length} rows; the manifest records ${descriptor.rows}.`,
    );
  }
  const bars: CompactBar[] = [];
  let previousTime = -1;
  for (const [index, row] of rows.entries()) {
    const parts = row.split(",");
    if (parts.length !== 6) {
      throw new ReplayPackageError(`Candle file ${descriptor.name} row ${index + 2} is malformed.`);
    }
    const timeMs = parseUtcMs(parts[0]);
    const values = parts.slice(1).map(Number);
    if (timeMs === null || values.length !== 5 || values.some((value) => !Number.isFinite(value))) {
      throw new ReplayPackageError(`Candle file ${descriptor.name} row ${index + 2} is malformed.`);
    }
    const open = values[0]!;
    const high = values[1]!;
    const low = values[2]!;
    const close = values[3]!;
    const ticks = values[4]!;
    if (ticks < 0) {
      throw new ReplayPackageError(`Candle file ${descriptor.name} row ${index + 2} is malformed.`);
    }
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
      throw new ReplayPackageError(
        `Candle file ${descriptor.name} row ${index + 2} has an impossible OHLC range.`,
      );
    }
    if (timeMs <= previousTime) {
      throw new ReplayPackageError(`Candle file ${descriptor.name} is not time-ordered.`);
    }
    previousTime = timeMs;
    bars.push([timeMs, open, high, low, close, ticks]);
  }
  return bars;
}

function readCandleMonth(root: string, descriptor: CandleManifestFile): CompactBar[] {
  const path = join(root, descriptor.name);
  if (!existsSync(path)) {
    throw new ReplayPackageError(`Candle file ${descriptor.name} is missing.`);
  }
  const key = fileKey(path);
  const cached = candleFileCache.get(path);
  if (cached?.key === key) return cached.value;
  const buffer = readFileSync(path);
  if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
    throw new ReplayPackageError(`Candle file ${descriptor.name} failed its byte/SHA-256 check.`);
  }
  if (buffer.includes(13)) {
    throw new ReplayPackageError(`Candle file ${descriptor.name} is not LF-normalized.`);
  }
  const bars = parseCandleCsv(buffer.toString("utf8"), descriptor);
  candleFileCache.delete(path);
  candleFileCache.set(path, { key, value: bars });
  while (candleFileCache.size > CANDLE_FILE_CACHE_LIMIT) {
    const oldest = candleFileCache.keys().next().value;
    if (oldest === undefined) break;
    candleFileCache.delete(oldest);
  }
  return bars;
}

function readTelemetryYear(root: string, file: ReplayManifestFile): AccountRow[] {
  const path = join(root, file.name);
  const key = fileKey(path);
  const cached = telemetryFileCache.get(path);
  if (cached?.key === key) return cached.value;
  const { text } = readVerifiedPayload(root, file);
  const lines = payloadLines(text);
  if (lines.length !== file.lines) {
    throw new ReplayPackageError(
      `${file.name} has ${lines.length} lines; the manifest records ${file.lines}.`,
    );
  }
  const rows: AccountRow[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ReplayPackageError(`${file.name} contains invalid JSON.`);
    }
    if (!isPlainObject(parsed)) {
      throw new ReplayPackageError(`${file.name} contains a non-object line.`);
    }
    const timeMs = parseUtcMs(parsed.time);
    if (timeMs === null) {
      throw new ReplayPackageError(`${file.name} contains a row without canonical UTC time.`);
    }
    if (parsed.kind !== "event" && parsed.kind !== "periodic") {
      throw new ReplayPackageError(`${file.name} contains an unsupported telemetry kind.`);
    }
    const eventId =
      parsed.kind === "event" && isPositiveInt(parsed.eventId)
        ? parsed.eventId
        : parsed.kind === "periodic" && (parsed.eventId === null || parsed.eventId === undefined)
          ? null
          : undefined;
    if (eventId === undefined) {
      throw new ReplayPackageError(`${file.name} contains an invalid telemetry eventId.`);
    }
    if (!isNonNegativeInt(parsed.quoteSequence) || typeof parsed.floatingObservable !== "boolean") {
      throw new ReplayPackageError(`${file.name} contains an invalid telemetry row.`);
    }
    for (const field of [
      "balance",
      "equity",
      "floatingProfit",
      "realizedProfit",
      "usedMargin",
      "freeMargin",
      "grossLots",
      "absoluteNetLots",
    ] as const) {
      if (typeof parsed[field] !== "string" || parsed[field] === "") {
        throw new ReplayPackageError(`${file.name} row is missing exact decimal "${field}".`);
      }
    }
    if (parsed.marginLevelPercent !== null && typeof parsed.marginLevelPercent !== "string") {
      throw new ReplayPackageError(`${file.name} row has an invalid marginLevelPercent.`);
    }
    if (typeof parsed.marginCallActive !== "boolean" || !isNonNegativeInt(parsed.openPositions)) {
      throw new ReplayPackageError(`${file.name} row has an invalid account state.`);
    }
    rows.push({
      kind: parsed.kind,
      eventId,
      time: parsed.time as string,
      timeMs,
      quoteSequence: parsed.quoteSequence,
      balance: parsed.balance as string,
      equity: parsed.equity as string,
      floatingProfit: parsed.floatingProfit as string,
      floatingObservable: parsed.floatingObservable,
      realizedProfit: parsed.realizedProfit as string,
      usedMargin: parsed.usedMargin as string,
      freeMargin: parsed.freeMargin as string,
      marginLevelPercent: parsed.marginLevelPercent as string | null,
      marginCallActive: parsed.marginCallActive,
      openPositions: parsed.openPositions,
      grossLots: parsed.grossLots as string,
      absoluteNetLots: parsed.absoluteNetLots as string,
    });
  }
  telemetryFileCache.set(path, { key, value: rows });
  return rows;
}

function basketSummary(number: number): BasketSummary {
  const loaded = loadPackage();
  const summary = loaded.byNumber.get(number);
  if (!summary) {
    throw new ReplayPackageError(`Basket ${number} is not present in the replay package.`);
  }
  return summary;
}

/** Read-only status for the Backtests landing screen. Never throws for a bad package. */
export function replayStatus(): ReplayStatus {
  let config: ReplayPackageConfig;
  try {
    config = replayPackageConfig();
  } catch (error) {
    return {
      configured: true,
      valid: false,
      error: error instanceof Error ? error.message : "Replay package configuration is invalid.",
      hint: null,
      package: null,
      candles: emptyCandleStatus(false, null),
      baskets: [],
    };
  }
  if (!config.configured) {
    return {
      configured: false,
      valid: false,
      error: null,
      hint: config.hint,
      package: null,
      candles: emptyCandleStatus(config.candleRoot !== null, config.hint),
      baskets: [],
    };
  }
  let candleStatus: ReplayStatus["candles"];
  if (config.candleRoot === null) {
    candleStatus = emptyCandleStatus(false, config.hint);
  } else {
    try {
      const cache = loadCandleCache();
      const months = [...cache.byMonth.keys()].sort();
      candleStatus = {
        configured: true,
        valid: true,
        error: null,
        contract: cache.manifest.contract,
        manifestSha256: cache.manifestSha256,
        contentSha256: cache.manifest.content_sha256 ?? null,
        fileCount: cache.manifest.files.length,
        firstMonth: months[0] ?? null,
        lastMonth: months[months.length - 1] ?? null,
      };
    } catch (error) {
      candleStatus = emptyCandleStatus(
        true,
        error instanceof Error ? error.message : "Candle cache is invalid.",
      );
    }
  }
  try {
    const loaded = loadPackage();
    const { manifest } = loaded;
    return {
      configured: true,
      valid: true,
      error: null,
      hint: config.hint,
      package: {
        contract: manifest.contract,
        modelRevision: manifest.modelRevision,
        stopOutModel: manifest.stopOutModel,
        symbol: manifest.symbol,
        market: manifest.market,
        securityType: typeof manifest.securityType === "string" ? manifest.securityType : null,
        startUtc: manifest.startUtc,
        endUtc: manifest.endUtc,
        quoteTimeZone: typeof manifest.quoteTimeZone === "string" ? manifest.quoteTimeZone : null,
        telemetryIntervalSeconds:
          typeof manifest.telemetryIntervalSeconds === "number"
            ? manifest.telemetryIntervalSeconds
            : null,
        outcome: manifest.outcome ?? null,
        counters: manifest.counters ?? null,
        eventCounts: manifest.eventCounts,
        telemetryCounts: manifest.telemetryCounts ?? null,
        packageSha256: manifest.packageSha256,
        manifestSha256: loaded.manifestSha256,
        files: manifest.files,
      },
      candles: candleStatus,
      baskets: loaded.baskets,
    };
  } catch (error) {
    return {
      configured: true,
      valid: false,
      error: error instanceof Error ? error.message : "Replay package is invalid.",
      hint: config.hint,
      package: null,
      candles: candleStatus,
      baskets: [],
    };
  }
}

function emptyCandleStatus(configured: boolean, error: string | null): ReplayStatus["candles"] {
  return {
    configured,
    valid: false,
    error,
    contract: null,
    manifestSha256: null,
    contentSha256: null,
    fileCount: 0,
    firstMonth: null,
    lastMonth: null,
  };
}

export function basketDetail(number: number): {
  basket: BasketSummary;
  events: ReplayEventView[];
} {
  const loaded = loadPackage();
  const summary = basketSummary(number);
  const events = loaded.eventsByBasket.get(number) ?? [];
  return { basket: summary, events };
}

/**
 * Reads one bounded replay window: candles from the derived M1 cache plus the
 * exact exported account telemetry rows covering the same cursor range. The
 * server never interpolates or recomputes a value; it selects rows.
 */
export function basketWindow(number: number, requestedFromMs: number) {
  const loaded = loadPackage();
  const summary = basketSummary(number);
  const cache = loadCandleCache();
  const fromMs = Math.max(summary.windowStartMs, requestedFromMs);
  if (fromMs > summary.windowEndMs) {
    throw new ReplayPackageError(`The requested time is after the basket ${number} replay window.`);
  }
  const bars: CompactBar[] = [];
  let nextFromMs: number | null = null;
  let month: string | null = monthKey(fromMs);
  const lastMonth = monthKey(summary.windowEndMs);
  while (month !== null && bars.length < REPLAY_CHUNK_BARS) {
    const descriptor = cache.byMonth.get(month);
    if (descriptor) {
      const monthBars = readCandleMonth(cache.root, descriptor);
      for (const bar of monthBars) {
        if (bar[0] < fromMs) continue;
        if (bar[0] > summary.windowEndMs) break;
        if (bars.length === REPLAY_CHUNK_BARS) {
          nextFromMs = bar[0];
          break;
        }
        bars.push(bar);
      }
    }
    if (bars.length === REPLAY_CHUNK_BARS) break;
    month = month === lastMonth ? null : nextMonthKey(month);
  }
  const lastBar = bars.length > 0 ? bars[bars.length - 1] : undefined;
  const toMs = lastBar ? lastBar[0] + 60_000 : Math.min(fromMs + 60_000, summary.windowEndMs);

  const years = new Set<number>();
  for (let probe = fromMs; probe <= toMs; probe = nextYearStart(probe)) {
    years.add(new Date(probe).getUTCFullYear());
  }
  const combined: AccountRow[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const descriptor = loaded.manifest.files.find(
      (file) => file.year === year && TELEMETRY_FILE.test(file.name),
    );
    if (!descriptor) continue;
    combined.push(...readTelemetryYear(loaded.root, descriptor));
  }
  // Stable time sort preserves the package's occurrence order at equal times.
  combined.sort((a, b) => a.timeMs - b.timeMs);
  const carry = accountAtCursor(combined, fromMs);
  const windowRows = combined.filter((row) => row.timeMs > fromMs && row.timeMs <= toMs);
  const account = carry ? [carry, ...windowRows] : windowRows;
  if (account.length > REPLAY_CHUNK_ACCOUNT_ROWS) {
    throw new ReplayPackageError(
      `Replay window for basket ${number} has ${account.length} account rows, above the ${REPLAY_CHUNK_ACCOUNT_ROWS} bound.`,
    );
  }
  return {
    fromMs,
    toMs,
    bars,
    account,
    nextFromMs,
    windowStartMs: summary.windowStartMs,
    windowEndMs: summary.windowEndMs,
    candleCache: {
      contract: cache.manifest.contract,
      manifestSha256: cache.manifestSha256,
      contentSha256: cache.manifest.content_sha256 ?? "",
    },
  };
}

const nextYearStart = (ms: number): number => {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
};

export { ReplayPackageError };
