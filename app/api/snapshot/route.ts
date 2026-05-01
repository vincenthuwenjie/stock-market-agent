import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market-data";

export const dynamic = "force-dynamic";
export const revalidate = 300;
export const maxDuration = 60;

export async function GET() {
  const snapshot = await getMarketSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=120",
    },
  });
}
