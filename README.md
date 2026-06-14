# 🤙 Dude, It's Firing!

SMS and email surf alerts for 274 US spots across California, the East Coast, Florida, and Hawaii. Checks NOAA buoy data, live wind, and real-time tide predictions every 3 hours. Only sends an alert when conditions score 7/10 or above — roughly 25–50 times per surf season per spot.

**Running cost: ~$5/mo (Railway) + ~$0.0075/SMS (Twilio). Email is free.**

---

## What you need before you start (15 minutes total)

### 1. Node.js ≥ 18
Check: `node --version`
Install if needed: https://nodejs.org

### 2. A Railway account (free to start)
https://railway.app — this is where the server runs.

### 3. Three free API keys

| Service | What it does | Sign up | Cost |
|---|---|---|---|
| **OpenWeatherMap** | Live wind data at each spot | openweathermap.org/api → "Free" plan | Free (1,000 calls/day) |
| **Twilio** | Sends SMS alerts | twilio.com/try-twilio | ~$0.0075/SMS in US |
| **Gmail App Password** | Sends email alerts | Your Google Account → Security → 2-Step Verification → App Passwords | Free |

> You only need Twilio if you want SMS. You only need Gmail if you want email. Most people want both.

---

## Setup

### Step 1 — Download and install

Unzip the project, then:

```bash
cd dudeitsfiring
npm install
```

### Step 2 — Create your .env file

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in your keys:

```
OPENWEATHER_API_KEY=abc123...        # from openweathermap.org
TWILIO_ACCOUNT_SID=ACxxxxxxxx...     # from twilio.com console
TWILIO_AUTH_TOKEN=xxxxxxxx...        # from twilio.com console
TWILIO_FROM_NUMBER=+15555551234      # your Twilio phone number
SMTP_USER=you@gmail.com              # your Gmail address
SMTP_PASS=abcd efgh ijkl mnop        # Gmail App Password (16 chars, spaces ok)
```

> **Gmail App Password:** Go to myaccount.google.com → Security → 2-Step Verification → App Passwords. Create one called "Dude Its Firing". Copy the 16-character code exactly as shown.

### Step 3 — Test locally

```bash
# Start the server
npm start

# In a browser, open:
# http://localhost:3000
# You should see the subscription page.

# In a second terminal, manually trigger a condition check right now:
npm run check
# This hits the live buoys and prints results for all 274 spots.
# Expect it to take 2-3 minutes to check all spots.
```

### Step 4 — Add a test subscriber

1. Open http://localhost:3000
2. Enter your name and your own phone number or email
3. Pick a spot you know well (Trestles, Pipeline, etc.)
4. Click **"Text me when it's firing"**
5. Run `npm run check` again — if conditions are currently good at that spot, you'll get a message

---

## Deploy to Railway

Railway runs the server 24/7 and handles the cron job automatically — no separate worker needed.

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOURUSERNAME/dudeitsfiring.git
git push -u origin main
```

### Step 2 — Connect to Railway

1. Go to railway.app and click **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `dudeitsfiring` repository
4. Railway will detect `npm start` automatically and deploy

### Step 3 — Add environment variables

In Railway dashboard → your project → **Variables** tab → add each line from your `.env` file:

```
OPENWEATHER_API_KEY     = your_key
TWILIO_ACCOUNT_SID      = your_sid
TWILIO_AUTH_TOKEN       = your_token
TWILIO_FROM_NUMBER      = +1xxxxxxxxxx
SMTP_USER               = you@gmail.com
SMTP_PASS               = your_app_password
BASE_URL                = https://your-project.up.railway.app
ADMIN_SECRET            = pick_any_password_here
ALERT_COOLDOWN_HOURS    = 6
CRON_SCHEDULE           = 0 */3 * * *
```

> `BASE_URL` is the public URL Railway gives your project — find it in the Railway dashboard under **Settings → Domain**. It looks like `https://dudeitsfiring-production.up.railway.app`. This is used to generate unsubscribe links in alerts.

> `ADMIN_SECRET` — pick any password. You'll use it to access the admin endpoints.

### Step 4 — Verify it's running

Railway will show logs in the dashboard. You should see:

```
🤙 Dude, it's Firing!
http://localhost:3000
274 spots · Cron: 0 */3 * * *
```

Visit your Railway public URL — you should see the subscription page live.

---

## How the alert logic works

Every 3 hours the cron job runs and checks all 274 spots:

```
For each spot:
  1. Fetch NOAA buoy → wave height, swell period, swell direction
  2. Fetch OpenWeatherMap → wind speed + direction
  3. Fetch NOAA Tides API → current tide, movement, 5-hour window
  4. Score conditions 0–100:
       Wave height   0–35 pts  (scales from minimum → 2× minimum)
       Swell period  0–25 pts  (scales from minimum → 1.5× minimum)
       Swell direction 0–20 pts  (±33° tolerance around ideal)
       Wind          0–15 pts  (offshore/glassy = full, cross = partial)
       Tide          0–5  pts  (in-range bonus)
  5. Hard gates — ANY of these = no alert:
       • Wave below spot minimum
       • Period below spot minimum
       • Swell direction outside ideal window
       • Wind onshore >8kts OR any wind >13kts (15mph)
       • Tide outside spot's ideal range
       • Tide won't hold for 5 hours
  6. If score ≥ 72 AND no hard gates failed:
       → Check 6hr cooldown (don't re-alert same spot twice in 6hrs)
       → Find all subscribers for this spot
       → Send SMS (daylight hours only, 6am–8pm spot's local time)
       → Send email (any time)
       → Log alert to database
```

Score 72 = 7/10 quality. Score 85+ = Epic (8.5/10+). You'll never get a text for anything below genuinely firing.

---

## Spot coverage

| Coast | Spots | Data source |
|---|---|---|
| California (Far NorCal → San Diego) | 101 | NOAA NDBC buoys |
| East Coast (Maine → Georgia) | 58 | NOAA NDBC buoys |
| Florida (Atlantic coast) | 29 | NOAA NDBC buoys |
| Hawaii (all 7 rideable islands) | 86 | NOAA NDBC buoys |
| **Total** | **274** | |

All US spots use free NOAA buoy data — no API key, no rate limit, no cost ever.

---

## Alert frequency (estimated)

Based on 30-year NDBC climatological data, score ≥72, 6hr cooldown, daylight hours only:

| Spot | Est. alerts/year |
|---|---|
| Steamer Lane (Santa Cruz) | ~44 |
| Trestles (Lowers) | ~39 |
| Pipeline | ~69 (5-month season) |
| New Smyrna Beach | ~49 |
| Montauk (Ditch Plains) | ~30 |
| Most East Coast beach breaks | 25–40 |

---

## Big wave spots

These spots have high minimums and only fire when they're genuinely breaking at scale:

| Spot | Minimum |
|---|---|
| Mavericks | 15ft / 16s |
| Waimea Bay | 15ft / 16s |
| Pe'ahi (Jaws) | 20ft / 17s |
| The Wedge | 5ft / 13s (low tide only) |

---

## Admin endpoints

All require `?secret=your_admin_secret` or header `x-admin-secret: your_admin_secret`:

```bash
# List all subscribers
curl https://your-site.up.railway.app/api/admin/subscribers?secret=yourpassword

# Recent alert log
curl https://your-site.up.railway.app/api/admin/alerts?secret=yourpassword

# Manually trigger a condition check right now
curl -X POST https://your-site.up.railway.app/api/admin/check-now?secret=yourpassword

# Live conditions for a specific spot
curl https://your-site.up.railway.app/api/conditions/trestles
curl https://your-site.up.railway.app/api/conditions/pipeline
curl https://your-site.up.railway.app/api/conditions/steamerlane
```

Spot IDs match the `id` field in the spots files (e.g. `trestles`, `pipeline`, `mavericks`, `narragansett`, `montauk`).

---

## Customizing a spot's thresholds

Open `src/spots-california.js` (or east coast / florida / hawaii) and find the spot. Every field is editable:

```js
{
  id:               "trestles",
  name:             "Trestles (Lowers)",
  minHeight:        5,        // ft — minimum wave height to fire
  minPeriod:        13,       // seconds — minimum swell period
  maxWindKts:       13,       // knots — hard cap (never exceed 13)
  idealSwell:       ["NW","W","SW"],  // compass directions that work
  offshoreWindFrom: 45,       // degrees FROM WHICH offshore wind blows
  tideStation:      "9410230",// NOAA CO-OPS station ID
  tideMin:          1.0,      // ft MLLW — minimum acceptable tide
  tideMax:          3.5,      // ft MLLW — maximum acceptable tide
  tideMovement:     "falling",// "rising", "falling", or "any"
}
```

After any change: redeploy to Railway by pushing to GitHub (`git push`).

---

## Adding a new spot

1. Find the nearest NOAA NDBC buoy: ndbc.noaa.gov
2. Find the nearest NOAA tide station: tidesandcurrents.noaa.gov
3. Add an entry to the appropriate spots file
4. Push to GitHub — it appears on the subscription page automatically

---

## File structure

```
dudeitsfiring/
├── src/
│   ├── server.js          — Express app + cron scheduler
│   ├── checker.js         — Condition check loop (runs every 3hrs)
│   ├── fetcher.js         — NOAA buoy + wind + tide API calls + scorer
│   ├── notifier.js        — SMS (Twilio) + email (nodemailer/Gmail)
│   ├── db.js              — SQLite: subscribers, alert log, cooldown
│   ├── spots.js           — Master index (combines all regions)
│   ├── spots-california.js — 101 CA spots with tuned thresholds
│   ├── spots-eastcoast.js  — 58 East Coast spots ME→GA
│   ├── spots-florida.js    — 29 Florida Atlantic coast spots
│   └── spots-hawaii.js     — 86 Hawaii spots, all major islands
├── public/
│   └── index.html         — Subscription landing page
├── .env.example           — Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## Troubleshooting

**"No wave data from buoy XXXXX"**
The buoy is temporarily offline. This is normal — NOAA buoys go down for maintenance. The spot is skipped and retried at the next 3-hour check.

**SMS not sending**
- Check Twilio dashboard for error logs
- Verify `TWILIO_FROM_NUMBER` is the correct format: `+15555551234`
- Twilio trial accounts can only send to verified numbers — upgrade to a paid account for real users

**Email landing in spam**
- Use a Gmail App Password, not your real password
- Consider setting up a custom domain for `EMAIL_FROM` once you have users

**Alerts firing too often or not enough**
Adjust `minHeight`, `minPeriod`, or `tideMin/tideMax` for the specific spot. Redeploy by pushing to GitHub.

**Check what conditions look like right now**
```bash
curl https://your-site.up.railway.app/api/conditions/trestles
```
This returns the live score, all gate results, and what's blocking or passing.

---

## Cost summary

| Item | Cost |
|---|---|
| Railway hosting | ~$5/month |
| Twilio SMS (US) | $0.0075/message |
| OpenWeatherMap | Free (1,000 calls/day) |
| NOAA buoy data | Free forever |
| NOAA tide data | Free forever |
| Gmail SMTP | Free |
| **At 500 subscribers, 40 alerts/season each** | **~$150/season in SMS** |

At $4.99/month subscription: 500 users = $2,495/month revenue vs ~$25/month infrastructure + SMS costs.
