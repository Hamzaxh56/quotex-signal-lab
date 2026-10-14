# Quotex Signal Lab — read-only analyzer

A responsive, mobile-friendly web dashboard for **read-only Quotex OTC candle analysis**. It shows a candlestick chart, OHLC snapshot, EMA 9/21 trend, RSI 14, MACD histogram, close-to-close momentum, and a simple CALL / PUT / WAIT rules engine. It never places trades and never invents or substitutes market candles.

## Important data limitations

- Quotex does not publish an official developer API. This app uses the **unofficial OTCharts third-party market-data API** (`https://otcharts.com/api`). The app does not ask for a Quotex login, password, or SSID.
- You must supply your own OTCharts API key on the **server side**. The app intentionally never puts the key into JavaScript or into the repository.
- The provider API reference currently documents the free tier as 200 requests in the first month and no live streaming, while its GitHub README describes a different quota. This build conservatively follows the stricter API-reference limit: no live stream and no automatic candle polling. Check the live account usage endpoint and provider terms before use.
- The UI and server restrict requests to the five documented free-tier Quotex instruments: `EURUSD_otc`, `GBPUSD_otc`, `USDJPY_otc`, `BTCUSD_otc`, and `AUDUSD_otc`. A provider may change this list or its free-plan rules; verify the catalogue and account page before use.
- OTC quotes are the provider's recorded Quotex book. They are not the same as interbank forex prices or exchange prices.
- A CALL/PUT result is only a transparent indicator-confluence heuristic. “Alignment 4/5” is **not** a 80% chance of winning. Binary options are risky; this is not financial advice.

## Deploy online with Render and GitHub

1. Download and unzip this project.
2. Upload the contents to a new GitHub repository. **Do not upload your real API key or a `.env` file.**
3. Create your own key through the provider's official account flow at `https://otcharts.com/api` (review its pricing and terms first).
4. In Render, create a new **Web Service** from your GitHub repository. Render can detect the included `render.yaml`; use these commands if asked:
   - Build: `pip install -r requirements.txt`
   - Start: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`
5. In the service's environment settings, set `OTCHARTS_API_KEY` to your own provider key, `APP_ACCESS_CODE` to a long private code that only you know, and `FLASK_SECRET_KEY` to a long random secret. Set `SESSION_COOKIE_SECURE=true` because the hosted site uses HTTPS. The access code helps protect your limited provider quota from other people who discover your URL. Save and deploy. Never put any of these values in GitHub.
6. Open your Render URL. The header should show the server as reachable. Use **Fetch candles & analyse** to make a single candle-history request.
7. Use **Check API quota** before repeated requests. The dashboard deliberately does not poll candle history automatically.

Live streaming is deliberately disabled in this free-tier build. Candle requests are manual only; do not automate refreshes on the free quota.

## Run locally (Windows / macOS / Linux)

Requires Python 3.10 or newer.

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

Set the environment variables before starting the server. Do not put real keys or secrets in source code. For a private hosted deployment, configure all three `OTCHARTS_API_KEY`, `APP_ACCESS_CODE`, and `FLASK_SECRET_KEY` variables; for local testing, you can omit the access code.

**Windows PowerShell**

```powershell
$env:OTCHARTS_API_KEY="your_own_key_here"
python app.py
```

**macOS / Linux**

```bash
export OTCHARTS_API_KEY="your_own_key_here"
python app.py
```

Then visit `http://127.0.0.1:5000`. If you set `APP_ACCESS_CODE` locally, use `SESSION_COOKIE_SECURE=false` for the local HTTP address.

## Data-integrity rules

Signals are suppressed unless the API key returns valid OHLC candles for an allowed free-tier symbol, the provider marks the instrument open, enough completed candles exist, timestamps are fresh, the latest bar is not from the future, and the recent candle sequence has no time gap. The latest candle is excluded when it appears to still be forming. If the feed errors or a check fails, the dashboard shows WAIT and does not fabricate replacement data.

## Technical overview

- `app.py`: Flask web server and server-side API proxy. API credentials are never returned to the browser.
- `templates/index.html`: dashboard layout.
- `static/style.css`: responsive visual design.
- `static/app.js`: chart drawing, indicators, safety checks, and rule-based signal score.
- `/api/health`: checks that the web server is up and whether an API key is configured.
- `/api/candles`: fetches provider candles.
- `/api/usage`: reads provider quota/usage data.
- `/api/stream`: proxies provider server-sent events when the plan allows live ticks.

## License

This project code is provided under the MIT License. Third-party provider data and API usage remain subject to that provider's terms.
