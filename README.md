# Stock Market Agent

Dynamic market dashboard for OHC. The Next.js app renders the cockpit UI and `/api/snapshot` collects public market data at request time with Vercel caching. The Python collector and `latest.json` remain available as a local static snapshot fallback.

## Usage

```bash
cd /Users/bytedance/ohc/projects/stock-market-agent
npm install
npm run dev
```

Open `http://127.0.0.1:3000/`.

The dynamic API uses live RSS news plus Nasdaq quotes/history/options, Nasdaq EPS, Cboe VIX/VXN history, FRED liquidity data, the US Treasury yield curve, USD FX rates, and the bundled influencer collection at `data/influencer-and-press-collection-agent/latest.md`.

## Partner Option Data

Production option data is persisted in Vercel Blob as private JSON files:

```text
options/latest.json
options/YYYY-MM-DD.json
```

`/api/snapshot` reads `options/latest.json` first and uses those option summaries ahead of the Nasdaq option-chain fallback.

Configure these environment variables in Vercel:

```text
BLOB_READ_WRITE_TOKEN=...       # created by the Vercel Blob store
OPTION_DATA_WRITE_TOKEN=...     # your shared write token for partners
```

Small JSON payloads can be written through the dashboard API:

```bash
curl -X POST "https://bull-stock.xyz/api/options/daily" \
  -H "Authorization: Bearer $OPTION_DATA_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @examples/options-2026-05-03.json
```

Accepted payload shape:

```json
{
  "date": "2026-05-03",
  "asOf": "2026-05-03T20:00:00.000Z",
  "source": "partner option feed",
  "options": {
    "AAPL": {
      "maxPain": 205,
      "iv": 28.4,
      "callOpenInterest": 123456,
      "putOpenInterest": 98765,
      "putCallOiRatio": 0.8,
      "expiration": "2026-05-15"
    }
  }
}
```

For files near 10 MB, avoid sending the file body through the serverless API. Ask the API for short-lived direct-upload tokens, then upload the same JSON to both returned paths:

```bash
curl -X POST "https://bull-stock.xyz/api/options/upload-token" \
  -H "Authorization: Bearer $OPTION_DATA_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-03"}'
```

The response includes `uploads[]` entries for the dated blob and `options/latest.json`. Each entry contains a `clientToken`, `pathname`, `access`, and `contentType` for Vercel Blob direct upload.

This repository also includes a direct-upload helper:

```bash
DASHBOARD_URL=https://bull-stock.xyz \
OPTION_DATA_WRITE_TOKEN=... \
node scripts/upload-options-to-blob.mjs examples/options-2026-05-03.json 2026-05-03
```

For the static fallback snapshot:

```bash
python3 collect_market_data.py
python3 -m http.server 3461
```

## Deploy

```bash
cd /Users/bytedance/ohc/projects/stock-market-agent
npx vercel@latest
```

IBKR/TWS, twitter-cli, futubull, and option-opinion are optional local data inputs for the Python fallback. The Vercel runtime uses public web data sources and bundled influencer markdown, so it does not depend on local desktop apps or absolute `/Users/...` paths.

## Influencer Collection

The previous `influencer-and-press-collection-agent` output is merged into this repository under:

```text
data/influencer-and-press-collection-agent/
```

The dashboard reads `latest.md` from that directory and renders it in the `Influencer AI Mock Analysis` section. For a hosted external feed, set `INFLUENCER_LATEST_MD_URL` in Vercel; otherwise the bundled markdown is used.
