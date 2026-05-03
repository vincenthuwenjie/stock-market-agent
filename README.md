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

Production option data is persisted in Postgres, intended for Neon on Vercel:

```sql
CREATE TABLE IF NOT EXISTS option_daily (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  trade_date DATE NOT NULL,
  as_of TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'partner option sql',
  max_pain DOUBLE PRECISION,
  iv DOUBLE PRECISION,
  call_open_interest BIGINT,
  put_open_interest BIGINT,
  put_call_oi_ratio DOUBLE PRECISION,
  expiration TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, trade_date)
);
```

`/api/snapshot` reads the latest `trade_date` from `option_daily` first and uses those option summaries ahead of the Nasdaq option-chain fallback. The table is created automatically by the API on first read/write.

Configure these environment variables in Vercel:

```text
DATABASE_URL=...             # Neon/Postgres connection string
OPTION_DATA_WRITE_TOKEN=...  # your shared write token for partners
```

Partners write option data through the dashboard API:

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

For 300 stocks and 10 option metrics, send one request for the full day or several smaller requests for the same `date`. The database stores one row per `symbol + trade_date`, so 300 stocks is 300 rows per day. Rows are upserted by `(symbol, trade_date)`, so repeated writes replace that symbol's data for that date. The normalized summary fields are stored in SQL columns, while the original per-symbol object is retained in `payload JSONB`.

Historical option data for charts can be read with:

```bash
curl "https://bull-stock.xyz/api/options/history?symbols=AAPL,NVDA&days=30&metrics=iv,maxPain,putCallOiRatio"
```

The `metrics` parameter can use standard columns such as `iv`, `maxPain`, `callOpenInterest`, `putOpenInterest`, and `putCallOiRatio`, or any extra key stored in the per-symbol payload JSON.

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
