import { get, put } from "@vercel/blob";
import type { OptionSummary, Scalar, SourceStatus } from "@/lib/types";

const OPTION_BLOB_PREFIX = "options";
const LATEST_OPTION_BLOB_PATH = `${OPTION_BLOB_PREFIX}/latest.json`;
const OPTION_BLOB_ACCESS = "private" as const;
const OPTION_CACHE_SECONDS = 300;

type OptionInput = Record<string, unknown>;

export type OptionDailyInput = {
  date?: unknown;
  asOf?: unknown;
  source?: unknown;
  options?: unknown;
};

export type OptionDailySnapshot = {
  schemaVersion: 1;
  date: string;
  asOf: string;
  source: string;
  options: Record<string, OptionSummary>;
};

export type OptionBlobWriteResult = {
  date: string;
  asOf: string;
  count: number;
  paths: {
    daily: string;
    latest: string;
  };
};

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function optionBlobPathForDate(date: string) {
  return `${OPTION_BLOB_PREFIX}/${date}.json`;
}

export function latestOptionBlobPath() {
  return LATEST_OPTION_BLOB_PATH;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDate(value: unknown) {
  if (value === undefined || value === null || value === "") return new Date().toISOString().slice(0, 10);
  if (isDate(value)) return value;
  throw new Error("date must use YYYY-MM-DD format");
}

function normalizeAsOf(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return new Date().toISOString();
}

function normalizeSource(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "partner option blob";
}

function optionalString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function normalizeSymbol(value: string) {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

function objectValue(input: OptionInput, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return undefined;
}

function scalar(value: unknown): Scalar {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(4));
  if (typeof value === "string") {
    const cleaned = value.replaceAll(",", "").replace("%", "").trim();
    if (!cleaned || /^n\/?a$/i.test(cleaned)) return "N/A";
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(4));
  }
  return "N/A";
}

function integerScalar(value: unknown): Scalar {
  const parsed = scalar(value);
  return typeof parsed === "number" ? Math.round(parsed) : parsed;
}

function expiration(value: unknown) {
  if (typeof value === "string") return value.trim();
  return "";
}

function normalizeOptionSummary(raw: unknown, fallbackSource: string): OptionSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as OptionInput;
  const callOpenInterest = integerScalar(objectValue(input, ["callOpenInterest", "call_oi", "callOI", "callOi", "callsOi"]));
  const putOpenInterest = integerScalar(objectValue(input, ["putOpenInterest", "put_oi", "putOI", "putOi", "putsOi"]));
  const ratioInput = objectValue(input, ["putCallOiRatio", "put_call_oi_ratio", "putCallRatio", "pcr"]);
  const putCallOiRatio = scalar(ratioInput);
  const computedRatio = putCallOiRatio === "N/A" && typeof callOpenInterest === "number" && typeof putOpenInterest === "number" && callOpenInterest > 0
    ? Number((putOpenInterest / callOpenInterest).toFixed(4))
    : putCallOiRatio;

  return {
    source: optionalString(objectValue(input, ["source"])) ?? fallbackSource,
    maxPain: scalar(objectValue(input, ["maxPain", "max_pain", "maxpain"])),
    iv: scalar(objectValue(input, ["iv", "impliedVolatility", "implied_volatility"])),
    callOpenInterest,
    putOpenInterest,
    putCallOiRatio: computedRatio,
    expiration: expiration(objectValue(input, ["expiration", "expiry", "expiryDate", "expirationDate"])),
  };
}

export function normalizeOptionDailyInput(input: OptionDailyInput): OptionDailySnapshot {
  const date = normalizeDate(input.date);
  const asOf = normalizeAsOf(input.asOf);
  const source = normalizeSource(input.source);
  const rawOptions = input.options;
  if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
    throw new Error("options must be an object keyed by stock symbol");
  }

  const options = Object.fromEntries(
    Object.entries(rawOptions as Record<string, unknown>)
      .map(([symbol, raw]) => [normalizeSymbol(symbol), normalizeOptionSummary(raw, source)] as const)
      .filter((entry): entry is [string, OptionSummary] => Boolean(entry[0] && entry[1])),
  );

  if (!Object.keys(options).length) throw new Error("options must include at least one valid symbol");

  return {
    schemaVersion: 1,
    date,
    asOf,
    source,
    options,
  };
}

async function blobToText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

export async function readLatestOptionSnapshot(statuses?: SourceStatus[]): Promise<OptionDailySnapshot | null> {
  if (!hasBlobToken()) {
    statuses?.push({ name: "vercel-blob:options", status: "skipped", detail: "BLOB_READ_WRITE_TOKEN is not configured" });
    return null;
  }

  try {
    const result = await get(LATEST_OPTION_BLOB_PATH, { access: OPTION_BLOB_ACCESS, useCache: false });
    if (!result || result.statusCode !== 200) {
      statuses?.push({ name: "vercel-blob:options", status: "missing", detail: `${LATEST_OPTION_BLOB_PATH} not found` });
      return null;
    }
    const payload = JSON.parse(await blobToText(result.stream)) as OptionDailyInput;
    const snapshot = normalizeOptionDailyInput(payload);
    statuses?.push({ name: "vercel-blob:options", status: "ok", detail: `${Object.keys(snapshot.options).length} option summaries from ${LATEST_OPTION_BLOB_PATH}` });
    return snapshot;
  } catch (error) {
    statuses?.push({ name: "vercel-blob:options", status: "missing", detail: error instanceof Error ? error.message : "failed to read option blob" });
    return null;
  }
}

export async function writeOptionSnapshot(input: OptionDailyInput): Promise<OptionBlobWriteResult> {
  if (!hasBlobToken()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");

  const snapshot = normalizeOptionDailyInput(input);
  const body = JSON.stringify(snapshot, null, 2);
  const dailyPath = optionBlobPathForDate(snapshot.date);

  await Promise.all([
    put(dailyPath, body, {
      access: OPTION_BLOB_ACCESS,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: OPTION_CACHE_SECONDS,
    }),
    put(LATEST_OPTION_BLOB_PATH, body, {
      access: OPTION_BLOB_ACCESS,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: OPTION_CACHE_SECONDS,
    }),
  ]);

  return {
    date: snapshot.date,
    asOf: snapshot.asOf,
    count: Object.keys(snapshot.options).length,
    paths: {
      daily: dailyPath,
      latest: LATEST_OPTION_BLOB_PATH,
    },
  };
}
