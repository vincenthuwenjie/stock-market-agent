"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketSnapshot, NewsItem, Scalar } from "@/lib/types";

type Props = {
  initialData: MarketSnapshot;
};

type Lang = "zh" | "en";

const NA: Scalar = "N/A";
const EMPTY_OPTION = {
  source: "unavailable",
  maxPain: NA,
  iv: NA,
  callOpenInterest: NA,
  putOpenInterest: NA,
  putCallOiRatio: NA,
  expiration: "",
};
const EMPTY_INDEX = {
  price: NA,
  change1dPct: NA,
  pe: NA,
  peSource: "unavailable",
  ma10: NA,
  ma30: NA,
  ma60: NA,
  ma180: NA,
  atr14: NA,
  option: EMPTY_OPTION,
  source: "unavailable",
  timestamp: "",
};
const EMPTY_VALUE = { value: NA, change1dPct: NA, source: "unavailable" };
const EMPTY_YIELD = { yield: NA, change5dPct: NA, asOf: "", source: "unavailable" };
const EMPTY_LIQUIDITY = {
  netLiquidity: NA,
  netLiquidityChange1w: NA,
  netLiquidityChange4w: NA,
  fedBalanceSheet: NA,
  tga: NA,
  rrp: NA,
  asOf: "",
  source: "unavailable",
  formula: "WALCL - WTREGEN - RRPONTSYD",
};

const UI_ZH: Record<string, string> = {
  "宏观新闻": "宏观新闻",
  "个股新闻": "个股新闻",
  "宏观指标": "宏观指标",
  "个股指标": "个股指标",
  "Updated": "更新",
  "Refresh": "刷新",
  "Refreshing": "刷新中",
  "Refresh snapshot": "刷新快照",
  "No items in this snapshot.": "本次快照暂无内容。",
  "items": "条",
  "tickers": "只股票",
  "Dynamic API": "动态 API",
  "M7 configurable": "默认 M7，可配置",
  "ETF Valuation / Trend": "ETF 估值 / 趋势",
  "Vol / FX / Bonds": "波动率 / 外汇 / 债券",
  "Cross Asset": "跨资产",
  "Option Structure": "期权结构",
  "Market Breadth": "市场宽度",
  "Sample AMA": "样本 AMA",
  "Measure": "指标",
  "Value": "数值",
  "Change": "变化",
  "Name": "名称",
  "Asset": "资产",
  "Ticker": "股票代码",
  "Price": "价格",
  "Max Pain": "最大痛点",
  "Expiry": "到期",
  "Model Posture": "模型姿态",
  "Risk score": "风险分",
  "Drivers": "驱动因素",
  "Focus": "关注",
  "No major drivers.": "暂无主要驱动因素。",
  "No focus list.": "暂无关注清单。",
  "Influencer AI Mock Analysis": "影响者 AI 模拟分析",
  "mock read": "模拟解读",
  "No influencer analysis available in this runtime.": "当前运行环境暂无影响者分析。",
  "Fed Liquidity": "美联储流动性",
  "Net Liquidity": "净流动性",
  "Fed Balance Sheet": "美联储资产负债表",
  "Treasury General Account": "财政部一般账户",
  "Reverse Repo": "逆回购",
  "unavailable": "不可用",
  "ok": "正常",
  "missing": "缺失",
  "empty": "为空",
  "skipped": "跳过",
  "available": "可用",
  "bullish": "偏多",
  "bearish": "偏空",
  "neutral": "中性",
  "watch": "观察",
  "Risk-on": "风险偏好",
  "Risk-off": "风险规避",
  "Neutral": "中性",
  "Macro / Fed": "宏观 / 美联储",
  "Geopolitics": "地缘政治",
  "Equity Tape": "股市盘面",
  "Single Stocks": "个股",
  "Commodities": "大宗商品",
  "AI / Tech": "AI / 科技",
  "Crypto": "加密资产",
  "Market Narrative": "市场叙事",
};

const UI_EN: Record<string, string> = {
  "宏观新闻": "Macro News",
  "个股新闻": "Stock News",
  "宏观指标": "Macro Indicators",
  "个股指标": "Stock Indicators",
};

const PHRASE_ZH: Array<[RegExp, string]> = [
  [/Rules-based dashboard signal only; not an order or investment advice\./gi, "仅为规则型看板信号，不是订单或投资建议。"],
  [/Market backdrop is mixed with score ([\-\d.]+); keep position sizing moderate and wait for stronger cross-asset confirmation\./gi, "市场背景偏混合，风险分为 $1；仓位保持适中，等待更强的跨资产确认。"],
  [/Market backdrop is constructive with score ([\-\d.]+); favor trend-following exposure while monitoring macro headline risk\./gi, "市场背景偏建设性，风险分为 $1；可偏向趋势跟随敞口，同时监控宏观标题风险。"],
  [/Market backdrop is defensive with score ([\-\d.]+); prioritize cash, hedges, and confirmation before adding beta\./gi, "市场背景偏防御，风险分为 $1；增加 beta 前优先考虑现金、对冲和确认信号。"],
  [/Recommendation unavailable in this snapshot\./gi, "本次快照暂无模型建议。"],
  [/Influencer mock analysis unavailable in this snapshot\./gi, "本次快照暂无影响者模拟分析。"],
  [/Bundled influencer mock analysis loaded instantly; live refresh runs in the background\./gi, "已即时加载内置影响者模拟分析；实时刷新在后台运行。"],
  [/Bundled fallback read; live API refresh will replace this with the full mock analysis when available\./gi, "内置快照解读；实时 API 可用后会替换为完整模拟分析。"],
  [/Mock analysis from influencer feed; dominant themes: ([^.]+)\./gi, "来自影响者信息流的模拟分析；主导主题：$1。"],
  [/Fed net liquidity expanded more than \$0\.10T over 4W/gi, "美联储净流动性 4 周扩张超过 0.10 万亿美元"],
  [/Fed net liquidity drained more than \$0\.10T over 4W/gi, "美联储净流动性 4 周收缩超过 0.10 万亿美元"],
  [/SPY sample breadth above 60% over MA60/gi, "SPY 样本中高于 MA60 的比例超过 60%"],
  [/SPY sample breadth below 40% over MA60/gi, "SPY 样本中高于 MA60 的比例低于 40%"],
  [/Multiple high-impact macro headlines detected/gi, "检测到多条高影响宏观新闻"],
  [/([A-Z]{1,5}): trend above MA60/gi, "$1：趋势高于 MA60"],
  [/([A-Z]{1,5}): below MA60, wait for repair/gi, "$1：低于 MA60，等待修复"],
  [/([A-Z]{1,5}): insufficient trend data/gi, "$1：趋势数据不足"],
  [/Treat as a constructive cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为偏建设性的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a defensive cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为偏防御的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a watchful cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为需要观察的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a constructive headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为偏建设性的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a defensive headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为偏防御的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a watchful headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为需要观察的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a constructive market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为偏建设性的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a defensive market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为偏防御的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a watchful market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为需要观察的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a constructive single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为偏建设性的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a defensive single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为偏防御的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a watchful single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为需要观察的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a constructive narrative signal; use price confirmation before acting on it\./gi, "视为偏建设性的叙事信号；行动前需要价格确认。"],
  [/Treat as a defensive narrative signal; use price confirmation before acting on it\./gi, "视为偏防御的叙事信号；行动前需要价格确认。"],
  [/Treat as a watchful narrative signal; use price confirmation before acting on it\./gi, "视为需要观察的叙事信号；行动前需要价格确认。"],
  [/latest USD rates/gi, "最新美元汇率"],
  [/not available in Vercel runtime/gi, "Vercel 运行时不可用"],
  [/unavailable or empty/gi, "不可用或为空"],
  [/unavailable/gi, "不可用"],
  [/latest close from Cboe CSV/gi, "Cboe CSV 最新收盘"],
  [/Bundled snapshot renders immediately; live data refreshes after load\./gi, "内置快照即时渲染；实时数据可手动刷新。"],
  [/RSS unavailable or empty/gi, "RSS 不可用或为空"],
  [/RSS items/gi, "条 RSS 内容"],
  [/stock news items/gi, "条个股新闻"],
  [/quotes/gi, "报价"],
  [/histories/gi, "历史数据"],
  [/option chains/gi, "期权链"],
  [/TTM EPS values/gi, "个 TTM EPS 值"],
];

const WORD_ZH: Array<[RegExp, string]> = [
  [/\bFederal Reserve\b/gi, "美联储"],
  [/\bFed\b/g, "美联储"],
  [/\bTreasury\b/gi, "财政部"],
  [/\binflation\b/gi, "通胀"],
  [/\btariff(s)?\b/gi, "关税"],
  [/\bwar\b/gi, "战争"],
  [/\boil\b/gi, "石油"],
  [/\byield(s)?\b/gi, "收益率"],
  [/\brate(s)?\b/gi, "利率"],
  [/\bmarket(s)?\b/gi, "市场"],
  [/\bstock(s)?\b/gi, "股票"],
  [/\boption(s)?\b/gi, "期权"],
  [/\bvolatility\b/gi, "波动率"],
  [/\bliquidity\b/gi, "流动性"],
  [/\brisk\b/gi, "风险"],
  [/\bbuyback(s)?\b/gi, "回购"],
  [/\bearnings\b/gi, "财报"],
  [/\bAI\b/g, "AI"],
];

function protectTickers(text: string) {
  const tokens: string[] = [];
  const protectedText = text.replace(/\b[A-Z]{1,6}(?:\/[A-Z]{2,6})?\b/g, (match) => {
    const key = `__TK${tokens.length}__`;
    tokens.push(match);
    return key;
  });
  return { protectedText, tokens };
}

function restoreTickers(text: string, tokens: string[]) {
  return tokens.reduce((result, token, index) => result.replaceAll(`__TK${index}__`, token), text);
}

function zhText(value: string | undefined) {
  if (!value) return "";
  const direct = UI_ZH[value];
  if (direct) return direct;
  const { protectedText, tokens } = protectTickers(value);
  let translated = protectedText;
  for (const [pattern, replacement] of PHRASE_ZH) translated = translated.replace(pattern, replacement);
  for (const [pattern, replacement] of WORD_ZH) translated = translated.replace(pattern, replacement);
  return restoreTickers(translated, tokens);
}

function localize(value: string | undefined, lang: Lang) {
  if (!value) return "";
  return lang === "zh" ? zhText(value) : (UI_EN[value] ?? value);
}

function fmt(value: Scalar | undefined, suffix = "") {
  if (value === undefined || value === "N/A" || Number.isNaN(value)) return "N/A";
  return `${value}${suffix}`;
}

function tone(value: Scalar | undefined) {
  if (typeof value !== "number") return "";
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "";
}

function shortTime(value: string) {
  if (!value) return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? value.slice(0, 18) : new Date(time).toLocaleString();
}

function NewsList({ items, lang }: { items: NewsItem[]; lang: Lang }) {
  if (!items.length) return <div className="empty">{localize("No items in this snapshot.", lang)}</div>;
  return (
    <div className="list">
      {items.map((item, index) => (
        <article className="news-item" key={`${item.url || item.title}-${index}`}>
          <div className="news-top">
            <span>{item.source}</span>
            <span>{shortTime(item.publishedAt)}</span>
          </div>
          <p className="news-title">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                {localize(item.title, lang)}
              </a>
            ) : localize(item.title, lang)}
          </p>
          {item.summary ? <p className="news-summary">{localize(item.summary, lang)}</p> : null}
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value, detail, lang }: { label: string; value: Scalar; detail: string; lang: Lang }) {
  return (
    <div className="metric">
      <span>{localize(label, lang)}</span>
      <strong>{fmt(value)}</strong>
      <small className={detail.includes("-") ? "red" : detail.includes("N/A") ? "" : "green"}>{localize(detail, lang)}</small>
    </div>
  );
}

function stanceClass(stance: string) {
  if (stance === "bullish") return "good";
  if (stance === "bearish") return "bad";
  if (stance === "watch") return "warn";
  return "";
}

export function MarketDashboard({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [activeTicker, setActiveTicker] = useState(initialData.meta?.watchlist?.[0] ?? "AAPL");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lang, setLang] = useState<Lang>("zh");

  async function refresh() {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      if (!response.ok) throw new Error(`snapshot ${response.status}`);
      setData(await response.json() as MarketSnapshot);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    const refreshSeconds = data.meta?.refreshSeconds ?? 300;
    const interval = window.setInterval(refresh, refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [data.meta?.refreshSeconds]);

  const stockRows = useMemo(() => Object.entries(data.stockIndicators ?? {}), [data.stockIndicators]);
  const watchlist = data.meta?.watchlist ?? [];
  const activeNews = data.stockNews?.[activeTicker] ?? [];
  const indices = data.macroIndicators?.indices ?? {};
  const volatility = data.macroIndicators?.volatility ?? {};
  const fx = data.macroIndicators?.fx ?? {};
  const bonds = data.macroIndicators?.bonds ?? {};
  const breadth = data.macroIndicators?.breadth ?? {};
  const qqq = indices.QQQ ?? EMPTY_INDEX;
  const spy = indices.SPY ?? EMPTY_INDEX;
  const vix = volatility.VIX ?? EMPTY_VALUE;
  const liquidity = data.macroIndicators?.liquidity ?? EMPTY_LIQUIDITY;
  const usdjpy = fx.USDJPY ?? EMPTY_VALUE;
  const influencerMockAnalysis = data.influencerMockAnalysis ?? {
    asOf: "",
    source: "unavailable",
    summary: "Influencer mock analysis unavailable in this snapshot.",
    items: [],
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Stock Market Agent</h1>
          <span className="stamp">{localize("Updated", lang)} {shortTime(data.generatedAt)}</span>
        </div>
        <div className="toolbar">
          <div className="language-toggle" aria-label="Language">
            <button className={lang === "zh" ? "active" : ""} type="button" onClick={() => setLang("zh")}>中文</button>
            <span>|</span>
            <button className={lang === "en" ? "active" : ""} type="button" onClick={() => setLang("en")}>English</button>
          </div>
          <button className="refresh" type="button" onClick={refresh} disabled={isRefreshing} title="Refresh snapshot">
            {localize(isRefreshing ? "Refreshing" : "Refresh", lang)}
          </button>
          {(data.sourcesStatus ?? []).slice(0, 10).map((source) => (
            <span
              className={`pill ${source.status === "ok" || source.status === "available" ? "good" : source.status === "missing" ? "warn" : ""}`}
              key={`${source.name}-${source.status}`}
              title={localize(source.detail, lang)}
            >
              {source.name}: {localize(source.status, lang)}
            </span>
          ))}
        </div>
      </header>

      <section className="dashboard">
        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("宏观新闻", lang)}</strong></div>
            <div className="panel-actions">{(data.macroNews ?? []).length} {localize("items", lang)}</div>
          </header>
          <div className="scroll"><NewsList items={data.macroNews ?? []} lang={lang} /></div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("个股新闻", lang)}</strong></div>
            <div className="panel-actions">{watchlist.length} {localize("tickers", lang)}</div>
          </header>
          <div className="scroll">
            <div className="tabs">
              {watchlist.map((ticker) => (
                <button className={`tab ${ticker === activeTicker ? "active" : ""}`} key={ticker} onClick={() => setActiveTicker(ticker)} type="button">
                  {ticker}
                </button>
              ))}
            </div>
            <NewsList items={activeNews} lang={lang} />
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("宏观指标", lang)}</strong></div>
            <div className="panel-actions">{localize("Dynamic API", lang)}</div>
          </header>
          <div className="scroll">
            <div className="metrics">
              <Metric label="SPY" value={spy.price} detail={`${fmt(spy.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="QQQ" value={qqq.price} detail={`${fmt(qqq.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="VIX" value={vix.value} detail={`${fmt(vix.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="Fed Liquidity" value={liquidity.netLiquidity} detail={`${fmt(liquidity.netLiquidityChange4w, "T")} 4W`} lang={lang} />
              <Metric label="USD/JPY" value={usdjpy.value} detail={usdjpy.source} lang={lang} />
            </div>
            <div className="subgrid">
              <section className="section">
                <div className="section-title"><span>{localize("Fed Liquidity", lang)}</span><span>{liquidity.asOf || "FRED"}</span></div>
                <table>
                  <thead><tr><th>{localize("Measure", lang)}</th><th>{localize("Value", lang)}</th><th>1W</th><th>4W</th></tr></thead>
                  <tbody>
                    <tr><td title={liquidity.formula}>{localize("Net Liquidity", lang)}</td><td>{fmt(liquidity.netLiquidity, "T")}</td><td className={tone(liquidity.netLiquidityChange1w)}>{fmt(liquidity.netLiquidityChange1w, "T")}</td><td className={tone(liquidity.netLiquidityChange4w)}>{fmt(liquidity.netLiquidityChange4w, "T")}</td></tr>
                    <tr><td title="WALCL">{localize("Fed Balance Sheet", lang)}</td><td>{fmt(liquidity.fedBalanceSheet, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="WTREGEN">{localize("Treasury General Account", lang)}</td><td>{fmt(liquidity.tga, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="RRPONTSYD">{localize("Reverse Repo", lang)}</td><td>{fmt(liquidity.rrp, "T")}</td><td colSpan={2}>{localize(liquidity.source, lang)}</td></tr>
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("ETF Valuation / Trend", lang)}</span><span>MA</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>ATR</th></tr></thead>
                  <tbody>
                    {Object.entries(indices).map(([name, item]) => (
                      <tr key={name}><td title={item.peSource}>{name}</td><td>{fmt(item.pe)}</td><td>{fmt(item.ma10)}</td><td>{fmt(item.ma30)}</td><td>{fmt(item.ma60)}</td><td>{fmt(item.ma180)}</td><td>{fmt(item.atr14)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Vol / FX / Bonds", lang)}</span><span>{localize("Cross Asset", lang)}</span></div>
                <table>
                  <thead><tr><th>{localize("Asset", lang)}</th><th>{localize("Value", lang)}</th><th>{localize("Change", lang)}</th></tr></thead>
                  <tbody>
                    {[
                      ["QQQ VIX", volatility.QQQ_VIX_PROXY?.value, volatility.QQQ_VIX_PROXY?.change1dPct],
                      ["SPY VIX", volatility.SPY_VIX_PROXY?.value, volatility.SPY_VIX_PROXY?.change1dPct],
                      ["USD/CNY", fx.USDCNY?.value, fx.USDCNY?.change1dPct],
                      ["USD/JPY", fx.USDJPY?.value, fx.USDJPY?.change1dPct],
                      ["US 1Y", (bonds.US1Y ?? EMPTY_YIELD).yield, (bonds.US1Y ?? EMPTY_YIELD).change5dPct],
                      ["US 10Y", (bonds.US10Y ?? EMPTY_YIELD).yield, (bonds.US10Y ?? EMPTY_YIELD).change5dPct],
                      ["US 20Y", (bonds.US20Y ?? EMPTY_YIELD).yield, (bonds.US20Y ?? EMPTY_YIELD).change5dPct],
                      ["US 30Y", (bonds.US30Y ?? EMPTY_YIELD).yield, (bonds.US30Y ?? EMPTY_YIELD).change5dPct],
                    ].map(([name, value, change]) => (
                      <tr key={name as string}><td>{name}</td><td>{fmt(value as Scalar)}</td><td className={tone(change as Scalar)}>{fmt(change as Scalar, "%")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Option Structure", lang)}</span><span>Nasdaq</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>{localize("Max Pain", lang)}</th><th>IV</th><th>P/C OI</th><th>{localize("Expiry", lang)}</th></tr></thead>
                  <tbody>
                    {Object.entries(indices).map(([name, item]) => (
                      <tr key={name}><td>{name}</td><td>{fmt(item.option.maxPain)}</td><td>{fmt(item.option.iv, "%")}</td><td>{fmt(item.option.putCallOiRatio)}</td><td>{item.option.expiration}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Market Breadth", lang)}</span><span>{localize("Sample AMA", lang)}</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>AMA10</th><th>AMA30</th><th>AMA60</th><th>AMA180</th></tr></thead>
                  <tbody>
                    {Object.entries(breadth).map(([name, item]) => (
                      <tr key={name}><td>{name}</td><td>{fmt(item.ama10 as Scalar, "%")}</td><td>{fmt(item.ama30 as Scalar, "%")}</td><td>{fmt(item.ama60 as Scalar, "%")}</td><td>{fmt(item.ama180 as Scalar, "%")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("个股指标", lang)}</strong></div>
            <div className="panel-actions">{localize("M7 configurable", lang)}</div>
          </header>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>{localize("Ticker", lang)}</th><th>{localize("Price", lang)}</th><th>1D</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>{localize("Max Pain", lang)}</th><th>IV</th></tr>
              </thead>
              <tbody>
                {stockRows.map(([ticker, item]) => (
                  <tr key={ticker}>
                    <td title={item.timestamp}>{ticker}</td>
                    <td>{fmt(item.price)}</td>
                    <td className={tone(item.change1dPct)}>{fmt(item.change1dPct, "%")}</td>
                    <td title={item.peSource}>{fmt(item.pe)}</td>
                    <td>{fmt(item.ma10)}</td>
                    <td>{fmt(item.ma30)}</td>
                    <td>{fmt(item.ma60)}</td>
                    <td>{fmt(item.ma180)}</td>
                    <td>{fmt(item.option.maxPain)}</td>
                    <td>{fmt(item.option.iv, "%")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="recommendation">
        <div className="rec-grid">
          <div className="posture">
            <span className={`pill ${data.recommendation?.posture === "Risk-on" ? "good" : data.recommendation?.posture === "Risk-off" ? "bad" : "warn"}`}>{localize("Model Posture", lang)}</span>
            <strong className={data.recommendation?.posture === "Risk-on" ? "green" : data.recommendation?.posture === "Risk-off" ? "red" : "amber"}>{localize(data.recommendation?.posture ?? "Neutral", lang)}</strong>
            <p className="rec-text">{localize("Risk score", lang)}: {data.recommendation?.riskScore ?? "N/A"}</p>
          </div>
          <div>
            <p className="rec-text">{localize(data.recommendation?.summary ?? "Recommendation unavailable in this snapshot.", lang)}</p>
            <p className="rec-text">{localize(data.recommendation?.disclaimer ?? "Rules-based dashboard signal only; not an order or investment advice.", lang)}</p>
          </div>
          <div className="subgrid">
            <section className="section">
              <div className="section-title">{localize("Drivers", lang)}</div>
              <ul className="rec-list">{(data.recommendation?.drivers?.length ? data.recommendation.drivers : ["No major drivers."]).map((item) => <li key={item}>{localize(item, lang)}</li>)}</ul>
            </section>
            <section className="section">
              <div className="section-title">{localize("Focus", lang)}</div>
              <ul className="rec-list">{(data.recommendation?.focus?.length ? data.recommendation.focus : ["No focus list."]).map((item) => <li key={item}>{localize(item, lang)}</li>)}</ul>
            </section>
          </div>
        </div>
      </section>

      <section className="influencer-analysis">
        <header className="panel-head">
          <div className="panel-title"><span className="dot" /><strong>{localize("Influencer AI Mock Analysis", lang)}</strong></div>
          <div className="panel-actions">{influencerMockAnalysis.asOf || "latest.md"}</div>
        </header>
        <div className="analysis-summary">
          <p className="rec-text">{localize(influencerMockAnalysis.summary, lang)}</p>
          <span className="stamp" title={influencerMockAnalysis.source}>{influencerMockAnalysis.source}</span>
        </div>
        {influencerMockAnalysis.items.length ? (
          <div className="analysis-grid">
            {influencerMockAnalysis.items.map((item) => (
              <article className="analysis-card" key={`${item.handle}-${item.theme}`}>
                <div className="analysis-top">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.handle} · {item.domain}</span>
                  </div>
                  <span className={`pill ${stanceClass(item.stance)}`}>{localize(item.stance, lang)}</span>
                </div>
                <div className="section-title"><span>{localize(item.theme, lang)}</span><span>{localize("mock read", lang)}</span></div>
                <p className="analysis-thesis">{localize(item.thesis, lang)}</p>
                <p className="rec-text">{localize(item.marketRead, lang)}</p>
                <ul className="rec-list">{item.evidence.map((line) => <li key={line}>{localize(line, lang)}</li>)}</ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">{localize("No influencer analysis available in this runtime.", lang)}</div>
        )}
      </section>
    </main>
  );
}
