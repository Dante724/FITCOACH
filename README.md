# FitCoach

Coach-led fitness, nutrition and yoga app: clients get an assigned coach, AI-drafted plans that the coach
approves, progress tracking, in-app chat, video calls and yoga pose checks.

- **backend/** — FastAPI + MongoDB (Motor). Photos are stored in MongoDB; no other storage needed.
- **frontend/** — React (Create React App via CRACO). Pose tracking (MediaPipe) is bundled into the build.
- **render.yaml** — Render Blueprint for both services. MongoDB is external (e.g. MongoDB Atlas).

## Deploy on Render

1. **MongoDB:** create a cluster (e.g. MongoDB Atlas), a database user, and allow access from anywhere
   (`0.0.0.0/0`) or from Render's outbound IPs. Copy the connection string.
2. **Render → New → Blueprint** → pick this repo. It creates `fitcoach-api` and `fitcoach-web`.
3. Fill in the prompted values:
   - `fitcoach-api`: `MONGO_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ chars), `CORS_ORIGINS` = your web URL
     (e.g. `https://fitcoach-web.onrender.com`), optional `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, Gmail, Razorpay.
   - `fitcoach-web`: `REACT_APP_BACKEND_URL` = your API URL (e.g. `https://fitcoach-api.onrender.com`).
4. Deploy. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then promote coaches in the Admin Console.

The API uses Render's **Starter** plan in `render.yaml`: free instances sleep, which would delay session
reminders and calls. `REACT_APP_BACKEND_URL` is baked in at build time — redeploy the web service after changing it.

## Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
2. **Authorized JavaScript origins:** your web URL (e.g. `https://fitcoach-web.onrender.com`) and, for local
   development, `http://localhost:3000`. No redirect URIs are needed.
3. Put the client ID (`…apps.googleusercontent.com`) in the API's `GOOGLE_CLIENT_ID`. The "Continue with Google"
   button appears automatically. Existing accounts with the same email are linked, not duplicated.

## Video calls

- Calls run inside the app (WebRTC): booked sessions and instant "Call now". The microphone is cleaned by
  **on-device AI noise removal** (RNNoise) — fans, traffic and kitchen noise are removed before audio leaves the
  phone; people can switch to the basic filter or off during a call. Dropped connections repair themselves, and
  both sides see connection quality, with a hint to turn the camera off on weak networks.
- **Set up a relay (TURN)** — without one, some mobile and office networks can't connect calls at all. Easiest is a
  managed relay with a free tier: set `METERED_DOMAIN` + `METERED_API_KEY` (metered.ca) or
  `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` on the API service. `TURN_URLS`/`TURN_USERNAME`/
  `TURN_CREDENTIAL` work for your own server. Credentials are fetched server-side and cached.
- **Test call setup** (`/call-check`, linked from Booking, the dashboard and the coach menu) checks camera,
  microphone, AI noise removal and the network before a session.
- Free-trial intro sessions wait for the coach to confirm them (switch off in Admin → Billing & payouts).

## Storage & backups

MongoDB Atlas's free tier holds 512 MB and has no automatic backups. (It doesn't sleep — it only pauses after 60
days without connections, and the API connects every minute.)

- **Photos, voice notes and pose snapshots** go to S3-compatible object storage when it's configured, so the
  database only holds text and numbers. Cloudflare R2 has 10 GB free: create a bucket, create an R2 API token
  with *Object Read & Write*, and set `S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`),
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Files are still served through the API, so only the
  right people can see them.
- **Admin → Insights → Storage & backups** shows how full the database is and moves existing files out of the
  database with one click. Admins get a notification at 80% and 95% full.
- **Backups:** "Download backup" there any time. With object storage set up, a backup is also saved every night
  at 03:00 IST to `backups/` in the bucket, keeping the latest 14.
- **Restore:** `python scripts/restore_backup.py <backup.json.gz> --mongo-url "<url>" --db fitcoach` (add
  `--replace` to overwrite an existing database).
- For production, a paid Atlas tier (Flex or M10) adds Atlas's own continuous backups — recommended once you
  have paying clients.

## Security note

Set `CORS_ORIGINS` to your website's address. The app signs requests with a header, never a cookie, and the
server only honours the login cookie for requests from your own site — so other websites can't act as a signed-in
user even if `CORS_ORIGINS` is missing.

## Passwords

- **Forgot password:** "Forgot password?" on the sign-in page emails a one-time link (valid 1 hour) to choose a new
  password. Needs the Gmail settings (`GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`). Resetting signs out the account's other
  devices. Links point to your website: set `APP_URL` (e.g. `https://fitcoach-web.onrender.com`), otherwise the first
  `CORS_ORIGINS` entry is used.
- **No email set up?** Admin Console → the key icon next to a person copies a reset link you can send them directly.
- **Change password:** Profile → Password. People who joined with Google can add a password there too.
- The main admin's password is always the `ADMIN_PASSWORD` setting on the server.

## Install as an app + notifications

FitCoach is an installable web app (PWA) with push notifications, so calls, session reminders, messages
and plan updates arrive even when it's closed — no app store needed.

- **Android / desktop Chrome & Edge:** an **Install app** button appears in the sidebar and in
  Profile → App & notifications. Then tap **Turn on** for notifications.
- **iPhone / iPad (iOS 16.4+):** in Safari tap **Share → Add to Home Screen**, open FitCoach from the
  Home Screen, then turn on notifications (Apple only allows web push for Home Screen apps).
- Incoming calls show **Answer / Decline** on the notification. Each device is linked to whoever is
  signed in and unlinked on logout.
- Push keys (VAPID) are generated on first start and stored in MongoDB; nothing to configure.
  Requires HTTPS in production (Render provides it).

## Payments & memberships (Razorpay)

- New clients get a free trial (7 days by default; a friend's referral link adds 7 more). When a
  membership ends there are 3 grace days, then workouts, yoga, chat, pose checks, food and meal plans
  show a renewal screen. Progress, photos and the membership page always stay open.
- **Admin → Billing & payouts** edits plan prices, durations, included sessions, session packs,
  trial/grace length, referral rewards and coach payout rates, and exports a monthly payout CSV.
- To take payments set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (test keys first). Clients can then
  subscribe (auto-renew) or pay once, and buy session packs.
- For auto-renewal, add a webhook in the Razorpay Dashboard → Webhooks pointing to
  `https://<your-api>.onrender.com/api/payments/webhook` with the events `subscription.charged`,
  `subscription.halted`, `subscription.cancelled` and `subscription.completed`,
  and put its secret in `RAZORPAY_WEBHOOK_SECRET`.

## Leads, trial and privacy

- **Free consultation:** the website has a "Book a free consultation" form. Requests appear under
  **Admin → Leads** (admins also get a notification). Leads are marked "Signed up" automatically when the
  person registers with the same email, and are deleted after 6 months.
- **Free trial:** Admin → Billing & payouts → "What the free trial includes" picks which features trial
  clients get (default: training plans, chat, food tracking) and how many free intro sessions (default 1).
- **Consent & privacy (DPDP Act):** sign-up asks for consent to health data (required), photo storage and
  offers (optional), with a timestamped audit log. Clients can download their data or delete their account
  from Profile → Privacy & data; admins can delete a client on request from the client's page.
- **Legal pages:** `/terms`, `/privacy`, `/refunds` and `/contact` (Razorpay checks for these). They fill in who
  runs FitCoach from these API env vars — the Admin Console warns until the required ones are set:
  `BUSINESS_NAME` (your full name if you're a sole proprietor), `BUSINESS_ADDRESS`, `GRIEVANCE_OFFICER`,
  `JURISDICTION_CITY`, `PRIVACY_CONTACT_EMAIL`, optional `CONTACT_PHONE`, `GSTIN` (only if registered) and
  `COACH_CREDENTIALS` (only certifications your coaches actually hold). The text is a careful plain-language
  starting point, not legal advice — have a lawyer review it, and edit the refund windows in
  `frontend/src/pages/Legal.js` if you want different ones.
- Use a **paid (billing-enabled) Gemini API key**: on the free tier Google may use prompts to improve its
  products, which the privacy policy doesn't allow for.
- **Insights:** Admin → Insights shows sign-ups, trial conversion, renewals, drop-offs, revenue, leads and
  coach reply times.

## Plan drafts & food estimates (no AI key needed)

FitCoach drafts plans with its own built-in engine (`backend/engine.py`) — free, no API key, nothing sent to an
outside AI service:
- **Nutrition:** calorie and protein targets (Mifflin–St Jeor × activity, adjusted for the goal) and a one-day
  Indian meal plan from a food table, respecting veg / egg / non-veg / vegan / Jain, allergies and dislikes.
- **Training:** a weekly split from goal, days per week, equipment and experience, skipping exercises that load
  listed injuries (knee, back, shoulder, wrist…). "Auto-draft adjustment" with no note progresses the plan.
- **Yoga:** a weekly practice sequenced warm-up → standing → balance → floor → rest, avoiding poses that clash
  with injuries, blood pressure or pregnancy.
- **Coach notes** steer drafts: "drop 150 kcal", "more protein", "4 days", "home workouts", "knee pain", "no rice".
- **Food log:** "2 roti, 1 katori dal, 100 g paneer" → calories and macros from the same food table.

**Works offline.** The food engine also runs inside the app (`frontend/src/lib/nutrition.js`, an exact port checked
against the Python engine by tests), so calories and macros are worked out instantly on the phone with no server
or internet. Meals logged and foods taught while offline are saved on the device and sync automatically, once,
with their original time. The app opens offline with the last-seen plans, targets and logs.

**My foods.** Clients can teach FitCoach dishes it doesn't know (e.g. a family recipe); it then recognises them on
the phone and on the server, for that person only.

**Editing the food table:** change `backend/food_data.json`, then run `npm run sync-foods` in `frontend/` (also
runs automatically before `npm start`/`npm run build`) and `python tests/test_engine.py` in `backend/` to refresh
the parity fixture. Tests fail if the app copy or fixture is out of date.

The coach reviews and approves every plan. Optionally set `GEMINI_API_KEY` (use a billing-enabled key) to use
Gemini instead; the engine stays as the fallback. The privacy policy switches its wording automatically.

## Local development

```bash
# API
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # set MONGO_URL, JWT_SECRET, ADMIN_*, and SEED_DEMO_DATA=true for demo coaches
uvicorn server:app --reload --port 8001

# Web app
cd frontend
cp .env.example .env          # REACT_APP_BACKEND_URL=http://localhost:8001
npm ci && npm start
```

## Tests

```bash
cd backend
python -m pytest tests/test_google_login.py                      # in-process, no server needed
REACT_APP_BACKEND_URL=http://localhost:8001 python -m pytest     # all suites; API running with SEED_DEMO_DATA=true
cd ../frontend && CI=true npx craco test --watchAll=false         # pose scoring
```
