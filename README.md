# Quotex Signal Lab — Render recovery build

## Render settings
- Environment: Python
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`
- Health check path: `/health`
- Root directory: leave blank if these files are in the repository root.

## Files required in GitHub
`app.py`, `requirements.txt`, `Procfile`, `render.yaml`, and `templates/index.html` (folder name must be exactly `templates`).

## Phone-only redeploy
1. Download and extract this ZIP using your phone's file manager.
2. In your GitHub repository, replace `app.py`, `requirements.txt`, `render.yaml`, and `README.md`; upload `Procfile`; ensure `templates/index.html` exists.
3. Commit the changes to the branch connected to Render.
4. In Render, open the web service and choose Manual Deploy → Deploy latest commit.
5. When deploy finishes, visit `/health`. It should return JSON containing `"status":"ok"`.
6. Visit `/` to open the dashboard.

## Honest limitations
This application analyzes historical OHLC candles from a user-uploaded CSV. It does not connect to Quotex, provide a verified live price feed, place trades, or guarantee win rates. Live feeds require a real authorized data provider and server-side credentials configured separately.
