const { Resend } = require('resend');

// ── Daylight hours check ──────────────────────────────────────
// SMS only sent 6am–8pm at the spot's local timezone
// Email is never suppressed — sits in inbox until opened
function isDaylightHours(timezone) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const hour = new Date(localStr).getHours();
  return hour >= 6 && hour < 20;
}

// ── Resend email client ───────────────────────────────────────
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.EMAIL_FROM || "Dude It's Firing <alerts@dudeitsfiring.com>";

// ── Alert email body ──────────────────────────────────────────
function buildEmailBody(spot, conditions, unsubscribeUrl) {
  const { buoy, wind, score } = conditions;
  const qualityEmoji = { Epic:'🔥', Good:'✅', Fair:'⚡' }[score.quality] || '🌊';
  const checkedAt = new Date().toLocaleTimeString('en-US', {
    timeZone: spot.timezone || 'America/Los_Angeles',
    hour:'numeric', minute:'2-digit', timeZoneName:'short'
  });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:system-ui,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;">
    <div style="background:#0A5C45;padding:24px 28px;">
      <p style="margin:0;color:#7ECFB3;font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Dude, It's Firing!</p>
      <h1 style="margin:8px 0 0;color:white;font-size:22px;font-weight:700;">${qualityEmoji} ${score.quality} surf at ${spot.name}</h1>
      <p style="margin:6px 0 0;color:#A8DDD0;font-size:14px;">${spot.location}</p>
    </div>
    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;">Wave height</td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#111;">${buoy.waveHeightFt} ft</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;">Swell period</td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#111;">${buoy.dominantPeriod ? buoy.dominantPeriod+'s' : 'N/A'}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;">Swell direction</td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#111;">${buoy.swellDirection || 'N/A'} (${buoy.swellDirectionDeg || '?'}°)</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;">Wind</td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#111;">${wind.windSpeedKts !== null ? wind.windDirection+' '+wind.windSpeedKts+' kts' : 'N/A'}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;font-size:13px;">Score</td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#0A5C45;">${score.score}/100 — ${score.quality}</td></tr>
        ${buoy.waterTempC ? `<tr><td style="padding:10px 0;color:#888;font-size:13px;">Water temp</td>
            <td style="padding:10px 0;text-align:right;font-weight:600;color:#111;">${Math.round(buoy.waterTempC*9/5+32)}°F</td></tr>` : ''}
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#555;line-height:1.6;">
        <strong>Get in the water.</strong> Conditions checked at ${checkedAt}.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f9f9f7;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;color:#999;">
        You subscribed to Dude, It's Firing! for ${spot.name}.
        <a href="${unsubscribeUrl}" style="color:#0A5C45;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body></html>`.trim();
}

// ── Welcome email body ────────────────────────────────────────
function buildWelcomeEmailBody(spotNames, unsubscribeUrl) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:system-ui,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;">
    <div style="background:#0A5C45;padding:24px 28px;">
      <p style="margin:0;color:#7ECFB3;font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Dude, It's Firing!</p>
      <h1 style="margin:8px 0 0;color:white;font-size:26px;font-weight:700;">🤙 You're in!</h1>
      <p style="margin:6px 0 0;color:#A8DDD0;font-size:14px;">We're watching your spots 24/7.</p>
    </div>
    <div style="padding:24px 28px;">
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 16px;">You're now connected to:</p>
      <div style="background:#F0F8F4;border-left:3px solid #0A5C45;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#0A5C45;line-height:1.6;">${spotNames}</p>
      </div>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 12px;">The moment any of them are genuinely worth paddling out — you'll get an alert. No false alarms. No spam. Just the real thing.</p>
      <p style="font-size:14px;color:#666;line-height:1.6;margin:0;font-style:italic;">Surf can be seasonal — if it's quiet for a few weeks, that's normal. When we send an alert, go surf.</p>
    </div>
    <div style="padding:16px 28px;background:#f9f9f7;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;color:#999;">
        You subscribed to Dude, It's Firing! · <a href="${unsubscribeUrl}" style="color:#0A5C45;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body></html>`.trim();
}

// ── Send alert email ──────────────────────────────────────────
async function sendEmail(to, spot, conditions, token, baseUrl) {
  const unsubUrl = `${baseUrl}/unsubscribe/${token}`;
  const { score } = conditions;
  const { error } = await getResend().emails.send({
    from:    FROM,
    to,
    subject: `🌊 ${score.quality} surf at ${spot.name} — go now`,
    html:    buildEmailBody(spot, conditions, unsubUrl),
  });
  if (error) throw new Error(error.message);
  console.log(`  ✉️  Alert email sent to ${to}`);
}

// ── Send welcome email ────────────────────────────────────────
async function sendWelcomeEmail(to, spotNames, token, baseUrl) {
  const unsubUrl = `${baseUrl}/unsubscribe/${token}`;
  const { error } = await getResend().emails.send({
    from:    FROM,
    to,
    subject: `🤙 You're connected to Dude, It's Firing!`,
    html:    buildWelcomeEmailBody(spotNames, unsubUrl),
  });
  if (error) throw new Error(error.message);
  console.log(`  ✉️  Welcome email sent to ${to}`);
}

// ── SMS segment cost helper ───────────────────────────────────
function smsSegmentCount(text) {
  const hasUnicode = /[^\x00-\x7F]/.test(text);
  const singleLimit = hasUnicode ? 70 : 160;
  const multiLimit  = hasUnicode ? 67 : 153;
  if (text.length <= singleLimit) return 1;
  return Math.ceil(text.length / multiLimit);
}

// ── Send alert SMS ────────────────────────────────────────────
async function sendSMS(subscriber, spot, conditions, baseUrl) {
  const tz = spot.timezone || 'America/Los_Angeles';
  if (!isDaylightHours(tz)) {
    const localTime = new Date().toLocaleTimeString('en-US', {
      timeZone: tz, hour:'numeric', minute:'2-digit', timeZoneName:'short'
    });
    console.log(`  ⏸️  SMS suppressed — currently ${localTime} at ${spot.location} (outside 6am–8pm).`);
    return;
  }

  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const { buoy, wind, score } = conditions;
  const unsubUrl = `${baseUrl}/unsubscribe/${subscriber.token}`;

  const body = [
    `Dude, it's firing at ${spot.name}!`,
    `${buoy.waveHeightFt}ft @ ${buoy.dominantPeriod||'?'}s, ${buoy.swellDirection||'?'} swell, Score:${score.score}/100`,
    wind.windSpeedKts !== null ? `Wind: ${wind.windDirection} ${wind.windSpeedKts}kts` : null,
    `Unsub: ${unsubUrl}`,
  ].filter(Boolean).join('\n');

  const segments = smsSegmentCount(body);
  if (segments > 1) {
    console.warn(`  ⚠️  SMS to ${subscriber.contact} is ${segments} segments — check for non-GSM-7 characters`);
  }

  await twilio.messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER,
    to:   subscriber.contact,
  });
  console.log(`  📱 SMS sent to ${subscriber.contact} (${segments} segment${segments>1?'s':''})`);
}

// ── Send welcome SMS (MMS with wave image) ────────────────────
async function sendWelcomeSMS(subscriber, spotList, baseUrl) {
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({
    body: `🤙 You're in! Welcome to Dude It's Firing! We're watching ${spotList} right now — the second any of them are firing, you'll get a text. Surf can be seasonal so give it time if it's quiet. When we text, go SURF.`,
    mediaUrl: [`${baseUrl}/final-bg.jpg`],
    from: process.env.TWILIO_FROM_NUMBER,
    to:   subscriber.contact,
  });
  console.log(`  📱 Welcome MMS sent to ${subscriber.contact}`);
}

// ── Format spot list for welcome SMS ─────────────────────────
function formatSpotList(spotNames) {
  const names = (spotNames || '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length <= 5) return names.join(', ');
  const shown = names.slice(0, 5).join(', ');
  const remaining = names.length - 5;
  return `${shown}, and ${remaining} more spot${remaining === 1 ? '' : 's'}`;
}

// ── Welcome dispatcher ────────────────────────────────────────
async function sendWelcome(subscriber, baseUrl, { spotNames, token }) {
  const spotList = formatSpotList(spotNames);

  if (subscriber.type === 'sms') {
    await sendWelcomeSMS(subscriber, spotList, baseUrl);
  } else if (subscriber.type === 'email') {
    await sendWelcomeEmail(subscriber.contact, spotNames, token, baseUrl);
  } else if (subscriber.type === 'both') {
    await sendWelcomeSMS(subscriber, spotList, baseUrl);
    await sendWelcomeEmail(subscriber.both_email, spotNames, token, baseUrl);
  }
}

// ── Main notify dispatcher ────────────────────────────────────
async function notify(subscriber, spot, conditions, baseUrl, options = {}) {
  // Welcome message
  if (options.isWelcome) {
    try {
      await sendWelcome(subscriber, baseUrl, options);
      return true;
    } catch (err) {
      console.error(`  ❌ Failed to send welcome to ${subscriber.contact}:`, err.message);
      return false;
    }
  }

  // Alert — email only
  if (subscriber.type === 'email') {
    try {
      await sendEmail(subscriber.contact, spot, conditions, subscriber.token, baseUrl);
      return true;
    } catch (err) {
      console.error(`  ❌ Failed to send alert email to ${subscriber.contact}:`, err.message);
      return false;
    }
  }

  // Alert — SMS only
  if (subscriber.type === 'sms') {
    try {
      await sendSMS(subscriber, spot, conditions, baseUrl);
      return true;
    } catch (err) {
      console.error(`  ❌ Failed to send alert SMS to ${subscriber.contact}:`, err.message);
      return false;
    }
  }

  // Alert — both: SMS and email fail independently
  if (subscriber.type === 'both') {
    let ok = true;
    try {
      await sendSMS(subscriber, spot, conditions, baseUrl);
    } catch (err) {
      console.error(`  ❌ Failed to send alert SMS to ${subscriber.contact}:`, err.message);
      ok = false;
    }
    try {
      await sendEmail(subscriber.both_email, spot, conditions, subscriber.token, baseUrl);
    } catch (err) {
      console.error(`  ❌ Failed to send alert email to ${subscriber.both_email}:`, err.message);
      ok = false;
    }
    return ok;
  }

  return false;
}

module.exports = { notify, isDaylightHours };
