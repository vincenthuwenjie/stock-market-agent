import { NextResponse } from "next/server";
import { readOptionSqlHistory } from "@/lib/option-sql";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function splitParam(value: string | null, fallback: string[] = []) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function daysParam(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 30;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const result = await readOptionSqlHistory({
      symbols: splitParam(searchParams.get("symbols")),
      metrics: splitParam(searchParams.get("metrics"), ["all"]),
      days: daysParam(searchParams.get("days")),
    });
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read option history";
    const status = message.includes("required") ? 400 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
