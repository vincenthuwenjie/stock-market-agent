export type Scalar = number | "N/A";

export type TimeSeriesPoint = {
  date: string;
  value: Scalar;
};

export type SourceStatus = {
  name: string;
  status: "ok" | "missing" | "empty" | "skipped" | "available";
  detail: string;
};

export type NewsItem = {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
  channel: string;
  ticker?: string;
  importance?: number;
};

export type OptionSummary = {
  source: string;
  maxPain: Scalar;
  iv: Scalar;
  callOpenInterest: Scalar;
  putOpenInterest: Scalar;
  putCallOiRatio: Scalar;
  expiration: string;
};

export type IndexIndicator = {
  price: Scalar;
  change1dPct: Scalar;
  pe: Scalar;
  peSource: string;
  ma10: Scalar;
  ma30: Scalar;
  ma60: Scalar;
  ma180: Scalar;
  atr14: Scalar;
  option: OptionSummary;
  source: string;
  timestamp: string;
  history: TimeSeriesPoint[];
};

export type StockIndicator = {
  price: Scalar;
  change1dPct: Scalar;
  pe: Scalar;
  peSource: string;
  epsTtm: Scalar;
  ma10: Scalar;
  ma30: Scalar;
  ma60: Scalar;
  ma180: Scalar;
  atr14: Scalar;
  option: OptionSummary;
  source: string;
  timestamp: string;
  history: TimeSeriesPoint[];
};

export type MacroSignal = {
  label: string;
  value: Scalar;
  change1w: Scalar;
  change4w: Scalar;
  unit: string;
  asOf: string;
  source: string;
};

export type InfluencerMockAnalysisItem = {
  name: string;
  handle: string;
  profileBio?: string;
  locale?: "english" | "chinese";
  domain: string;
  theme: string;
  stance: "bullish" | "bearish" | "neutral" | "watch";
  thesis: string;
  marketRead: string;
  evidence: string[];
  tweets?: Array<{
    text: string;
    time: string;
    quote?: {
      author: string;
      text: string;
    };
  }>;
};

export type CompleteReportItem = {
  title: string;
  summary: string;
  source: string;
  author: string;
  publishedAt: string;
  url: string;
  tags: string[];
  body?: string;
  storagePath?: string;
  isPrivate?: boolean;
};

export type MarketSnapshot = {
  generatedAt: string;
  meta: {
    name: string;
    watchlist: string[];
    timezone: string;
    refreshSeconds: number;
  };
  sourcesStatus: SourceStatus[];
  macroNews: NewsItem[];
  stockNews: Record<string, NewsItem[]>;
  influencerMockAnalysis: {
    asOf: string;
    source: string;
    summary: string;
    items: InfluencerMockAnalysisItem[];
  };
  completeReports: {
    asOf: string;
    source: string;
    summary: string;
    items: CompleteReportItem[];
  };
  macroIndicators: {
    indices: Record<string, IndexIndicator>;
    volatility: Record<string, { value: Scalar; change1dPct: Scalar; source: string; history?: TimeSeriesPoint[] }>;
    liquidity: {
      netLiquidity: Scalar;
      netLiquidityChange1w: Scalar;
      netLiquidityChange4w: Scalar;
      fedBalanceSheet: Scalar;
      tga: Scalar;
      rrp: Scalar;
      asOf: string;
      source: string;
      formula: string;
      signals?: Record<string, MacroSignal>;
    };
    fx: Record<string, { value: Scalar; change1dPct: Scalar; source: string }>;
    bonds: Record<string, { yield: Scalar; change5dPct: Scalar; asOf: string; source: string }>;
    breadth: Record<string, Record<string, Scalar | number>>;
    source: string;
  };
  stockIndicators: Record<string, StockIndicator>;
  recommendation: {
    posture: "Risk-on" | "Risk-off" | "Neutral";
    riskScore: number;
    summary: string;
    drivers: string[];
    focus: string[];
    disclaimer: string;
  };
};
