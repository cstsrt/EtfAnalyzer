# neon ETF Analyzer

A local-first, Dockerized web app for comparing ETF / investment products offered through neon Switzerland.

It stores ETF metadata and performance history in SQLite, uses `justetf-scraping` for justETF data, and exports a clean JSON snapshot that can later be given to ChatGPT together with market/geopolitical context.

## What It Does

- Track neon investment products by ISIN.
- Preload and refresh neon's official published instrument universe.
- Refresh ETF overview/profile/chart data from justETF.
- Filter by fees, fund size, region, asset class, currency, replication, distribution policy, volatility, drawdown, and return figures.
- Compare selected ETFs in a zoomable normalized performance chart.
- Store everything in SQLite under `./data`.
- Export a structured analysis pack as JSON.

## Quick Start

```bash
docker compose up --build
```

Then open:

```text
http://localhost:3002
```

On your Mac mini over Tailscale, use:

```text
http://<mac-mini-tailscale-name-or-ip>:3002
```

## Typical Workflow

1. Start the app. On an empty database, it preloads neon's official instrument list automatically.
2. Click `Refresh neon list` whenever you want to reload neon's latest published list.
3. Click `Refresh justETF overview`.
4. Select ETFs and click `Refresh selected profiles` or `Refresh selected charts`.
5. Filter and compare products.
6. Export the JSON analysis pack when you want ChatGPT to reason over the saved data.

## Notes About Scraping

The app wraps [`druzsan/justetf-scraping`](https://github.com/druzsan/justetf-scraping), which provides:

- `load_overview()` for ETF screener data.
- `load_chart(isin)` for historical chart data.
- `get_etf_overview(isin)` for ETF profile/allocation data.

The neon list importer uses neon's official public PDF:

```text
https://static-assets.neon-free.ch/trading/asset-list/neon_invest_stocks_etfs.pdf
```

It currently parses stocks, ETFs, and crypto/other ETPs, including ISIN, neon display name, full product name where available, accumulation/distribution status, and 0%-fee eligibility.

The older neon page scanner remains available as a fallback: it extracts ISIN-looking codes from configured public pages.

## Data Files

- SQLite database: `./data/etf_analyzer.sqlite3`
- Export endpoint: `GET /api/export/snapshot`

## Useful Commands

```bash
docker compose up --build
docker compose down
docker compose logs -f app
```

## AI-Style Export Pack

When I said “AI-style recommendation prompt/export pack,” I meant this:

- A machine-readable JSON file containing your chosen ETFs, current filters, key figures, historical performance points, and optional event notes.
- You can later upload/paste that export into ChatGPT and ask questions like: “Given these ETFs and recent geopolitical/business events, which ones look over-concentrated, expensive, or strategically redundant?”

The app does not make investment decisions for you; it prepares clean data so analysis is easier.
