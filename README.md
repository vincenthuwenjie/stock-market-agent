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
