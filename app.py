import os
import csv
import io
from datetime import datetime, timezone
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/health")
def health():
    return jsonify({"status": "ok", "app": "Quotex Signal Lab", "mode": "signals-only"})

@app.post("/api/analyze-csv")
def analyze_csv():
    """Analyze user-supplied OHLC CSV only. No fabricated candles or live-feed claims."""
    upload = request.files.get("file")
    if not upload or not upload.filename.lower().endswith(".csv"):
        return jsonify({"ok": False, "error": "Upload a CSV file with time, open, high, low, close columns."}), 400
    try:
        content = upload.stream.read().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            raise ValueError("CSV is empty or has no header row.")
        normalized = {name.strip().lower(): name for name in reader.fieldnames}
        required = ["open", "high", "low", "close"]
        if any(k not in normalized for k in required):
            raise ValueError("Required columns: open, high, low, close. Optional column: time.")
        candles = []
        for row in reader:
            try:
                o, h, l, c = [float(row[normalized[k]]) for k in required]
            except (ValueError, TypeError, KeyError):
                continue
            if not all(map(lambda x: x == x and abs(x) != float("inf"), [o,h,l,c])):
                continue
            if min(o,h,l,c) <= 0 or h < max(o,c,l) or l > min(o,c,h):
                continue
            candles.append({"time": (row.get(normalized.get("time", ""), "") if normalized.get("time") else ""), "open": o, "high": h, "low": l, "close": c})
        if len(candles) < 22:
            raise ValueError("At least 22 valid candles are required for analysis.")
        closes = [x["close"] for x in candles]
        def ema(values, period):
            alpha = 2 / (period + 1)
            out = [values[0]]
            for value in values[1:]:
                out.append(alpha * value + (1 - alpha) * out[-1])
            return out
        e9, e21 = ema(closes, 9), ema(closes, 21)
        last = candles[-1]
        direction = "WAIT"
        note = "Mixed conditions: wait for a clearer setup."
        # Conservative rule-based educational signal; never described as guaranteed.
        if e9[-1] > e21[-1] and closes[-1] > e9[-1] and closes[-1] > closes[-2]:
            direction, note = "CALL", "EMA 9 above EMA 21; last close is above EMA 9 and rising."
        elif e9[-1] < e21[-1] and closes[-1] < e9[-1] and closes[-1] < closes[-2]:
            direction, note = "PUT", "EMA 9 below EMA 21; last close is below EMA 9 and falling."
        return jsonify({
            "ok": True, "signal": direction, "note": note,
            "last_close": last["close"], "candles": candles[-150:],
            "ema9": e9[-150:], "ema21": e21[-150:],
            "count": len(candles),
            "source": "User-uploaded CSV; historical data only",
            "as_of_utc": datetime.now(timezone.utc).isoformat()
        })
    except (UnicodeDecodeError, csv.Error, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

@app.errorhandler(500)
def internal_error(_error):
    return jsonify({"error": "Internal server error. Check Render application logs."}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
