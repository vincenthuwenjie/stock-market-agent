import { neon } from "@neondatabase/serverless";
import { normalizeOptionDailyInput, scalarToNumber, type OptionDailyInput } from "@/lib/option-data";
import type { OptionSummary, Scalar, SourceStatus } from "@/lib/types";

type SqlClient = ReturnType<typeof neon>;

type OptionDailyRow = {
  symbol: string;
  trade_date: string;
  as_of: string | Date | null;
  source: string | null;
  max_pain: number | string | null;
  iv: number | string | null;
  call_open_interest: number | string | null;
  put_open_interest: number | string | null;
  put_call_oi_ratio: number | string | null;
  expiration: string | null;
  payload?: Record<string, unknown> | null;
};

export type OptionSqlWriteResult = {
  date: string;
  asOf: string;
  count: number;
  table: "option_daily";
};

export type OptionHistoryParams = {
  symbols: string[];
  metrics: string[];
  days: number;
};

export type OptionHistoryPoint = {
  date: string;
  asOf: string | null;
  values: Record<string, Scalar | string>;
};

export type OptionHistoryResult = {
  days: number;
  metrics: string[];
  symbols: Record<string, OptionHistoryPoint[]>;
};

let sqlClient: SqlClient | null = null;
let didEnsureSchema = false;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || "";
}

function hasDatabaseUrl() {
  return Boolean(databaseUrl());
}

function getSql() {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

function dateOnly(value: string) {
  return String(value).slice(0, 10);
}

function numberScalar(value: number | string | null): Scalar {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(4));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(4));
  }
  return "N/A";
}

function integerScalar(value: number | string | null): Scalar {
  const parsed = numberScalar(value);
  return typeof parsed === "number" ? Math.round(parsed) : parsed;
}

function normalizeSymbol(value: string) {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

function normalizeMetric(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_]/g, "");
}

async function ensureOptionSchema() {
  if (didEnsureSchema) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS option_daily (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      trade_date DATE NOT NULL,
      as_of TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'partner option sql',
      max_pain DOUBLE PRECISION,
      iv DOUBLE PRECISION,
      call_open_interest BIGINT,
      put_open_interest BIGINT,
      put_call_oi_ratio DOUBLE PRECISION,
      expiration TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (symbol, trade_date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS option_daily_trade_date_idx ON option_daily (trade_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS option_daily_symbol_idx ON option_daily (symbol)`;
  didEnsureSchema = true;
}

export async function writeOptionSqlSnapshot(input: OptionDailyInput): Promise<OptionSqlWriteResult> {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL is not configured");
  const snapshot = normalizeOptionDailyInput(input);
  await ensureOptionSchema();
  const sql = getSql();

  await Promise.all(snapshot.records.map((record) => sql`
    INSERT INTO option_daily (
      symbol,
      trade_date,
      as_of,
      source,
      max_pain,
      iv,
      call_open_interest,
      put_open_interest,
      put_call_oi_ratio,
      expiration,
      payload
    )
    VALUES (
      ${record.symbol},
      ${snapshot.date},
      ${snapshot.asOf},
      ${record.summary.source},
      ${scalarToNumber(record.summary.maxPain)},
      ${scalarToNumber(record.summary.iv)},
      ${scalarToNumber(record.summary.callOpenInterest)},
      ${scalarToNumber(record.summary.putOpenInterest)},
      ${scalarToNumber(record.summary.putCallOiRatio)},
      ${record.summary.expiration || null},
      ${JSON.stringify(record.raw)}::jsonb
    )
    ON CONFLICT (symbol, trade_date)
    DO UPDATE SET
      as_of = EXCLUDED.as_of,
      source = EXCLUDED.source,
      max_pain = EXCLUDED.max_pain,
      iv = EXCLUDED.iv,
      call_open_interest = EXCLUDED.call_open_interest,
      put_open_interest = EXCLUDED.put_open_interest,
      put_call_oi_ratio = EXCLUDED.put_call_oi_ratio,
      expiration = EXCLUDED.expiration,
      payload = EXCLUDED.payload,
      updated_at = now()
  `));

  return {
    date: snapshot.date,
    asOf: snapshot.asOf,
    count: snapshot.records.length,
    table: "option_daily",
  };
}

function rowToSummary(row: OptionDailyRow): OptionSummary {
  return {
    source: row.source || "option_daily",
    maxPain: numberScalar(row.max_pain),
    iv: numberScalar(row.iv),
    callOpenInterest: integerScalar(row.call_open_interest),
    putOpenInterest: integerScalar(row.put_open_interest),
    putCallOiRatio: numberScalar(row.put_call_oi_ratio),
    expiration: row.expiration || "",
  };
}

const METRIC_COLUMNS: Record<string, keyof OptionDailyRow> = {
  maxPain: "max_pain",
  max_pain: "max_pain",
  iv: "iv",
  callOpenInterest: "call_open_interest",
  call_open_interest: "call_open_interest",
  putOpenInterest: "put_open_interest",
  put_open_interest: "put_open_interest",
  putCallOiRatio: "put_call_oi_ratio",
  put_call_oi_ratio: "put_call_oi_ratio",
  expiration: "expiration",
};

function historyMetricValue(row: OptionDailyRow, metric: string): Scalar | string {
  const column = METRIC_COLUMNS[metric];
  if (column) {
    const value = row[column];
    if (metric === "expiration") return typeof value === "string" ? value : "";
    return numberScalar(typeof value === "number" || typeof value === "string" ? value : null);
  }

  const raw = row.payload?.[metric];
  if (typeof raw === "number") return numberScalar(raw);
  if (typeof raw === "string") {
    const numeric = numberScalar(raw);
    return numeric === "N/A" ? raw : numeric;
  }
  if (raw === null || raw === undefined) return "N/A";
  return String(raw);
}

export async function readLatestSqlOptionSnapshot(statuses?: SourceStatus[]) {
  if (!hasDatabaseUrl()) {
    statuses?.push({ name: "postgres:options", status: "skipped", detail: "DATABASE_URL is not configured" });
    return null;
  }

  try {
    await ensureOptionSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT symbol, trade_date::text AS trade_date, as_of, source, max_pain, iv, call_open_interest, put_open_interest, put_call_oi_ratio, expiration
      FROM option_daily
      WHERE trade_date = (SELECT max(trade_date) FROM option_daily)
      ORDER BY symbol
    ` as OptionDailyRow[];

    if (!rows.length) {
      statuses?.push({ name: "postgres:options", status: "missing", detail: "option_daily has no rows" });
      return null;
    }

    const tradeDate = dateOnly(rows[0]?.trade_date ?? "");
    const options = Object.fromEntries(rows.map((row) => [row.symbol, rowToSummary(row)]));
    statuses?.push({ name: "postgres:options", status: "ok", detail: `${rows.length} option summaries from option_daily ${tradeDate}` });
    return { date: tradeDate, options };
  } catch (error) {
    statuses?.push({ name: "postgres:options", status: "missing", detail: error instanceof Error ? error.message : "failed to read option_daily" });
    return null;
  }
}

export async function readOptionSqlHistory(params: OptionHistoryParams): Promise<OptionHistoryResult> {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL is not configured");
  const symbols = [...new Set(params.symbols.map(normalizeSymbol).filter(Boolean))].slice(0, 500);
  const metrics = [...new Set(params.metrics.map(normalizeMetric).filter(Boolean))].slice(0, 50);
  const days = Math.min(Math.max(Math.round(params.days || 30), 1), 365);

  if (!symbols.length) throw new Error("symbols query parameter is required");
  if (!metrics.length) throw new Error("metrics query parameter is required");

  await ensureOptionSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT symbol, trade_date::text AS trade_date, as_of, source, max_pain, iv, call_open_interest, put_open_interest, put_call_oi_ratio, expiration, payload
    FROM option_daily
    WHERE symbol = ANY(${symbols}::text[])
      AND trade_date >= (CURRENT_DATE - ${days - 1}::int)
    ORDER BY symbol, trade_date
  ` as OptionDailyRow[];

  const result: OptionHistoryResult = {
    days,
    metrics,
    symbols: Object.fromEntries(symbols.map((symbol) => [symbol, []])),
  };

  for (const row of rows) {
    const values = Object.fromEntries(metrics.map((metric) => [metric, historyMetricValue(row, metric)]));
    result.symbols[row.symbol] ??= [];
    result.symbols[row.symbol].push({
      date: row.trade_date,
      asOf: row.as_of ? new Date(row.as_of).toISOString() : null,
      values,
    });
  }

  return result;
}
