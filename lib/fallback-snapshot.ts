import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import latestSnapshot from "@/latest.json";
import type { InfluencerMockAnalysisItem, MarketSnapshot } from "@/lib/types";

const MISSING = "N/A" as const;

type InfluencerTweetRecord = {
  text: string;
  time: string;
  quote?: {
    author: string;
    text: string;
  };
};

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function clipText(value: string, length = 180) {
  const text = stripTags(value).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function influencerLocaleFromContent(...values: string[]): InfluencerMockAnalysisItem["locale"] {
  return values.some((value) => /[\u3400-\u9fff]/.test(value)) ? "chinese" : "english";
}

function selectInfluencerItems(scored: Array<{ score: number; item: InfluencerMockAnalysisItem }>) {
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ item }) => item);
}

function parseBundledInfluencerMarkdown(markdown: string, source = "data/influencer-and-press-collection-agent/latest.md") {
  const asOf = markdown.match(/^# Daily(?: AI Tech Updates| Collection)\s+[—-]\s+(.+)$/m)?.[1]?.trim() ?? "";
  const defaultDomain = markdown.startsWith("# Daily AI Tech Updates") ? "AI / Tech" : "";
  const headingPattern = /^###\s+(.+?)\s+\(@([^)]+)\)(?:[ \t]+[—-][ \t]+(.+))?$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  const priority = new Set(["Corsica267", "KobeissiLetter", "NickTimiraos", "DeItaone", "zerohedge", "unusual_whales", "Balloon_Capital", "TJ_Research"]);
  const profileMap = bundledInfluencerProfiles();

  const scored = headings
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = headings[index + 1]?.index ?? markdown.length;
      const body = markdown.slice(start, end);
      const tweets = parseTweetRecords(body).slice(0, 2);
      const evidence = tweets.map(formatTweetEvidence);

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
          profileBio: parseInfluencerProfileBio(body) || profileMap[(match[2] ?? "").toLowerCase()] || "",
          locale: influencerLocaleFromContent(
            match[1]?.trim() ?? "",
            parseInfluencerProfileBio(body),
            tweets.map((tweet) => `${tweet.text} ${tweet.quote?.author ?? ""} ${tweet.quote?.text ?? ""}`).join(" "),
          ),
          domain: match[3]?.trim() || defaultDomain,
          theme,
          stance,
          thesis: evidence[0] ? `${match[1]?.trim()}: ${clipText(evidence[0], 150)}` : "No recent market-relevant post extracted",
          marketRead: "Bundled fallback read; live API refresh will replace this with the full mock analysis when available.",
          evidence,
          tweets,
        } satisfies InfluencerMockAnalysisItem,
      };
    })
    .filter(({ item }) => item.evidence.length);
  const items = selectInfluencerItems(scored);

  return {
    asOf,
    source,
    summary: items.length ? "Bundled influencer mock analysis loaded instantly; live refresh runs in the background." : "No bundled influencer analysis available.",
    items,
  };
}

function bundledInfluencerProfiles() {
  try {
    const source = join(process.cwd(), "data/influencer-and-press-collection-agent", "sources.md");
    const markdown = readFileSync(source, "utf8");
    const profiles: Record<string, string> = {};
    for (const line of markdown.split(/\r?\n/)) {
      if (!line.startsWith("| @")) continue;
      const cols = line.split("|").slice(1, -1).map((col) => col.trim());
      if (cols.length < 4) continue;
      profiles[cols[0].replace(/^@/, "").toLowerCase()] = cols[2];
    }
    return profiles;
  } catch {
    return {} as Record<string, string>;
  }
}

function parseInfluencerProfileBio(body: string) {
  return body.match(/^>\s*(?:Bio|简介):\s*(.+)$/m)?.[1]?.trim() ?? "";
}

function parseTweetRecords(body: string): InfluencerTweetRecord[] {
  const lines = body.split(/\r?\n/);
  const records: InfluencerTweetRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("- ")) continue;
    const tweet = clipText(line.slice(2), 220);
    if (!tweet || /^likes:|^views:|^RT:/i.test(tweet)) continue;

    let timestamp = "";
    let quote: InfluencerTweetRecord["quote"];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor];
      if (nextLine.startsWith("- ")) break;
      timestamp = nextLine.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)?.[0] ?? timestamp;
      const quoteMatch = nextLine.match(/^\s+-\s*(?:quote|quoted|引用):\s*(.+?)\s+[—-]\s+(.+)$/i)
        ?? nextLine.match(/^\s+-\s*(?:quote|quoted|引用):\s*(.+?):\s+(.+)$/i);
      if (quoteMatch) {
        quote = {
          author: quoteMatch[1].trim(),
          text: clipText(quoteMatch[2].trim(), 180),
        };
      }
    }
    records.push({ text: tweet, time: timestamp, quote });
  }
  return records;
}

function formatTweetEvidence(record: InfluencerTweetRecord) {
  const prefix = record.time ? `[${record.time}] ` : "";
  const quote = record.quote ? ` 引用：${record.quote.author} — ${record.quote.text}` : "";
  return `${prefix}${record.text}${quote}`;
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
