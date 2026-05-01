#!/bin/bash
set -euo pipefail

export PATH="/Users/bytedance/.local/bin:$PATH"
cd /Users/bytedance/ohc/projects/influencer-and-press-collection-agent

# 1. 检查新收藏，自动添加新博主到 sources.md
python3 bookmark_watcher.py

# 2. 抓取所有 influencer + press，生成日报
python3 main.py
