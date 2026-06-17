const axios = require('axios');

// ── Helpers ───────────────────────────────────────────────────

function degreesToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
function msToKnots(ms)  { return Math.round(ms * 1.944); }
function mToFt(m)       { return parseFloat((m * 3.281).toFixed(1)); }
function angleDiff(a,b) { return Math.abs(((a - b + 540) % 360) - 180); }

// ── NOAA Buoy ─────────────────────────────────────────────────

async function fetchNoaaBuoy(buoyId) {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${buoyId}.txt`;
  const res = await axios.get(url, { timeout: 10000 });
  const lines = res.data.trim().split('\n');
  const headers = lines[0].replace('#','').trim().split(/\s+/);
  const values  = lines[2].trim().split(/\s+/);
  const row = {};
  headers.forEach((h,i) => { row[h] = values[i]; });
  const wh  = parseFloat(row['WVHT']);
  const dp  = parseFloat(row['DPD']);
  const mwd = parseFloat(row['MWD']);
  const wt  = parseFloat(row['WTMP']);
  if (isNaN(wh)) throw new Error(`No wave data from buoy ${buoyId}`);
  return {
    waveHeightFt:      mToFt(wh),
    dominantPeriod:    isNaN(dp)  ? null : dp,
    swellDirection:    isNaN(mwd) ? null : degreesToCompass(mwd),
    swellDirectionDeg: isNaN(mwd) ? null : Math.round(mwd),
    waterTempC:        isNaN(wt)  ? null : wt,
  };
}

// ── NOAA Tides API ────────────────────────────────────────────

async function fetchTideData(stationId) {
  if (!stationId) return { tideFt:null, tideMovement:null, tideWindowMin:null, tideWindowMax:null };
  const now   = new Date();
  const fmt   = d => d.toISOString().slice(0,16).replace('T',' ');
  const end   = new Date(now.getTime() + 6*3600*1000);
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
    + `?begin_date=${encodeURIComponent(fmt(now))}&end_date=${encodeURIComponent(fmt(end))}`
    + `&station=${stationId}&product=predictions&datum=MLLW&time_zone=lst_ldt`
    + `&interval=h&units=english&application=dudeitsfiring&format=json`;
  const res = await axios.get(url, { timeout: 10000 });
  const preds = res.data.predictions;
  if (!preds || preds.length < 2) return { tideFt:null, tideMovement:null, tideWindowMin:null, tideWindowMax:null };
  const vals = preds.slice(0,6).map(p => parseFloat(p.v));
  return {
    tideFt:        vals[0],
    tideMovement:  vals[1] > vals[0] ? 'rising' : 'falling',
    tideWindowMin: Math.min(...vals),
    tideWindowMax: Math.max(...vals),
  };
}

// ── OpenWeatherMap Wind ───────────────────────────────────────

async function fetchWindData(lat, lon) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key || key === 'your_openweather_key_here') {
    return { windSpeedKts:null, windDirection:null, windDirectionDeg:null };
  }
  const res = await axios.get(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`,
    { timeout: 10000 }
  );
  const w = res.data.wind;
  return {
    windSpeedKts:     msToKnots(w.speed),
    windDirection:    degreesToCompass(w.deg),
    windDirectionDeg: Math.round(w.deg),
  };
}

// ── Open-Meteo Marine (global) ────────────────────────────────

async function fetchOpenMeteoMarine(lat, lon) {
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + `&hourly=swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction`
    + `&forecast_days=1&timezone=auto`;
  const res = await axios.get(url, { timeout: 10000 });
  const d = res.data.hourly;
  const i = Math.min(new Date().getUTCHours(), d.wave_height.length - 1);
  const h   = d.swell_wave_height[i]    ?? d.wave_height[i];
  const p   = d.swell_wave_period[i]    ?? d.wave_period[i];
  const dir = d.swell_wave_direction[i] ?? d.wave_direction[i];
  if (h == null) throw new Error(`No Open-Meteo data for ${lat},${lon}`);
  return {
    waveHeightFt:      mToFt(h),
    dominantPeriod:    p   ? Math.round(p)   : null,
    swellDirection:    dir ? degreesToCompass(dir) : null,
    swellDirectionDeg: dir ? Math.round(dir) : null,
    waterTempC: null,
  };
}

// ── Swell direction check ─────────────────────────────────────
// ±33° tolerance per compass point prevents false rejections at
// boundary edges (e.g. 316° rounds to NNW but NW is listed as ideal)

function checkSwellDirection(spot, swellDeg) {
  if (swellDeg === null) return { pass:true, note:'swell direction unknown' };
  const cDeg = {
    N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,
    S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5
  };
  const passes = spot.idealSwell.some(d => cDeg[d]!==undefined && angleDiff(swellDeg,cDeg[d])<=33);
  if (passes) return { pass:true,  note:`${swellDeg}° swell in ideal window` };
  return       { pass:false, note:`swell ${swellDeg}° (${degreesToCompass(swellDeg)}) not in ideal window [${spot.idealSwell.join('/')}]` };
}

// ── Wind direction + speed check ─────────────────────────────
// offshoreWindFrom = compass degrees FROM WHICH offshore wind blows
// ≤5kts = glassy, always ok | diff≤60° = offshore | 61-120° = cross | >120° = onshore
// Global hard cap: 13kts (15mph)

const MAX_WIND_KTS = 14; // ~16mph — wind that kills most breaks

function checkWind(spot, windDeg, windKts) {
  if (windDeg===null || windKts===null) return { pass:true, type:'unknown', note:'wind data unavailable' };
  // Per-spot cap allows big-wave spots to set higher thresholds
  const cap = spot.maxWindKts || MAX_WIND_KTS;
  if (windKts <= 5) return { pass:true, type:'glassy', note:`glassy ${windKts}kts` };
  if (spot.offshoreWindFrom === undefined) {
    return windKts<=cap
      ? { pass:true,  type:'unknown', note:`wind ${windKts}kts` }
      : { pass:false, type:'unknown', note:`wind ${windKts}kts > cap ${cap}kts` };
  }
  const diff = angleDiff(windDeg, spot.offshoreWindFrom);
  const type = diff<=60?'offshore': diff<=120?'cross':'onshore';
  // Onshore kills quality but light onshore can still be surfable — block above 10kts
  if (type==='onshore' && windKts>10) return { pass:false, type, note:`onshore wind ${windKts}kts ${degreesToCompass(windDeg)} — blown out` };
  if (windKts>cap)                    return { pass:false, type, note:`${type} wind ${windKts}kts > ${cap}kts cap` };
  return { pass:true, type, note:`${type} wind ${windKts}kts ${degreesToCompass(windDeg)}` };
}

// ── Tide check ────────────────────────────────────────────────
// Checks current level, movement preference, and 5-hour window
// Only gates when tideStation is configured on the spot

function checkTide(spot, tide) {
  if (!spot.tideStation || tide.tideFt===null) return { pass:true, note:'tide check skipped' };
  const { tideFt, tideMovement, tideWindowMin, tideWindowMax } = tide;
  if (tideFt < spot.tideMin || tideFt > spot.tideMax)
    return { pass:false, note:`tide ${tideFt.toFixed(1)}ft outside ideal range ${spot.tideMin}–${spot.tideMax}ft` };
  if (spot.tideMovement && spot.tideMovement!=='any' && tideMovement!==spot.tideMovement)
    return { pass:false, note:`tide ${tideMovement} — ${spot.name||'spot'} needs ${spot.tideMovement}` };
  const buf = 0.5;
  if (tideWindowMin < spot.tideMin-buf || tideWindowMax > spot.tideMax+buf)
    return { pass:false, note:`tide window (${tideWindowMin.toFixed(1)}–${tideWindowMax.toFixed(1)}ft) won't hold 5hrs` };
  return { pass:true, note:`tide ${tideFt.toFixed(1)}ft ${tideMovement}, 5hr window ${tideWindowMin.toFixed(1)}–${tideWindowMax.toFixed(1)}ft` };
}

// ── Period-adjusted effective height ──────────────────────────
// Long-period groundswell breaks bigger than its open-ocean buoy
// reading once it wraps into the coast — period has an outsized
// effect on actual face height, especially at points/rivermouths
// that organize swell well. Calibrated against real session
// reports (e.g. Andrew Molera: 3.5ft @ 18-19s buoy reading
// produced ~6ft faces in the water — a ~1.7x multiplier).
function periodMultiplier(period) {
  if (period === null) return 1.0;
  if (period >= 18) return 1.7;
  if (period >= 16) return 1.5;
  if (period >= 14) return 1.3;
  if (period >= 13) return 1.15;
  return 1.0;
}

// ── Master scorer ─────────────────────────────────────────────
// Score 0–100. Alert fires at score ≥ 72 AND no hard failures.
// 72 = roughly 7/10 quality — genuinely firing, not just surfable.
//
// Breakdown:
//   Wave height  0–35 pts  (20 at min → 35 at 2× min)
//   Period       0–25 pts  (15 at min → 25 at 1.5× min)
//   Swell dir    0–20 pts  (pass/fail with ±33° tolerance)
//   Wind         0–15 pts  (offshore/glassy=15, cross=7, unknown=8)
//   Tide         0–5  pts  (bonus when in ideal range)
//
// Hard gates (any = no alert):
//   wave too small | period too short | wrong swell direction |
//   wind too strong or onshore | tide outside range

function scoreConditions(spot, buoy, wind, tideData) {
  const issues = [], reasons = [];
  let score = 0;
  const td = tideData || { tideFt:null, tideMovement:null };

  // Wave height — adjusted for period, since long-period swell
  // breaks bigger than its raw buoy reading once it wraps to shore
  const mult = periodMultiplier(buoy.dominantPeriod);
  const effectiveHeight = parseFloat((buoy.waveHeightFt * mult).toFixed(1));
  const hr = effectiveHeight / spot.minHeight;
  if (hr < 1.0) {
    issues.push(`waves too small: ${buoy.waveHeightFt}ft buoy (${effectiveHeight}ft effective @ ${mult}x, need ${spot.minHeight}ft+)`);
  } else {
    score += Math.min(35, Math.round(20 + (hr-1)*30));
    reasons.push(mult > 1.0
      ? `${buoy.waveHeightFt}ft buoy → ${effectiveHeight}ft effective (long-period boost)`
      : `${buoy.waveHeightFt}ft waves`);
  }

  // Period
  if (buoy.dominantPeriod !== null) {
    const pr = buoy.dominantPeriod / spot.minPeriod;
    if (pr < 1.0) {
      issues.push(`period too short: ${buoy.dominantPeriod}s (need ${spot.minPeriod}s+)`);
    } else {
      score += Math.min(25, Math.round(15 + (pr-1)*33));
      reasons.push(`${buoy.dominantPeriod}s period`);
    }
  }

  // Swell direction
  const sw = checkSwellDirection(spot, buoy.swellDirectionDeg);
  if (!sw.pass) { issues.push(sw.note); } else { score += 20; reasons.push(sw.note); }

  // Wind
  const wn = checkWind(spot, wind.windDirectionDeg, wind.windSpeedKts);
  if (!wn.pass) {
    issues.push(wn.note);
  } else {
    score += wn.type==='offshore'||wn.type==='glassy' ? 15 : wn.type==='cross' ? 7 : 8;
    reasons.push(wn.note);
  }

  // Tide
  const tk = checkTide(spot, td);
  if (!tk.pass) { issues.push(tk.note); } else { score += 5; reasons.push(tk.note); }

  score = Math.min(100, score);
  const hardFail = issues.length > 0;

  // 72+ = fires alert (≈7/10). Fair (45-71) = logged but no text sent.
  let quality = 'Poor';
  if (!hardFail) {
    quality = score>=85?'Epic': score>=72?'Good': score>=50?'Fair':'Poor';
  }
  const isGood = !hardFail && score >= 72;

  return { isGood, quality, score, reasons, issues };
}

// ── Main ──────────────────────────────────────────────────────

async function fetchSpotConditions(spot) {
  const src = spot.dataSource || 'noaa';
  const [buoy, wind, tideData] = await Promise.all([
    src==='openmeteo' ? fetchOpenMeteoMarine(spot.lat, spot.lon) : fetchNoaaBuoy(spot.buoyId),
    fetchWindData(spot.lat, spot.lon),
    fetchTideData(spot.tideStation),
  ]);
  const result = scoreConditions(spot, buoy, wind, tideData);
  return { spot, buoy, wind, tideData, score:result };
}

module.exports = { fetchSpotConditions, degreesToCompass, scoreConditions, MAX_WIND_KTS };
