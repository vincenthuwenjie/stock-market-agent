import { readdirSync, readFileSync } from "node:fs";
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

function parseBundledInfluencerMarkdown(markdown: string, source = "data/influencer-and-press-collection-agent/latest.md") {
  const asOf = markdown.match(/^# Daily(?: AI Tech Updates| Collection)\s+[—-]\s+(.+)$/m)?.[1]?.trim() ?? "";
  const defaultDomain = markdown.startsWith("# Daily AI Tech Updates") ? "AI / Tech" : "";
  const headingPattern = /^###\s+(.+?)\s+\(@([^)]+)\)(?:[ \t]+[—-][ \t]+(.+))?$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  const priority = new Set(["Corsica267", "KobeissiLetter", "NickTimiraos", "DeItaone", "zerohedge", "unusual_whales", "Balloon_Capital", "TJ_Research"]);

  const items = headings
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = headings[index + 1]?.index ?? markdown.length;
      const body = markdown.slice(start, end);
      const evidence = tweetEvidenceWithTime(body).slice(0, 2);

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
          domain: match[3]?.trim() || defaultDomain,
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
    source,
    summary: items.length ? "Bundled influencer mock analysis loaded instantly; live refresh runs in the background." : "No bundled influencer analysis available.",
    items,
  };
}

function tweetEvidenceWithTime(body: string) {
  const lines = body.split(/\r?\n/);
  const evidence: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("- ")) continue;
    const tweet = clipText(line.slice(2), 220);
    if (!tweet || /^likes:|^views:|^RT:/i.test(tweet)) continue;

    let timestamp = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor];
      if (nextLine.startsWith("- ")) break;
      timestamp = nextLine.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)?.[0] ?? timestamp;
      if (timestamp) break;
    }
    evidence.push(timestamp ? `[${timestamp}] ${tweet}` : tweet);
  }
  return evidence;
}

function sourceRank(source: string, markdown: string) {
  return markdown.match(/^# Daily(?: AI Tech Updates| Collection)\s+[—-]\s+(\d{4}-\d{2}-\d{2})$/m)?.[1]
    ?? source.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1]
    ?? "";
}

function bundledInfluencerMockAnalysis() {
  try {
    const root = join(process.cwd(), "data/influencer-and-press-collection-agent");
    const candidates = [join(root, "latest.md")];
    try {
      candidates.push(...readdirSync(join(root, "daily-ai-tech"))
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
        .map((file) => join(root, "daily-ai-tech", file)));
    } catch {
      // The AI tech directory is optional in bundled snapshots.
    }
    const freshest = candidates
      .map((source) => {
        try {
          const markdown = readFileSync(source, "utf8");
          return { source, markdown, rank: sourceRank(source, markdown) };
        } catch {
          return null;
        }
      })
      .filter((item): item is { source: string; markdown: string; rank: string } => Boolean(item))
      .sort((a, b) => b.rank.localeCompare(a.rank))[0];
    if (!freshest) throw new Error("No bundled influencer markdown source");
    const markdown = freshest.markdown;
    return parseBundledInfluencerMarkdown(markdown, freshest.source.replace(process.cwd(), "").replace(/^\//, ""));
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
