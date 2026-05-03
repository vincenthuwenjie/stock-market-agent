import type { OptionSummary, Scalar } from "@/lib/types";

type OptionInput = Record<string, unknown>;

export type OptionDailyInput = {
  date?: unknown;
  asOf?: unknown;
  source?: unknown;
  options?: unknown;
};

export type NormalizedOptionRecord = {
  symbol: string;
  summary: OptionSummary;
  raw: unknown;
};

export type NormalizedOptionDaily = {
  date: string;
  asOf: string;
  source: string;
  records: NormalizedOptionRecord[];
  options: Record<string, OptionSummary>;
};

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
  return "partner option sql";
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

export function scalarToNumber(value: Scalar): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeOptionDailyInput(input: OptionDailyInput): NormalizedOptionDaily {
  const date = normalizeDate(input.date);
  const asOf = normalizeAsOf(input.asOf);
  const source = normalizeSource(input.source);
  const rawOptions = input.options;
  if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
    throw new Error("options must be an object keyed by stock symbol");
  }

  const records = Object.entries(rawOptions as Record<string, unknown>)
    .map(([symbol, raw]) => {
      const normalizedSymbol = normalizeSymbol(symbol);
      const summary = normalizeOptionSummary(raw, source);
      if (!normalizedSymbol || !summary) return null;
      return { symbol: normalizedSymbol, summary, raw };
    })
    .filter((record): record is NormalizedOptionRecord => Boolean(record));

  if (!records.length) throw new Error("options must include at least one valid symbol");

  return {
    date,
    asOf,
    source,
    records,
    options: Object.fromEntries(records.map((record) => [record.symbol, record.summary])),
  };
}
