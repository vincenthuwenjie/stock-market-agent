import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import config from "@/config.json";
import { readLatestSqlOptionSnapshot } from "@/lib/option-sql";
import type { CompleteReportItem, InfluencerMockAnalysisItem, MarketSnapshot, NewsItem, OptionSummary, Scalar, SourceStatus, StockIndicator } from "@/lib/types";

const MISSING: Scalar = "N/A";
const WATCHLIST = config.watchlist;
const ETF_SYMBOLS = ["QQQ", "SPY"] as const;
const REFRESH_SECONDS = 300;
const INFLUENCER_PRIORITY = [
  "Corsica267",
  "KobeissiLetter",
  "NickTimiraos",
  "DeItaone",
  "zerohedge",
  "unusual_whales",
  "Balloon_Capital",
  "TJ_Research",
  "maitian99",
  "Trader_S18",
  "StockSavvyShay",
  "burrytracker",
  "chamath",
  "RayDalio",
];

type Series = number[];
type Quote = {
  symbol: string;
  price: Scalar;
  netChange: Scalar;
  change1dPct: Scalar;
  volume: Scalar;
  timestamp: string;
  isRealTime: boolean;
  source: string;
  ok: boolean;
};

type MarketData = {
  quotes: Record<string, Quote>;
  history: Record<string, Series>;
  epsTtm: Record<string, number>;
  options: Record<string, OptionSummary>;
};

type InfluencerTweetRecord = {
  text: string;
  time: string;
  quote?: {
    author: string;
    text: string;
  };
};

type FredPoint = {
  date: string;
  value: number;
};

type LiquidityRow = {
  asOf: string;
  netLiquidity: number;
  fedBalanceSheet: number;
  tga: number;
  rrp: number;
};

function status(name: string, statusValue: SourceStatus["status"], detail: string): SourceStatus {
  return { name, status: statusValue, detail };
}

function nowIso() {
  return new Date().toISOString();
}

function cleanNumber(value: unknown, digits = 2): Scalar {
  const parsed = parseNumber(value);
  if (parsed === null) return MISSING;
  return Number(parsed.toFixed(digits));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replaceAll("$", "").replaceAll("%", "").replaceAll(",", "").replace(/^\+/, "");
  if (!cleaned || cleaned === "--" || cleaned.toUpperCase() === "N/A") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pctChange(current: unknown, previous: unknown): Scalar {
  const currentNumber = parseNumber(current);
  const previousNumber = parseNumber(previous);
  if (currentNumber === null || previousNumber === null || previousNumber === 0) return MISSING;
  return Number((((currentNumber - previousNumber) / previousNumber) * 100).toFixed(2));
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function fetchText(url: string, timeoutMs = 9000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 ohc-stock-market-agent/nextjs",
        Accept: "application/json,text/csv,text/xml,text/plain,*/*",
      },
      next: { revalidate: REFRESH_SECONDS },
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T = Record<string, unknown>>(url: string, timeoutMs = 9000): Promise<T | null> {
  const text = await fetchText(url, timeoutMs);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&#8217;/g, "'")
    .replace(/&#8230;/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? stripTags(decodeXmlText(match[1] ?? "")) : "";
}

function allTags(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((match) => stripTags(decodeXmlText(match[1] ?? "")))
    .filter(Boolean);
}

async function fetchRss(url: string, source: string, limit = 8): Promise<NewsItem[]> {
  const xml = await fetchText(url, 9000);
  if (!xml) return [];
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const atomBlocks = itemBlocks.length ? [] : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const blocks = itemBlocks.length ? itemBlocks : atomBlocks;
  return blocks.slice(0, limit).map((block) => {
    const linkTag = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? firstTag(block, "link");
    return {
      title: firstTag(block, "title"),
      summary: firstTag(block, "description") || firstTag(block, "summary"),
      source,
      publishedAt: normalizeDate(firstTag(block, "pubDate") || firstTag(block, "updated") || firstTag(block, "published")),
      url: linkTag,
      channel: "rss",
    };
  }).filter((item) => item.title);
}

async function fetchBoistReports(limit = 12): Promise<CompleteReportItem[]> {
  const sourceUrl = "https://boist.org/feed/";
  const xml = await fetchText(sourceUrl, 12000);
  if (!xml) return [];
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => match[0])
    .slice(0, limit)
    .map((block) => ({
      title: firstTag(block, "title"),
      summary: clipText(firstTag(block, "description"), 220),
      source: "boist.org",
      author: firstTag(block, "dc:creator") || "Bo Zeng",
      publishedAt: normalizeDate(firstTag(block, "pubDate")),
      url: firstTag(block, "link"),
      tags: allTags(block, "category").slice(0, 8),
    }))
    .filter((item) => item.title && item.url);
}

function privateReportsEnabled() {
  return process.env.ENABLE_PRIVATE_REPORTS === "1" && process.env.VERCEL !== "1";
}

function privateReportsRoot() {
  return process.env.PRIVATE_REPORTS_DIR || join(process.cwd(), "private_reports");
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { meta: {} as Record<string, string>, body: markdown };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    meta[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: markdown.slice(match[0].length) };
}

function parseTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 8);
  if (typeof value !== "string") return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
}

function inferTitleFromMarkdown(markdown: string, fallback: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback.replace(/\.[^.]+$/, "");
}

function htmlAttr(html: string, selector: RegExp) {
  return decodeEntities(selector.exec(html)?.[1] ?? "").trim();
}

function htmlBlockText(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? stripTags(match[1] ?? "") : "";
}

function htmlMeta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = escapeRegex(name);
    const byName = htmlAttr(html, new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*content=["']([^"']*)["'][^>]*>`, "i"));
    if (byName) return byName;
    const byContentFirst = htmlAttr(html, new RegExp(`<meta\\b(?=[^>]*content=["']([^"']*)["'])(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*>`, "i"));
    if (byContentFirst) return byContentFirst;
  }
  return "";
}

function reportFromHtml(html: string, fallbackPath: string): CompleteReportItem | null {
  const title = htmlMeta(html, ["og:title", "twitter:title"]) || htmlBlockText(html, "title") || fallbackPath.replace(/\.[^.]+$/, "");
  const article = htmlBlockText(html, "article") || htmlBlockText(html, "main") || htmlBlockText(html, "body");
  const body = clipText(article, 8000);
  return reportFromRecord({
    title,
    summary: htmlMeta(html, ["description", "og:description", "twitter:description"]),
    source: htmlMeta(html, ["og:site_name"]) || "local private html",
    author: htmlMeta(html, ["author", "article:author"]) || "Bo Zeng",
    publishedAt: htmlMeta(html, ["article:published_time", "date", "pubdate"]),
    url: htmlMeta(html, ["og:url"]) || `local://${fallbackPath}`,
    body,
  }, fallbackPath);
}

function reportFromRecord(record: Record<string, unknown>, fallbackPath: string): CompleteReportItem | null {
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const body = typeof record.body === "string" ? record.body.trim() : typeof record.content === "string" ? record.content.trim() : "";
  if (!title && !body) return null;
  return {
    title: title || inferTitleFromMarkdown(body, fallbackPath),
    summary: clipText(typeof record.summary === "string" ? record.summary : body, 260),
    source: typeof record.source === "string" ? record.source : "local private reports",
    author: typeof record.author === "string" ? record.author : "Bo Zeng",
    publishedAt: normalizeDate(typeof record.publishedAt === "string" ? record.publishedAt : typeof record.date === "string" ? record.date : ""),
    url: typeof record.url === "string" ? record.url : `local://${fallbackPath}`,
    tags: parseTags(record.tags),
    body,
    storagePath: fallbackPath,
    isPrivate: true,
  };
}

function reportFromMarkdown(markdown: string, fallbackPath: string): CompleteReportItem | null {
  const { meta, body } = parseFrontmatter(markdown);
  return reportFromRecord({
    title: meta.title || inferTitleFromMarkdown(body, fallbackPath),
    summary: meta.summary,
    source: meta.source || "local private reports",
    author: meta.author || "Bo Zeng",
    publishedAt: meta.publishedAt || meta.date,
    url: meta.url || `local://${fallbackPath}`,
    tags: meta.tags,
    body,
  }, fallbackPath);
}

async function listReportFiles(root: string, prefix = ""): Promise<string[]> {
  try {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const entryPath = join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().endsWith("_files")) return [];
        return listReportFiles(root, entryPath);
      }
      const extension = extname(entry.name).toLowerCase();
      if (entry.name.toLowerCase() === "readme.md") return [];
      return [".md", ".markdown", ".json", ".html", ".htm"].includes(extension) ? [entryPath] : [];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

async function readPrivateReports(limit = 24): Promise<CompleteReportItem[]> {
  if (!privateReportsEnabled()) return [];
  const root = privateReportsRoot();
  const files = await listReportFiles(root);
  const reports = await Promise.all(files.map(async (file) => {
    const absolutePath = join(root, file);
    const storagePath = relative(process.cwd(), absolutePath) || file;
    try {
      const text = await readFile(absolutePath, "utf8");
      if (extname(file).toLowerCase() === ".json") {
        const parsed = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
        const records = Array.isArray(parsed) ? parsed : [parsed];
        return records.map((record, index) => reportFromRecord(record, records.length > 1 ? `${storagePath}#${index + 1}` : storagePath));
      }
      if ([".html", ".htm"].includes(extname(file).toLowerCase())) {
        return [reportFromHtml(text, storagePath)];
      }
      return [reportFromMarkdown(text, storagePath)];
    } catch {
      return [];
    }
  }));
  return reports
    .flat()
    .filter((item): item is CompleteReportItem => Boolean(item))
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, limit);
}

async function collectCompleteReports(statuses: SourceStatus[]) {
  const [rssItems, privateItems] = await Promise.all([fetchBoistReports(12), readPrivateReports(24)]);
  const items = [...privateItems, ...rssItems];
  statuses.push(status("reports:boist.org", rssItems.length ? "ok" : "missing", rssItems.length ? `${rssItems.length} public RSS report items` : "RSS unavailable or empty"));
  statuses.push(status(
    "reports:local-private",
    privateReportsEnabled() ? (privateItems.length ? "ok" : "empty") : "skipped",
    privateReportsEnabled()
      ? `${privateItems.length} private local report files loaded from ${privateReportsRoot()}`
      : "disabled outside local runtime; set ENABLE_PRIVATE_REPORTS=1 locally",
  ));
  return {
    asOf: items[0]?.publishedAt ?? "",
    source: privateItems.length ? `${privateReportsRoot()} + https://boist.org/feed/` : "https://boist.org/feed/",
    summary: privateItems.length
      ? "Local private reports are loaded only on this computer; public deployment remains limited to the RSS index."
      : "Bo Zeng report index from public RSS. Subscription-only full text is not mirrored; open source link for the complete report.",
    items,
  };
}

function normalizeDate(value: string) {
  if (!value) return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? value.slice(0, 40) : new Date(time).toISOString();
}

function clipText(value: string, length = 180) {
  const text = stripTags(value).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function scoreNews(title: string, summary: string, keywords: string[]) {
  const text = `${title} ${summary}`.toLowerCase();
  let score = keywords.reduce((count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
  if (/(fed|fomc|powell|cpi|tariff|war|white house)/i.test(text)) score += 2;
  return score;
}

function dedupeNews(items: NewsItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.url || item.title).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectMacroNews(statuses: SourceStatus[]): Promise<NewsItem[]> {
  const keywords = config.macroKeywords;
  const all: NewsItem[] = [];
  const topMarketNews: NewsItem[] = [];
  await Promise.all(config.pressSources.map(async (source) => {
    const items = await fetchRss(source.url, source.name, 10);
    statuses.push(status(`press:${source.name}`, items.length ? "ok" : "missing", items.length ? `${items.length} RSS items` : "RSS unavailable or empty"));
    topMarketNews.push(...items.map((item) => ({ ...item, importance: 0 })));
    for (const item of items) {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
        all.push({ ...item, importance: scoreNews(item.title, item.summary, keywords) });
      }
    }
  }));
  const unique = dedupeNews(all).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  if (unique.length < 20) {
    unique.push(...dedupeNews(topMarketNews).filter((item) => !unique.some((existing) => (existing.url || existing.title) === (item.url || item.title))).slice(0, 20 - unique.length));
  }
  return unique.slice(0, 36);
}

async function collectStockNews(statuses: SourceStatus[]): Promise<Record<string, NewsItem[]>> {
  const result: Record<string, NewsItem[]> = Object.fromEntries(WATCHLIST.map((ticker) => [ticker, []]));
  let total = 0;
  await Promise.all(WATCHLIST.map(async (ticker) => {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
    let items: NewsItem[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      items = await fetchRss(url, `Yahoo Finance ${ticker}`, 8);
      if (items.length) break;
    }
    result[ticker] = items.map((item) => ({ ...item, ticker }));
    total += result[ticker].length;
  }));
  statuses.push(status("yahoo:stock-news", total ? "ok" : "missing", `${total} stock news items`));
  statuses.push(status("futubull", "missing", "not available in Vercel runtime; Yahoo Finance RSS fallback"));
  return result;
}

function parseInfluencerMarkdown(markdown: string) {
  const asOf = markdown.match(/^# Daily(?: AI Tech Updates| Collection)\s+[—-]\s+(.+)$/m)?.[1]?.trim() ?? "";
  const defaultDomain = markdown.startsWith("# Daily AI Tech Updates") ? "AI / Tech" : "";
  const headingPattern = /^###\s+(.+?)\s+\(@([^)]+)\)(?:[ \t]+[—-][ \t]+(.+))?$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  return headings.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const tweetRecords = parseTweetRecords(body);
    return {
      name: match[1]?.trim() ?? "",
      handle: match[2]?.trim() ?? "",
      domain: match[3]?.trim() || defaultDomain,
      profileBio: parseInfluencerProfileBio(body),
      tweetRecords,
      tweets: tweetRecords.map(formatTweetEvidence),
      asOf,
    };
  });
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

function influencerLocaleFromContent(...values: string[]): InfluencerMockAnalysisItem["locale"] {
  return values.some((value) => /[\u3400-\u9fff]/.test(value)) ? "chinese" : "english";
}

function selectInfluencerItems(scored: Array<{ score: number; item: InfluencerMockAnalysisItem }>) {
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ item }) => item);
}

function influencerSourceRank(source: string, markdown: string) {
  return markdown.match(/^# Daily(?: AI Tech Updates| Collection)\s+[—-]\s+(\d{4}-\d{2}-\d{2})$/m)?.[1]
    ?? source.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1]
    ?? "";
}

async function readFreshestLocalInfluencerMarkdown(sourceRoot: string) {
  const root = join(/*turbopackIgnore: true*/ process.cwd(), "data", "influencer-and-press-collection-agent");
  const candidates = [{ source: `${sourceRoot}/latest.md`, path: join(root, "latest.md") }];
  try {
    const aiTechFiles = await readdir(join(root, "daily-ai-tech"));
    candidates.push(...aiTechFiles.filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file)).map((file) => ({
      source: `${sourceRoot}/daily-ai-tech/${file}`,
      path: join(root, "daily-ai-tech", file),
    })));
  } catch {
    // The bundled AI tech directory is optional; latest.md remains the baseline source.
  }

  const readable = await Promise.all(candidates.map(async (candidate) => {
    try {
      const markdown = await readFile(candidate.path, "utf8");
      return { source: candidate.source, markdown, rank: influencerSourceRank(candidate.source, markdown) };
    } catch {
      return null;
    }
  }));

  const freshest = readable
    .filter((item): item is { source: string; markdown: string; rank: string } => Boolean(item))
    .sort((a, b) => b.rank.localeCompare(a.rank))[0];

  if (!freshest) throw new Error("No readable influencer markdown source");
  return freshest;
}

async function readLocalInfluencerProfiles() {
  try {
    const root = join(/*turbopackIgnore: true*/ process.cwd(), "data", "influencer-and-press-collection-agent");
    const markdown = await readFile(join(root, "sources.md"), "utf8");
    const profiles: Record<string, string> = {};
    for (const line of markdown.split(/\r?\n/)) {
      if (!line.startsWith("| @")) continue;
      const cols = line.split("|").slice(1, -1).map((col) => col.trim());
      if (cols.length < 4) continue;
      const handle = cols[0].replace(/^@/, "").toLowerCase();
      profiles[handle] = cols[2];
    }
    return profiles;
  } catch {
    return {} as Record<string, string>;
  }
}

function classifyInfluencerPost(text: string) {
  const lower = text.toLowerCase();
  const rules = [
    { theme: "Macro / Fed", terms: ["fed", "fomc", "powell", "rate", "treasury", "yield", "liquidity", "dxy", "dollar", "美联储", "财政部", "收益率", "利差", "美元", "流动性"] },
    { theme: "Geopolitics", terms: ["war", "iran", "israel", "ukraine", "tariff", "china", "hormuz", "strike", "战争", "伊朗", "关税", "霍尔木兹"] },
    { theme: "Equity Tape", terms: ["spx", "s&p", "qqq", "nasdaq", "stock", "buy the dip", "sell the rip", "200 dma", "美股", "股市", "反弹", "回调"] },
    { theme: "Single Stocks", terms: ["$aapl", "$msft", "$nvda", "$tsla", "$meta", "$googl", "apple", "tesla", "nvidia", "spacex"] },
    { theme: "Commodities", terms: ["oil", "crude", "wti", "brent", "gas", "石油", "油价", "原油"] },
    { theme: "AI / Tech", terms: ["ai", "openai", "anthropic", "model", "gpu", "芯片", "模型", "算力"] },
    { theme: "Crypto", terms: ["bitcoin", "btc", "eth", "stablecoin", "crypto", "加密", "比特币", "稳定币"] },
  ];
  const found = rules.find((rule) => rule.terms.some((term) => lower.includes(term.toLowerCase())));
  return found?.theme ?? "Market Narrative";
}

function stanceForInfluencerPost(text: string): InfluencerMockAnalysisItem["stance"] {
  const lower = text.toLowerCase();
  const bearish = ["sell the rip", "risk", "war", "tariff", "blockade", "strike", "vix", "short", "down", "担忧", "避险", "下跌", "制裁", "战争", "抽水"];
  const bullish = ["buy the dip", "bullish", "long", "reclaim", "peace", "soft landing", "upside", "利好", "上涨", "反弹", "充足"];
  const bearScore = bearish.filter((word) => lower.includes(word)).length;
  const bullScore = bullish.filter((word) => lower.includes(word)).length;
  if (bearScore && bullScore) return "watch";
  if (bearScore) return "bearish";
  if (bullScore) return "bullish";
  return "neutral";
}

function marketReadForTheme(theme: string, stanceValue: InfluencerMockAnalysisItem["stance"]) {
  const direction = stanceValue === "bearish" ? "defensive" : stanceValue === "bullish" ? "constructive" : "watchful";
  if (theme === "Macro / Fed") return `Treat as a ${direction} cross-asset liquidity/rates signal; validate against Fed liquidity, yields, DXY, SPY/QQQ trend.`;
  if (theme === "Geopolitics") return `Treat as a ${direction} headline-risk input; watch oil, VIX, USD/JPY, and gap risk before adding beta.`;
  if (theme === "Equity Tape") return `Treat as a ${direction} market-tape read; confirm with SPY/QQQ MA60, breadth, and options positioning.`;
  if (theme === "Single Stocks") return `Treat as a ${direction} single-name watch item; confirm with M7 trend, PE, and option structure.`;
  if (theme === "Commodities") return `Treat as a ${direction} inflation/geopolitics input; watch crude transmission into CPI and yields.`;
  if (theme === "AI / Tech") return `Treat as a ${direction} AI-tech narrative input; map it to megacap duration risk and semiconductor leadership.`;
  if (theme === "Crypto") return `Treat as a ${direction} liquidity-beta input; watch risk appetite spillover into high beta equities.`;
  return `Treat as a ${direction} narrative signal; use price confirmation before acting on it.`;
}

async function collectInfluencerMockAnalysis(statuses: SourceStatus[]) {
  const sourceRoot = config.sourcePaths.influencerAndPress;
  const localSource = `${sourceRoot}/latest.md`;
  const remoteSource = process.env.INFLUENCER_LATEST_MD_URL;
  let source = remoteSource || localSource;
  try {
    let markdown = "";
    if (remoteSource) {
      markdown = await fetchText(remoteSource, 12000);
      if (!markdown) source = localSource;
    }
    if (!markdown) {
      const local = await readFreshestLocalInfluencerMarkdown(sourceRoot);
      markdown = local.markdown;
      source = local.source;
    }
    const [blocks, profileMap] = await Promise.all([
      Promise.resolve(parseInfluencerMarkdown(markdown)),
      readLocalInfluencerProfiles(),
    ]);
    const scored = blocks
      .map((block) => {
        const tweetRecords = block.tweetRecords.slice(0, 2);
        const evidence = tweetRecords.map(formatTweetEvidence);
        const joined = evidence.join(" ");
        const theme = classifyInfluencerPost(joined);
        const stanceValue = stanceForInfluencerPost(joined);
        const priority = INFLUENCER_PRIORITY.indexOf(block.handle);
        const relevance = ["Finance", "Crypto", "AI"].includes(block.domain) ? 2 : 0;
        const keywordScore = theme === "Market Narrative" ? 0 : 3;
        return {
          score: (priority >= 0 ? 20 - priority : 0) + relevance + keywordScore + evidence.length,
          item: {
            name: block.name,
            handle: `@${block.handle}`,
            profileBio: block.profileBio || profileMap[block.handle.toLowerCase()] || "",
            locale: influencerLocaleFromContent(
              block.name,
              block.profileBio,
              tweetRecords.map((tweet) => `${tweet.text} ${tweet.quote?.author ?? ""} ${tweet.quote?.text ?? ""}`).join(" "),
            ),
            domain: block.domain,
            theme,
            stance: stanceValue,
            thesis: evidence[0] ? `${block.name}: ${clipText(evidence[0], 150)}` : `${block.name}: no recent market-relevant post extracted`,
            marketRead: marketReadForTheme(theme, stanceValue),
            evidence,
            tweets: tweetRecords,
          } satisfies InfluencerMockAnalysisItem,
        };
      })
      .filter(({ item }) => item.evidence.length);
    const items = selectInfluencerItems(scored);

    const themeCounts = items.reduce<Record<string, number>>((counts, item) => {
      counts[item.theme] = (counts[item.theme] ?? 0) + 1;
      return counts;
    }, {});
    const dominantThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([theme]) => theme);
    statuses.push(status("influencer:ai-mock-analysis", items.length ? "ok" : "empty", `${items.length} notes from ${source}`));
    return {
      asOf: blocks[0]?.asOf ?? "",
      source,
      summary: dominantThemes.length
        ? `Mock analysis from influencer feed; dominant themes: ${dominantThemes.join(", ")}.`
        : "No influencer mock analysis items available in the latest collection.",
      items,
    };
  } catch {
    statuses.push(status("influencer:ai-mock-analysis", "missing", `${source} not readable in this runtime`));
    return {
      asOf: "",
      source,
      summary: "Influencer mock analysis unavailable; local collection file is not readable in this runtime.",
      items: [] as InfluencerMockAnalysisItem[],
    };
  }
}

function assetClassFor(symbol: string) {
  return ETF_SYMBOLS.includes(symbol as (typeof ETF_SYMBOLS)[number]) ? "etf" : "stocks";
}

async function fetchNasdaqQuote(symbol: string): Promise<Quote> {
  const assetClass = assetClassFor(symbol);
  const payload = await fetchJson<{ data?: { primaryData?: Record<string, unknown> } }>(
    `https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=${assetClass}`,
    10000,
  );
  const primary = payload?.data?.primaryData ?? {};
  const price = cleanNumber(primary.lastSalePrice, 4);
  return {
    symbol,
    price,
    netChange: cleanNumber(primary.netChange, 4),
    change1dPct: cleanNumber(primary.percentageChange),
    volume: cleanNumber(primary.volume, 0),
    timestamp: typeof primary.lastTradeTimestamp === "string" ? primary.lastTradeTimestamp : "",
    isRealTime: Boolean(primary.isRealTime),
    source: "Nasdaq quote",
    ok: price !== MISSING,
  };
}

async function fetchNasdaqHistory(symbol: string, days = 430): Promise<Series> {
  const assetClass = assetClassFor(symbol);
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const payload = await fetchJson<{
    data?: { tradesTable?: { rows?: Array<Record<string, string>> } };
  }>(
    `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=${assetClass}&fromdate=${start.toISOString().slice(0, 10)}&todate=${end.toISOString().slice(0, 10)}&limit=9999`,
    12000,
  );
  const rows = payload?.data?.tradesTable?.rows ?? [];
  return rows
    .map((row) => ({ date: Date.parse(row.date ?? ""), close: parseNumber(row.close) }))
    .filter((row): row is { date: number; close: number } => Number.isFinite(row.date) && row.close !== null)
    .sort((a, b) => a.date - b.date)
    .map((row) => row.close);
}

async function fetchNasdaqEpsTtm(symbol: string): Promise<Scalar> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await fetchJson<{
      data?: { earningsPerShare?: Array<{ type?: string; earnings?: number }> };
    }>(`https://api.nasdaq.com/api/quote/${symbol}/eps?assetclass=stocks`, 9000);
    const rows = payload?.data?.earningsPerShare ?? [];
    const values = rows.filter((row) => row.type === "PreviousQuarter").map((row) => row.earnings).filter((value): value is number => typeof value === "number" && value > 0);
    if (values.length >= 4) return Number(values.slice(-4).reduce((sum, value) => sum + value, 0).toFixed(4));
  }
  return MISSING;
}

async function fetchNasdaqOptionSummary(symbol: string): Promise<OptionSummary | null> {
  const assetClass = assetClassFor(symbol);
  const payload = await fetchJson<{
    data?: { table?: { rows?: Array<Record<string, string | null>> } };
  }>(`https://api.nasdaq.com/api/quote/${symbol}/option-chain?assetclass=${assetClass}&limit=5000`, 15000);
  const rows = payload?.data?.table?.rows ?? [];
  let expiration = "";
  const optionRows: Array<{ strike: number; callOi: number; putOi: number }> = [];
  for (const row of rows) {
    if (row.expirygroup && !expiration) {
      expiration = row.expirygroup;
      continue;
    }
    if (row.expirygroup && expiration && optionRows.length) break;
    const strike = parseNumber(row.strike);
    if (strike === null) continue;
    optionRows.push({
      strike,
      callOi: parseNumber(row.c_Openinterest) ?? 0,
      putOi: parseNumber(row.p_Openinterest) ?? 0,
    });
  }
  if (!optionRows.length) return null;
  const callOpenInterest = optionRows.reduce((sum, row) => sum + row.callOi, 0);
  const putOpenInterest = optionRows.reduce((sum, row) => sum + row.putOi, 0);
  return {
    source: "Nasdaq option-chain",
    maxPain: estimateMaxPain(optionRows),
    iv: MISSING,
    callOpenInterest: Math.round(callOpenInterest),
    putOpenInterest: Math.round(putOpenInterest),
    putCallOiRatio: callOpenInterest ? Number((putOpenInterest / callOpenInterest).toFixed(2)) : MISSING,
    expiration,
  };
}

function estimateMaxPain(rows: Array<{ strike: number; callOi: number; putOi: number }>): Scalar {
  const strikes = [...new Set(rows.map((row) => row.strike))].sort((a, b) => a - b);
  if (!strikes.length) return MISSING;
  let bestStrike = strikes[0] ?? 0;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const candidate of strikes) {
    const loss = rows.reduce((sum, row) => {
      return sum + Math.max(0, candidate - row.strike) * row.callOi + Math.max(0, row.strike - candidate) * row.putOi;
    }, 0);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestStrike = candidate;
    }
  }
  return cleanNumber(bestStrike);
}

async function collectNasdaqData(symbols: string[], optionSymbols: string[], statuses: SourceStatus[]): Promise<MarketData> {
  const uniqueSymbols = [...new Set(symbols)];
  const data: MarketData = { quotes: {}, history: {}, epsTtm: {}, options: {} };

  const quotes = await Promise.all(uniqueSymbols.map(fetchNasdaqQuote));
  for (const quote of quotes) {
    if (quote.ok) data.quotes[quote.symbol] = quote;
  }

  const histories = await Promise.all(uniqueSymbols.map(async (symbol) => [symbol, await fetchNasdaqHistory(symbol)] as const));
  for (const [symbol, series] of histories) {
    if (series.length) data.history[symbol] = series;
  }

  const eps = await Promise.all(uniqueSymbols.filter((symbol) => assetClassFor(symbol) === "stocks").map(async (symbol) => [symbol, await fetchNasdaqEpsTtm(symbol)] as const));
  for (const [symbol, value] of eps) {
    if (typeof value === "number") data.epsTtm[symbol] = value;
  }

  const options = await Promise.all(optionSymbols.map(async (symbol) => [symbol, await fetchNasdaqOptionSummary(symbol)] as const));
  for (const [symbol, option] of options) {
    if (option) data.options[symbol] = option;
  }

  statuses.push(status("nasdaq:quotes", data.quotes ? "ok" : "missing", `${Object.keys(data.quotes).length}/${uniqueSymbols.length} quotes`));
  statuses.push(status("nasdaq:history", data.history ? "ok" : "missing", `${Object.keys(data.history).length}/${uniqueSymbols.length} histories`));
  statuses.push(status("nasdaq:eps", Object.keys(data.epsTtm).length ? "ok" : "missing", `${Object.keys(data.epsTtm).length} TTM EPS values`));
  statuses.push(status("nasdaq:options", Object.keys(data.options).length ? "ok" : "missing", `${Object.keys(data.options).length}/${optionSymbols.length} option chains`));
  return data;
}

async function fetchCboeIndex(symbol: "VIX" | "VXN", statuses: SourceStatus[]) {
  const csv = await fetchText(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${symbol}_History.csv`, 12000);
  const rows = csv.split(/\r?\n/).slice(1).map((line) => line.split(",")).filter((cols) => cols.length >= 5);
  const closes = rows.map((cols) => parseNumber(cols[4])).filter((value): value is number => value !== null);
  if (closes.length < 2) {
    statuses.push(status(`cboe:${symbol.toLowerCase()}`, "missing", `${symbol} history unavailable`));
    return { value: MISSING, change1dPct: MISSING, source: `Cboe ${symbol} history` };
  }
  statuses.push(status(`cboe:${symbol.toLowerCase()}`, "ok", `latest close from Cboe CSV`));
  return {
    value: cleanNumber(closes.at(-1)),
    change1dPct: pctChange(closes.at(-1), closes.at(-2)),
    source: `Cboe ${symbol} history`,
  };
}

async function fetchTreasuryCurve(statuses: SourceStatus[]) {
  const year = new Date().getUTCFullYear();
  const csv = await fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`, 12000);
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0]?.split(",").map((header) => header.replaceAll('"', "")) ?? [];
  const rows = lines.slice(1).map((line) => line.split(",").map((cell) => cell.replaceAll('"', ""))).filter((row) => row.length === headers.length);
  if (!rows.length) {
    statuses.push(status("treasury:yield-curve", "missing", "CSV unavailable"));
    return {};
  }
  const latest = rows[0] ?? [];
  const previous = rows[5] ?? rows[1] ?? latest;
  const read = (row: string[], column: string) => parseNumber(row[headers.indexOf(column)]);
  const asOf = latest[headers.indexOf("Date")] ?? "";
  statuses.push(status("treasury:yield-curve", "ok", `latest ${asOf}`));
  return {
    US1Y: { yield: cleanNumber(read(latest, "1 Yr")), change5dPct: pctChange(read(latest, "1 Yr"), read(previous, "1 Yr")), asOf, source: "US Treasury daily yield curve" },
    US10Y: { yield: cleanNumber(read(latest, "10 Yr")), change5dPct: pctChange(read(latest, "10 Yr"), read(previous, "10 Yr")), asOf, source: "US Treasury daily yield curve" },
    US20Y: { yield: cleanNumber(read(latest, "20 Yr")), change5dPct: pctChange(read(latest, "20 Yr"), read(previous, "20 Yr")), asOf, source: "US Treasury daily yield curve" },
    US30Y: { yield: cleanNumber(read(latest, "30 Yr")), change5dPct: pctChange(read(latest, "30 Yr"), read(previous, "30 Yr")), asOf, source: "US Treasury daily yield curve" },
  };
}

async function fetchFx(statuses: SourceStatus[]) {
  const payload = await fetchJson<{ rates?: Record<string, number>; time_last_update_utc?: string }>("https://open.er-api.com/v6/latest/USD", 8000);
  const rates = payload?.rates ?? {};
  if (!rates.CNY || !rates.JPY) {
    statuses.push(status("fx:open-er-api", "missing", "USD rates unavailable"));
    return {};
  }
  statuses.push(status("fx:open-er-api", "ok", payload?.time_last_update_utc ?? "latest USD rates"));
  return {
    USDCNY: { value: cleanNumber(rates.CNY, 4), change1dPct: MISSING, source: "open.er-api.com" },
    USDJPY: { value: cleanNumber(rates.JPY, 4), change1dPct: MISSING, source: "open.er-api.com" },
  };
}

function parseFredCsv(csv: string): FredPoint[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(",");
      const value = parseNumber(rawValue);
      return date && value !== null ? { date, value } : null;
    })
    .filter((row): row is FredPoint => Boolean(row));
}

async function fetchFredSeries(id: string): Promise<FredPoint[]> {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, 12000);
  return parseFredCsv(csv);
}

function latestAtOrBefore(points: FredPoint[], date: string) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && point.date <= date) return point;
  }
  return undefined;
}

function toFedLiquidityRow(walcl: FredPoint, tgaPoints: FredPoint[], rrpPoints: FredPoint[]): LiquidityRow | null {
  const tga = latestAtOrBefore(tgaPoints, walcl.date);
  const rrp = latestAtOrBefore(rrpPoints, walcl.date);
  if (!tga || !rrp) return null;

  const fedBalanceSheet = walcl.value / 1_000_000;
  const tgaValue = tga.value / 1_000_000;
  const rrpValue = rrp.value / 1_000;
  return {
    asOf: walcl.date,
    fedBalanceSheet: cleanNumber(fedBalanceSheet, 3) as number,
    tga: cleanNumber(tgaValue, 3) as number,
    rrp: cleanNumber(rrpValue, 3) as number,
    netLiquidity: cleanNumber(fedBalanceSheet - tgaValue - rrpValue, 3) as number,
  };
}

function emptyLiquidity(source = "FRED unavailable") {
  return {
    netLiquidity: MISSING,
    netLiquidityChange1w: MISSING,
    netLiquidityChange4w: MISSING,
    fedBalanceSheet: MISSING,
    tga: MISSING,
    rrp: MISSING,
    asOf: "",
    source,
    formula: "WALCL - WTREGEN - RRPONTSYD",
  };
}

async function fetchFedLiquidity(statuses: SourceStatus[]) {
  const [walcl, tga, rrp] = await Promise.all([
    fetchFredSeries("WALCL"),
    fetchFredSeries("WTREGEN"),
    fetchFredSeries("RRPONTSYD"),
  ]);

  const rows = walcl
    .map((point) => toFedLiquidityRow(point, tga, rrp))
    .filter((row): row is LiquidityRow => row !== null);
  const latest = rows.at(-1);
  const previousWeek = rows.at(-2);
  const previousMonth = rows.at(-5);

  if (!latest) {
    statuses.push(status("fred:fed-liquidity", "missing", "WALCL / WTREGEN / RRPONTSYD unavailable"));
    return emptyLiquidity();
  }

  statuses.push(status("fred:fed-liquidity", "ok", `latest ${latest.asOf}, net ${latest.netLiquidity.toFixed(3)}T`));
  return {
    ...latest,
    netLiquidityChange1w: previousWeek ? cleanNumber(latest.netLiquidity - previousWeek.netLiquidity, 3) : MISSING,
    netLiquidityChange4w: previousMonth ? cleanNumber(latest.netLiquidity - previousMonth.netLiquidity, 3) : MISSING,
    source: "FRED WALCL / WTREGEN / RRPONTSYD",
    formula: "WALCL - WTREGEN - RRPONTSYD",
  };
}

function movingAverage(series: Series | undefined, days: number): Scalar {
  if (!series || series.length < days) return MISSING;
  const slice = series.slice(-days);
  return cleanNumber(slice.reduce((sum, value) => sum + value, 0) / slice.length);
}

function atrProxy(series: Series | undefined, days = 14): Scalar {
  if (!series || series.length <= days) return MISSING;
  const diffs = series.slice(1).map((value, index) => Math.abs(value - (series[index] ?? value))).slice(-days);
  return cleanNumber(diffs.reduce((sum, value) => sum + value, 0) / diffs.length);
}

function derivedPe(data: MarketData, symbol: string): Scalar {
  const price = data.quotes[symbol]?.price;
  const eps = data.epsTtm[symbol];
  if (typeof price !== "number" || !eps) return MISSING;
  return cleanNumber(price / eps);
}

function samplePeProxy(data: MarketData, symbols: string[]): Scalar {
  const values = symbols.map((symbol) => derivedPe(data, symbol)).filter((value): value is number => typeof value === "number" && value > 0);
  if (!values.length) return MISSING;
  return cleanNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function breadthForSample(data: MarketData, symbols: string[]) {
  const result: Record<string, Scalar | number> = { sampleSize: symbols.length };
  for (const window of [10, 30, 60, 180]) {
    let available = 0;
    let above = 0;
    for (const symbol of symbols) {
      const series = data.history[symbol];
      const ma = movingAverage(series, window);
      const price = data.quotes[symbol]?.price ?? series?.at(-1);
      if (typeof price !== "number" || typeof ma !== "number") continue;
      available += 1;
      if (price > ma) above += 1;
    }
    result[`ama${window}`] = available ? cleanNumber((above / available) * 100, 1) : MISSING;
  }
  return result;
}

function buildIndexIndicator(data: MarketData, symbol: "QQQ" | "SPY") {
  const series = data.history[symbol];
  const quote = data.quotes[symbol];
  return {
    price: quote?.price ?? MISSING,
    change1dPct: quote?.change1dPct ?? MISSING,
    pe: samplePeProxy(data, config.indexConstituentSamples[symbol]),
    peSource: "Nasdaq top-holdings sample PE proxy",
    ma10: movingAverage(series, 10),
    ma30: movingAverage(series, 30),
    ma60: movingAverage(series, 60),
    ma180: movingAverage(series, 180),
    atr14: atrProxy(series),
    option: data.options[symbol] ?? emptyOption("unavailable"),
    source: quote?.source ?? "unavailable",
    timestamp: quote?.timestamp ?? "",
  };
}

function buildStockIndicator(data: MarketData, symbol: string): StockIndicator {
  const series = data.history[symbol];
  const quote = data.quotes[symbol];
  return {
    price: quote?.price ?? MISSING,
    change1dPct: quote?.change1dPct ?? MISSING,
    pe: derivedPe(data, symbol),
    peSource: "Nasdaq price / TTM EPS",
    epsTtm: data.epsTtm[symbol] ?? MISSING,
    ma10: movingAverage(series, 10),
    ma30: movingAverage(series, 30),
    ma60: movingAverage(series, 60),
    ma180: movingAverage(series, 180),
    atr14: atrProxy(series),
    option: data.options[symbol] ?? emptyOption("unavailable"),
    source: quote?.source ?? "unavailable",
    timestamp: quote?.timestamp ?? "",
  };
}

function emptyOption(source: string): OptionSummary {
  return {
    source,
    maxPain: MISSING,
    iv: MISSING,
    callOpenInterest: MISSING,
    putOpenInterest: MISSING,
    putCallOiRatio: MISSING,
    expiration: "",
  };
}

function buildRecommendation(snapshot: Pick<MarketSnapshot, "macroIndicators" | "stockIndicators" | "macroNews">) {
  let score = 0;
  const drivers: string[] = [];
  const vix = snapshot.macroIndicators.volatility.VIX?.value;
  if (typeof vix === "number") {
    if (vix >= 25) {
      score -= 3;
      drivers.push("VIX above 25: risk-off volatility regime");
    } else if (vix <= 16) {
      score += 2;
      drivers.push("VIX below 16: benign volatility backdrop");
    }
  }
  for (const [label, item] of Object.entries(snapshot.macroIndicators.indices)) {
    if (typeof item.price === "number" && typeof item.ma60 === "number") {
      if (item.price > item.ma60) score += 1;
      else {
        score -= 1;
        drivers.push(`${label} below MA60`);
      }
    }
  }
  const breadth = snapshot.macroIndicators.breadth.SPY?.ama60;
  if (typeof breadth === "number") {
    if (breadth >= 60) {
      score += 1;
      drivers.push("SPY sample breadth above 60% over MA60");
    } else if (breadth < 40) {
      score -= 1;
      drivers.push("SPY sample breadth below 40% over MA60");
    }
  }
  const liquidityChange4w = snapshot.macroIndicators.liquidity.netLiquidityChange4w;
  if (typeof liquidityChange4w === "number") {
    if (liquidityChange4w >= 0.1) {
      score += 1;
      drivers.push("Fed net liquidity expanded more than $0.10T over 4W");
    } else if (liquidityChange4w <= -0.1) {
      score -= 1;
      drivers.push("Fed net liquidity drained more than $0.10T over 4W");
    }
  }
  if (snapshot.macroNews.filter((item) => (item.importance ?? 0) >= 3).length >= 5) {
    score -= 1;
    drivers.push("Multiple high-impact macro headlines detected");
  }
  const posture = score >= 3 ? "Risk-on" : score <= -3 ? "Risk-off" : "Neutral";
  const focus = Object.entries(snapshot.stockIndicators).map(([symbol, item]) => {
    if (typeof item.price === "number" && typeof item.ma60 === "number" && item.price > item.ma60) return `${symbol}: trend above MA60`;
    if (typeof item.price === "number" && typeof item.ma60 === "number") return `${symbol}: below MA60, wait for repair`;
    return `${symbol}: insufficient trend data`;
  });
  return {
    posture,
    riskScore: score,
    summary: posture === "Risk-on"
      ? `Market backdrop is constructive with score ${score}; favor trend-following exposure while monitoring macro headline risk.`
      : posture === "Risk-off"
        ? `Market backdrop is defensive with score ${score}; prioritize cash, hedges, and confirmation before adding beta.`
        : `Market backdrop is mixed with score ${score}; keep position sizing moderate and wait for stronger cross-asset confirmation.`,
    drivers: drivers.slice(0, 8),
    focus: focus.slice(0, 14),
    disclaimer: "Rules-based dashboard signal only; not an order or investment advice.",
  } as const;
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const statuses: SourceStatus[] = [];
  const symbols = [...new Set([...WATCHLIST, ...ETF_SYMBOLS, ...config.indexConstituentSamples.SPY, ...config.indexConstituentSamples.QQQ])];

  const [macroNews, stockNews, influencerMockAnalysis, completeReports, marketData, sqlOptions, vix, vxn, bonds, fx, liquidity] = await Promise.all([
    collectMacroNews(statuses),
    collectStockNews(statuses),
    collectInfluencerMockAnalysis(statuses),
    collectCompleteReports(statuses),
    collectNasdaqData(symbols, [...WATCHLIST, ...ETF_SYMBOLS], statuses),
    readLatestSqlOptionSnapshot(statuses),
    fetchCboeIndex("VIX", statuses),
    fetchCboeIndex("VXN", statuses),
    fetchTreasuryCurve(statuses),
    fetchFx(statuses),
    fetchFedLiquidity(statuses),
  ]);

  if (sqlOptions) {
    marketData.options = {
      ...marketData.options,
      ...sqlOptions.options,
    };
  }

  statuses.push(status("ibkr-tws", "skipped", "not available in Vercel runtime"));
  statuses.push(status("option-opinion", "skipped", sqlOptions ? "not available in Vercel runtime; Postgres option_daily used when present" : "not available in Vercel runtime; Nasdaq option-chain used"));

  const stockIndicators = Object.fromEntries(WATCHLIST.map((symbol) => [symbol, buildStockIndicator(marketData, symbol)]));
  const macroIndicators = {
    indices: {
      QQQ: buildIndexIndicator(marketData, "QQQ"),
      SPY: buildIndexIndicator(marketData, "SPY"),
    },
    volatility: {
      VIX: vix,
      QQQ_VIX_PROXY: vxn,
      SPY_VIX_PROXY: vix,
    },
    liquidity,
    fx: {
      USDCNY: fx.USDCNY ?? { value: MISSING, change1dPct: MISSING, source: "unavailable" },
      USDJPY: fx.USDJPY ?? { value: MISSING, change1dPct: MISSING, source: "unavailable" },
    },
    bonds: {
      US1Y: bonds.US1Y ?? { yield: MISSING, change5dPct: MISSING, asOf: "", source: "unavailable" },
      US10Y: bonds.US10Y ?? { yield: MISSING, change5dPct: MISSING, asOf: "", source: "unavailable" },
      US20Y: bonds.US20Y ?? { yield: MISSING, change5dPct: MISSING, asOf: "", source: "unavailable" },
      US30Y: bonds.US30Y ?? { yield: MISSING, change5dPct: MISSING, asOf: "", source: "unavailable" },
    },
    breadth: {
      SPY: breadthForSample(marketData, config.indexConstituentSamples.SPY),
      QQQ: breadthForSample(marketData, config.indexConstituentSamples.QQQ),
    },
    source: "Dynamic Vercel API: Nasdaq, Cboe, FRED, US Treasury, open.er-api, RSS feeds",
  };

  const partial = { macroIndicators, stockIndicators, macroNews };
  return {
    generatedAt: nowIso(),
    meta: {
      name: "Stock-Market-Agent",
      watchlist: WATCHLIST,
      timezone: "UTC",
      refreshSeconds: REFRESH_SECONDS,
    },
    sourcesStatus: statuses,
    macroNews,
    stockNews,
    influencerMockAnalysis,
    completeReports,
    macroIndicators,
    stockIndicators,
    recommendation: buildRecommendation(partial),
  };
}
