require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Price IDs — created in Stripe dashboard or via API
// We create them programmatically on first run
const PRICE_CONFIG = {
  locals: { amount: 1200, name: 'Locals Only',     description: '5 spots · Less than a burrito' },
  coast:  { amount: 2200, name: 'Coast Rat',        description: '10 spots · Can\'t stop the froth' },
  nomad:  { amount: 3900, name: 'Full Send Nomad',  description: 'Unlimited spots · Chase swell anywhere' },
};

// ── Create Stripe checkout session ────────────────────────────
async function createCheckoutSession({ name, contact, type, tier, spots, optEmail, bothEmail, baseUrl }) {
  const config = PRICE_CONFIG[tier] || PRICE_CONFIG.locals;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Dude, It's Firing! — ${config.name}`,
          description: `${config.description} · By completing this purchase you agree to our Terms of Service and Privacy Policy at dudeitsfiring.com/terms`,
          images: [`${baseUrl}/logo.png`],
        },
        unit_amount: config.amount,
        recurring: { interval: 'year' },
      },
      quantity: 1,
    }],
    subscription_data: {
      metadata: {
        name,
        contact,
        type,
        tier,
        spots: JSON.stringify(spots),
        optEmail: optEmail || '',
        bothEmail: bothEmail || '',
      },
    },
    customer_email: type === 'email' ? contact : (type === 'both' ? bothEmail : undefined),
    metadata: {
      name,
      contact,
      type,
      tier,
      spots: JSON.stringify(spots),
      optEmail: optEmail || '',
      bothEmail: bothEmail || '',
    },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?cancelled=true`,
  });

  return session;
}

// ── Handle Stripe webhook ─────────────────────────────────────
// Called when payment succeeds, subscription renews, or cancels
async function handleWebhook(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch(err) {
    throw new Error(`Webhook signature failed: ${err.message}`);
  }

  return event;
}

// ── Cancel subscription after first alert fires ───────────────
// Removes trial and starts billing immediately after first alert
async function endTrialNow(subscriptionId) {
  try {
    await stripe.subscriptions.update(subscriptionId, {
      trial_end: 'now',
    });
    console.log(`Trial ended for subscription ${subscriptionId} — first alert fired`);
  } catch(err) {
    console.error(`Failed to end trial: ${err.message}`);
  }
}

module.exports = { createCheckoutSession, handleWebhook, endTrialNow, PRICE_CONFIG };
