const path = require('path');
const fs   = require('fs');

// Use better-sqlite3 if available, fallback to a simple JSON store
// This ensures Railway compatibility without native compilation issues
const DB_PATH = path.join(__dirname, '..', 'dudeitsfiring.db');
const JSON_PATH = path.join(__dirname, '..', 'dudeitsfiring-data.json');

let db;
let useJSON = false;

try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      contact     TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('sms','email','both')),
      tier        TEXT NOT NULL DEFAULT 'locals',
      spots       TEXT NOT NULL,
      active      INTEGER DEFAULT 1,
      token       TEXT UNIQUE,
      both_email  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alert_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id       TEXT NOT NULL,
      subscriber_id INTEGER,
      conditions    TEXT,
      sent_at       TEXT DEFAULT (datetime('now'))
    );
  `);
  try { db.exec(`ALTER TABLE subscribers ADD COLUMN tier TEXT NOT NULL DEFAULT 'locals'`); } catch(e) {}
  try { db.exec(`ALTER TABLE subscribers ADD COLUMN both_email TEXT`); } catch(e) {}
  console.log('DB: using better-sqlite3');
} catch(e) {
  useJSON = true;
  console.log('DB: using JSON fallback store (better-sqlite3 unavailable)');
}

// ── JSON fallback store ───────────────────────────────────────
function loadJSON() {
  try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } 
  catch { return { subscribers: [], alerts: [], nextId: 1 }; }
}
function saveJSON(data) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// ── Tier config ───────────────────────────────────────────────
const TIERS = {
  locals: { label:'Locals Only',     spotLimit:5,         price:12 },
  coast:  { label:'Coast Rat',       spotLimit:10,        price:22 },
  nomad:  { label:'Full Send Nomad', spotLimit:Infinity,  price:39 },
};

function spotLimitForTier(tier) { return TIERS[tier]?.spotLimit ?? 5; }

// ── Subscribers ───────────────────────────────────────────────
function addSubscriber({ name, contact, type, tier, spots, stripeSubscriptionId, bothEmail }) {
  const limit = spotLimitForTier(tier);
  if (spots.length > limit)
    throw new Error(`Tier "${tier}" allows max ${limit} spots. You selected ${spots.length}.`);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const created_at = new Date().toISOString();

  if (!useJSON) {
    db.prepare(`INSERT INTO subscribers (name,contact,type,tier,spots,token,both_email) VALUES (@name,@contact,@type,@tier,@spots,@token,@both_email)`)
      .run({ name, contact, type, tier: tier||'locals', spots: JSON.stringify(spots), token, both_email: bothEmail||null });
  } else {
    const data = loadJSON();
    data.subscribers.push({ id: data.nextId++, name, contact, type, tier: tier||'locals', spots: JSON.stringify(spots), token, both_email: bothEmail||null, stripe_subscription_id: stripeSubscriptionId||null, active: 1, created_at });
    saveJSON(data);
  }
  return token;
}

function getSubscribersForSpot(spotId) {
  const rows = useJSON
    ? loadJSON().subscribers.filter(r => r.active)
    : db.prepare(`SELECT * FROM subscribers WHERE active = 1`).all();
  return rows.filter(r => { try { return JSON.parse(r.spots).includes(spotId); } catch { return false; } });
}

function unsubscribe(token) {
  if (!useJSON) {
    return db.prepare(`UPDATE subscribers SET active = 0 WHERE token = ?`).run(token).changes > 0;
  } else {
    const data = loadJSON();
    const sub = data.subscribers.find(s => s.token === token);
    if (sub) { sub.active = 0; saveJSON(data); return true; }
    return false;
  }
}

function getAllSubscribers() {
  if (!useJSON) return db.prepare(`SELECT * FROM subscribers ORDER BY created_at DESC`).all();
  return loadJSON().subscribers.sort((a,b) => b.created_at?.localeCompare(a.created_at));
}

// ── Alert log / cooldown ──────────────────────────────────────
function wasAlertedRecently(spotId, cooldownHours = 6) {
  if (!useJSON) {
    const row = db.prepare(`SELECT sent_at FROM alert_log WHERE spot_id = ? ORDER BY sent_at DESC LIMIT 1`).get(spotId);
    if (!row) return false;
    return (Date.now() - new Date(row.sent_at).getTime()) / 36e5 < cooldownHours;
  } else {
    const alerts = loadJSON().alerts.filter(a => a.spot_id === spotId);
    if (!alerts.length) return false;
    const last = alerts.sort((a,b) => b.sent_at?.localeCompare(a.sent_at))[0];
    return (Date.now() - new Date(last.sent_at).getTime()) / 36e5 < cooldownHours;
  }
}

function logAlert(spotId, subscriberId, conditions) {
  const sent_at = new Date().toISOString();
  if (!useJSON) {
    db.prepare(`INSERT INTO alert_log (spot_id,subscriber_id,conditions) VALUES (?,?,?)`).run(spotId, subscriberId, JSON.stringify(conditions));
  } else {
    const data = loadJSON();
    data.alerts.push({ id: data.nextId++, spot_id: spotId, subscriber_id: subscriberId, conditions: JSON.stringify(conditions), sent_at });
    saveJSON(data);
  }
}

function getRecentAlerts(limit = 50) {
  if (!useJSON) {
    return db.prepare(`SELECT al.*, s.name as subscriber_name, s.contact, s.tier FROM alert_log al LEFT JOIN subscribers s ON s.id = al.subscriber_id ORDER BY al.sent_at DESC LIMIT ?`).all(limit);
  } else {
    const data = loadJSON();
    return data.alerts.sort((a,b) => b.sent_at?.localeCompare(a.sent_at)).slice(0, limit);
  }
}

function deactivateByStripeId(stripeSubscriptionId) {
  if (!useJSON) {
    return db.prepare(`UPDATE subscribers SET active = 0 WHERE stripe_subscription_id = ?`).run(stripeSubscriptionId).changes > 0;
  } else {
    const data = loadJSON();
    const sub = data.subscribers.find(s => s.stripe_subscription_id === stripeSubscriptionId);
    if (sub) { sub.active = 0; saveJSON(data); return true; }
    return false;
  }
}

module.exports = {
  addSubscriber, getSubscribersForSpot, unsubscribe, deactivateByStripeId,
  getAllSubscribers, wasAlertedRecently, logAlert, getRecentAlerts,
  TIERS, spotLimitForTier,
};
