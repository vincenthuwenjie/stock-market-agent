import { readFileSync } from "node:fs";
import { join } from "node:path";

import latestSnapshot from "@/latest.json";
import type { InfluencerMockAnalysisItem, MarketSnapshot } from "@/lib/types";

const MISSING = "N/A" as const;

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function clipText(value: string, length = 180) {
  const text = stripTags(value).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseBundledInfluencerMarkdown(markdown: string) {
  const asOf = markdown.match(/^# Daily Collection\s+[—-]\s+(.+)$/m)?.[1]?.trim() ?? "";
  const headingPattern = /^###\s+(.+?)\s+\(@([^)]+)\)\s+[—-]\s+(.+)$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  const priority = new Set(["Corsica267", "KobeissiLetter", "NickTimiraos", "DeItaone", "zerohedge", "unusual_whales", "Balloon_Capital", "TJ_Research"]);

  const items = headings
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = headings[index + 1]?.index ?? markdown.length;
      const body = markdown.slice(start, end);
      const evidence = body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("- "))
        .map((line) => clipText(line.slice(2), 240))
        .filter((line) => line && !/^likes:|^views:|^RT:/i.test(line))
        .slice(0, 2);

      const joined = evidence.join(" ").toLowerCase();
      const theme = joined.match(/fed|fomc|powell|treasury|yield|liquidity|美联储|财政部|收益率|流动性/)
        ? "Macro / Fed"
        : joined.match(/iran|israel|ukraine|war|tariff|hormuz|伊朗|关税|战争/)
          ? "Geopolitics"
          : joined.match(/spx|qqq|nasdaq|stock|buy the dip|sell the rip|股市|美股/)
            ? "Equity Tape"
            : "Market Narrative";
      const stance: InfluencerMockAnalysisItem["stance"] = joined.match(/risk|war|tariff|vix|short|担忧|避险|下跌|战争/)
        ? "bearish"
        : joined.match(/buy the dip|bullish|long|peace|利好|上涨|反弹/)
          ? "bullish"
          : "neutral";

      return {
        score: (priority.has(match[2] ?? "") ? 10 : 0) + evidence.length,
        item: {
          name: match[1]?.trim() ?? "",
          handle: `@${match[2]?.trim() ?? ""}`,
          domain: match[3]?.trim() ?? "",
          theme,
          stance,
          thesis: evidence[0] ? `${match[1]?.trim()}: ${clipText(evidence[0], 150)}` : "No recent market-relevant post extracted",
          marketRead: "Bundled fallback read; live API refresh will replace this with the full mock analysis when available.",
          evidence,
        } satisfies InfluencerMockAnalysisItem,
      };
    })
    .filter(({ item }) => item.evidence.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ item }) => item);

  return {
    asOf,
    source: "data/influencer-and-press-collection-agent/latest.md",
    summary: items.length ? "Bundled influencer mock analysis loaded instantly; live refresh runs in the background." : "No bundled influencer analysis available.",
    items,
  };
}

function bundledInfluencerMockAnalysis() {
  try {
    const markdown = readFileSync(join(process.cwd(), "data/influencer-and-press-collection-agent/latest.md"), "utf8");
    return parseBundledInfluencerMarkdown(markdown);
  } catch {
    return {
      asOf: "",
      source: "data/influencer-and-press-collection-agent/latest.md",
      summary: "Bundled influencer analysis unavailable.",
      items: [] as InfluencerMockAnalysisItem[],
    };
  }
}

export function getFallbackMarketSnapshot(): MarketSnapshot {
  const snapshot = latestSnapshot as unknown as Omit<MarketSnapshot, "influencerMockAnalysis">;
  return {
    ...snapshot,
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    meta: {
      ...snapshot.meta,
      refreshSeconds: snapshot.meta.refreshSeconds ?? 300,
    },
    sourcesStatus: [
      { name: "fallback:snapshot", status: "ok", detail: "Bundled snapshot renders immediately; live data refreshes after load." },
      ...(snapshot.sourcesStatus ?? []),
    ],
    influencerMockAnalysis: bundledInfluencerMockAnalysis(),
    macroIndicators: {
      ...snapshot.macroIndicators,
      liquidity: snapshot.macroIndicators.liquidity ?? {
        netLiquidity: MISSING,
        netLiquidityChange1w: MISSING,
        netLiquidityChange4w: MISSING,
        fedBalanceSheet: MISSING,
        tga: MISSING,
        rrp: MISSING,
        asOf: "",
        source: "fallback snapshot; refresh for FRED",
        formula: "WALCL - WTREGEN - RRPONTSYD",
      },
    },
  };
}
