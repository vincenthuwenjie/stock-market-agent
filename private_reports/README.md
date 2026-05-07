# Private Reports

This directory is for local-only authorized report files. Files here are ignored by Git and are never read on Vercel.

Enable local reading with:

```bash
ENABLE_PRIVATE_REPORTS=1 npm run dev
```

Supported formats:

```md
---
title: 2026-05-03 Weekly Report
author: Bo Zeng
publishedAt: 2026-05-03T08:00:00+08:00
source: boist.org
url: https://boist.org/...
tags: 美股, 周报, 宏观
---

# 2026-05-03 Weekly Report

Authorized personal-use notes or exported text go here.
```

```json
{
  "title": "2026-05-03 Weekly Report",
  "author": "Bo Zeng",
  "publishedAt": "2026-05-03T08:00:00+08:00",
  "source": "boist.org",
  "url": "https://boist.org/...",
  "tags": ["美股", "周报", "宏观"],
  "summary": "Short private summary",
  "body": "Authorized personal-use notes or exported text."
}
```

Browser-saved `.html` / `.htm` files are also supported. The loader extracts the title, description, author/date metadata when present, and article/main/body text from the local file.
