(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { bars: [], data: null, stream: null, tick: null, activeSymbol: 'EURUSD_otc', fetchedTf: null };
  const fmtTime = (seconds) => new Date(seconds * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const tfLabel = (seconds) => {
    const s = Number(seconds);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${s / 60}m`;
    if (s < 86400) return `${s / 3600}h`;
    return `${s / 86400}d`;
  };
  const numberText = (n, digits) => Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const priceDigits = (symbol) => /BTC|ETH|XAU|XAG|#/.test(symbol) ? 2 : /JPY/.test(symbol) ? 3 : 5;
  const nfmt = (n) => Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : Number(n).toPrecision(5)) : '—';

  function showMessage(text, kind = '') {
    const box = $('messageBox');
    box.textContent = text;
    box.className = `message ${kind}`.trim();
    box.hidden = !text;
  }

  function setConnection(connected, label) {
    $('connectionDot').classList.toggle('live', Boolean(connected));
    $('connectionLabel').textContent = label || (connected ? 'FEED READY' : 'NOT CONNECTED');
    $('statusTitle').textContent = connected ? 'Market feed responded' : 'Awaiting market data';
    $('statusSub').textContent = connected ? 'Data fetched; checks determine signal eligibility' : 'Configure the server key to begin';
    $('heroStatusPulse')?.classList.toggle('live', Boolean(connected));
  }

  function getSymbol() {
    return $('customSymbol').value.trim() || $('pairSelect').value;
  }

  function resetSignal(reason = 'No verified setup available.') {
    $('signalBadge').className = 'signal-badge neutral';
    $('signalBadge').textContent = 'WAIT';
    $('decisionGlyph').className = 'decision-glyph';
    $('decisionGlyph').innerHTML = '<span>—</span>';
    $('decisionLabel').textContent = 'NO ACTION';
    $('decisionTitle').textContent = 'WAIT — no eligible signal';
    $('decisionReason').textContent = reason;
    $('alignmentValue').textContent = '— / 5';
    $('rsiValue').textContent = '—';
    $('macdValue').textContent = '—';
    $('expiryValue').textContent = '—';
    setRule('ruleTrend', 'WAIT', 'neutral');
    setRule('ruleRsi', 'WAIT', 'neutral');
    setRule('ruleMacd', 'WAIT', 'neutral');
    setRule('ruleMomentum', 'WAIT', 'neutral');
    setRule('ruleCandle', 'WAIT', 'neutral');
    $('indicatorCount').textContent = '0 / 5';
  }

  function setRule(id, text, mode) {
    const el = $(id);
    el.textContent = text;
    el.className = `rule-state ${mode || 'neutral'}`;
  }

  function dot(id, mode) {
    const el = $(id);
    el.className = `safety-dot ${mode || ''}`.trim();
  }

  function clearMarket() {
    $('marketBadge').className = 'tiny-chip muted';
    $('marketBadge').textContent = 'NO FEED';
    $('lastPrice').textContent = '—';
    $('priceChange').className = 'price-change';
    $('priceChange').textContent = 'Waiting for data';
    ['openValue','highValue','lowValue','volumeValue','barTime','dataAge'].forEach(id => $(id).textContent = '—');
    $('liveTick').textContent = state.tick ? `${numberText(state.tick.price, priceDigits(state.activeSymbol))} · ${fmtTime(state.tick.time)}` : 'Not connected';
    drawChart([]);
  }

  async function checkHealth() {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const d = await r.json();
      if (d.accessRequired && !d.authenticated) {
        $('accessBox').hidden = false;
        $('loadBtn').disabled = true; $('usageBtn').disabled = true; $('streamBtn').disabled = true;
        showMessage('This deployment requires its private access code before it can make data requests.', 'error');
        $('safeFeedText').textContent = 'Private dashboard locked';
        dot('safeFeedDot', 'warn');
        return;
      }
      $('accessBox').hidden = true;
      $('loadBtn').disabled = false; $('usageBtn').disabled = false; $('streamBtn').disabled = true; $('stopStreamBtn').disabled = true;
      if (!d.keyConfigured) {
        showMessage('Server is running, but no provider key is configured. Add OTCHARTS_API_KEY to your host environment variables. Keep the key out of frontend code and GitHub.', 'error');
        $('safeFeedText').textContent = 'Server reachable; API key missing';
        dot('safeFeedDot', 'warn');
      } else {
        showMessage('Server is ready. Free-tier mode: manually fetch candles only; live streaming is disabled to avoid a guaranteed plan refusal. Check API quota before repeated requests.', '');
        $('safeFeedText').textContent = 'Key configured; feed not fetched yet';
        dot('safeFeedDot', 'good');
      }
    } catch (_) {
      showMessage('Could not reach the app server. Reload the page or check the deployment logs.', 'error');
      $('safeFeedText').textContent = 'App server not reachable';
      dot('safeFeedDot', 'bad');
    }
  }

  async function fetchCandles() {
    const symbol = getSymbol();
    const tf = Number($('timeframe').value);
    if (!symbol) { showMessage('Enter a symbol before fetching candles.', 'error'); return; }
    $('loadBtn').disabled = true;
    $('loadBtn').innerHTML = '<span class="btn-icon">…</span> Fetching candles';
    $('sourceText').textContent = 'Source: requesting provider candles…';
    showMessage('Requesting a single candle history page. No auto-polling is used, to avoid burning your API quota.', '');
    try {
      const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=240`;
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `Request failed (${r.status})`);
      if (!Array.isArray(d.candles) || !d.candles.length) throw new Error('Provider returned no usable candles. No signal was generated.');
      state.data = d;
      state.fetchedTf = tf;
      state.activeSymbol = d.symbol || symbol;
      state.bars = d.candles;
      state.tick = null;
      $('sourceText').textContent = `Source: ${d.source || 'third-party Quotex feed'}`;
      $('updatedText').textContent = `Fetched: ${new Date(d.fetchedAt * 1000).toLocaleTimeString()}`;
      $('marketBadge').textContent = d.open === true ? 'OPEN' : d.open === false ? 'CLOSED' : 'UNCONFIRMED';
      $('marketBadge').className = `tiny-chip ${d.open === true ? 'open' : 'muted'}`;
      $('chartTitle').innerHTML = `${escapeHtml(state.activeSymbol)} <small>· ${tfLabel(tf)} candle feed</small>`;
      setConnection(true, 'CANDLES RECEIVED');
      renderSnapshot(d.candles, tf, state.activeSymbol);
      analyze(d, tf);
      showMessage(`Received ${d.candles.length} provider bars for ${state.activeSymbol}. Signals are suppressed when checks fail; this is not a win-rate prediction.`, 'success');
    } catch (err) {
      state.data = null;
      state.bars = [];
      resetSignal('No signal: market data could not be verified.');
      clearMarket();
      setConnection(false, 'FEED ERROR');
      $('sourceText').textContent = 'Source: unavailable';
      $('safeFeedText').textContent = 'Candle request failed';
      dot('safeFeedDot', 'bad');
      $('safeFreshText').textContent = 'No timestamp to verify';
      dot('safeFreshDot', 'bad');
      $('safeGapText').textContent = 'No bars to check';
      dot('safeGapDot', 'warn');
      $('safeOpenText').textContent = 'Tradability not confirmed';
      dot('safeOpenDot', 'warn');
      showMessage(`${err.message} No simulated data was substituted, and no signal was generated.`, 'error');
    } finally {
      $('loadBtn').disabled = false;
      $('loadBtn').innerHTML = '<span class="btn-icon">↻</span> Fetch candles & analyse';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderSnapshot(allBars, tf, symbol) {
    const now = Date.now() / 1000;
    const closed = allBars.filter(c => Number(c.time) + tf <= now + 1);
    const last = closed[closed.length - 1];
    const prev = closed[closed.length - 2];
    if (!last) {
      clearMarket();
      $('barTime').textContent = 'No closed bar yet';
      return;
    }
    const digits = priceDigits(symbol);
    $('lastPrice').textContent = numberText(last.close, digits);
    $('openValue').textContent = numberText(last.open, digits);
    $('highValue').textContent = numberText(last.high, digits);
    $('lowValue').textContent = numberText(last.low, digits);
    $('volumeValue').textContent = Number.isFinite(last.volume) && last.volume ? nfmt(last.volume) : '—';
    $('barTime').textContent = fmtTime(last.time);
    const age = Math.max(0, now - (last.time + tf));
    $('dataAge').textContent = age < 60 ? `${Math.round(age)}s` : age < 3600 ? `${Math.floor(age / 60)}m ${Math.round(age % 60)}s` : `${(age / 3600).toFixed(1)}h`;
    if (prev) {
      const pct = ((last.close - prev.close) / prev.close) * 100;
      $('priceChange').className = `price-change ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}`;
      $('priceChange').textContent = `${pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} ${pct > 0 ? '+' : ''}${pct.toFixed(3)}% vs prior close`;
    } else {
      $('priceChange').className = 'price-change';
      $('priceChange').textContent = 'Not enough bars to compare';
    }
    $('chartRange').textContent = `${closed.length} closed bars · ${closed.length ? fmtTime(closed[0].time) : '—'} → ${fmtTime(last.time)}`;
    $('chartEmpty').hidden = closed.length > 0;
    drawChart(closed.slice(-100));
    $('liveTick').textContent = state.tick ? `${numberText(state.tick.price, digits)} · ${fmtTime(state.tick.time)}` : 'Not connected';
  }

  const mean = (xs) => xs.length ? xs.reduce((a,b) => a+b,0) / xs.length : NaN;
  function emaSeries(values, period) {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    let current = mean(values.slice(0, period));
    const result = Array(period - 1).fill(NaN);
    result.push(current);
    for (let i = period; i < values.length; i++) {
      current = values[i] * k + current * (1-k);
      result.push(current);
    }
    return result;
  }
  function rsiValue(closes, period = 14) {
    if (closes.length < period + 1) return NaN;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return gains === 0 ? 50 : 100;
    return 100 - (100 / (1 + (gains / period) / (losses / period)));
  }
  function atrValue(bars, period=14) {
    if (bars.length < period + 1) return NaN;
    const trs = [];
    for (let i = bars.length-period; i < bars.length; i++) {
      const p = bars[i-1].close;
      trs.push(Math.max(bars[i].high-bars[i].low, Math.abs(bars[i].high-p), Math.abs(bars[i].low-p)));
    }
    return mean(trs);
  }

  function analyze(data, tf) {
    const now = Date.now() / 1000;
    const raw = data.candles || [];
    const completed = raw.filter(c => Number(c.time) + tf <= now + 1);
    const last = completed[completed.length - 1];
    const minBars = 35;
    const maxAge = Math.max(tf * 2.5, 10);
    const age = last ? Math.max(0, now - (last.time + tf)) : Infinity;
    const recent = completed.slice(-31);
    let recentGap = false;
    for (let i=1; i<recent.length; i++) {
      if ((recent[i].time - recent[i-1].time) > tf * 1.5) recentGap = true;
    }
    $('safeFeedText').textContent = `${data.candles.length} bars received from third-party feed`;
    dot('safeFeedDot', 'good');
    $('safeFreshText').textContent = last ? `${age.toFixed(0)}s since last bar closed; limit ${maxAge.toFixed(0)}s` : 'No completed candle received';
    dot('safeFreshDot', last && age <= maxAge ? 'good' : 'bad');
    $('safeGapText').textContent = completed.length < 2 ? 'Not enough bars to inspect continuity' : recentGap ? 'Gap detected in recent 30 bars' : `No timestamp gap in last ${Math.max(0,recent.length-1)} intervals`;
    dot('safeGapDot', recentGap ? 'bad' : completed.length >= 2 ? 'good' : 'warn');
    const marketOpen = data.open === true;
    $('safeOpenText').textContent = data.open === true ? 'Provider reports this pair open' : data.open === false ? 'Provider reports this pair closed' : 'Provider did not confirm tradability';
    dot('safeOpenDot', data.open === true ? 'good' : data.open === false ? 'bad' : 'warn');
    $('indicatorCount').textContent = `${completed.length} bars`;

    if (data.open === false) {
      resetSignal('WAIT: the provider reports this instrument closed for trading.');
      $('alignmentValue').textContent = '0 / 5';
      return;
    }
    if (data.open !== true) {
      resetSignal('WAIT: the provider did not confirm that this instrument is currently tradable.');
      $('alignmentValue').textContent = '0 / 5';
      return;
    }
    if (!last || completed.length < minBars) {
      resetSignal(`WAIT: need at least ${minBars} completed candles; received ${completed.length}.`);
      $('alignmentValue').textContent = '0 / 5';
      return;
    }
    if (age > maxAge) {
      resetSignal(`WAIT: candle data is stale (${Math.round(age)} seconds since the last completed bar).`);
      $('alignmentValue').textContent = '0 / 5';
      return;
    }
    if (recentGap) {
      resetSignal('WAIT: a timestamp gap exists in the recent candle sequence. Fetch again after the feed stabilizes.');
      $('alignmentValue').textContent = '0 / 5';
      return;
    }

    const closes = completed.map(c => c.close);
    const ema9Series = emaSeries(closes, 9);
    const ema21Series = emaSeries(closes, 21);
    const ema9 = ema9Series[ema9Series.length-1];
    const ema21 = ema21Series[ema21Series.length-1];
    const rsi = rsiValue(closes, 14);
    const macdLine = emaSeries(closes,12).map((v,i) => v - emaSeries(closes,26)[i]);
    const validMacd = macdLine.filter(Number.isFinite);
    const macdSignalSeries = emaSeries(validMacd,9);
    const macdHist = validMacd.length && macdSignalSeries.length ? validMacd[validMacd.length-1] - macdSignalSeries[macdSignalSeries.length-1] : NaN;
    const atr = atrValue(completed,14);
    const prior = completed[completed.length-2];
    const body = Math.abs(last.close-last.open);
    const notSpike = Number.isFinite(atr) && atr > 0 && body <= atr * 1.8;
    const trendUp = ema9 > ema21 && last.close > ema9;
    const trendDown = ema9 < ema21 && last.close < ema9;
    const rsiUp = rsi >= 52 && rsi <= 68;
    const rsiDown = rsi >= 32 && rsi <= 48;
    const macdUp = macdHist > 0;
    const macdDown = macdHist < 0;
    const momUp = last.close > prior.close;
    const momDown = last.close < prior.close;
    const candleUp = last.close > last.open && notSpike;
    const candleDown = last.close < last.open && notSpike;
    const bullChecks = [trendUp, rsiUp, macdUp, momUp, candleUp];
    const bearChecks = [trendDown, rsiDown, macdDown, momDown, candleDown];
    const bullScore = bullChecks.filter(Boolean).length;
    const bearScore = bearChecks.filter(Boolean).length;
    const score = Math.max(bullScore, bearScore);
    const extremeRsi = rsi >= 70 || rsi <= 30;

    setRule('ruleTrend', trendUp ? 'CALL BIAS' : trendDown ? 'PUT BIAS' : 'MIXED', trendUp ? 'bull' : trendDown ? 'bear' : 'neutral');
    setRule('ruleRsi', rsiUp ? 'BULLISH' : rsiDown ? 'BEARISH' : 'NEUTRAL', rsiUp ? 'bull' : rsiDown ? 'bear' : 'neutral');
    setRule('ruleMacd', macdUp ? 'BULLISH' : macdDown ? 'BEARISH' : 'NEUTRAL', macdUp ? 'bull' : macdDown ? 'bear' : 'neutral');
    setRule('ruleMomentum', momUp ? 'UP' : momDown ? 'DOWN' : 'FLAT', momUp ? 'bull' : momDown ? 'bear' : 'neutral');
    setRule('ruleCandle', candleUp ? 'UP BAR' : candleDown ? 'DOWN BAR' : 'MIXED / SPIKE', candleUp ? 'bull' : candleDown ? 'bear' : 'neutral');
    $('indicatorCount').textContent = `${score} / 5`;
    $('alignmentValue').textContent = `${score} / 5`;
    $('rsiValue').textContent = Number.isFinite(rsi) ? rsi.toFixed(1) : '—';
    $('macdValue').textContent = Number.isFinite(macdHist) ? nfmt(macdHist) : '—';
    const expirySeconds = tf * Number($('expiryBars').value);
    $('expiryValue').textContent = `${tfLabel(expirySeconds)} (${Number($('expiryBars').value)} bar${Number($('expiryBars').value) > 1 ? 's' : ''})`;

    let action = 'WAIT';
    if (!extremeRsi && bullScore >= 4 && bullScore > bearScore) action = 'CALL';
    else if (!extremeRsi && bearScore >= 4 && bearScore > bullScore) action = 'PUT';

    const badge = $('signalBadge');
    const glyph = $('decisionGlyph');
    if (action === 'CALL') {
      badge.className = 'signal-badge call'; badge.textContent = 'CALL';
      glyph.className = 'decision-glyph call'; glyph.innerHTML = '<span>↑</span>';
      $('decisionLabel').textContent = 'BULLISH CONFLUENCE';
      $('decisionTitle').textContent = `CALL setup · ${bullScore}/5 checks`;
      $('decisionReason').textContent = 'Bullish indicator alignment detected on the last closed candles. This is a rules-based setup, not a prediction guarantee.';
    } else if (action === 'PUT') {
      badge.className = 'signal-badge put'; badge.textContent = 'PUT';
      glyph.className = 'decision-glyph put'; glyph.innerHTML = '<span>↓</span>';
      $('decisionLabel').textContent = 'BEARISH CONFLUENCE';
      $('decisionTitle').textContent = `PUT setup · ${bearScore}/5 checks`;
      $('decisionReason').textContent = 'Bearish indicator alignment detected on the last closed candles. This is a rules-based setup, not a prediction guarantee.';
    } else {
      badge.className = 'signal-badge neutral'; badge.textContent = 'WAIT';
      glyph.className = 'decision-glyph'; glyph.innerHTML = '<span>—</span>';
      $('decisionLabel').textContent = 'NO ACTION';
      $('decisionTitle').textContent = 'WAIT — no eligible confluence';
      $('decisionReason').textContent = extremeRsi ? 'RSI is in an extreme zone, so this rule set blocks the setup.' : 'Fewer than four checks agree on one direction. No eligible setup was confirmed.';
      $('alignmentValue').textContent = `${score} / 5`;
      $('rsiValue').textContent = Number.isFinite(rsi) ? rsi.toFixed(1) : '—';
      $('macdValue').textContent = Number.isFinite(macdHist) ? nfmt(macdHist) : '—';
      $('expiryValue').textContent = `${tfLabel(expirySeconds)} (${Number($('expiryBars').value)} bar${Number($('expiryBars').value) > 1 ? 's' : ''})`;
    }
  }

  function drawChart(bars) {
    const canvas = $('candleChart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,rect.width,rect.height);
    ctx.fillStyle = '#0d1420'; ctx.fillRect(0,0,rect.width,rect.height);
    if (!bars || bars.length < 1) {
      $('chartEmpty').hidden = false;
      return;
    }
    $('chartEmpty').hidden = true;
    const pad = { left: 14, right: 68, top: 17, bottom: 27 };
    const w = rect.width - pad.left - pad.right;
    const h = rect.height - pad.top - pad.bottom;
    const hi = Math.max(...bars.map(x=>x.high));
    const lo = Math.min(...bars.map(x=>x.low));
    const spread = Math.max(hi-lo, Math.abs(hi)*0.000001, 1e-8);
    const max = hi + spread*0.07, min = lo - spread*0.07;
    const y = (v) => pad.top + (max-v)/(max-min)*h;
    const xStep = w/bars.length;
    const bodyW = Math.max(2, Math.min(8, xStep*0.62));
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.lineWidth = 1;
    for(let i=0;i<5;i++){
      const gy = pad.top + h*i/4;
      ctx.strokeStyle = '#223044'; ctx.beginPath(); ctx.moveTo(pad.left,gy); ctx.lineTo(pad.left+w,gy); ctx.stroke();
      const val = max-(max-min)*i/4;
      ctx.fillStyle = '#7b8ea7'; ctx.textAlign='left'; ctx.fillText(formatAxis(val,state.activeSymbol),pad.left+w+9,gy+3);
    }
    for(let i=0;i<bars.length;i++){
      const b=bars[i], cx=pad.left+xStep*(i+.5), up=b.close>=b.open;
      const top=Math.min(y(b.open),y(b.close)), bottom=Math.max(y(b.open),y(b.close));
      ctx.strokeStyle=up?'#50d7a1':'#ff7387'; ctx.fillStyle=up?'#50d7a1':'#ff7387';
      ctx.beginPath();ctx.moveTo(cx,y(b.high));ctx.lineTo(cx,y(b.low));ctx.stroke();
      ctx.fillRect(cx-bodyW/2,top,bodyW,Math.max(1.3,bottom-top));
    }
    const last = bars[bars.length-1];
    const ly = y(last.close);
    ctx.setLineDash([4,4]);ctx.strokeStyle='#83a9ff';ctx.beginPath();ctx.moveTo(pad.left,ly);ctx.lineTo(pad.left+w,ly);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#243954';ctx.fillRect(pad.left+w+4,ly-9,pad.right-8,18);
    ctx.fillStyle='#dce8fb';ctx.textAlign='left';ctx.fillText(formatAxis(last.close,state.activeSymbol),pad.left+w+8,ly+3);
    const tickIndices=[0,Math.floor((bars.length-1)/2),bars.length-1];
    ctx.fillStyle='#75869c';ctx.textAlign='left';ctx.fillText(shortTime(bars[tickIndices[0]].time),pad.left,pad.top+h+19);
    ctx.textAlign='center';ctx.fillText(shortTime(bars[tickIndices[1]].time),pad.left+xStep*(tickIndices[1]+.5),pad.top+h+19);
    ctx.textAlign='right';ctx.fillText(shortTime(bars[tickIndices[2]].time),pad.left+w,pad.top+h+19);
  }
  function formatAxis(val,symbol){
    if(/BTC|ETH|XAU|XAG|#/.test(symbol)) return val.toLocaleString(undefined,{maximumFractionDigits:2});
    return val.toFixed(/JPY/.test(symbol)?3:5);
  }
  function shortTime(seconds){return new Date(seconds*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}

  async function checkUsage() {
    $('usageBtn').disabled = true;
    const old = $('usageBtn').textContent;
    $('usageBtn').textContent = 'Checking…';
    try {
      const r = await fetch('/api/usage', {cache:'no-store'});
      const d = await r.json();
      if(!r.ok || d.error) throw new Error(d.error || 'Could not check quota.');
      if(d.requests && Number.isFinite(d.requests.remaining)) {
        $('quotaText').textContent = `Quota: ${d.requests.remaining} / ${d.requests.quota ?? '—'} requests left`;
      } else $('quotaText').textContent = `Quota: plan ${d.planName || 'unknown'}`;
      const detail = d.requests ? `Plan ${d.planName}: ${d.requests.remaining ?? '?'} of ${d.requests.quota ?? '?'} requests remaining.` : `Plan: ${d.planName || 'unknown'}.`;
      showMessage(`${detail} Live stream allowance: ${d.streams?.limit ?? 'not stated'}.`, 'success');
    } catch(err) {
      showMessage(`${err.message}`, 'error');
      $('quotaText').textContent = 'Quota: unavailable';
    } finally {
      $('usageBtn').disabled = false;
      $('usageBtn').textContent = old;
    }
  }

  function connectStream() {
    if (state.stream) state.stream.close();
    state.stream = null;
    state.tick = null;
    $('streamBtn').disabled = true;
    $('stopStreamBtn').disabled = true;
    $('liveTick').textContent = 'Unavailable on documented free tier';
    showMessage('Live streaming is disabled in this free-tier build. Fetch candles manually; no tick stream or auto-refresh is started.', 'error');
  }

  function stopStream(show = true) {
    if(state.stream) state.stream.close();
    state.stream = null;
    $('streamBtn').disabled = false;
    $('stopStreamBtn').disabled = true;
    if(!state.tick) $('liveTick').textContent = 'Not connected';
    if(show) showMessage('Live tick stream disconnected. Candle analysis remains unchanged until the next manual fetch.', '');
  }

  async function unlockDashboard() {
    $('unlockBtn').disabled = true;
    try {
      const r = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:$('accessCode').value})});
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Could not unlock dashboard.');
      $('accessBox').hidden = true;
      $('loadBtn').disabled = false; $('usageBtn').disabled = false; $('streamBtn').disabled = true; $('stopStreamBtn').disabled = true;
      $('accessCode').value = '';
      showMessage('Dashboard unlocked for this browser session. You can now fetch candles.', 'success');
      checkHealth();
    } catch(err) {
      showMessage(err.message, 'error');
    } finally { $('unlockBtn').disabled = false; }
  }

  $('unlockBtn').addEventListener('click', unlockDashboard);
  $('accessCode').addEventListener('keydown', event => { if (event.key === 'Enter') unlockDashboard(); });
  $('loadBtn').addEventListener('click', fetchCandles);
  $('usageBtn').addEventListener('click', checkUsage);
  $('streamBtn').addEventListener('click', connectStream);
  $('stopStreamBtn').addEventListener('click', () => stopStream());
  function invalidateCurrentSetup(reason) {
    if (state.stream) stopStream(false);
    state.data = null; state.bars = []; state.fetchedTf = null; state.tick = null;
    resetSignal('WAIT: fetch the newly selected market/timeframe before analyzing.');
    clearMarket();
    $('marketBadge').textContent = 'NO FEED';
    $('sourceText').textContent = 'Source: selection changed';
    $('updatedText').textContent = 'Updated: —';
    $('safeFreshText').textContent = 'Awaiting candle timestamps'; dot('safeFreshDot', 'warn');
    $('safeGapText').textContent = 'Awaiting gap inspection'; dot('safeGapDot', 'warn');
    $('safeOpenText').textContent = 'Not confirmed'; dot('safeOpenDot', 'warn');
    showMessage(reason, '');
  }
  $('pairSelect').addEventListener('change', () => { if (!$('customSymbol').value.trim()) invalidateCurrentSetup('Market selection changed. Fetch candles again to avoid analyzing an old pair.'); });
  $('customSymbol').addEventListener('change', () => invalidateCurrentSetup('Custom symbol changed. Fetch candles again to verify its data feed.'));
  $('timeframe').addEventListener('change', () => invalidateCurrentSetup('Timeframe changed. Fetch candles again to request bars for the selected timeframe.'));
  $('expiryBars').addEventListener('change', () => { if(state.data && state.fetchedTf) analyze(state.data, state.fetchedTf); });
  window.addEventListener('resize', () => drawChart((state.bars || []).filter(c => Number(c.time)+Number($('timeframe').value) <= Date.now()/1000+1).slice(-100)));
  checkHealth();
})();
