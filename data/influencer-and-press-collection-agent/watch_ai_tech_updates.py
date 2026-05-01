#!/usr/bin/env python3
"""watch_ai_tech_updates — 每 3 小时增量记录中文 AI Twitter influencers 的新推文。

规则：
- 仅扫描 `sources.md` 中 `## 中文 Twitter Influencers` 且领域为 `AI` 的账号
- 通过 tweet id 去重
- 首次运行仅建立基线，不回填历史推文
- 有新增时追加写入 `daily-ai-tech/YYYY-MM-DD.md`
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from main import SOURCES_FILE

HERE = Path(__file__).resolve().parent
DEFAULT_STATE_FILE = HERE / "ai_tech_watch_state.json"
DEFAULT_OUTPUT_DIR = HERE / "daily-ai-tech"
DEFAULT_RESULT_FILE = HERE / "ai_tech_watch_result.json"


def _parse_json_output(raw: str) -> dict | None:
    for i, line in enumerate(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                return json.loads("\n".join(raw.splitlines()[i:]))
            except json.JSONDecodeError:
                return None
    return None


def fetch_recent_tweets(handle: str, max_tweets: int) -> list[dict]:
    clean = handle.lstrip("@")
    try:
        result = subprocess.run(
            ["twitter", "user-posts", clean, "--json", "--max", str(max_tweets)],
            capture_output=True,
            text=True,
            timeout=12,
        )
    except (subprocess.TimeoutExpired, OSError):
        return []

    if result.returncode != 0 or not result.stdout.strip():
        return []

    envelope = _parse_json_output(result.stdout)
    if not envelope or not envelope.get("ok") or not isinstance(envelope.get("data"), list):
        return []

    tweets = []
    for item in envelope["data"]:
        if not isinstance(item, dict):
            continue
        metrics = item.get("metrics") or {}
        tweets.append(
            {
                "id": item.get("id", ""),
                "text": item.get("text", "")[:500],
                "date": item.get("createdAtLocal", "") or item.get("createdAt", ""),
                "likes": metrics.get("likes", 0),
                "retweets": metrics.get("retweets", 0),
                "replies": metrics.get("replies", 0),
                "views": metrics.get("views", 0),
            }
        )
    return tweets


def parse_chinese_ai_influencers(path: Path) -> list[dict]:
    influencers: list[dict] = []
    in_cn_section = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            in_cn_section = "## 中文 Twitter Influencers" in line
            continue
        if not in_cn_section or not line.startswith("|"):
            continue
        cols = [col.strip() for col in line.split("|")[1:-1]]
        if len(cols) < 4 or cols[0] in ("Handle", "--------"):
            continue
        handle, name, bio, domain = cols[:4]
        if not handle.startswith("@") or domain != "AI":
            continue
        influencers.append(
            {
                "handle": handle,
                "name": name or handle.lstrip("@"),
                "bio": bio,
                "domain": domain,
            }
        )
    return influencers


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"initialized": False, "known_tweets": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"initialized": False, "known_tweets": {}}


def save_state(path: Path, state: dict) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _tweet_timestamp(tweet: dict) -> str:
    return tweet.get("date") or tweet.get("createdAtLocal") or ""


def _tweet_metrics(tweet: dict) -> str:
    parts = []
    likes = int(tweet.get("likes") or 0)
    rts = int(tweet.get("retweets") or 0)
    replies = int(tweet.get("replies") or 0)
    views = int(tweet.get("views") or 0)
    if likes:
        parts.append(f"likes:{likes}")
    if rts:
        parts.append(f"RT:{rts}")
    if replies:
        parts.append(f"replies:{replies}")
    if views:
        parts.append(f"views:{views}")
    ts = _tweet_timestamp(tweet)
    if ts:
        parts.append(ts)
    return " | ".join(parts)


def render_update_block(run_at: str, updates: list[dict]) -> str:
    lines = [
        f"## Run — {run_at}",
        "",
        f"- 新增推文数: {sum(len(item['tweets']) for item in updates)}",
        f"- 更新账号数: {len(updates)}",
        "",
    ]
    for item in updates:
        lines.append(f"### {item['name']} ({item['handle']})")
        lines.append("")
        for tweet in item["tweets"]:
            text = (tweet.get("text") or "").replace("\n", " ").strip()
            lines.append(f"- {text}")
            metrics = _tweet_metrics(tweet)
            if metrics:
                lines.append(f"  - {metrics}")
            tweet_id = tweet.get("id", "")
            if tweet_id:
                lines.append(f"  - https://x.com/{item['handle'].lstrip('@')}/status/{tweet_id}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def append_daily_file(output_dir: Path, run_at: str, updates: list[dict]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = output_dir / f"{date_str}.md"
    if path.exists():
        content = path.read_text(encoding="utf-8").rstrip() + "\n\n"
    else:
        content = (
            f"# Daily AI Tech Updates — {date_str}\n\n"
            f"> 自动生成于 {run_at}\n"
            f"> 仅记录中文 Twitter Influencers 中 AI 分类账号的新增推文\n\n"
        )
    content += render_update_block(run_at, updates)
    path.write_text(content, encoding="utf-8")
    return path


def run_watch(
    sources_file: Path,
    state_file: Path,
    output_dir: Path,
    max_tweets: int,
    handles_filter: set[str] | None = None,
    init: bool = False,
    dry_run: bool = False,
) -> dict:
    influencers = parse_chinese_ai_influencers(sources_file)
    if handles_filter:
        influencers = [item for item in influencers if item["handle"].lower() in handles_filter]
    state = load_state(state_file)
    known_tweets = {
        handle: set(ids)
        for handle, ids in state.get("known_tweets", {}).items()
    }
    run_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    fetched = []
    for influencer in influencers:
        tweets = fetch_recent_tweets(influencer["handle"], max_tweets=max_tweets)
        fetched.append({**influencer, "tweets": tweets})

    if init or not state.get("initialized", False):
        next_state = {
            "initialized": True,
            "known_tweets": {
                item["handle"]: [tweet.get("id", "") for tweet in item["tweets"] if tweet.get("id")]
                for item in fetched
            },
            "last_run_at": run_at,
            "mode": "baseline",
        }
        if not dry_run:
            save_state(state_file, next_state)
        return {
            "status": "initialized",
            "mode": "baseline",
            "tracked_handles": len(fetched),
            "new_tweets": 0,
            "updates": [],
            "output_file": "",
        }

    updates = []
    for item in fetched:
        handle = item["handle"]
        seen = known_tweets.get(handle, set())
        new_tweets = []
        for tweet in item["tweets"]:
            tweet_id = tweet.get("id", "")
            if not tweet_id or tweet_id in seen:
                continue
            new_tweets.append(tweet)
            seen.add(tweet_id)
        if new_tweets:
            new_tweets.sort(key=lambda tweet: _tweet_timestamp(tweet))
            updates.append({**item, "tweets": new_tweets})
        known_tweets[handle] = set(list(seen)[-200:])

    output_file = ""
    if updates and not dry_run:
        output_file = str(append_daily_file(output_dir, run_at, updates))

    next_state = {
        "initialized": True,
        "known_tweets": {
            handle: sorted(ids)[-200:]
            for handle, ids in known_tweets.items()
        },
        "last_run_at": run_at,
        "mode": "watch",
    }
    if not dry_run:
        save_state(state_file, next_state)

    return {
        "status": "ok",
        "mode": "watch",
        "tracked_handles": len(fetched),
        "new_tweets": sum(len(item["tweets"]) for item in updates),
        "updated_handles": len(updates),
        "updates": [
            {
                "handle": item["handle"],
                "name": item["name"],
                "tweet_ids": [tweet.get("id", "") for tweet in item["tweets"]],
            }
            for item in updates
        ],
        "output_file": output_file,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch Chinese AI Twitter influencers every 3 hours")
    parser.add_argument("--sources", type=Path, default=SOURCES_FILE)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--result-file", type=Path, default=DEFAULT_RESULT_FILE)
    parser.add_argument("--max-tweets", type=int, default=8)
    parser.add_argument("--handles", type=str, default="", help="Comma-separated handles for targeted runs")
    parser.add_argument("--init", action="store_true", help="Initialize baseline only")
    parser.add_argument("--dry-run", action="store_true", help="Print result without writing files")
    args = parser.parse_args()
    handles_filter = {
        item.strip().lower()
        for item in args.handles.split(",")
        if item.strip()
    } or None

    result = run_watch(
        sources_file=args.sources,
        state_file=args.state_file,
        output_dir=args.output_dir,
        max_tweets=args.max_tweets,
        handles_filter=handles_filter,
        init=args.init,
        dry_run=args.dry_run,
    )
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **result,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not args.dry_run:
        args.result_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
