require('dotenv').config();
const spots   = require('./spots');
const { fetchSpotConditions } = require('./fetcher');
const { getSubscribersForSpot, wasAlertedRecently, logAlert } = require('./db');
const { notify } = require('./notifier');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const COOLDOWN = parseInt(process.env.ALERT_COOLDOWN_HOURS || '6');

// ── Daylight check ────────────────────────────────────────────
// No alerts before 6am or after 8pm local time — nobody wants a 3am text
// Timezone estimated from longitude (accurate enough for surf alerts)
function isDaylight(spot) {
  const lon = spot.lon;
  let utcOffset;
  if (lon < -115)      utcOffset = -8;  // Pacific  (CA, HI uses -10 but close enough)
  else if (lon < -100) utcOffset = -7;  // Mountain
  else if (lon < -85)  utcOffset = -6;  // Central
  else                 utcOffset = -5;  // Eastern  (EC, FL)

  const localHour = (new Date().getUTCHours() + 24 + utcOffset) % 24;
  return localHour >= 6 && localHour < 20; // 6am to 8pm only
}

async function checkAllSpots() {
  console.log(`\n[${new Date().toISOString()}] Checking ${spots.length} spots...\n`);

  for (const spot of spots) {
    try {
      // Skip if it's dark — no point waking people up
      if (!isDaylight(spot)) {
        continue;
      }

      const conditions = await fetchSpotConditions(spot);
      const { score, buoy, wind, tideData } = conditions;

      // Only log spots with activity to keep output readable
      if (!score.isGood && score.score < 50) continue;

      const tideStr = tideData && tideData.tideFt !== null
        ? `tide ${tideData.tideFt.toFixed(1)}ft ${tideData.tideMovement}`
        : 'tide N/A';

      console.log(`→ ${spot.name}`);
      console.log(`  ${buoy.waveHeightFt}ft @ ${buoy.dominantPeriod}s · ${buoy.swellDirection} · wind ${wind.windSpeedKts}kts ${wind.windDirection} · ${tideStr}`);
      console.log(`  Score: ${score.score}/100 (${score.quality}) | Alert: ${score.isGood ? '✅ YES' : '🚫 no'}`);

      if (!score.isGood) {
        console.log(`  Blocked: ${score.issues.join(' | ')}`);
        continue;
      }

      if (wasAlertedRecently(spot.id, COOLDOWN)) {
        console.log(`  ⏱  Cooldown — alerted within last ${COOLDOWN}hrs`);
        continue;
      }

      const subscribers = getSubscribersForSpot(spot.id);
      console.log(`  📣 ${score.quality}! Notifying ${subscribers.length} subscriber(s)...`);

      for (const sub of subscribers) {
        const ok = await notify(sub, spot, conditions, BASE_URL);
        if (ok) logAlert(spot.id, sub.id, { buoy, wind, tideData, score });
      }

      if (subscribers.length === 0) {
        logAlert(spot.id, null, { buoy, wind, tideData, score });
        console.log(`  (no subscribers yet — logged for testing)`);
      }

    } catch (err) {
      console.error(`  ❌ ${spot.name}: ${err.message}`);
    }
  }

  console.log(`\n✅ Check complete — ${new Date().toISOString()}\n`);
}

// Run directly: node src/checker.js --run-now
if (require.main === module) {
  checkAllSpots().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { checkAllSpots };
