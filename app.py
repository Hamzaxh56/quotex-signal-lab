"""Read-only Quotex OTC market analyzer. Uses an unofficial third-party feed."""
from __future__ import annotations

import hmac
import json
import os
import re
import time
from typing import Any

import requests
from flask import Flask, Response, jsonify, render_template, request, session

app = Flask(__name__)
API_BASE = os.getenv("OTCHARTS_API_BASE", "https://otcharts.com").rstrip("/")
API_KEY = os.getenv("OTCHARTS_API_KEY", "").strip()
APP_ACCESS_CODE = os.getenv("APP_ACCESS_CODE", "").strip()
app.secret_key = os.getenv("FLASK_SECRET_KEY") or os.urandom(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true")
TIMEFRAMES = {5, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 14400, 86400}
# OTCharts currently documents these five instruments on the free Quotex tier.
FREE_QUOTEX_SYMBOLS = {"EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "BTCUSD_otc", "AUDUSD_otc"}
_SYMBOL_STATUS_CACHE: dict[str, Any] = {"fetchedAt": 0, "items": {}}
SYMBOL_RE = re.compile(r"^[A-Za-z0-9_#./-]{2,60}$")


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}



def fetch_symbol_status(symbol: str) -> bool | None:
    """Check provider-reported tradability; cache the full catalogue briefly.

    Some candle responses only include `open:false` when closed. The symbol
    catalogue is the source of an explicit `open:true` status, so do not treat
    a missing candle field as proof the market is tradable.
    """
    now = time.time()
    cached_items = _SYMBOL_STATUS_CACHE.get("items", {})
    if now - float(_SYMBOL_STATUS_CACHE.get("fetchedAt", 0)) > 45 or not cached_items:
        try:
            r = requests.get(
                f"{API_BASE}/v1/symbols",
                params={"venue": "quotex"},
                headers=auth_headers(),
                timeout=10,
            )
            if not r.ok:
                return None
            body = r.json()
            symbols = body.get("symbols", []) if isinstance(body, dict) else []
            refreshed: dict[str, Any] = {}
            for entry in symbols if isinstance(symbols, list) else []:
                if isinstance(entry, dict) and isinstance(entry.get("symbol"), str):
                    refreshed[entry["symbol"]] = entry.get("open")
            _SYMBOL_STATUS_CACHE["items"] = refreshed
            _SYMBOL_STATUS_CACHE["fetchedAt"] = now
            cached_items = refreshed
        except (requests.RequestException, ValueError):
            return None
    value = cached_items.get(symbol)
    return value if isinstance(value, bool) else None


def provider_error(response: requests.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            return str(body.get("error") or body.get("message") or body.get("detail") or f"Provider returned HTTP {response.status_code}")[:400]
    except (ValueError, requests.RequestException):
        pass
    return f"Provider returned HTTP {response.status_code}. Check your key, plan, symbol, and timeframe."


@app.get("/")
def index():
    return render_template("index.html")


def has_access() -> bool:
    return not APP_ACCESS_CODE or bool(session.get("unlocked"))


@app.post("/api/login")
def login():
    if not APP_ACCESS_CODE:
        return jsonify({"ok": True, "unlocked": True, "message": "No app access code is configured."})
    body = request.get_json(silent=True) or {}
    submitted = str(body.get("code", ""))
    if not hmac.compare_digest(submitted, APP_ACCESS_CODE):
        return jsonify({"error": "Access code is incorrect."}), 401
    session["unlocked"] = True
    return jsonify({"ok": True, "unlocked": True})


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "keyConfigured": bool(API_KEY),
        "accessRequired": bool(APP_ACCESS_CODE),
        "authenticated": has_access(),
        "source": "OTCharts third-party Quotex feed",
    })


@app.get("/api/candles")
def candles():
    if not has_access():
        return jsonify({"error": "This dashboard is access-code protected. Unlock it first."}), 401
    if not API_KEY:
        return jsonify({"error": "No data key is configured on the server. Set OTCHARTS_API_KEY in your host's environment variables, then restart/redeploy."}), 503

    symbol = request.args.get("symbol", "EURUSD_otc").strip()
    try:
        tf = int(request.args.get("tf", "60"))
        limit = int(request.args.get("limit", "240"))
    except ValueError:
        return jsonify({"error": "tf and limit must be integers."}), 400
    if not SYMBOL_RE.fullmatch(symbol):
        return jsonify({"error": "Invalid symbol format."}), 400
    if symbol not in FREE_QUOTEX_SYMBOLS:
        return jsonify({"error": "This dashboard is restricted to the five documented free-tier Quotex instruments: EURUSD_otc, GBPUSD_otc, USDJPY_otc, BTCUSD_otc, and AUDUSD_otc."}), 403
    if tf not in TIMEFRAMES:
        return jsonify({"error": f"Unsupported timeframe. Allowed seconds: {sorted(TIMEFRAMES)}"}), 400
    limit = max(80, min(limit, 500))

    try:
        r = requests.get(
            f"{API_BASE}/v1/candles",
            params={"venue": "quotex", "symbol": symbol, "tf": tf, "limit": limit},
            headers=auth_headers(),
            timeout=15,
        )
        if not r.ok:
            return jsonify({"error": provider_error(r), "providerStatus": r.status_code}), 502
        payload = r.json()
    except requests.Timeout:
        return jsonify({"error": "The market-data server timed out. Try again; no signal was generated."}), 504
    except requests.RequestException as exc:
        return jsonify({"error": f"Could not reach the market-data server: {str(exc)[:180]}"}), 502
    except ValueError:
        return jsonify({"error": "The market-data server returned invalid JSON."}), 502

    rows = payload.get("candles") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return jsonify({"error": "The provider response did not contain a candles array."}), 502

    cleaned: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            item = {
                "time": int(float(row["time"])),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume") or 0),
            }
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        vals = [item[k] for k in ("open", "high", "low", "close")]
        if not all(v > 0 and v < float("inf") for v in vals):
            continue
        if item["high"] < max(item["open"], item["close"], item["low"]):
            continue
        if item["low"] > min(item["open"], item["close"], item["high"]):
            continue
        if item["low"] > item["high"] or item["time"] > time.time() + 5:
            continue
        cleaned.append(item)

    cleaned.sort(key=lambda x: x["time"])
    # Do not silently accept duplicate timestamps: keep the last valid record for that time.
    dedup: dict[int, dict[str, Any]] = {c["time"]: c for c in cleaned}
    cleaned = [dedup[t] for t in sorted(dedup)]
    if not cleaned:
        return jsonify({"error": "No valid candle bars were returned. Confirm the symbol is available to your plan."}), 502

    gaps = payload.get("gaps") if isinstance(payload, dict) and isinstance(payload.get("gaps"), dict) else {}
    market_open = payload.get("open") if isinstance(payload, dict) else None
    if not isinstance(market_open, bool):
        market_open = fetch_symbol_status(symbol)
    return jsonify({
        "source": "OTCharts third-party feed · Quotex book",
        "symbol": payload.get("symbol", symbol),
        "timeframeSeconds": tf,
        "fetchedAt": int(time.time()),
        "open": market_open,
        "candles": cleaned,
        "count": len(cleaned),
        "gaps": {"runs": gaps.get("runs", None), "missingBars": gaps.get("missingBars", None)},
        "planScope": "free-tier five-instrument scope",
        "note": "This is an unofficial read-only market-data feed, not an official Quotex API. Free-tier quotas and features may change; check provider usage before repeated requests."
    })


@app.get("/api/usage")
def usage():
    if not has_access():
        return jsonify({"error": "This dashboard is access-code protected. Unlock it first."}), 401
    if not API_KEY:
        return jsonify({"error": "No API key is configured on the server."}), 503
    try:
        r = requests.get(f"{API_BASE}/v1/usage", headers=auth_headers(), timeout=10)
        if not r.ok:
            return jsonify({"error": provider_error(r), "providerStatus": r.status_code}), 502
        data = r.json()
        # Return useful quota summary only; never return credentials.
        reqs = data.get("requests") or {}
        streams = data.get("streams") or {}
        return jsonify({
            "planName": data.get("planName", data.get("plan", "Unknown")),
            "books": data.get("books", []),
            "requests": {k: reqs.get(k) for k in ("used", "quota", "remaining", "resets")},
            "streams": {k: streams.get(k) for k in ("open", "limit", "instrumentsPerStream")},
        })
    except requests.RequestException as exc:
        return jsonify({"error": f"Could not check quota: {str(exc)[:180]}"}), 502
    except ValueError:
        return jsonify({"error": "The usage endpoint returned invalid JSON."}), 502


@app.get("/api/stream")
def stream():
    """Proxy the provider's SSE tick stream without exposing the key in the browser."""
    if not has_access():
        return Response(
            f"event: error\ndata: {json.dumps({'error': 'This dashboard is access-code protected. Unlock it first.'})}\n\n",
            mimetype="text/event-stream",
        )
    symbol = request.args.get("symbol", "EURUSD_otc").strip()
    if not API_KEY:
        return Response(
            f"event: error\ndata: {json.dumps({'error': 'No data key is configured on the server.'})}\n\n",
            mimetype="text/event-stream",
        )
    if not SYMBOL_RE.fullmatch(symbol) or symbol not in FREE_QUOTEX_SYMBOLS:
        return Response(
            f"event: error\ndata: {json.dumps({'error': 'Only the five documented free-tier instruments are enabled.'})}\n\n",
            mimetype="text/event-stream",
        )
    return Response(
        f"event: error\ndata: {json.dumps({'error': 'Live streaming is not available on the documented free tier. Use manual candle fetches only.'})}\n\n",
        mimetype="text/event-stream", status=403,
    )

    # Paid-tier streaming implementation retained below but unreachable on this free-tier build.

    def generate():
        upstream = None
        try:
            upstream = requests.get(
                f"{API_BASE}/v1/stream",
                params={"venue": "quotex", "symbol": symbol},
                headers={"Authorization": f"Bearer {API_KEY}", "Accept": "text/event-stream"},
                stream=True,
                timeout=(10, None),
            )
            if not upstream.ok:
                yield f"event: error\ndata: {json.dumps({'error': provider_error(upstream)})}\n\n"
                return
            for line in upstream.iter_lines(decode_unicode=True):
                if line is None:
                    continue
                if isinstance(line, bytes):
                    line = line.decode("utf-8", errors="replace")
                yield line + "\n"
        except requests.RequestException as exc:
            yield f"event: error\ndata: {json.dumps({'error': f'Live stream disconnected: {str(exc)[:150]}'})}\n\n"
        finally:
            if upstream is not None:
                upstream.close()

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
