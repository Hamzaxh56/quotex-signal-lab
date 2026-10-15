import csv
import io
import math
import os
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template, request

app = Flask(__name__, template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

@app.get('/')
def home():
    return render_template('index.html')

@app.get('/health')
def health():
    return jsonify(status='ok', app='Quotex Signal Lab', mode='historical-csv-analysis')

@app.get('/api/status')
def api_status():
    return jsonify(ok=True, live_market_feed=False, message='No verified live feed is configured. Upload historical OHLC CSV to analyze candles.')

def ema(values, period):
    alpha = 2.0 / (period + 1.0)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1.0 - alpha) * result[-1])
    return result

@app.post('/api/analyze-csv')
def analyze_csv():
    upload = request.files.get('file')
    if not upload or not upload.filename or not upload.filename.lower().endswith('.csv'):
        return jsonify(ok=False, error='Choose a .csv file with open, high, low, close columns.'), 400
    try:
        content = upload.stream.read().decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            raise ValueError('CSV is empty or missing its header row.')
        columns = {str(name).strip().lower(): name for name in reader.fieldnames if name}
        required = ('open', 'high', 'low', 'close')
        missing = [name for name in required if name not in columns]
        if missing:
            raise ValueError('Missing required column(s): ' + ', '.join(missing) + '. Required: open, high, low, close. Optional: time.')
        candles = []
        skipped = 0
        for row in reader:
            try:
                o, h, l, c = (float(row[columns[k]]) for k in required)
                if not all(math.isfinite(v) for v in (o, h, l, c)) or min(o, h, l, c) <= 0:
                    raise ValueError()
                if h < max(o, c, l) or l > min(o, c, h):
                    raise ValueError()
            except (ValueError, TypeError, KeyError):
                skipped += 1
                continue
            time_col = columns.get('time')
            candles.append({'time': (row.get(time_col, '') if time_col else ''), 'open': o, 'high': h, 'low': l, 'close': c})
        if len(candles) < 22:
            raise ValueError(f'Only {len(candles)} valid candles found. At least 22 are required; check the CSV format.')
        closes = [c['close'] for c in candles]
        e9, e21 = ema(closes, 9), ema(closes, 21)
        signal, note = 'WAIT', 'Mixed conditions. Wait for a clearer setup.'
        if e9[-1] > e21[-1] and closes[-1] > e9[-1] and closes[-1] > closes[-2]:
            signal, note = 'CALL', 'Historical trend conditions are bullish (EMA 9 above EMA 21 and last close rising).'
        elif e9[-1] < e21[-1] and closes[-1] < e9[-1] and closes[-1] < closes[-2]:
            signal, note = 'PUT', 'Historical trend conditions are bearish (EMA 9 below EMA 21 and last close falling).'
        return jsonify(ok=True, signal=signal, note=note, last_close=candles[-1]['close'], candles=candles[-150:], ema9=e9[-150:], ema21=e21[-150:], count=len(candles), skipped_rows=skipped, source='User-uploaded historical CSV; not a live feed', as_of_utc=datetime.now(timezone.utc).isoformat())
    except UnicodeDecodeError:
        return jsonify(ok=False, error='Could not read the file as text. Export the CSV as UTF-8 and try again.'), 400
    except csv.Error as exc:
        return jsonify(ok=False, error=f'CSV format error: {exc}'), 400
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400

@app.errorhandler(413)
def too_large(_error):
    return jsonify(ok=False, error='File is too large. Maximum upload size is 2 MB.'), 413

@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith('/api/') or request.path == '/health':
        return jsonify(ok=False, error='Endpoint not found.'), 404
    return 'Page not found', 404

@app.errorhandler(500)
def internal_error(error):
    app.logger.error('Unhandled server error: %s', error, exc_info=True)
    return jsonify(ok=False, error='Internal server error. Open Render Logs and share the latest traceback to identify the cause.'), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '10000')))
