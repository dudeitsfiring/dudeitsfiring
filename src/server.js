require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const cron     = require('node-cron');
const path     = require('path');
const db       = require('./db');
const { checkAllSpots } = require('./checker');
const { notify } = require('./notifier');
const { createCheckoutSession, handleWebhook, endTrialNow } = require('./stripe');
const allSpots = require('./spots');

const app  = express();
const PORT = process.env.PORT || 3000;
const CRON = process.env.CRON_SCHEDULE || '0 */3 * * *';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Raw body for Stripe webhooks ──────────────────────────────
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Test Stripe connection ────────────────────────────────────
app.get('/api/admin/stripe-test', requireAdmin, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const balance = await stripe.balance.retrieve();
    res.json({ 
      ok: true, 
      keyPrefix: process.env.STRIPE_SECRET_KEY?.slice(0,14) + '...',
      mode: process.env.STRIPE_SECRET_KEY?.includes('test') ? 'test' : 'live',
      balance: balance.available
    });
  } catch(err) {
    res.json({ ok: false, error: err.message, keyPrefix: process.env.STRIPE_SECRET_KEY?.slice(0,14) + '...' });
  }
});


// ── Legal pages ───────────────────────────────────────────────
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html')));

// ── Subscribe → create Stripe checkout session ────────────────
app.post('/subscribe', async (req, res) => {
  const { name, contact, type, tier, spots: spotIds } = req.body;

  // Normalize phone number — ensure + prefix
  const normalizedContact = (type === 'sms' && contact && !contact.startsWith('+'))
    ? '+' + contact.replace(/[^0-9]/g, '')
    : contact;

  if (!name || !contact || !type || !spotIds || !spotIds.length)
    return res.status(400).json({ error: 'Missing required fields' });
  if (!['sms','email'].includes(type))
    return res.status(400).json({ error: 'type must be sms or email' });
  if (!['locals','coast','nomad'].includes(tier||'locals'))
    return res.status(400).json({ error: 'Invalid tier' });
  if (type==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))
    return res.status(400).json({ error: 'Invalid email address' });
  if (type==='sms' && !/^\+?[1-9]\d{7,14}$/.test(contact.replace(/[\s\-\(\)]/g,'')))
    return res.status(400).json({ error: 'Invalid phone number — use +1xxxxxxxxxx format' });

  const validIds = new Set(allSpots.map(s => s.id));
  const invalidSpots = spotIds.filter(id => !validIds.has(id));
  if (invalidSpots.length)
    return res.status(400).json({ error: `Unknown spot IDs: ${invalidSpots.join(', ')}` });

  try {
    // Create Stripe checkout session — user pays after trial
    const session = await createCheckoutSession({
      name, contact: normalizedContact, type, tier: tier||'locals', spots: spotIds, baseUrl: BASE_URL
    });
    res.json({ success: true, checkoutUrl: session.url });
  } catch(err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment setup failed — please try again.' });
  }
});

// ── Stripe webhook ────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const { handleWebhook } = require('./stripe');
    event = await handleWebhook(req.body, sig);
  } catch(err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  // Handle events
  switch(event.type) {

    case 'checkout.session.completed': {
      // Payment setup complete — add subscriber to database
      const session = event.data.object;
      const { name, contact, type, tier, spots } = session.metadata;
      try {
        const token = db.addSubscriber({
          name,
          contact,
          type,
          tier: tier || 'locals',
          spots: JSON.parse(spots),
          stripeSubscriptionId: session.subscription,
        });

        // Send welcome text/email immediately
        const spotList = JSON.parse(spots);
        const spotNames = spotList
          .map(id => allSpots.find(s => s.id === id)?.name || id)
          .join(', ');

        const welcomeSub = { id: null, name, contact, type, tier };
        await notify(welcomeSub, null, null, BASE_URL, {
          isWelcome: true,
          spotNames,
          token,
        });

        console.log(`✅ New subscriber: ${name} (${tier}) — ${spotNames}`);
      } catch(err) {
        console.error('Failed to add subscriber after payment:', err);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription cancelled — deactivate subscriber
      const sub = event.data.object;
      const subscriptionId = sub.id;
      db.deactivateByStripeId(subscriptionId);
      console.log(`❌ Subscription cancelled: ${subscriptionId}`);
      break;
    }

    case 'invoice.payment_failed': {
      // Payment failed — could notify subscriber
      console.log(`⚠️ Payment failed for subscription: ${event.data.object.subscription}`);
      break;
    }
  }

  res.json({ received: true });
});

// ── Success page ──────────────────────────────────────────────
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>You're in! — Dude, It's Firing!</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;text-align:center;min-height:100vh;background:#FAF8F3;color:#0D1F2D;display:flex;align-items:center;justify-content:center;padding:40px 24px}
    .card{background:#fff;border-radius:24px;padding:48px 40px;max-width:460px;width:100%;box-shadow:0 8px 48px rgba(13,43,69,0.10)}
    .logo-wrap{margin-bottom:28px}
    .logo-wrap img{width:260px;height:auto;display:block;margin:0 auto}
    .divider{width:48px;height:3px;background:#007AFF;border-radius:2px;margin:0 auto 28px}
    .heading{font-family:'Barlow Condensed',sans-serif;font-size:48px;font-weight:900;color:#0D2B45;margin-bottom:8px;line-height:1}
    .sub{font-size:18px;font-weight:600;color:#0D2B45;margin-bottom:16px}
    .body{color:#5A6E7A;font-size:16px;line-height:1.7;margin-bottom:12px}
    .patience{font-size:14px;color:#5A6E7A;font-style:italic;margin-bottom:32px;line-height:1.6;padding:14px 18px;background:#F0F7FF;border-radius:12px;border-left:3px solid #007AFF}
    .btn{display:inline-block;background:#007AFF;color:white;padding:16px 40px;border-radius:100px;font-weight:600;text-decoration:none;font-size:16px;transition:opacity .15s}
    .btn:hover{opacity:.88}
    .fine{font-size:12px;color:#A0B0C0;margin-top:20px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-wrap">
      <img src="/logo.png" alt="Dude, It's Firing!">
    </div>
    <div class="divider"></div>
    <div class="sub" style="font-size:28px;margin-bottom:16px">Stoked you are here!</div>
    <p class="body">We're watching your spots right now. The moment conditions are Firing! — you'll get a text. Check your phone for a welcome message.</p>
    <div class="patience">P.S. — if it's the off season for your spots, give it a few weeks. We never cry wolf. 🤙</div>
    <a class="btn" href="/">Back to home</a>
    <div class="fine">One-tap unsubscribe in every text · No spam · Ever</div>
  </div>
</body>
</html>`);
});

// ── Unsubscribe ───────────────────────────────────────────────
app.get('/unsubscribe/:token', (req, res) => {
  const ok = db.unsubscribe(req.params.token);
  res.send(ok
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
       <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@900&family=Inter:wght@400;600&display=swap" rel="stylesheet"></head>
       <body style="font-family:'Inter',sans-serif;text-align:center;padding:80px 24px;background:#FAF8F3;color:#0D1F2D">
         <div style="font-family:'Barlow Condensed',sans-serif;font-size:48px;font-weight:900;color:#1A4F7A;margin-bottom:12px">Dude, It's Firing!</div>
         <h2 style="font-size:22px;font-weight:700;margin-bottom:10px">You've been unsubscribed 🤙</h2>
         <p style="color:#5A6E7A;margin-bottom:28px">No more alerts. Hope you caught some good ones.</p>
         <a href="/" style="background:#007AFF;color:white;padding:12px 28px;border-radius:100px;font-weight:600;text-decoration:none;font-size:15px">Re-subscribe</a>
       </body></html>`
    : `<html><body style="font-family:system-ui;text-align:center;padding:60px">Token not found.</body></html>`
  );
});

// ── Spots API ─────────────────────────────────────────────────
app.get('/api/spots', (req, res) => {
  const grouped = {};
  allSpots.forEach(s => {
    if (!grouped[s.region]) grouped[s.region] = [];
    grouped[s.region].push({ id:s.id, name:s.name, location:s.location });
  });
  res.json({ total: allSpots.length, regions: grouped });
});

app.get('/api/tiers', (req, res) => res.json(db.TIERS));

app.get('/api/conditions/:spotId', async (req, res) => {
  const spot = allSpots.find(s => s.id === req.params.spotId);
  if (!spot) return res.status(404).json({ error: 'Spot not found' });
  try {
    const { fetchSpotConditions } = require('./fetcher');
    res.json(await fetchSpotConditions(spot));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}
app.get('/api/admin/subscribers', requireAdmin, (req,res) => res.json(db.getAllSubscribers()));
app.get('/api/admin/alerts',      requireAdmin, (req,res) => res.json(db.getRecentAlerts()));
app.post('/api/admin/check-now',  requireAdmin, (req,res) => {
  res.json({ message: 'Check triggered' });
  checkAllSpots().catch(console.error);
});

// ── Cron ──────────────────────────────────────────────────────
cron.schedule(CRON, () => {
  console.log(`⏰ ${new Date().toISOString()}`);
  checkAllSpots().catch(console.error);
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌──────────────────────────────────────┐
  │  🤙 Dude, it's Firing!                │
  │  http://localhost:${PORT}              │
  │  ${allSpots.length} spots · Cron: ${CRON}    │
  └──────────────────────────────────────┘
  `);
});
