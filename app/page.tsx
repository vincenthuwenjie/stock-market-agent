import { MarketDashboard } from "@/components/MarketDashboard";
import { getFallbackMarketSnapshot } from "@/lib/fallback-snapshot";

export const dynamic = "force-static";
export const revalidate = 300;

export default function Page() {
  return <MarketDashboard initialData={getFallbackMarketSnapshot()} />;
}
