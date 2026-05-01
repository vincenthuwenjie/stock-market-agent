#!/usr/bin/env python3
"""bookmark_watcher — 监控 Twitter 收藏，自动将新收藏对应的博主加入 sources.md。

原理：记录已知 bookmark ID 集合，每次执行对比差集，新增的即为新收藏。
首次执行会建立基线（不添加博主），之后每次只处理增量。

用法:
  python bookmark_watcher.py              # 检查新收藏，增量添加博主
  python bookmark_watcher.py --init       # 首次初始化基线（只记录，不添加）
  python bookmark_watcher.py --dry-run    # 仅打印，不写文件
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES_FILE = HERE / "sources.md"
STATE_FILE = HERE / "bookmark_watcher_state.json"

BJT = timezone(timedelta(hours=8))


# ---------------------------------------------------------------------------
# twitter-cli 调用
# ---------------------------------------------------------------------------

def _parse_json_output(raw: str) -> dict | None:
    """解析 twitter-cli 的 JSON 输出（跳过 stderr 行如 cookie 提示）。"""
    for i, line in enumerate(raw.splitlines()):
        if line.strip().startswith("{"):
            try:
                return json.loads("\n".join(raw.splitlines()[i:]))
            except json.JSONDecodeError:
                pass
    return None


def fetch_bookmarks(max_results: int = 100) -> list[dict]:
    """调用 twitter bookmarks --json 获取收藏列表。"""
    try:
        result = subprocess.run(
            ["twitter", "bookmarks", "--json", "--max", str(max_results)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return []
        envelope = _parse_json_output(result.stdout)
        if envelope and envelope.get("ok") and isinstance(envelope.get("data"), list):
            return envelope["data"]
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"[watcher] fetch_bookmarks error: {e}")
    return []


def fetch_user_profile(handle: str) -> dict | None:
    """获取用户简介。"""
    try:
        result = subprocess.run(
            ["twitter", "user", handle, "--json"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return None
        envelope = _parse_json_output(result.stdout)
        if envelope and envelope.get("ok"):
            return envelope["data"]
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


# ---------------------------------------------------------------------------
# sources.md 读写
# ---------------------------------------------------------------------------

def get_existing_handles(path: Path | None = None) -> set[str]:
    """从 sources.md 提取已有的 handle 集合（小写）。"""
    src = path or SOURCES_FILE
    if not src.exists():
        return set()
    handles = set()
    for line in src.read_text(encoding="utf-8").splitlines():
        if line.startswith("|") and "@" in line:
            cols = [c.strip() for c in line.split("|")]
            for col in cols:
                if col.startswith("@"):
                    handles.add(col.lower())
    return handles


def append_to_sources(handle: str, name: str, bio: str, domain: str, path: Path | None = None):
    """将新博主追加到 sources.md 的中文 influencer 表末尾。"""
    src = path or SOURCES_FILE
    text = src.read_text(encoding="utf-8")
    lines = text.splitlines()

    new_row = f"| @{handle} | {name} | {bio} | {domain} |"

    # 找到 "## 中文 Twitter Influencers" 表的最后一行
    insert_idx = None
    in_cn_section = False
    for i, line in enumerate(lines):
        if "## 中文 Twitter Influencers" in line:
            in_cn_section = True
            continue
        if in_cn_section:
            if line.startswith("##") or (line.strip() == "" and i + 1 < len(lines) and lines[i + 1].startswith("##")):
                insert_idx = i
                break
            if line.startswith("|") and "@" in line:
                insert_idx = i + 1

    if insert_idx is None:
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip() == "---":
                insert_idx = i
                break
        if insert_idx is None:
            insert_idx = len(lines)

    lines.insert(insert_idx, new_row)
    src.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# 状态：已知 bookmark ID 集合
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"known_ids": [], "added_handles": [], "initialized": False}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# 分类（只有 4 类）
# ---------------------------------------------------------------------------

def guess_domain(bio: str, tweet_text: str = "") -> str:
    """根据简介和推文内容分类。只分 4 类：AI / Tech / Finance / Crypto。"""
    combined = (bio + " " + tweet_text).lower()
    if any(k in combined for k in ["crypto", "btc", "bitcoin", "web3", "加密", "defi", "nft", "eth", "solana", "token"]):
        return "Crypto"
    if any(k in combined for k in ["ai", " ml", "llm", "gpt", "模型", "transformer", "deep learning", "neural", "openai", "claude", "agent"]):
        return "AI"
    if any(k in combined for k in ["stock", "trade", "trading", "invest", "美股", "期权", "option", "fund", "宏观", "macro",
                                    "fed", "美联储", "equity", "bond", "yield", "s&p", "nasdaq", "portfolio", "hedge",
                                    "finance", "金融", "交易", "基本面", "pe ", "eps", "earning"]):
        return "Finance"
    if any(k in combined for k in ["dev", "code", "engineer", "开发", "react", "python", "rust", "api", "infra",
                                    "software", "startup", "founder", "vc", "tech", "科技", "产品"]):
        return "Tech"
    return "Finance"


# ---------------------------------------------------------------------------
# 核心逻辑
# ---------------------------------------------------------------------------

def run_watcher(init: bool = False, dry_run: bool = False) -> list[str]:
    """执行一次收藏检查。

    init=True: 建立基线，只记录当前所有 bookmark ID，不添加博主。
    init=False: 对比已知 ID，新增的收藏 → 提取博主 → 加入 sources.md。
    """
    state = load_state()
    known_ids = set(state.get("known_ids", []))
    is_first_run = not state.get("initialized", False)

    bookmarks = fetch_bookmarks(max_results=100)
    if not bookmarks:
        print("[watcher] 无法获取收藏或收藏为空")
        return []

    current_ids = {bm.get("id", "") for bm in bookmarks if bm.get("id")}

    # 首次运行或 --init：建立基线
    if init or is_first_run:
        print(f"[watcher] 初始化基线: 记录 {len(current_ids)} 个已有收藏")
        if not dry_run:
            state["known_ids"] = list(current_ids)
            state["initialized"] = True
            save_state(state)
        return []

    # 差集 = 新收藏
    new_ids = current_ids - known_ids
    if not new_ids:
        print("[watcher] 无新增收藏")
        return []

    print(f"[watcher] 发现 {len(new_ids)} 条新收藏")

    existing_handles = get_existing_handles()
    new_handles = []

    for bm in bookmarks:
        bm_id = bm.get("id", "")
        if bm_id not in new_ids:
            continue

        author = bm.get("author", {})
        screen_name = author.get("screenName", "")
        if not screen_name:
            continue

        handle_lower = f"@{screen_name}".lower()
        if handle_lower in existing_handles:
            continue
        existing_handles.add(handle_lower)

        # 获取完整 profile
        profile = fetch_user_profile(screen_name)
        name = (profile or author).get("name", screen_name)
        bio_raw = (profile or {}).get("bio", "") or ""
        bio = bio_raw.replace("|", "/").replace("\n", " ")[:60]
        followers = (profile or {}).get("followers", 0)
        tweet_text = bm.get("text", "")
        domain = guess_domain(bio_raw, tweet_text)

        if followers:
            bio_suffix = f"，{followers // 1000}k粉" if followers >= 1000 else f"，{followers}粉"
            bio = bio[:50] + bio_suffix

        print(f"[watcher] 新博主: @{screen_name} ({name}) — {domain}")

        if not dry_run:
            append_to_sources(screen_name, name, bio, domain)

        new_handles.append(f"@{screen_name}")

    # 更新已知 ID
    if not dry_run:
        known_ids.update(current_ids)
        state["known_ids"] = list(known_ids)[-1000:]  # 保留最近 1000 个
        state["added_handles"] = state.get("added_handles", []) + new_handles
        save_state(state)

    return new_handles


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Bookmark Watcher — 从收藏自动发现新博主")
    parser.add_argument("--init", action="store_true",
                        help="初始化基线（记录当前所有收藏，不添加博主）")
    parser.add_argument("--dry-run", action="store_true",
                        help="仅打印，不修改文件")
    args = parser.parse_args()

    now = datetime.now(BJT).strftime("%Y-%m-%d %H:%M BJT")
    print(f"[watcher] {now}")

    new = run_watcher(init=args.init, dry_run=args.dry_run)
    if new:
        print(f"[watcher] 本轮新增 {len(new)} 个博主: {', '.join(new)}")


if __name__ == "__main__":
    main()
