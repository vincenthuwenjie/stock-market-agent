import { MarketDashboard } from "@/components/MarketDashboard";
import { getMarketSnapshot } from "@/lib/market-data";

export const dynamic = "force-dynamic";
export const revalidate = 300;
export const maxDuration = 60;

export default async function Page() {
  const snapshot = await getMarketSnapshot();
  return <MarketDashboard initialData={snapshot} />;
}
