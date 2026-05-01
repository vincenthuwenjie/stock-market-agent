#!/usr/bin/env python3
"""influencer-and-press-collection-agent — 每日抓取 Twitter 大V 和媒体头条，汇总成 Markdown。

采集策略分层：
  方案 A（主力）: jackwener twitter-cli — 自动浏览器 cookie + GraphQL API
  方案 B（兜底）: Chrome CDP (chrome-devtools-mcp) — 需人工介入时使用

用法:
  python main.py                  # 抓取并生成今日汇总
  python main.py --dry-run        # 仅打印，不写文件
  python main.py --sources FILE   # 指定 sources.md 路径
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

HERE = Path(__file__).resolve().parent
DAILY_DIR = HERE / "daily"
SOURCES_FILE = HERE / "sources.md"

# twitter-cli 的 YAML 输出信封: {ok: true, schema_version: "1", data: [...]}
# 每条 tweet data: {id, text, author: {name, screen_name}, metrics: {likes, retweets, replies, views}, created_at, urls, media}


# ---------------------------------------------------------------------------
# 工具检测
# ---------------------------------------------------------------------------

def _has_cmd(cmd: str) -> bool:
    return shutil.which(cmd) is not None


HAS_TWITTER_CLI = _has_cmd("twitter")
HAS_XHS_CLI = _has_cmd("xhs")


def capabilities() -> dict:
    return {
        "twitter_cli": HAS_TWITTER_CLI,
        "xhs_cli": HAS_XHS_CLI,
    }


# ---------------------------------------------------------------------------
# 解析 sources.md
# ---------------------------------------------------------------------------

def parse_sources(path: Path | None = None) -> dict:
    """从 sources.md 解析 influencer 和 press 列表。"""
    src = path or SOURCES_FILE
    text = src.read_text(encoding="utf-8")

    influencers: list[dict] = []
    press: list[dict] = []

    section = None
    for line in text.splitlines():
        if "## Twitter Influencers" in line or "## 中文 Twitter Influencers" in line:
            section = "influencers"
            continue
        if "## Press / Media Sources" in line:
            section = "press"
            continue
        if not line.startswith("|") or line.startswith("| -") or line.startswith("|--"):
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) < 3:
            continue
        if cols[0] in ("Handle", "Source"):
            continue

        if section == "influencers" and len(cols) >= 4:
            influencers.append({
                "handle": cols[0],
                "name": cols[1],
                "bio": cols[2],
                "domain": cols[3],
            })
        elif section == "press" and len(cols) >= 4:
            press.append({
                "source": cols[0],
                "name": cols[1],
                "leaning": cols[2],
                "bio": cols[3],
            })

    return {"influencers": influencers, "press": press}


# ---------------------------------------------------------------------------
# 方案 A: jackwener twitter-cli（主力）
# ---------------------------------------------------------------------------

def _parse_twitter_cli_output(raw: str) -> list[dict]:
    """解析 twitter-cli --json 或 --yaml 输出的统一信封格式。

    优先用 --json（stdlib 可解析），fallback 到 --yaml（需 PyYAML）。
    """
    # 尝试 JSON
    try:
        envelope = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        # 尝试 YAML
        if HAS_YAML:
            try:
                envelope = yaml.safe_load(raw)
            except Exception:
                return []
        else:
            return []

    if not isinstance(envelope, dict) or not envelope.get("ok"):
        return []

    data = envelope.get("data", [])
    if not isinstance(data, list):
        return []

    tweets = []
    for item in data:
        if not isinstance(item, dict):
            continue
        author = item.get("author", {}) or {}
        metrics = item.get("metrics", {}) or {}
        tweets.append({
            "id": item.get("id", ""),
            "text": (item.get("text", "") or "")[:500],
            "author": author.get("screenName", "") or author.get("screen_name", "") or author.get("name", ""),
            "date": item.get("createdAt", "") or item.get("created_at", ""),
            "likes": metrics.get("likes", 0),
            "retweets": metrics.get("retweets", 0),
            "replies": metrics.get("replies", 0),
            "views": metrics.get("views", 0),
        })
    return tweets


def _fetch_via_twitter_cli(handle: str, max_tweets: int = 5) -> list[dict]:
    """方案 A: 用 jackwener/twitter-cli 抓取用户最新推文。

    命令: twitter user-posts <handle> --yaml --max N
    输出: YAML 信封 {ok, schema_version, data}
    """
    if not HAS_TWITTER_CLI:
        return []

    clean = handle.lstrip("@")
    try:
        result = subprocess.run(
            ["twitter", "user-posts", clean, "--json", "--max", str(max_tweets)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return _parse_twitter_cli_output(result.stdout)
    except (subprocess.TimeoutExpired, OSError):
        pass

    return []


def _fetch_twitter_search(query: str, max_tweets: int = 10) -> list[dict]:
    """用 twitter-cli 搜索推文。"""
    if not HAS_TWITTER_CLI:
        return []

    try:
        result = subprocess.run(
            ["twitter", "search", query, "--json", "--max", str(max_tweets)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return _parse_twitter_cli_output(result.stdout)
    except (subprocess.TimeoutExpired, OSError):
        pass

    return []


def _fetch_twitter_feed(max_tweets: int = 20) -> list[dict]:
    """用 twitter-cli 抓取 home feed。"""
    if not HAS_TWITTER_CLI:
        return []

    try:
        result = subprocess.run(
            ["twitter", "feed", "--json", "--max", str(max_tweets)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return _parse_twitter_cli_output(result.stdout)
    except (subprocess.TimeoutExpired, OSError):
        pass

    return []


# ---------------------------------------------------------------------------
# Twitter 抓取入口（分层降级）
# ---------------------------------------------------------------------------

def fetch_influencer_tweets(handle: str, max_tweets: int = 5) -> list[dict]:
    """抓取单个 influencer 的推文。方案 A → graceful degrade。"""
    # 方案 A: twitter-cli
    tweets = _fetch_via_twitter_cli(handle, max_tweets)
    if tweets:
        return tweets

    # 方案 B (Chrome CDP) 不在自动化流程中调用，需人工介入
    return []


def fetch_influencer_updates(influencers: list[dict]) -> list[dict]:
    """抓取所有 influencer 的最新推文。"""
    results = []
    for inf in influencers:
        handle = inf["handle"]
        tweets = fetch_influencer_tweets(handle)
        results.append({
            **inf,
            "tweets": tweets,
            "fetched": len(tweets) > 0,
        })
    return results


# ---------------------------------------------------------------------------
# Press 抓取（RSS / 网页）
# ---------------------------------------------------------------------------

def _fetch_rss(url: str) -> list[dict]:
    """简单的 RSS 抓取，用 stdlib xml 解析。"""
    from urllib import request
    from xml.etree import ElementTree

    try:
        req = request.Request(url, headers={
            "User-Agent": "ohc-press-collector/1.0",
        })
        with request.urlopen(req, timeout=15) as resp:
            raw = resp.read(500_000).decode("utf-8", errors="replace")
    except Exception:
        return []

    items = []
    try:
        root = ElementTree.fromstring(raw)
        # RSS 2.0
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            desc = (item.findtext("description") or "").strip()
            desc = re.sub(r"<[^>]+>", "", desc)[:200]
            if title:
                items.append({
                    "title": title,
                    "link": link,
                    "date": pub_date,
                    "summary": desc,
                })
            if len(items) >= 5:
                break
        # Atom
        if not items:
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall(".//atom:entry", ns):
                title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
                link_el = entry.find("atom:link", ns)
                link = link_el.get("href", "") if link_el is not None else ""
                summary = (entry.findtext("atom:summary", namespaces=ns) or "").strip()
                summary = re.sub(r"<[^>]+>", "", summary)[:200]
                if title:
                    items.append({"title": title, "link": link, "date": "", "summary": summary})
                if len(items) >= 5:
                    break
    except ElementTree.ParseError:
        pass

    return items


RSS_PATHS = ["/feed", "/rss", "/feed/rss", "/feeds/posts/default", "/rss.xml"]


def fetch_press_updates(press_list: list[dict]) -> list[dict]:
    """抓取所有 press 的最新头条。"""
    results = []
    for p in press_list:
        source = p["source"]
        base = f"https://{source}" if not source.startswith("http") else source

        articles: list[dict] = []
        for rss_path in RSS_PATHS:
            articles = _fetch_rss(f"{base}{rss_path}")
            if articles:
                break

        results.append({
            **p,
            "articles": articles[:5],
            "fetched": len(articles) > 0,
        })
    return results


# ---------------------------------------------------------------------------
# 生成 Markdown 日报
# ---------------------------------------------------------------------------

def generate_daily_md(
    influencer_results: list[dict],
    press_results: list[dict],
    date_str: str,
) -> str:
    """生成每日汇总 Markdown。"""
    lines = [
        f"# Daily Collection — {date_str}",
        "",
        f"> 自动生成于 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"> 采集能力: twitter-cli={'OK' if HAS_TWITTER_CLI else 'N/A'}, xhs-cli={'OK' if HAS_XHS_CLI else 'N/A'}",
        "",
    ]

    # --- Influencers ---
    lines.append("## Twitter Influencers")
    lines.append("")

    fetched_count = sum(1 for r in influencer_results if r["fetched"])
    lines.append(f"成功抓取: {fetched_count}/{len(influencer_results)}")
    lines.append("")

    for r in influencer_results:
        handle = r["handle"]
        name = r["name"]
        domain = r.get("domain", "")
        lines.append(f"### {name} ({handle}) — {domain}")
        lines.append("")

        if not r["fetched"]:
            lines.append("_未能抓取，CLI 不可用或无新推文_")
            lines.append("")
            continue

        for t in r["tweets"][:5]:
            text = t["text"].replace("\n", " ")[:280]
            likes = t.get("likes", 0)
            rts = t.get("retweets", 0)
            views = t.get("views", 0)
            date = t.get("date", "")
            lines.append(f"- {text}")
            metrics_parts = []
            if likes:
                metrics_parts.append(f"likes:{likes}")
            if rts:
                metrics_parts.append(f"RT:{rts}")
            if views:
                metrics_parts.append(f"views:{views}")
            if date:
                metrics_parts.append(date[:10])
            if metrics_parts:
                lines.append(f"  - {' | '.join(metrics_parts)}")
        lines.append("")

    # --- Press ---
    lines.append("---")
    lines.append("")
    lines.append("## Press Headlines")
    lines.append("")

    fetched_press = sum(1 for r in press_results if r["fetched"])
    lines.append(f"成功抓取: {fetched_press}/{len(press_results)}")
    lines.append("")

    for r in press_results:
        name = r["name"]
        leaning = r.get("leaning", "")
        lines.append(f"### {name} ({leaning})")
        lines.append("")

        if not r["fetched"]:
            lines.append("_RSS 不可用或无新文章_")
            lines.append("")
            continue

        for a in r["articles"][:5]:
            title = a["title"]
            link = a.get("link", "")
            summary = a.get("summary", "")
            if link:
                lines.append(f"- [{title}]({link})")
            else:
                lines.append(f"- {title}")
            if summary:
                lines.append(f"  > {summary[:150]}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Influencer & Press Daily Collector")
    parser.add_argument("--dry-run", action="store_true", help="打印结果但不写文件")
    parser.add_argument("--sources", type=str, default=None, help="sources.md 路径")
    args = parser.parse_args()

    sources_path = Path(args.sources) if args.sources else SOURCES_FILE
    sources = parse_sources(sources_path)

    caps = capabilities()
    print(f"[collector] 加载 {len(sources['influencers'])} influencers, {len(sources['press'])} press sources")
    print(f"[collector] 采集能力: {caps}")

    # 抓取
    print("[collector] 抓取 Twitter influencers (方案 A: twitter-cli) ...")
    inf_results = fetch_influencer_updates(sources["influencers"])

    print("[collector] 抓取 Press RSS ...")
    press_results = fetch_press_updates(sources["press"])

    # 生成日报
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    md = generate_daily_md(inf_results, press_results, today)

    if args.dry_run:
        print(md)
        return

    # 写文件
    DAILY_DIR.mkdir(exist_ok=True)
    out_path = DAILY_DIR / f"{today}.md"
    out_path.write_text(md, encoding="utf-8")
    print(f"[collector] 日报已写入: {out_path}")

    latest = HERE / "latest.md"
    latest.write_text(md, encoding="utf-8")
    print(f"[collector] latest.md 已更新")

    # 写 result.json
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "date": today,
        "capabilities": caps,
        "influencers_total": len(inf_results),
        "influencers_fetched": sum(1 for r in inf_results if r["fetched"]),
        "press_total": len(press_results),
        "press_fetched": sum(1 for r in press_results if r["fetched"]),
        "output_file": str(out_path),
    }
    (HERE / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
