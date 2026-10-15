# Quotex Signal Lab — fixed Flask deployment

## What was fixed
- Flask's `render_template("index.html")` expects the page at `templates/index.html`; this project includes that exact structure.
- Render start command has `--timeout 120` (no trailing period).
- `/health` endpoint is provided for Render health checks.

## Safety and data policy
- Signals only; no automatic trading and no Quotex account login.
- No fabricated/demo candles are generated.
- The app starts in WAIT state until user-uploaded OHLC candles are provided.
- CSV analysis is historical only. It does not claim live Quotex OTC prices.
- OTC data requires a verified source that actually provides those instruments.

## Deploy on Render
1. Upload/extract this ZIP or replace the files in your GitHub repository.
2. Ensure the root contains `app.py`, `requirements.txt`, `render.yaml`, and a `templates` folder containing `index.html`.
3. In Render, use the root directory of this project, build command `pip install -r requirements.txt`, and start command:
   `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`
4. Deploy latest commit. Visit `/health`; it should return JSON with `"status":"ok"`.
5. Open `/` to see the app.

## CSV format
Header example:
`time,open,high,low,close`
Use at least 22 rows of real OHLC candles. The time column is optional. This is not a guarantee of trading performance.
