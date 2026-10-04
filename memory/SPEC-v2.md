# FitCoach v2 — Coach-led, AI-assisted

**One line:** Every client has an assigned coach. AI drafts plans fast, and the coach approves them before the client sees them.

**Why we're rebuilding:** v1 is a booking marketplace with AI features attached. Any client can book any trainer and generate their own meal plan, and trainers can't see client progress. So the coach, who is what clients pay for, is missing from the product.

---

## 1. Roles

| Role | Who | Home screen |
|---|---|---|
| **Admin** | Business owner | Clients without a coach, coach workloads, memberships, revenue |
| **Fitness coach** | Online training + nutrition (fat loss, muscle gain) | "Needs attention" queue |
| **Yoga coach** | Yoga sessions + pose feedback | "Needs attention" queue (yoga view) |
| **Client** | Paying member | Today: workout, meals, log weight, next session |

A trainer has a `coach_type`: `fitness` or `yoga`. A client can have **one fitness coach and/or one yoga coach**.

## 2. Permissions (the important rules)

| Action | Client | Assigned coach | Other coach | Admin |
|---|---|---|---|---|
| Create/edit membership tiers and what they include | – | – | – | ✅ |
| Assign or reassign a client's coach | – | – | – | ✅ |
| Generate an AI workout/meal plan draft | – | ✅ | – | ✅ |
| Approve/edit/reject a plan | – | ✅ | – | ✅ |
| See an approved plan | ✅ (own) | ✅ | – | ✅ |
| See a draft/pending plan | – | ✅ | – | ✅ |
| Log weight, measurements, photos, workouts, food | ✅ | – | – | – |
| View client progress | ✅ (own) | ✅ | ❌ | ✅ |
| Book a session | ✅ (own coaches only) | – | – | ✅ |
| Submit a yoga pose clip | ✅ | – | – | – |
| Review a pose clip | – | ✅ (yoga) | – | ✅ |

**Nutrition rule:** clients can *track* food (photo → calories with AI). Only the assigned fitness coach can *prescribe* a meal plan.

## 3. Core flows

### 3.1 Onboarding & assignment
1. Client signs up and picks a membership.
2. Client fills in a goal questionnaire: goal (fat loss / muscle gain / yoga / both), current weight, height, experience, equipment, injuries, diet type (veg / non-veg / egg / vegan / Jain), allergies, dislikes.
3. Client sees "Your coach is being assigned" with a progress state.
4. Admin sees the client in the **Unassigned** list and assigns a coach (or coaches) by type and current workload.
5. Coach gets a notification: "New client: Priya, fat loss, veg, knee issue."

### 3.2 Plan creation & approval (the core of the product)
```
Coach clicks "Draft plan" ──► AI generates from the questionnaire + latest progress
        │
        ▼
   status: DRAFT ──► coach edits inline (swap exercise, change sets, adjust macros)
        │
        ├── Approve ──► status: ACTIVE ──► client notified, sees plan
        └── Discard
```
- Plan types: `workout`, `meal`, `yoga_sequence`.
- One active plan per type per client. Approving a new one archives the old one.
- The plan shows "Approved by Coach Arjun · 3 Oct". Clients are paying for that.
- **Target:** a coach can review and approve a draft in **under 2 minutes**. Editing has to be inline and quick. If it takes longer, coaches will approve plans without reading them.
- The AI respects the client's stated preferences (equipment, injuries, dislikes, diet). That's how the client shapes their plan without picking exercises freely.

### 3.3 Progress tracking
- **Client logs:** weight, waist/chest/hips/arms, progress photos (existing), completed workouts (existing), food (existing AI photo tracking).
- **Client sees:** trend charts, streaks, plan adherence %.
- **Coach sees per client:** the same charts, plus logs and photo comparison.
- **Coach "Needs attention" queue** (home screen), sorted by urgency:
  - Plans waiting for approval
  - Client hasn't logged in X days (default 7)
  - Weight hasn't changed in 3 weeks (plateau)
  - Pose clips waiting for review (yoga)
  - Upcoming sessions today

### 3.4 Yoga pose check (built: live cues + async coach review)
1. Client picks a pose from their yoga plan and records a 10–15s clip in the browser.
2. On-device pose tracking (MediaPipe / MoveNet) scores key joint angles against a reference for that pose and flags issues (e.g. "front knee past ankle", "hips uneven").
3. The clip, AI score and flags go to the assigned yoga coach.
4. The coach confirms or overrides the feedback and adds a note. The client gets the result.

Start with **8–10 common poses** (Warrior I/II, Tree, Triangle, Downward Dog, Cobra, Chair, Plank, Bridge, Child's).
*Later:* live, real-time correction during practice, once we trust the scoring.

### 3.5 Booking
- Clients only see their own coach(es) when booking.
- Session count comes from the membership tier, plus pay-per-session (₹1,000) beyond that.

## 4. Admin controls
- Membership tiers: name, price, duration, **what's included** (fitness coaching, nutrition, yoga, sessions per month).
- Assign or reassign coaches. Reassigning keeps the client's full history.
- Coach roster: type, max clients, current load.
- Overview: active clients, unassigned clients, plans pending > 48h, revenue.

## 5. Data model changes
- `users`: add `coach_type` (trainers), `max_clients` (trainers), `fitness_coach_id` / `yoga_coach_id` (clients), `intake` (questionnaire).
- `membership_plans`: move from hard-coded constants into the DB so admins can edit them. Add `includes` (list of features) and `sessions_per_month`.
- **New** `plans`: `{id, client_id, coach_id, type, status: draft|active|archived, content, ai_generated, approved_by, approved_at, created_at}`
- **New** `body_metrics`: `{client_id, date, weight, waist, chest, hips, arms}`. Replaces/extends `progress`.
- **New** `pose_checks`: `{client_id, coach_id, pose, clip_path, ai_score, ai_flags, coach_verdict, coach_note, status}`

## 6. What happens to v1 screens

| v1 screen | v2 |
|---|---|
| Landing, Login, Profile, VideoCall, Membership | Keep (Membership reads tiers from the DB) |
| FocusSelect | **Replace** with the goal questionnaire |
| Workouts | **Rebuild:** shows the coach-approved plan, not a hard-coded list |
| MealPlans | **Move to coach side.** Client sees the approved plan read-only. |
| FoodTrack, Progress, ProgressPhotos | Keep, add body measurements, make visible to the coach |
| Booking | Limit to the client's own coaches |
| TrainerDashboard | **Rebuild:** client list + "Needs attention" queue + plan editor |
| AdminPanel | Extend: assignment, tier editor, coach roster |
| BodyScan | **Removed** (Oct 2026). |

## 7. Build order
1. **Foundation:** coach types, client↔coach assignment, admin assignment screen, permission checks. *Everything else depends on this.*
2. **Progress visibility:** body metrics + coach can view a client's progress + "Needs attention" queue.
3. **Plan approval:** AI draft → coach edit → approve → client view (workout + meal).
4. **Admin tier editor:** DB-backed memberships with "includes".
5. **Yoga pose check:** async clip + on-device scoring + coach review.
6. Polish: booking limited to own coaches, notifications, empty states.

## 8. Risks & how to check them cheaply
| Risk | Check before building |
|---|---|
| Coaches become a bottleneck (plans wait days) | Time 3 real coaches reviewing 10 AI drafts each. Target < 2 min per plan. |
| Coaches don't trust AI drafts | Ask the same coaches: "Would you put your name on this?" Tune prompts until mostly yes. |
| Pose scoring is wrong and hurts trust | Coach always confirms before the client sees feedback (built into 3.4). |
| Clients feel they have no control | Questionnaire preferences + a "request a change" button on the plan, which goes to the coach. |

## 9. Build status (branch `v2-coach-led`, 2026-10-04)
| Area | Status |
|---|---|
| Goal questionnaire (fat loss / muscle gain / yoga / fitness + yoga) | ✅ Built |
| Admin: assign fitness/yoga coach, coach type, workload, "needs a coach" filter | ✅ Built |
| Permissions: coaches only see their own clients and their own track's plans; clients only book their own coach | ✅ Built + tested |
| AI draft → coach edits inline → approve → client sees "Approved by …" | ✅ Built (template fallback when AI is unavailable) |
| Adjustments with a reason shown to the client; plan history | ✅ Built |
| Coach "Needs attention" queue + weekly brief per client (rule-based) | ✅ Built |
| In-app coach ↔ client chat with context (meal, workout, plan, photo) | ✅ Built (text only; polling every 8s) |
| Responsive: phone (375), tablet (768), laptop (1366) | ✅ Checked in browser |
| In-app video calls (WebRTC, no Zoom/Jitsi): booked sessions + instant "Call now", ringing, echo/noise suppression toggle, reconnect | ✅ Built (STUN only by default — add a TURN server for strict networks) |
| Coach schedules sessions; reminders 1h & 10 min before; "starting soon" banner | ✅ Built |
| Installable app (PWA) + Web Push when closed: calls with Answer/Decline, reminders, messages, plan updates | ✅ Built (needs a real-device check; iPhone requires Add to Home Screen) |
| Admin tier editor (DB-backed memberships) | ⏳ Next |
| Yoga pose check: live on-device tracking with cues, 10s hold or uploaded clip → score + corrections + one annotated still → yoga coach confirms/adjusts → client | ✅ Built (8 poses; camera tested only via a still photo — needs a real-phone test) |
| Voice notes in chat, AI-written weekly brief | ⏳ Later |

## 10. Open questions
- Coach payouts: salary or per-client? (affects admin reporting)
- Should clients message their coach in-app, or keep using WhatsApp?
- Are there clients without a membership who only pay per session?
