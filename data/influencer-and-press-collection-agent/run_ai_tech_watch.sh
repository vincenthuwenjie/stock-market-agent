#!/bin/bash
set -euo pipefail

export PATH="/Users/bytedance/.local/bin:/opt/homebrew/bin:$PATH"
cd /Users/bytedance/ohc/projects/influencer-and-press-collection-agent

exec /opt/homebrew/bin/python3 watch_ai_tech_updates.py
