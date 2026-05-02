"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketSnapshot, NewsItem, Scalar } from "@/lib/types";

type Props = {
  initialData: MarketSnapshot;
};

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

function NewsList({ items }: { items: NewsItem[] }) {
  if (!items.length) return <div className="empty">No items in this snapshot.</div>;
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
                {item.title}
              </a>
            ) : item.title}
          </p>
          {item.summary ? <p className="news-summary">{item.summary}</p> : null}
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: Scalar; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
      <small className={detail.includes("-") ? "red" : detail.includes("N/A") ? "" : "green"}>{detail}</small>
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
  const [activeTicker, setActiveTicker] = useState(initialData.meta.watchlist[0] ?? "AAPL");
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    const interval = window.setInterval(refresh, data.meta.refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [data.meta.refreshSeconds]);

  useEffect(() => {
    void refresh();
  }, []);

  const stockRows = useMemo(() => Object.entries(data.stockIndicators), [data.stockIndicators]);
  const activeNews = data.stockNews[activeTicker] ?? [];
  const qqq = data.macroIndicators.indices.QQQ;
  const spy = data.macroIndicators.indices.SPY;
  const vix = data.macroIndicators.volatility.VIX;
  const liquidity = data.macroIndicators.liquidity;
  const usdjpy = data.macroIndicators.fx.USDJPY;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Stock Market Agent</h1>
          <span className="stamp">Updated {shortTime(data.generatedAt)}</span>
        </div>
        <div className="toolbar">
          <button className="refresh" type="button" onClick={refresh} disabled={isRefreshing} title="Refresh snapshot">
            {isRefreshing ? "Refreshing" : "Refresh"}
          </button>
          {data.sourcesStatus.slice(0, 10).map((source) => (
            <span
              className={`pill ${source.status === "ok" || source.status === "available" ? "good" : source.status === "missing" ? "warn" : ""}`}
              key={`${source.name}-${source.status}`}
              title={source.detail}
            >
              {source.name}: {source.status}
            </span>
          ))}
        </div>
      </header>

      <section className="dashboard">
        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>宏观新闻</strong></div>
            <div className="panel-actions">{data.macroNews.length} items</div>
          </header>
          <div className="scroll"><NewsList items={data.macroNews} /></div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>个股新闻</strong></div>
            <div className="panel-actions">{data.meta.watchlist.length} tickers</div>
          </header>
          <div className="scroll">
            <div className="tabs">
              {data.meta.watchlist.map((ticker) => (
                <button className={`tab ${ticker === activeTicker ? "active" : ""}`} key={ticker} onClick={() => setActiveTicker(ticker)} type="button">
                  {ticker}
                </button>
              ))}
            </div>
            <NewsList items={activeNews} />
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>宏观指标</strong></div>
            <div className="panel-actions">Dynamic API</div>
          </header>
          <div className="scroll">
            <div className="metrics">
              <Metric label="SPY" value={spy.price} detail={`${fmt(spy.change1dPct, "%")} 1D`} />
              <Metric label="QQQ" value={qqq.price} detail={`${fmt(qqq.change1dPct, "%")} 1D`} />
              <Metric label="VIX" value={vix.value} detail={`${fmt(vix.change1dPct, "%")} 1D`} />
              <Metric label="Fed Liquidity" value={liquidity.netLiquidity} detail={`${fmt(liquidity.netLiquidityChange4w, "T")} 4W`} />
              <Metric label="USD/JPY" value={usdjpy.value} detail={usdjpy.source} />
            </div>
            <div className="subgrid">
              <section className="section">
                <div className="section-title"><span>Fed Liquidity</span><span>{liquidity.asOf || "FRED"}</span></div>
                <table>
                  <thead><tr><th>Measure</th><th>Value</th><th>1W</th><th>4W</th></tr></thead>
                  <tbody>
                    <tr><td title={liquidity.formula}>Net Liquidity</td><td>{fmt(liquidity.netLiquidity, "T")}</td><td className={tone(liquidity.netLiquidityChange1w)}>{fmt(liquidity.netLiquidityChange1w, "T")}</td><td className={tone(liquidity.netLiquidityChange4w)}>{fmt(liquidity.netLiquidityChange4w, "T")}</td></tr>
                    <tr><td title="WALCL">Fed Balance Sheet</td><td>{fmt(liquidity.fedBalanceSheet, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="WTREGEN">Treasury General Account</td><td>{fmt(liquidity.tga, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="RRPONTSYD">Reverse Repo</td><td>{fmt(liquidity.rrp, "T")}</td><td colSpan={2}>{liquidity.source}</td></tr>
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>ETF Valuation / Trend</span><span>MA</span></div>
                <table>
                  <thead><tr><th>Name</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>ATR</th></tr></thead>
                  <tbody>
                    {Object.entries(data.macroIndicators.indices).map(([name, item]) => (
                      <tr key={name}><td title={item.peSource}>{name}</td><td>{fmt(item.pe)}</td><td>{fmt(item.ma10)}</td><td>{fmt(item.ma30)}</td><td>{fmt(item.ma60)}</td><td>{fmt(item.ma180)}</td><td>{fmt(item.atr14)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>Vol / FX / Bonds</span><span>Cross Asset</span></div>
                <table>
                  <thead><tr><th>Asset</th><th>Value</th><th>Change</th></tr></thead>
                  <tbody>
                    {[
                      ["QQQ VIX", data.macroIndicators.volatility.QQQ_VIX_PROXY?.value, data.macroIndicators.volatility.QQQ_VIX_PROXY?.change1dPct],
                      ["SPY VIX", data.macroIndicators.volatility.SPY_VIX_PROXY?.value, data.macroIndicators.volatility.SPY_VIX_PROXY?.change1dPct],
                      ["USD/CNY", data.macroIndicators.fx.USDCNY?.value, data.macroIndicators.fx.USDCNY?.change1dPct],
                      ["USD/JPY", data.macroIndicators.fx.USDJPY?.value, data.macroIndicators.fx.USDJPY?.change1dPct],
                      ["US 1Y", data.macroIndicators.bonds.US1Y?.yield, data.macroIndicators.bonds.US1Y?.change5dPct],
                      ["US 10Y", data.macroIndicators.bonds.US10Y?.yield, data.macroIndicators.bonds.US10Y?.change5dPct],
                      ["US 20Y", data.macroIndicators.bonds.US20Y?.yield, data.macroIndicators.bonds.US20Y?.change5dPct],
                      ["US 30Y", data.macroIndicators.bonds.US30Y?.yield, data.macroIndicators.bonds.US30Y?.change5dPct],
                    ].map(([name, value, change]) => (
                      <tr key={name as string}><td>{name}</td><td>{fmt(value as Scalar)}</td><td className={tone(change as Scalar)}>{fmt(change as Scalar, "%")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>Option Structure</span><span>Nasdaq</span></div>
                <table>
                  <thead><tr><th>Name</th><th>Max Pain</th><th>IV</th><th>P/C OI</th><th>Expiry</th></tr></thead>
                  <tbody>
                    {Object.entries(data.macroIndicators.indices).map(([name, item]) => (
                      <tr key={name}><td>{name}</td><td>{fmt(item.option.maxPain)}</td><td>{fmt(item.option.iv, "%")}</td><td>{fmt(item.option.putCallOiRatio)}</td><td>{item.option.expiration}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>Market Breadth</span><span>Sample AMA</span></div>
                <table>
                  <thead><tr><th>Name</th><th>AMA10</th><th>AMA30</th><th>AMA60</th><th>AMA180</th></tr></thead>
                  <tbody>
                    {Object.entries(data.macroIndicators.breadth).map(([name, item]) => (
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
            <div className="panel-title"><span className="dot" /><strong>个股指标</strong></div>
            <div className="panel-actions">M7 configurable</div>
          </header>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Ticker</th><th>Price</th><th>1D</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>Max Pain</th><th>IV</th></tr>
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
            <span className={`pill ${data.recommendation.posture === "Risk-on" ? "good" : data.recommendation.posture === "Risk-off" ? "bad" : "warn"}`}>Model Posture</span>
            <strong className={data.recommendation.posture === "Risk-on" ? "green" : data.recommendation.posture === "Risk-off" ? "red" : "amber"}>{data.recommendation.posture}</strong>
            <p className="rec-text">Risk score: {data.recommendation.riskScore}</p>
          </div>
          <div>
            <p className="rec-text">{data.recommendation.summary}</p>
            <p className="rec-text">{data.recommendation.disclaimer}</p>
          </div>
          <div className="subgrid">
            <section className="section">
              <div className="section-title">Drivers</div>
              <ul className="rec-list">{(data.recommendation.drivers.length ? data.recommendation.drivers : ["No major drivers."]).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section className="section">
              <div className="section-title">Focus</div>
              <ul className="rec-list">{(data.recommendation.focus.length ? data.recommendation.focus : ["No focus list."]).map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          </div>
        </div>
      </section>

      <section className="influencer-analysis">
        <header className="panel-head">
          <div className="panel-title"><span className="dot" /><strong>Influencer AI Mock Analysis</strong></div>
          <div className="panel-actions">{data.influencerMockAnalysis.asOf || "latest.md"}</div>
        </header>
        <div className="analysis-summary">
          <p className="rec-text">{data.influencerMockAnalysis.summary}</p>
          <span className="stamp" title={data.influencerMockAnalysis.source}>{data.influencerMockAnalysis.source}</span>
        </div>
        {data.influencerMockAnalysis.items.length ? (
          <div className="analysis-grid">
            {data.influencerMockAnalysis.items.map((item) => (
              <article className="analysis-card" key={`${item.handle}-${item.theme}`}>
                <div className="analysis-top">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.handle} · {item.domain}</span>
                  </div>
                  <span className={`pill ${stanceClass(item.stance)}`}>{item.stance}</span>
                </div>
                <div className="section-title"><span>{item.theme}</span><span>mock read</span></div>
                <p className="analysis-thesis">{item.thesis}</p>
                <p className="rec-text">{item.marketRead}</p>
                <ul className="rec-list">{item.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">No influencer analysis available in this runtime.</div>
        )}
      </section>
    </main>
  );
}
