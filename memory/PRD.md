# FitCoach — Product Requirements & Progress

## Original problem statement
Client-focused fitness app (originally a single-file Claude demo, "FitCoach Pro"). Client should
access only: Booking, their Progress, AI Food Track, quick AI Body Scan (body type), and Gym Workout
(previous + current sessions). Before those, a first screen lets the client choose a focus — one of
**Strength & Conditioning / Nutrition Plan / Yoga / Muscle Building & Fat Loss** — and **each choice
leads to a different set of features**. Style: clay morphism + Liquid Glass, professional, no emojis.

## User choices
- AI model: **Gemini 3 Flash** (gemini-3-flash-preview) via Emergent LLM key
- Auth: **Emergent-managed Google OAuth**
- Body scan: from an **uploaded photo** (Gemini vision)
- Each focus → different feature set

## Architecture
- Frontend: React 19 (CRA/craco), react-router 7, lucide-react, custom clay+glass design system (index.css)
- Backend: FastAPI, MongoDB (motor), emergentintegrations (Gemini), httpx (OAuth session exchange)
- Auth: Google OAuth session_id → backend exchange → httpOnly cookie `session_token` (7d)

## Focus → feature mapping (each different)
- strength    → workouts, progress, bodyscan, booking
- nutrition   → food, progress, booking
- yoga        → workouts (yoga flow), progress, booking
- muscle_fat  → bodyscan, food, workouts, progress, booking
- Overview (dashboard) always present.

## Implemented (2026-07-19)
- Google OAuth login, session cookie, /auth/me, logout, protected routes
- Focus selector screen (persists user.focus); focus-gated sidebar nav + route guard
- Booking: trainers, date/slot picker, create/list/cancel, duplicate-slot 409
- Progress: log measurements modal, list, delete, weight trend sparkline
- AI Food Track: Gemini analyzes meal description → calories/macros/health score; daily totals; logs
- AI Body Scan: photo upload → Gemini vision → body type + training/nutrition/split recommendations; history
- Workouts: focus-tailored plan, tick exercises, log session, previous sessions list
- Clay morphism + Liquid Glass design, Bricolage Grotesque + Manrope fonts, terracotta/teal palette, no emojis
- Testing: 22/22 backend pass, 100% frontend pass (testing agent iteration_1)

## Backlog / next
- P1: Real trainer-side availability & video session join (dropped from client-only scope)
- P1: Meal plan builder + saved diet templates (nutrition focus)
- P2: Per-user rate limiting on AI endpoints; strict Pydantic response models for AI outputs
- P2: Progress photo timeline; export data
- P2: Split server.py into modules as features grow
