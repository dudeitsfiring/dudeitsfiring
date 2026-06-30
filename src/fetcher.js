const axios = require('axios');

// ── Helpers ───────────────────────────────────────────────────

function degreesToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
function msToKnots(ms)  { return Math.round(ms * 1.944); }
function mToFt(m)       { return parseFloat((m * 3.281).toFixed(1)); }
function angleDiff(a,b) { return Math.abs(((a - b + 540) % 360) - 180); }

// Retry wrapper for Open-Meteo — handles 403 rate-limit responses
// with exponential backoff. Open-Meteo is free but rate-limited;
// a short pause between retries is enough to recover.
async function withRetry(fn, retries = 3, delayMs = 800) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.response && (err.response.status === 403 || err.response.status === 429);
      if (isRateLimit && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// ── NOAA Buoy ─────────────────────────────────────────────────

async function fetchNoaaBuoy(buoyId) {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${buoyId}.txt`;
  const res = await axios.get(url, { timeout: 4000 });
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
// Uses 6-minute interval predictions (NOAA's highest resolution)
// over a 3-hour window centered on now, so we get the actual
// current tide height rather than the nearest hourly snap.
//
// Time handling: NOAA's lst_ldt parameter expects local station
// time, so we offset UTC by the station's approximate timezone
// using the spot's longitude — accurate enough for tide purposes.

function utcToStationLocal(date, lon) {
  // Estimate UTC offset from longitude (15° per hour)
  const offsetHours = Math.round(lon / 15);
  return new Date(date.getTime() + offsetHours * 3600000);
}

async function fetchTideData(stationId, lon) {
  if (!stationId) return { tideFt:null, tideMovement:null, tideWindowMin:null, tideWindowMax:null };
  const now      = new Date();
  const localNow = lon !== undefined ? utcToStationLocal(now, lon) : now;
  // 30-min back, 2.5-hrs forward — captures current reading plus
  // enough future values to determine movement direction reliably
  const begin    = new Date(localNow.getTime() - 30*60000);
  const end      = new Date(localNow.getTime() + 150*60000);
  const fmt      = d => d.toISOString().slice(0,16).replace('T',' ');
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
    + `?begin_date=${encodeURIComponent(fmt(begin))}&end_date=${encodeURIComponent(fmt(end))}`
    + `&station=${stationId}&product=predictions&datum=MLLW&time_zone=lst_ldt`
    + `&interval=6&units=english&application=dudeitsfiring&format=json`;
  const res = await axios.get(url, { timeout: 4000 });
  const preds = res.data.predictions;
  if (!preds || preds.length < 3) return { tideFt:null, tideMovement:null, tideWindowMin:null, tideWindowMax:null };
  const vals = preds.map(p => parseFloat(p.v));
  // Find the reading closest to right now (middle of our window)
  const midIdx = Math.floor(vals.length / 2);
  const current = vals[midIdx];
  // Movement: compare current to reading 30 minutes from now
  const futureIdx = Math.min(midIdx + 5, vals.length - 1); // 5 × 6min = 30min ahead
  return {
    tideFt:        parseFloat(current.toFixed(1)),
    tideMovement:  vals[futureIdx] > current ? 'rising' : 'falling',
    tideWindowMin: parseFloat(Math.min(...vals).toFixed(1)),
    tideWindowMax: parseFloat(Math.max(...vals).toFixed(1)),
  };
}

// ── Wind Data ─────────────────────────────────────────────────
// Primary: Open-Meteo (no API key, same provider as our marine data,
// proven reliable). Falls back to OpenWeatherMap if key is configured.

async function fetchWindData(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=windspeed_10m,winddirection_10m&wind_speed_unit=kn&forecast_days=1&timezone=auto`;
    const res = await axios.get(url, { timeout: 4000 });
    const d = res.data.hourly;
    const i = findCurrentHourIndex(d.time || d.windspeed_10m.map((_,j) => j));
    const spd = d.windspeed_10m[i];
    const dir = d.winddirection_10m[i];
    if (spd == null) throw new Error('No Open-Meteo wind data');
    return {
      windSpeedKts:     Math.round(spd),
      windDirection:    degreesToCompass(dir),
      windDirectionDeg: Math.round(dir),
    };
  } catch (err) {
    // Optional fallback to OpenWeatherMap if key is set
    const key = process.env.OPENWEATHER_API_KEY;
    if (key && key !== 'your_openweather_key_here') {
      try {
        const res = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`,
          { timeout: 4000 }
        );
        const w = res.data.wind;
        return {
          windSpeedKts:     msToKnots(w.speed),
          windDirection:    degreesToCompass(w.deg),
          windDirectionDeg: Math.round(w.deg),
        };
      } catch (_) {}
    }
    return { windSpeedKts:null, windDirection:null, windDirectionDeg:null };
  }
}

// ── NOAA Buoy with fallback ───────────────────────────────────
// Tries primary buoyId first; if it's offline/returning no data,
// falls back to spot.fallbackBuoyId if one is defined.

async function fetchNoaaBuoyWithFallback(spot) {
  try {
    return await fetchNoaaBuoy(spot.buoyId);
  } catch (err) {
    if (spot.fallbackBuoyId) {
      const data = await fetchNoaaBuoy(spot.fallbackBuoyId);
      data._usedFallback = spot.fallbackBuoyId;
      return data;
    }
    throw err;
  }
}

// ── Open-Meteo Marine (global) ────────────────────────────────
// Uses local time from the API response to find the correct
// current-hour index, rather than using raw UTC hours which
// would be wrong for any timezone offset from UTC.

function findCurrentHourIndex(times) {
  const now = Date.now();
  let closest = 0;
  let closestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - now);
    if (diff < closestDiff) { closestDiff = diff; closest = i; }
  });
  return closest;
}

async function fetchOpenMeteoMarine(lat, lon) {
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + `&hourly=swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,wave_period,wave_direction`
    + `&forecast_days=1&timezone=auto`;
  const res = await withRetry(() => axios.get(url, { timeout: 4000 }));
  const d = res.data.hourly;
  const i = findCurrentHourIndex(d.time);
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
  // 5-hour window: informational only — current tide in range is enough to fire.
  // A spot that's good right now is worth alerting even if tide drifts later.
  const windowNote = (tideWindowMin !== null && tideWindowMax !== null)
    ? ` (5hr window: ${tideWindowMin.toFixed(1)}–${tideWindowMax.toFixed(1)}ft)`
    : '';
  return { pass:true, note:`tide ${tideFt.toFixed(1)}ft ${tideMovement}${windowNote}` };
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
  if (period >= 12) return 1.07;  // modest boost — 12s is real groundswell
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

  // Wave height — adjusted for period at reefs and points only.
  // Beach breaks don't focus or amplify long-period swell the way
  // a reef or point does — a 3ft @ 14s buoy reading at Bolsa Chica
  // produces ~3ft of actual surf, not 3.9ft. beachBreak:true on a
  // spot disables the multiplier and uses raw buoy height only.
  const mult = spot.beachBreak ? 1.0 : periodMultiplier(buoy.dominantPeriod);
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

// ── Hybrid data selection ─────────────────────────────────────
// Runs NOAA buoy and Open-Meteo simultaneously, then picks the
// best reading based on agreement and data quality.
//
// Decision rules (in order):
//   1. Both return data + agree within tolerance → use NOAA buoy
//      (real ocean measurement beats model when they agree)
//   2. Both return data + diverge significantly → use Open-Meteo
//      (model is more reliable than a buoy with noisy/stale data)
//   3. Only one returns data → use whichever succeeded
//   4. Neither → throw, checker logs the error and moves on
//
// "Agree" = within 1.5ft height AND 2s period (or period is null
//   on the buoy — the "nulls" issue we saw where a buoy loses its
//   directional sensor but still reports height).

const HYBRID_HEIGHT_TOLERANCE = 1.5; // ft
const HYBRID_PERIOD_TOLERANCE = 2;   // seconds

function selectBestData(buoyData, modelData) {
  // If buoy has null period (sensor issue), trust model's period
  // but keep buoy's height if it's within tolerance
  const buoyPeriodOk = buoyData.dominantPeriod !== null;

  const heightDiff = Math.abs(buoyData.waveHeightFt - modelData.waveHeightFt);
  const periodDiff = buoyPeriodOk
    ? Math.abs(buoyData.dominantPeriod - (modelData.dominantPeriod || 0))
    : 999;

  const agree = heightDiff <= HYBRID_HEIGHT_TOLERANCE && periodDiff <= HYBRID_PERIOD_TOLERANCE;

  if (agree && buoyPeriodOk) {
    // High confidence — real measurement matches model, use buoy
    return { ...buoyData, _source: 'buoy', _modelHeight: modelData.waveHeightFt };
  }

  if (agree && !buoyPeriodOk) {
    // Buoy height looks right but period sensor failed — blend:
    // use buoy height, model period and direction
    return {
      ...buoyData,
      dominantPeriod:    modelData.dominantPeriod,
      swellDirection:    modelData.swellDirection,
      swellDirectionDeg: modelData.swellDirectionDeg,
      _source: 'hybrid',
      _modelHeight: modelData.waveHeightFt,
    };
  }

  // Diverge — log it and trust model
  return {
    ...modelData,
    _source: 'model',
    _buoyHeight: buoyData.waveHeightFt,
    _divergence: `buoy ${buoyData.waveHeightFt}ft vs model ${modelData.waveHeightFt}ft`,
  };
}

// ── Main ──────────────────────────────────────────────────────

async function fetchSpotConditions(spot) {
  // Always fetch wind and tide in parallel — these never change
  const [wind, tideData] = await Promise.all([
    fetchWindData(spot.lat, spot.lon),
    fetchTideData(spot.tideStation, spot.lon),
  ]);

  // For spots already set to openmeteo-only (e.g. remote Hawaii
  // spots with no nearby buoy), skip the hybrid and just use model
  if (spot.dataSource === 'openmeteo') {
    const buoy = await fetchOpenMeteoMarine(spot.lat, spot.lon);
    buoy._source = 'model';
    const result = scoreConditions(spot, buoy, wind, tideData);
    return { spot, buoy, wind, tideData, score:result };
  }

  // Hybrid: fetch NOAA buoy and Open-Meteo simultaneously.
  // Key design: don't wait for NOAA if Open-Meteo already answered.
  // Uses a race with a short NOAA-specific deadline — if NOAA hasn't
  // responded by the time Open-Meteo finishes, use Open-Meteo and
  // let NOAA resolve in the background (we don't need it anymore).
  // This means a NOAA outage never blocks the service — Open-Meteo
  // always provides a result within its own response time (~1-2s).

  const modelPromise = fetchOpenMeteoMarine(spot.lat, spot.lon);
  const buoyPromise  = fetchNoaaBuoyWithFallback(spot);

  // Wait for Open-Meteo first — it's our reliable backbone
  let modelData, buoyData;
  try {
    modelData = await modelPromise;
  } catch (modelErr) {
    // Open-Meteo failed — fall back to NOAA only
    try {
      buoyData = await buoyPromise;
      const buoy = { ...buoyData, _source: 'buoy' };
      const result = scoreConditions(spot, buoy, wind, tideData);
      return { spot, buoy, wind, tideData, score:result };
    } catch (buoyErr) {
      throw buoyErr; // both failed
    }
  }

  // Open-Meteo succeeded — now check if NOAA also has a result
  // without waiting (race it against an immediate resolve)
  try {
    buoyData = await Promise.race([
      buoyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('buoy slower than model')), 500)),
    ]);
  } catch (_) {
    // NOAA didn't respond within 500ms of Open-Meteo — use model only
    const buoy = { ...modelData, _source: 'model' };
    const result = scoreConditions(spot, buoy, wind, tideData);
    return { spot, buoy, wind, tideData, score:result };
  }

  // Both succeeded — apply selection logic
  const buoy = selectBestData(buoyData, modelData);
  const result = scoreConditions(spot, buoy, wind, tideData);
  return { spot, buoy, wind, tideData, score:result };
}

module.exports = { fetchSpotConditions, degreesToCompass, scoreConditions, MAX_WIND_KTS };

