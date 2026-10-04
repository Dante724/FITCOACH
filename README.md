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

## AI (optional)

Set `GEMINI_API_KEY` (Google AI Studio). Without it, coaches start plans from a built-in template and food
analysis shows "try again later". `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

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
