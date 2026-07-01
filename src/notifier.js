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
function buildWelcomeEmailBody(firstName, spotNames, unsubscribeUrl) {
  const greeting = firstName ? firstName : 'there';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You're in.</title>
  <style>
    body { margin:0;padding:0;background:#F0F4F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; }
    .wrapper { max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .hero img { width:100%;display:block; }
    .hero-text { background:#ffffff;padding:32px 40px 8px;text-align:center; }
    .hero-text h1 { color:#0D2B45;font-size:38px;font-weight:900;margin:0 0 8px;letter-spacing:-0.5px; }
    .hero-text p { color:#4A5568;font-size:16px;margin:0; }
    .body { padding:32px 40px 40px; }
    .greeting { font-size:18px;color:#0D2B45;font-weight:700;margin-bottom:16px; }
    .body p { font-size:15px;color:#4A5568;line-height:1.7;margin:0 0 20px; }
    .spots-box { background:#F0F8F4;border-left:4px solid #0A5C45;border-radius:0 12px 12px 0;padding:16px 20px;margin:20px 0;font-size:14px;font-weight:600;color:#0A5C45;line-height:1.6; }
    .alert-preview { background:#F0F7FF;border-left:4px solid #007AFF;border-radius:0 12px 12px 0;padding:20px 24px;margin:28px 0; }
    .alert-time { font-size:12px;color:#888;margin-bottom:8px; }
    .alert-bubble { background:#007AFF;color:white;border-radius:18px 18px 18px 4px;padding:14px 18px;display:inline-block;font-size:14px;line-height:1.6;max-width:100%; }
    .alert-bubble strong { display:block;font-size:16px;margin-bottom:4px; }
    .section-title { font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#007AFF;margin:32px 0 12px; }
    .expect-item { display:flex;gap:14px;margin-bottom:16px;align-items:flex-start; }
    .expect-icon { font-size:20px;flex-shrink:0;margin-top:2px; }
    .expect-text { font-size:14px;color:#4A5568;line-height:1.6; }
    .expect-text strong { color:#0D2B45; }
    .share-box { background:#FFF8ED;border:1.5px solid #FFD97A;border-radius:12px;padding:24px;margin:32px 0;text-align:center; }
    .share-box p { font-size:14px;color:#7A5C00;margin:0 0 16px;line-height:1.6; }
    .share-btn { display:inline-block;background:#007AFF;color:white;text-decoration:none;padding:12px 28px;border-radius:100px;font-size:14px;font-weight:600; }
    .bottom-wave img { width:100%;display:block; }
    .bottom-bar { background:#ffffff;padding:24px 40px 28px;display:flex;align-items:center;justify-content:space-between;gap:20px; }
    .bottom-bar img { width:160px;height:auto;flex-shrink:0; }
    .bottom-bar-text { font-size:12px;color:#888;line-height:1.7;text-align:right; }
    .bottom-bar-text a { color:#888;text-decoration:underline; }
    @media(max-width:600px){
      .wrapper{margin:0;border-radius:0;}
      .hero-text{padding:24px 20px 4px;}
      .hero-text h1{font-size:28px;}
      .body{padding:24px 20px 32px;}
      .bottom-bar{flex-direction:column;align-items:flex-start;padding:20px;}
      .bottom-bar-text{text-align:left;}
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="hero">
      <img src="https://dudeitsfiring.com/final-bg.jpg" alt="firing waves">
    </div>
    <div class="hero-text">
      <h1>You're in. 🤙</h1>
      <p>We're watching your spots right now.</p>
    </div>
    <div class="body">
      <p class="greeting">Hey ${greeting},</p>
      <p>Welcome to the crew. From this moment on, we're watching your spots around the clock — wave height, swell direction, wind, tide — all of it. The second conditions hit firing levels, you'll get a text. No checking, no forecasting, no wasted drives.</p>
      <div class="spots-box">${spotNames}</div>
      <p>This is what that text looks like when it lands:</p>
      <div class="alert-preview">
        <div class="alert-time">Today 6:47 AM</div>
        <div class="alert-bubble">
          <strong>🤙 Dude, It's Firing!! 🔥</strong>
          Trestles · 5ft · 13s · SW swell 🌊<br>
          Glassy · Tide dropping perfectly<br>
          GO NOW! — conditions are dialed 🏄
        </div>
      </div>
      <p>When you see that — move. We never send it unless it means it.</p>
      <div class="section-title">What to expect</div>
      <div class="expect-item">
        <div class="expect-icon">📅</div>
        <div class="expect-text"><strong>Alerts are seasonal.</strong> Your spots fire when the swell cooperates — NorCal and Hawaii go off in fall and winter, the East Coast peaks in late summer through fall, and SoCal catches south swells in summer. If it's quiet for a few weeks, that's normal. When it fires, you'll know.</div>
      </div>
      <div class="expect-item">
        <div class="expect-icon">⏰</div>
        <div class="expect-text"><strong>Texts arrive between 6am and 8pm local time only.</strong> Nobody needs a 3am wake-up call. We check conditions every few hours and only alert during daylight.</div>
      </div>
      <div class="expect-item">
        <div class="expect-icon">🚫</div>
        <div class="expect-text"><strong>We never cry wolf.</strong> Our threshold is strict — wave height, period, swell direction, wind, and tide all have to line up. You won't get a text for mediocre surf. When we say it's firing, it's firing.</div>
      </div>
      <div class="expect-item">
        <div class="expect-icon">📱</div>
        <div class="expect-text"><strong>To stop alerts anytime,</strong> just reply STOP to any text. No apps, no logins, no hassle.</div>
      </div>
      <div class="share-box">
        <p>🤙 <strong>Know someone who's missing sessions?</strong><br>
        Your surf crew should be in on this. Send them the link — for every friend who signs up, you're basically the hero who got them out of bed on the best morning of the year.</p>
        <a href="https://dudeitsfiring.com" class="share-btn">Share dudeitsfiring.com</a>
      </div>
      <p>That's it. No dashboard to check, no app to download, no forecast to interpret. Just go surf when we tell you to.</p>
      <p>See you in the water. 🌊</p>
      <p style="color:#0D2B45;font-weight:700;">— The Dude It's Firing crew</p>
    </div>
    <div class="bottom-wave">
      <img src="https://dudeitsfiring.com/wave-bg.jpg" alt="waves">
    </div>
    <div class="bottom-bar">
      <img src="https://dudeitsfiring.com/logo.png" alt="Dude, It's Firing!">
      <div class="bottom-bar-text">
        You're receiving this because you signed up at <a href="https://dudeitsfiring.com">dudeitsfiring.com</a><br>
        To unsubscribe from surf alerts, reply STOP to any text.<br>
        <a href="${unsubscribeUrl}">Unsubscribe from emails</a><br>
        © 2026 Dude, It's Firing! · Carmel-by-the-Sea, CA
      </div>
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
async function sendWelcomeEmail(to, firstName, spotNames, token, baseUrl) {
  const unsubUrl = `${baseUrl}/unsubscribe/${token}`;
  const { error } = await getResend().emails.send({
    from:    FROM,
    to,
    subject: `🤙 You're in — Dude, It's Firing! is watching your spots`,
    html:    buildWelcomeEmailBody(firstName, spotNames, unsubUrl),
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
    await sendWelcomeEmail(subscriber.contact, subscriber.name, spotNames, token, baseUrl);
  } else if (subscriber.type === 'both') {
    await sendWelcomeSMS(subscriber, spotList, baseUrl);
    await sendWelcomeEmail(subscriber.both_email, subscriber.name, spotNames, token, baseUrl);
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
