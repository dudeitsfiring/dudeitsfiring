const nodemailer = require('nodemailer');

// ── Daylight hours check ──────────────────────────────────────
// SMS only sent 6am–8pm at the spot's local timezone
// Email is never suppressed — sits in inbox until opened
// Spots store a timezone field; fallback to America/Los_Angeles

function isDaylightHours(timezone) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const hour = new Date(localStr).getHours();
  return hour >= 6 && hour < 20; // 6:00am – 7:59pm local
}

// ── Email transporter ─────────────────────────────────────────

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

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
      <p style="margin:0;color:#7ECFB3;font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Dude, it's Firing!</p>
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
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#0A5C45;">${conditions.score.score}/100 — ${score.quality}</td></tr>
        ${buoy.waterTempC ? `<tr><td style="padding:10px 0;color:#888;font-size:13px;">Water temp</td>
            <td style="padding:10px 0;text-align:right;font-weight:600;color:#111;">${Math.round(buoy.waterTempC*9/5+32)}°F</td></tr>` : ''}
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#555;line-height:1.6;">
        <strong>Get in the water.</strong> Conditions checked at ${checkedAt}.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f9f9f7;border-top:1px solid #eee;">
      <p style="margin:0;font-size:12px;color:#999;">
        You subscribed to Dude, it's Firing! for ${spot.name}.
        <a href="${unsubscribeUrl}" style="color:#0A5C45;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body></html>`.trim();
}

async function sendEmail(subscriber, spot, conditions, baseUrl) {
  const unsubUrl = `${baseUrl}/unsubscribe/${subscriber.token}`;
  const { score } = conditions;
  await getTransporter().sendMail({
    from:    process.env.EMAIL_FROM || 'Dude Its Firing <noreply@dudeitsfiring.com>',
    to:      subscriber.contact,
    subject: `🌊 ${score.quality} surf at ${spot.name} — go now`,
    html:    buildEmailBody(spot, conditions, unsubUrl),
  });
  console.log(`  ✉️  Email sent to ${subscriber.contact}`);
}

// ── SMS ───────────────────────────────────────────────────────

async function sendSMS(subscriber, spot, conditions, baseUrl) {
  // Enforce daylight-only SMS — never wake someone up at 4am
  const tz = spot.timezone || 'America/Los_Angeles';
  if (!isDaylightHours(tz)) {
    const localTime = new Date().toLocaleTimeString('en-US', {
      timeZone: tz, hour:'numeric', minute:'2-digit', timeZoneName:'short'
    });
    console.log(`  ⏸️  SMS suppressed — currently ${localTime} at ${spot.location} (outside 6am–8pm). Email subscribers still notified.`);
    return;
  }

  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const { buoy, wind, score } = conditions;
  const unsubUrl = `${baseUrl}/unsubscribe/${subscriber.token}`;

  const body = [
    `🤙 Dude, it's firing at ${spot.name}!`,
    `${buoy.waveHeightFt}ft @ ${buoy.dominantPeriod||'?'}s · ${buoy.swellDirection||'?'} swell · Score:${score.score}/100`,
    wind.windSpeedKts !== null ? `Wind: ${wind.windDirection} ${wind.windSpeedKts}kts` : null,
    `Unsub: ${unsubUrl}`,
  ].filter(Boolean).join('\n');

  await twilio.messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER,
    to:   subscriber.contact,
  });
  console.log(`  📱 SMS sent to ${subscriber.contact}`);
}

// ── Format spot names for welcome message ─────────────────────
// Lists up to 5 spots by name; summarizes the rest to keep SMS
// short and avoid multi-segment overage on big plans (Nomad).
function formatSpotList(spotNames) {
  const names = (spotNames || '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length <= 5) return names.join(', ');
  const shown = names.slice(0, 5).join(', ');
  const remaining = names.length - 5;
  return `${shown}, and ${remaining} more spot${remaining === 1 ? '' : 's'}`;
}

// ── Welcome message ───────────────────────────────────────────

async function sendWelcome(subscriber, baseUrl, { spotNames, token }) {
  const unsubUrl = `${baseUrl}/unsubscribe/${token}`;
  const spotList = formatSpotList(spotNames);

  if (subscriber.type === 'sms') {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    await twilio.messages.create({
      body: `🤙 You're in! Welcome to Dude It's Firing! We're watching ${spotList} right now — the second any of them are firing, you'll get a text. Surf can be seasonal so give it time if it's quiet. When we text, go SURF.`,
      from: process.env.TWILIO_FROM_NUMBER,
      to:   subscriber.contact,
    });
    console.log(`  📱 Welcome SMS sent to ${subscriber.contact}`);
  } else if (subscriber.type === 'email') {
    await getTransporter().sendMail({
      from:    process.env.EMAIL_FROM || 'Dude Its Firing <noreply@dudeitsfiring.com>',
      to:      subscriber.contact,
      subject: `🤙 You're connected to Dude, It's Firing!`,
      html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:520px;margin:32px auto;padding:24px;background:#FAF8F3;">
        <h1 style="font-size:32px;color:#0D2B45">🤙 You're in!</h1>
        <p style="font-size:16px;color:#444;line-height:1.6">You're now connected to: <strong>${spotNames}</strong>.</p>
        <p style="font-size:16px;color:#444;line-height:1.6">We're watching 24/7. The moment conditions are worth paddling out — you'll get an alert.</p>
        <p style="font-size:14px;color:#888;">Never miss another session. 🌊</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999"><a href="${unsubUrl}" style="color:#1E6FA8">Unsubscribe</a></p>
      </body></html>`,
    });
    console.log(`  ✉️  Welcome email sent to ${subscriber.contact}`);
  }
}

// ── Dispatcher ────────────────────────────────────────────────

async function notify(subscriber, spot, conditions, baseUrl, options = {}) {
  try {
    if (options.isWelcome) {
      await sendWelcome(subscriber, baseUrl, options);
      return true;
    }
    if (subscriber.type === 'email') await sendEmail(subscriber, spot, conditions, baseUrl);
    else if (subscriber.type === 'sms') await sendSMS(subscriber, spot, conditions, baseUrl);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to notify ${subscriber.contact}:`, err.message);
    return false;
  }
}

module.exports = { notify, isDaylightHours };
