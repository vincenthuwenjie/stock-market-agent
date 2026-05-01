#!/usr/bin/env python3
"""Collect market data for the Stock Market Agent dashboard."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import re
import signal
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib import request
from xml.etree import ElementTree

HERE = Path(__file__).resolve().parent
CONFIG_FILE = HERE / "config.json"
LATEST_FILE = HERE / "latest.json"
MISSING = "N/A"
DEFAULT_TIMEOUT_SECONDS = 8

try:
    import pandas as pd
except ImportError:  # pragma: no cover - runtime dependency check
    pd = None

try:
    import yfinance as yf
except ImportError:  # pragma: no cover - runtime dependency check
    yf = None


@dataclass
class SourceStatus:
    name: str
    status: str
    detail: str

    def as_dict(self) -> dict[str, str]:
        return {"name": self.name, "status": self.status, "detail": self.detail}


class CallTimedOut(RuntimeError):
    pass


def _timeout_handler(signum: int, frame: Any) -> None:
    raise CallTimedOut("operation timed out")


def with_timeout(seconds: int, default: Any, func: Any, *args: Any, **kwargs: Any) -> Any:
    previous = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(seconds)
    try:
        return func(*args, **kwargs)
    except Exception:
        return default
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def has_cmd(name: str) -> bool:
    return shutil.which(name) is not None


def clean_float(value: Any, digits: int = 2) -> float | str:
    try:
        if value is None:
            return MISSING
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return MISSING
        return round(number, digits)
    except (TypeError, ValueError):
        return MISSING


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    text = text.replace("$", "").replace("%", "").replace(",", "").replace("+", "")
    try:
        number = float(text)
    except ValueError:
        return None
    return None if math.isnan(number) or math.isinf(number) else number


def pct_change(current: Any, previous: Any) -> float | str:
    try:
        current_f = float(current)
        previous_f = float(previous)
        if previous_f == 0:
            return MISSING
        return round((current_f - previous_f) / previous_f * 100, 2)
    except (TypeError, ValueError):
        return MISSING


def fetch_json(url: str, timeout: int = 8) -> dict[str, Any]:
    try:
        req = request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) ohc-stock-market-agent/1.0",
            "Accept": "application/json,text/plain,*/*",
        })
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read(2_000_000).decode("utf-8", errors="replace"))
    except Exception:
        return {}


def fetch_text(url: str, timeout: int = 10) -> str:
    try:
        req = request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) ohc-stock-market-agent/1.0",
            "Accept": "text/csv,text/plain,*/*",
        })
        with request.urlopen(req, timeout=timeout) as resp:
            return resp.read(4_000_000).decode("utf-8-sig", errors="replace")
    except Exception:
        return ""


def fetch_rss(url: str, source: str, limit: int = 8) -> list[dict[str, Any]]:
    try:
        req = request.Request(url, headers={"User-Agent": "ohc-stock-market-agent/1.0"})
        with request.urlopen(req, timeout=6) as resp:
            raw = resp.read(700_000).decode("utf-8", errors="replace")
    except Exception:
        return []

    items: list[dict[str, Any]] = []
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return items

    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        desc = re.sub(r"<[^>]+>", "", (item.findtext("description") or "")).strip()
        if title:
            items.append({
                "title": title,
                "summary": desc[:240],
                "source": source,
                "publishedAt": normalize_date(pub_date),
                "url": link,
                "channel": "press"
            })
        if len(items) >= limit:
            return items

    atom_ns = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//atom:entry", atom_ns):
        title = (entry.findtext("atom:title", namespaces=atom_ns) or "").strip()
        link_el = entry.find("atom:link", atom_ns)
        link = link_el.get("href", "") if link_el is not None else ""
        summary = re.sub(r"<[^>]+>", "", (entry.findtext("atom:summary", namespaces=atom_ns) or "")).strip()
        if title:
            items.append({
                "title": title,
                "summary": summary[:240],
                "source": source,
                "publishedAt": normalize_date(entry.findtext("atom:updated", namespaces=atom_ns) or ""),
                "url": link,
                "channel": "press"
            })
        if len(items) >= limit:
            break
    return items


def normalize_date(value: str) -> str:
    if not value:
        return ""
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except Exception:
        return value[:40]


def parse_influencer_sources(project_dir: Path) -> dict[str, list[dict[str, str]]]:
    sources = project_dir / "sources.md"
    if not sources.exists():
        return {"press": [], "influencers": []}

    press: list[dict[str, str]] = []
    influencers: list[dict[str, str]] = []
    section = ""
    for line in sources.read_text(encoding="utf-8").splitlines():
        if "## Twitter Influencers" in line or "## 中文 Twitter Influencers" in line:
            section = "influencers"
            continue
        if "## Press / Media Sources" in line:
            section = "press"
            continue
        if not line.startswith("|") or line.startswith("| -") or line.startswith("|--"):
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) < 4 or cols[0] in ("Handle", "Source"):
            continue
        if section == "press":
            press.append({"source": cols[0], "name": cols[1], "leaning": cols[2], "bio": cols[3]})
        elif section == "influencers":
            influencers.append({"handle": cols[0], "name": cols[1], "bio": cols[2], "domain": cols[3]})
    return {"press": press, "influencers": influencers}


def collect_macro_news(config: dict[str, Any], statuses: list[SourceStatus], live_news: bool = False) -> list[dict[str, Any]]:
    keywords = [k.lower() for k in config["macroKeywords"]]
    news: list[dict[str, Any]] = []

    if live_news:
        for source in config["pressSources"]:
            items = fetch_rss(source["url"], source["name"], limit=10)
            if items:
                statuses.append(SourceStatus(f"press:{source['name']}", "ok", f"{len(items)} RSS items"))
            else:
                statuses.append(SourceStatus(f"press:{source['name']}", "missing", "RSS unavailable or empty"))
            for item in items:
                haystack = f"{item['title']} {item.get('summary', '')}".lower()
                if any(keyword in haystack for keyword in keywords):
                    item["importance"] = score_news(item["title"], item.get("summary", ""), keywords)
                    news.append(item)
    else:
        statuses.append(SourceStatus("press:rss", "skipped", "default snapshot mode; pass --live-news"))

    influencer_dir = Path(config["sourcePaths"]["influencerAndPress"])
    latest_md = influencer_dir / "latest.md"
    if latest_md.exists():
        local_hits = extract_local_macro_hits(latest_md, keywords)
        news.extend(local_hits)
        statuses.append(SourceStatus("local:influencer-latest", "ok", f"{len(local_hits)} macro hits"))
    else:
        statuses.append(SourceStatus("local:influencer-latest", "missing", "latest.md not found"))

    if live_news and has_cmd("twitter"):
        tweets = fetch_twitter_macro(keywords)
        news.extend(tweets)
        statuses.append(SourceStatus("twitter-cli", "ok" if tweets else "empty", f"{len(tweets)} macro tweets"))
    elif not has_cmd("twitter"):
        statuses.append(SourceStatus("twitter-cli", "missing", "twitter command not installed"))
    else:
        statuses.append(SourceStatus("twitter-cli", "skipped", "default snapshot mode; pass --live-news"))

    unique = dedupe_items(news)
    unique.sort(key=lambda x: (x.get("importance", 0), x.get("publishedAt", "")), reverse=True)
    return unique[:36]


def score_news(title: str, summary: str, keywords: list[str]) -> int:
    text = f"{title} {summary}".lower()
    score = sum(1 for k in keywords if k in text)
    if any(k in text for k in ("fed", "fomc", "powell", "cpi", "tariff", "war", "white house")):
        score += 2
    return score


def extract_local_macro_hits(path: Path, keywords: list[str]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip(" -")
        if len(line) < 35:
            continue
        lower = line.lower()
        if any(k in lower for k in keywords):
            title = re.sub(r"\s+", " ", line)
            hits.append({
                "title": title[:220],
                "summary": "",
                "source": "Influencer/Press latest.md",
                "publishedAt": "",
                "url": "",
                "channel": "local",
                "importance": score_news(title, "", keywords)
            })
    return hits[:20]


def fetch_twitter_macro(keywords: list[str]) -> list[dict[str, Any]]:
    query = "(Fed OR FOMC OR Powell OR tariff OR war OR WhiteHouse OR CPI) lang:en"
    try:
        result = subprocess.run(
            ["twitter", "search", query, "--json", "--max", "12"],
            capture_output=True,
            text=True,
            timeout=25,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    items = envelope.get("data", []) if isinstance(envelope, dict) else []
    tweets = []
    for item in items:
        text = (item.get("text") or "").replace("\n", " ")
        if not text:
            continue
        author = item.get("author", {}) or {}
        tweets.append({
            "title": text[:220],
            "summary": "",
            "source": f"X @{author.get('screenName') or author.get('screen_name') or author.get('name', '')}",
            "publishedAt": item.get("createdAt") or item.get("created_at") or "",
            "url": "",
            "channel": "x",
            "importance": score_news(text, "", keywords)
        })
    return tweets


def collect_stock_news(config: dict[str, Any], statuses: list[SourceStatus], live_news: bool = False) -> dict[str, list[dict[str, Any]]]:
    watchlist = config["watchlist"]
    data: dict[str, list[dict[str, Any]]] = {}
    futu_available = has_cmd("futu") or has_cmd("futubull")
    statuses.append(SourceStatus("futubull", "missing" if not futu_available else "available", "CLI not found; Yahoo news fallback" if not futu_available else "CLI found"))

    for ticker in watchlist:
        data[ticker] = []

    if live_news:
        for ticker in watchlist:
            url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
            items = []
            for attempt in range(2):
                items = fetch_rss(url, f"Yahoo Finance {ticker}", limit=8)
                if items:
                    break
                if attempt == 0:
                    time.sleep(0.5)
            for item in items:
                item["ticker"] = ticker
            data[ticker].extend(items)
        statuses.append(SourceStatus("yahoo:stock-news", "ok", f"{sum(len(v) for v in data.values())} stock news items"))
    else:
        statuses.append(SourceStatus("yahoo:stock-news", "skipped", "default snapshot mode; pass --live-news"))

    influencer_dir = Path(config["sourcePaths"]["influencerAndPress"])
    latest_md = influencer_dir / "latest.md"
    if latest_md.exists():
        local = extract_local_stock_hits(latest_md, watchlist)
        for ticker, items in local.items():
            data[ticker].extend(items)
        statuses.append(SourceStatus("local:stock-news", "ok", f"{sum(len(v) for v in local.values())} ticker mentions"))
    return data


def extract_local_stock_hits(path: Path, watchlist: list[str]) -> dict[str, list[dict[str, Any]]]:
    result = {ticker: [] for ticker in watchlist}
    patterns = {ticker: re.compile(rf"(?<![A-Z])[$]?(?:{re.escape(ticker)})(?![A-Z])", re.IGNORECASE) for ticker in watchlist}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = re.sub(r"\s+", " ", raw.strip(" -"))
        if len(line) < 35:
            continue
        for ticker, pattern in patterns.items():
            if pattern.search(line):
                result[ticker].append({
                    "title": line[:220],
                    "summary": "",
                    "source": "Influencer/Press latest.md",
                    "publishedAt": "",
                    "url": "",
                    "channel": "local",
                    "ticker": ticker
                })
                break
    return {ticker: items[:10] for ticker, items in result.items()}


def dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in items:
        key = (item.get("url") or item.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def download_history(tickers: list[str], period: str = "1y") -> Any:
    if yf is None:
        return None
    def _download() -> Any:
        return yf.download(
            tickers=sorted(set(tickers)),
            period=period,
            auto_adjust=False,
            progress=False,
            threads=False,
            group_by="ticker",
            timeout=15,
        )
    return with_timeout(35, None, _download)


def close_series(history: Any, ticker: str) -> Any:
    if history is None or getattr(history, "empty", True):
        return None
    try:
        if hasattr(history.columns, "nlevels") and history.columns.nlevels > 1:
            if ticker in history.columns.get_level_values(0):
                return history[ticker]["Close"].dropna()
            if "Close" in history.columns.get_level_values(0):
                return history["Close"][ticker].dropna()
        if "Close" in history:
            return history["Close"].dropna()
    except Exception:
        return None
    return None


def asset_class_for(symbol: str) -> str:
    return "etf" if symbol.upper() in {"SPY", "QQQ"} else "stocks"


def fetch_nasdaq_quote(symbol: str) -> dict[str, Any]:
    asset_class = asset_class_for(symbol)
    url = f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass={asset_class}"
    payload = fetch_json(url, timeout=10)
    primary = (payload.get("data") or {}).get("primaryData") or {}
    price = parse_number(primary.get("lastSalePrice"))
    change = parse_number(primary.get("netChange"))
    pct = parse_number(primary.get("percentageChange"))
    if price is None:
        return {"symbol": symbol, "source": "Nasdaq", "ok": False}
    return {
        "symbol": symbol,
        "price": clean_float(price, 4),
        "netChange": clean_float(change, 4),
        "change1dPct": clean_float(pct, 2),
        "volume": clean_float(parse_number(primary.get("volume")), 0),
        "timestamp": primary.get("lastTradeTimestamp") or "",
        "isRealTime": bool(primary.get("isRealTime")),
        "source": "Nasdaq quote",
        "ok": True,
    }


def fetch_nasdaq_history(symbol: str, days: int = 430) -> Any:
    asset_class = asset_class_for(symbol)
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    url = (
        f"https://api.nasdaq.com/api/quote/{symbol}/historical"
        f"?assetclass={asset_class}&fromdate={start.isoformat()}&todate={end.isoformat()}&limit=9999"
    )
    payload = fetch_json(url, timeout=12)
    rows = (((payload.get("data") or {}).get("tradesTable") or {}).get("rows") or [])
    points: list[tuple[Any, float]] = []
    for row in rows:
        close = parse_number(row.get("close"))
        date_raw = row.get("date")
        if close is None or not date_raw:
            continue
        try:
            date_value = datetime.strptime(date_raw, "%m/%d/%Y")
        except ValueError:
            continue
        points.append((date_value, close))
    points.sort(key=lambda item: item[0])
    if not points:
        return None
    if pd is not None:
        return pd.Series([p[1] for p in points], index=[p[0] for p in points])
    return [p[1] for p in points]


def fetch_nasdaq_eps_ttm(symbol: str) -> float | str:
    url = f"https://api.nasdaq.com/api/quote/{symbol}/eps?assetclass=stocks"
    payload: dict[str, Any] = {}
    for attempt in range(2):
        payload = fetch_json(url, timeout=8)
        if payload.get("data"):
            break
        if attempt == 0:
            time.sleep(0.4)
    rows = (payload.get("data") or {}).get("earningsPerShare") or []
    previous = [parse_number(row.get("earnings")) for row in rows if row.get("type") == "PreviousQuarter"]
    previous = [value for value in previous if value is not None]
    if len(previous) < 4:
        return MISSING
    return clean_float(sum(previous[-4:]), 4)


def collect_nasdaq_market_data(symbols: list[str], option_symbols: list[str], statuses: list[SourceStatus]) -> dict[str, Any]:
    data = {"quotes": {}, "history": {}, "epsTtm": {}, "options": {}}
    symbols = sorted(set(symbols))
    option_symbols = sorted(set(option_symbols))
    with ThreadPoolExecutor(max_workers=8) as pool:
        quote_futures = {pool.submit(fetch_nasdaq_quote, symbol): symbol for symbol in symbols}
        history_futures = {pool.submit(fetch_nasdaq_history, symbol): symbol for symbol in symbols}
        eps_futures = {pool.submit(fetch_nasdaq_eps_ttm, symbol): symbol for symbol in symbols if asset_class_for(symbol) == "stocks"}
        option_futures = {pool.submit(fetch_nasdaq_option_summary, symbol): symbol for symbol in option_symbols}

        for future in as_completed(quote_futures):
            symbol = quote_futures[future]
            try:
                quote = future.result()
            except Exception:
                quote = {"symbol": symbol, "ok": False}
            if quote.get("ok"):
                data["quotes"][symbol] = quote

        for future in as_completed(history_futures):
            symbol = history_futures[future]
            try:
                series = future.result()
            except Exception:
                series = None
            if series is not None and len(series) > 0:
                data["history"][symbol] = series

        for future in as_completed(eps_futures):
            symbol = eps_futures[future]
            try:
                eps = future.result()
            except Exception:
                eps = MISSING
            if eps != MISSING:
                data["epsTtm"][symbol] = eps

        for future in as_completed(option_futures):
            symbol = option_futures[future]
            try:
                option = future.result()
            except Exception:
                option = {}
            if option:
                data["options"][symbol] = option

    statuses.append(SourceStatus("nasdaq:quotes", "ok" if data["quotes"] else "missing", f"{len(data['quotes'])}/{len(symbols)} quotes"))
    statuses.append(SourceStatus("nasdaq:history", "ok" if data["history"] else "missing", f"{len(data['history'])}/{len(symbols)} histories"))
    statuses.append(SourceStatus("nasdaq:eps", "ok" if data["epsTtm"] else "missing", f"{len(data['epsTtm'])} TTM EPS values"))
    statuses.append(SourceStatus("nasdaq:options", "ok" if data["options"] else "missing", f"{len(data['options'])}/{len(option_symbols)} option chains"))
    return data


def fetch_nasdaq_option_summary(symbol: str) -> dict[str, Any]:
    asset_class = asset_class_for(symbol)
    url = f"https://api.nasdaq.com/api/quote/{symbol}/option-chain?assetclass={asset_class}&limit=5000"
    payload = fetch_json(url, timeout=14)
    rows = (((payload.get("data") or {}).get("table") or {}).get("rows") or [])
    current_expiry = ""
    option_rows: list[dict[str, Any]] = []
    for row in rows:
        group = row.get("expirygroup")
        if group and not current_expiry:
            current_expiry = group
            continue
        if group and current_expiry and option_rows:
            break
        strike = parse_number(row.get("strike"))
        if strike is None:
            continue
        option_rows.append({
            "strike": strike,
            "callOi": parse_number(row.get("c_Openinterest")) or 0,
            "putOi": parse_number(row.get("p_Openinterest")) or 0,
        })
    if not option_rows:
        return {}
    call_oi = sum(row["callOi"] for row in option_rows)
    put_oi = sum(row["putOi"] for row in option_rows)
    max_pain = estimate_max_pain_from_rows(option_rows)
    return {
        "source": "Nasdaq option-chain",
        "maxPain": max_pain,
        "iv": MISSING,
        "callOpenInterest": int(call_oi),
        "putOpenInterest": int(put_oi),
        "putCallOiRatio": clean_float(put_oi / call_oi if call_oi else None, 2),
        "expiration": current_expiry,
    }


def estimate_max_pain_from_rows(rows: list[dict[str, Any]]) -> float | str:
    losses = []
    for candidate in sorted({row["strike"] for row in rows}):
        call_loss = sum(max(0, candidate - row["strike"]) * row["callOi"] for row in rows)
        put_loss = sum(max(0, row["strike"] - candidate) * row["putOi"] for row in rows)
        losses.append((call_loss + put_loss, candidate))
    return clean_float(min(losses, key=lambda x: x[0])[1], 2) if losses else MISSING


def fetch_cboe_index_history(symbol: str, statuses: list[SourceStatus]) -> dict[str, Any]:
    raw = fetch_text(f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{symbol}_History.csv", timeout=12)
    if not raw:
        statuses.append(SourceStatus(f"cboe:{symbol.lower()}", "missing", f"{symbol} history unavailable"))
        return {}
    rows = list(csv.DictReader(raw.splitlines()))
    points: list[tuple[Any, float]] = []
    for row in rows:
        close = parse_number(row.get("CLOSE"))
        date_raw = row.get("DATE")
        if close is None or not date_raw:
            continue
        try:
            date_value = datetime.strptime(date_raw, "%m/%d/%Y")
        except ValueError:
            continue
        points.append((date_value, close))
    points.sort(key=lambda item: item[0])
    if len(points) < 2:
        statuses.append(SourceStatus(f"cboe:{symbol.lower()}", "missing", f"{symbol} history empty"))
        return {}
    latest = points[-1][1]
    prev = points[-2][1]
    series = pd.Series([p[1] for p in points], index=[p[0] for p in points]) if pd is not None else [p[1] for p in points]
    statuses.append(SourceStatus(f"cboe:{symbol.lower()}", "ok", f"latest close {points[-1][0].date().isoformat()}"))
    return {"value": clean_float(latest, 2), "change1dPct": pct_change(latest, prev), "series": series, "source": f"Cboe {symbol} history"}


def fetch_treasury_curve(statuses: list[SourceStatus]) -> dict[str, Any]:
    year = datetime.now(timezone.utc).year
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv"
    )
    raw = fetch_text(url, timeout=12)
    if not raw:
        statuses.append(SourceStatus("treasury:yield-curve", "missing", "CSV unavailable"))
        return {}
    rows = list(csv.DictReader(raw.splitlines()))
    if not rows:
        statuses.append(SourceStatus("treasury:yield-curve", "missing", "CSV empty"))
        return {}
    rows.sort(key=lambda row: datetime.strptime(row["Date"], "%m/%d/%Y"))
    latest = rows[-1]
    prev = rows[-6] if len(rows) > 5 else (rows[-2] if len(rows) > 1 else latest)
    mapping = {"US1Y": "1 Yr", "US10Y": "10 Yr", "US20Y": "20 Yr", "US30Y": "30 Yr"}
    result = {}
    for key, column in mapping.items():
        value = parse_number(latest.get(column))
        previous = parse_number(prev.get(column))
        result[key] = {
            "yield": clean_float(value, 2),
            "change5dPct": pct_change(value, previous),
            "asOf": latest.get("Date", ""),
            "source": "US Treasury daily yield curve",
        }
    statuses.append(SourceStatus("treasury:yield-curve", "ok", f"latest {latest.get('Date', '')}"))
    return result


def fetch_fx_rates(statuses: list[SourceStatus]) -> dict[str, Any]:
    payload = fetch_json("https://open.er-api.com/v6/latest/USD", timeout=8)
    rates = payload.get("rates") or {}
    if not rates:
        statuses.append(SourceStatus("fx:open-er-api", "missing", "USD rates unavailable"))
        return {}
    statuses.append(SourceStatus("fx:open-er-api", "ok", payload.get("time_last_update_utc", "latest USD rates")))
    return {
        "USDCNY": {"value": clean_float(rates.get("CNY"), 4), "change1dPct": MISSING, "source": "open.er-api.com"},
        "USDJPY": {"value": clean_float(rates.get("JPY"), 4), "change1dPct": MISSING, "source": "open.er-api.com"},
    }


def moving_average(series: Any, days: int) -> float | str:
    if series is None or len(series) < days:
        return MISSING
    return clean_float(series.tail(days).mean(), 2)


def current_price(series: Any) -> float | str:
    if series is None or len(series) == 0:
        return MISSING
    return clean_float(series.iloc[-1], 2)


def price_change(series: Any, lookback: int) -> float | str:
    if series is None or len(series) <= lookback:
        return MISSING
    return pct_change(series.iloc[-1], series.iloc[-lookback - 1])


def atr_from_ticker(ticker: str, period: str = "6mo") -> float | str:
    if yf is None:
        return MISSING
    hist = with_timeout(DEFAULT_TIMEOUT_SECONDS, None, lambda: yf.Ticker(ticker).history(period=period))
    if hist is None:
        return MISSING
    if hist is None or hist.empty or len(hist) < 15:
        return MISSING
    high_low = hist["High"] - hist["Low"]
    high_prev_close = (hist["High"] - hist["Close"].shift()).abs()
    low_prev_close = (hist["Low"] - hist["Close"].shift()).abs()
    tr = pd.concat([high_low, high_prev_close, low_prev_close], axis=1).max(axis=1) if pd is not None else high_low
    return clean_float(tr.tail(14).mean(), 2)


def ticker_info(ticker: str, rich: bool = False) -> dict[str, Any]:
    if yf is None:
        return {}
    if not rich:
        return {}
    tk = yf.Ticker(ticker)
    info = with_timeout(5, {}, lambda: dict(tk.fast_info or {}))
    rich_info = with_timeout(5, {}, lambda: tk.get_info())
    if isinstance(rich_info, dict):
        info.update({k: v for k, v in rich_info.items() if k in ("trailingPE", "forwardPE", "trailingPegRatio", "regularMarketPrice")})
    return info


def option_summary(ticker: str, live_options: bool = False) -> dict[str, Any]:
    option_available = has_cmd("option-opinion")
    summary: dict[str, Any] = {
        "source": "option-opinion" if option_available else "Yahoo option_chain fallback",
        "maxPain": MISSING,
        "iv": MISSING,
        "callOpenInterest": MISSING,
        "putOpenInterest": MISSING,
        "putCallOiRatio": MISSING,
        "expiration": ""
    }
    if not live_options:
        summary["source"] = "skipped; pass --live-options"
        return summary
    if yf is None:
        return summary
    try:
        tk = yf.Ticker(ticker)
        expirations = with_timeout(DEFAULT_TIMEOUT_SECONDS, [], lambda: list(tk.options or []))
        if not expirations:
            return summary
        expiration = expirations[0]
        chain = with_timeout(DEFAULT_TIMEOUT_SECONDS, None, lambda: tk.option_chain(expiration))
        if chain is None:
            return summary
        calls = chain.calls
        puts = chain.puts
        call_oi = float(calls["openInterest"].fillna(0).sum()) if "openInterest" in calls else 0.0
        put_oi = float(puts["openInterest"].fillna(0).sum()) if "openInterest" in puts else 0.0
        iv_values = []
        if "impliedVolatility" in calls:
            iv_values.extend([float(x) for x in calls["impliedVolatility"].dropna().head(20)])
        if "impliedVolatility" in puts:
            iv_values.extend([float(x) for x in puts["impliedVolatility"].dropna().head(20)])
        summary.update({
            "expiration": expiration,
            "callOpenInterest": int(call_oi),
            "putOpenInterest": int(put_oi),
            "putCallOiRatio": clean_float(put_oi / call_oi if call_oi else None, 2),
            "iv": clean_float(sum(iv_values) / len(iv_values) * 100 if iv_values else None, 2),
            "maxPain": estimate_max_pain(calls, puts)
        })
    except Exception:
        return summary
    return summary


def estimate_max_pain(calls: Any, puts: Any) -> float | str:
    try:
        strikes = sorted(set(calls["strike"].dropna().tolist()) | set(puts["strike"].dropna().tolist()))
        if not strikes:
            return MISSING
        call_rows = calls[["strike", "openInterest"]].fillna(0).values.tolist()
        put_rows = puts[["strike", "openInterest"]].fillna(0).values.tolist()
        losses = []
        for settlement in strikes:
            call_loss = sum(max(0, settlement - strike) * oi for strike, oi in call_rows)
            put_loss = sum(max(0, strike - settlement) * oi for strike, oi in put_rows)
            losses.append((call_loss + put_loss, settlement))
        return clean_float(min(losses, key=lambda x: x[0])[1], 2)
    except Exception:
        return MISSING


def collect_indicators(
    config: dict[str, Any],
    statuses: list[SourceStatus],
    live_yahoo: bool = False,
    live_options: bool = False,
    rich_info: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    watchlist = config["watchlist"]
    macro_map = config["macroTickers"]
    nasdaq_symbols = sorted(set(watchlist + ["SPY", "QQQ"] + config["indexConstituentSamples"]["SPY"] + config["indexConstituentSamples"]["QQQ"]))
    nasdaq_data = collect_nasdaq_market_data(nasdaq_symbols, watchlist + ["SPY", "QQQ"], statuses)
    vix_data = fetch_cboe_index_history("VIX", statuses)
    vxn_data = fetch_cboe_index_history("VXN", statuses)
    treasury_data = fetch_treasury_curve(statuses)
    fx_data = fetch_fx_rates(statuses)

    tickers = list(macro_map.values()) + watchlist + config["indexConstituentSamples"]["SPY"] + config["indexConstituentSamples"]["QQQ"]
    history = download_history(tickers) if live_yahoo else None
    statuses.append(SourceStatus("yahoo:history", "ok" if history is not None else ("skipped" if not live_yahoo else "missing"), "pass --live-yahoo for 1y price history"))
    statuses.append(SourceStatus("ibkr-tws", "available" if can_connect_ibkr() else "missing", "TWS local package/app check only; live connection not opened"))
    statuses.append(SourceStatus("option-opinion", "available" if has_cmd("option-opinion") else "missing", "CLI not found; Yahoo option_chain fallback"))

    trade_cache = load_trade_theme_cache(config)
    if trade_cache:
        statuses.append(SourceStatus("local:trade-theme-cache", "ok", "used cached macro market data"))
    else:
        statuses.append(SourceStatus("local:trade-theme-cache", "missing", "latest_market_data.json unavailable"))

    macro = build_macro_indicators(
        config,
        history,
        trade_cache,
        nasdaq_data,
        vix_data,
        vxn_data,
        treasury_data,
        fx_data,
        live_options=live_options,
        rich_info=rich_info,
    )
    stocks = build_stock_indicators(watchlist, history, nasdaq_data, live_options=live_options, rich_info=rich_info)
    return macro, stocks


def load_trade_theme_cache(config: dict[str, Any]) -> dict[str, Any]:
    path = Path(config["sourcePaths"].get("tradeThemeCache", ""))
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload.get("data", {})
    except Exception:
        return {}


def can_connect_ibkr() -> bool:
    return (
        importlib.util.find_spec("ib_insync") is not None
        and Path("/Users/bytedance/Applications/Trader Workstation").exists()
    )


def cached_current(cache: dict[str, Any], key: str) -> float | str:
    return clean_float(cache.get(key, {}).get("current"), 2)


def cached_change(cache: dict[str, Any], key: str, period: str = "daily") -> float | str:
    return clean_float(cache.get(key, {}).get("changes", {}).get(period, {}).get("pct"), 2)


def get_history_series(nasdaq_data: dict[str, Any], yfinance_history: Any, ticker: str) -> Any:
    if ticker in nasdaq_data.get("history", {}):
        return nasdaq_data["history"][ticker]
    return close_series(yfinance_history, ticker)


def quote_value(nasdaq_data: dict[str, Any], ticker: str, field: str, fallback: Any = MISSING) -> Any:
    return nasdaq_data.get("quotes", {}).get(ticker, {}).get(field, fallback)


def derived_pe(nasdaq_data: dict[str, Any], ticker: str) -> float | str:
    price = quote_value(nasdaq_data, ticker, "price")
    eps = nasdaq_data.get("epsTtm", {}).get(ticker, MISSING)
    if isinstance(price, (int, float)) and isinstance(eps, (int, float)) and eps > 0:
        return clean_float(price / eps, 2)
    return MISSING


def sample_pe_proxy(nasdaq_data: dict[str, Any], tickers: list[str]) -> float | str:
    values = [derived_pe(nasdaq_data, ticker) for ticker in tickers]
    numeric = [value for value in values if isinstance(value, (int, float)) and value > 0]
    if not numeric:
        return MISSING
    return clean_float(sum(numeric) / len(numeric), 2)


def build_macro_indicators(
    config: dict[str, Any],
    history: Any,
    trade_cache: dict[str, Any],
    nasdaq_data: dict[str, Any],
    vix_data: dict[str, Any],
    vxn_data: dict[str, Any],
    treasury_data: dict[str, Any],
    fx_data: dict[str, Any],
    live_options: bool = False,
    rich_info: bool = False,
) -> dict[str, Any]:
    macro_map = config["macroTickers"]
    indices: dict[str, Any] = {}
    for name in ("QQQ", "SPY"):
        ticker = macro_map[name]
        series = get_history_series(nasdaq_data, history, ticker)
        info = ticker_info(ticker, rich=rich_info)
        cache_key = "SPX" if name == "SPY" else name
        price = quote_value(nasdaq_data, ticker, "price", current_price(series) if series is not None else cached_current(trade_cache, cache_key))
        change_1d = quote_value(nasdaq_data, ticker, "change1dPct", price_change(series, 1) if series is not None else cached_change(trade_cache, cache_key))
        pe_proxy = sample_pe_proxy(nasdaq_data, config["indexConstituentSamples"][name])
        indices[name] = {
            "price": price,
            "change1dPct": change_1d,
            "pe": clean_float(info.get("trailingPE") or info.get("forwardPE") or info.get("trailingPegRatio"), 2) if rich_info else pe_proxy,
            "peSource": "Nasdaq top-holdings sample PE proxy" if pe_proxy != MISSING else "unavailable",
            "ma10": moving_average(series, 10),
            "ma30": moving_average(series, 30),
            "ma60": moving_average(series, 60),
            "ma180": moving_average(series, 180),
            "option": nasdaq_data.get("options", {}).get(ticker) or option_summary(ticker, live_options=live_options),
            "atr14": atr_from_series(series),
            "source": quote_value(nasdaq_data, ticker, "source", "local cache" if price != MISSING else "unavailable"),
            "timestamp": quote_value(nasdaq_data, ticker, "timestamp", ""),
        }

    vol = {}
    for key in ("VIX", "QQQ_VIX_PROXY", "SPY_VIX_PROXY"):
        active_vol = vxn_data if key == "QQQ_VIX_PROXY" else vix_data
        series = active_vol.get("series")
        cache_key = "VIX" if key in ("VIX", "SPY_VIX_PROXY") else ""
        vol[key] = {
            "value": active_vol.get("value") if active_vol else (current_price(series) if series is not None else cached_current(trade_cache, cache_key)),
            "change1dPct": active_vol.get("change1dPct") if active_vol else (price_change(series, 1) if series is not None else cached_change(trade_cache, cache_key)),
            "source": active_vol.get("source", "local cache") if active_vol else "unavailable",
        }

    fx = {}
    for key in ("USDCNY", "USDJPY"):
        cache_key = "USDJPY" if key == "USDJPY" else ""
        fx[key] = {
            "value": fx_data.get(key, {}).get("value", cached_current(trade_cache, cache_key)),
            "change1dPct": fx_data.get(key, {}).get("change1dPct", cached_change(trade_cache, cache_key)),
            "source": fx_data.get(key, {}).get("source", "local cache"),
        }

    bonds = {}
    for key in ("US1Y", "US10Y", "US20Y", "US30Y"):
        cache_key = {"US1Y": "US2Y", "US10Y": "US10Y", "US20Y": "US20Y", "US30Y": "US20Y"}.get(key, "")
        bonds[key] = {
            "yield": treasury_data.get(key, {}).get("yield", cached_current(trade_cache, cache_key)),
            "change5dPct": treasury_data.get(key, {}).get("change5dPct", cached_change(trade_cache, cache_key, "weekly")),
            "asOf": treasury_data.get(key, {}).get("asOf", ""),
            "source": treasury_data.get(key, {}).get("source", "local cache"),
        }

    breadth = {
        "SPY": breadth_for_sample(config["indexConstituentSamples"]["SPY"], history, nasdaq_data),
        "QQQ": breadth_for_sample(config["indexConstituentSamples"]["QQQ"], history, nasdaq_data)
    }

    return {
        "indices": indices,
        "volatility": vol,
        "fx": fx,
        "bonds": bonds,
        "breadth": breadth,
        "source": "Nasdaq quote/history, Cboe VIX, US Treasury, open.er-api; Yahoo optional fallback"
    }


def atr_from_series(series: Any, days: int = 14) -> float | str:
    if series is None or len(series) <= days:
        return MISSING
    try:
        diffs = series.diff().abs().dropna()
        if len(diffs) < days:
            return MISSING
        return clean_float(diffs.tail(days).mean(), 2)
    except Exception:
        return MISSING


def breadth_for_sample(tickers: list[str], history: Any, nasdaq_data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"sampleSize": len(tickers)}
    for window in (10, 30, 60, 180):
        above = 0
        available = 0
        for ticker in tickers:
            yf_ticker = ticker.replace("-", ".")
            series = get_history_series(nasdaq_data, history, ticker)
            if series is None:
                series = close_series(history, ticker)
            if series is None or len(series) < window:
                continue
            available += 1
            if float(series.iloc[-1]) > float(series.tail(window).mean()):
                above += 1
        result[f"ama{window}"] = clean_float(above / available * 100 if available else None, 1)
    return result


def build_stock_indicators(watchlist: list[str], history: Any, nasdaq_data: dict[str, Any], live_options: bool = False, rich_info: bool = False) -> dict[str, Any]:
    stocks: dict[str, Any] = {}
    for ticker in watchlist:
        series = get_history_series(nasdaq_data, history, ticker)
        info = ticker_info(ticker, rich=rich_info)
        price = quote_value(nasdaq_data, ticker, "price", current_price(series))
        eps_ttm = nasdaq_data.get("epsTtm", {}).get(ticker, MISSING)
        pe_value = derived_pe(nasdaq_data, ticker)
        stocks[ticker] = {
            "price": price,
            "change1dPct": quote_value(nasdaq_data, ticker, "change1dPct", price_change(series, 1)),
            "pe": clean_float(info.get("trailingPE") or info.get("forwardPE"), 2) if rich_info else pe_value,
            "peSource": "Nasdaq price / TTM EPS",
            "epsTtm": eps_ttm,
            "ma10": moving_average(series, 10),
            "ma30": moving_average(series, 30),
            "ma60": moving_average(series, 60),
            "ma180": moving_average(series, 180),
            "option": nasdaq_data.get("options", {}).get(ticker) or option_summary(ticker, live_options=live_options),
            "source": quote_value(nasdaq_data, ticker, "source", "unavailable"),
            "timestamp": quote_value(nasdaq_data, ticker, "timestamp", ""),
        }
    return stocks


def recommendation(macro: dict[str, Any], stocks: dict[str, Any], macro_news: list[dict[str, Any]]) -> dict[str, Any]:
    score = 0
    drivers: list[str] = []
    vix = macro.get("volatility", {}).get("VIX", {}).get("value")
    if isinstance(vix, (int, float)):
        if vix >= 25:
            score -= 3
            drivers.append("VIX above 25: risk-off volatility regime")
        elif vix <= 16:
            score += 2
            drivers.append("VIX below 16: benign volatility backdrop")

    spy = macro.get("indices", {}).get("SPY", {})
    qqq = macro.get("indices", {}).get("QQQ", {})
    for label, item in (("SPY", spy), ("QQQ", qqq)):
        price = item.get("price")
        ma60 = item.get("ma60")
        ma180 = item.get("ma180")
        if isinstance(price, (int, float)) and isinstance(ma60, (int, float)):
            if price > ma60:
                score += 1
            else:
                score -= 1
                drivers.append(f"{label} below MA60")
        if isinstance(price, (int, float)) and isinstance(ma180, (int, float)) and price < ma180:
            score -= 2
            drivers.append(f"{label} below MA180")

    breadth_spy = macro.get("breadth", {}).get("SPY", {}).get("ama60")
    if isinstance(breadth_spy, (int, float)):
        if breadth_spy >= 60:
            score += 1
            drivers.append("SPY sample breadth above 60% over MA60")
        elif breadth_spy < 40:
            score -= 1
            drivers.append("SPY sample breadth below 40% over MA60")

    high_impact_news = [n for n in macro_news if n.get("importance", 0) >= 3]
    if len(high_impact_news) >= 5:
        score -= 1
        drivers.append("Multiple high-impact macro headlines detected")

    posture = "Neutral"
    if score >= 3:
        posture = "Risk-on"
    elif score <= -3:
        posture = "Risk-off"

    focus = []
    for ticker, data in stocks.items():
        price = data.get("price")
        ma60 = data.get("ma60")
        option = data.get("option", {})
        iv = option.get("iv")
        if isinstance(price, (int, float)) and isinstance(ma60, (int, float)) and price > ma60:
            focus.append(f"{ticker}: trend above MA60")
        elif isinstance(price, (int, float)) and isinstance(ma60, (int, float)):
            focus.append(f"{ticker}: below MA60, wait for repair")
        if isinstance(iv, (int, float)) and iv > 55:
            focus.append(f"{ticker}: elevated option IV")

    return {
        "posture": posture,
        "riskScore": score,
        "summary": build_summary(posture, score),
        "drivers": drivers[:8],
        "focus": focus[:14],
        "disclaimer": "Rules-based dashboard signal only; not an order or investment advice."
    }


def build_summary(posture: str, score: int) -> str:
    if posture == "Risk-on":
        return f"Market backdrop is constructive with score {score}; favor trend-following exposure while monitoring macro headline risk."
    if posture == "Risk-off":
        return f"Market backdrop is defensive with score {score}; prioritize cash, hedges, and confirmation before adding beta."
    return f"Market backdrop is mixed with score {score}; keep position sizing moderate and wait for stronger cross-asset confirmation."


def write_outputs(payload: dict[str, Any]) -> None:
    LATEST_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    global CONFIG_FILE

    parser = argparse.ArgumentParser(description="Collect Stock Market Agent dashboard data")
    parser.add_argument("--config", default=str(CONFIG_FILE), help="config path")
    parser.add_argument("--local-news-only", action="store_true", help="skip external RSS/Twitter news and use local snapshot mentions only")
    parser.add_argument("--live-yahoo", action="store_true", help="fetch Yahoo 1y price history instead of local cache-only indicators")
    parser.add_argument("--live-options", action="store_true", help="fetch Yahoo option chains")
    parser.add_argument("--rich-info", action="store_true", help="fetch richer Yahoo info payloads for PE fields")
    args = parser.parse_args()

    CONFIG_FILE = Path(args.config).resolve()

    statuses: list[SourceStatus] = []
    config = load_config()
    if yf is None:
        statuses.append(SourceStatus("yfinance", "missing", "Python package not installed"))
    else:
        statuses.append(SourceStatus("yfinance", "ok", "Python package available"))

    macro_news = collect_macro_news(config, statuses, live_news=not args.local_news_only)
    stock_news = collect_stock_news(config, statuses, live_news=not args.local_news_only)
    macro_indicators, stock_indicators = collect_indicators(
        config,
        statuses,
        live_yahoo=args.live_yahoo,
        live_options=args.live_options,
        rich_info=args.rich_info,
    )
    reco = recommendation(macro_indicators, stock_indicators, macro_news)

    payload = {
        "generatedAt": now_iso(),
        "meta": {
            "name": "Stock-Market-Agent",
            "watchlist": config["watchlist"],
            "timezone": "UTC"
        },
        "sourcesStatus": [s.as_dict() for s in statuses],
        "macroNews": macro_news,
        "stockNews": stock_news,
        "macroIndicators": macro_indicators,
        "stockIndicators": stock_indicators,
        "recommendation": reco
    }
    write_outputs(payload)
    print(f"wrote {LATEST_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
