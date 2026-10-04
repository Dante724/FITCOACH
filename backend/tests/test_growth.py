"""
Growth and compliance, in-process: the limited free trial, consultation leads from the landing page,
consent records (DPDP), photo consent, data export, account deletion and the admin insights dashboard.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from inprocess import server

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


@pytest.fixture()
def api():
    with TestClient(server.app) as c:
        run(server.db.app_settings.delete_many({"_id": "billing"}))  # default trial settings for every test
        yield c


def run(coro):
    return asyncio.run(coro)


def login(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def register(api, name="Grow Tester", email=None, **extra):
    body = {"name": name, "email": email or f"grow_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", **extra}
    r = api.post("/api/auth/register", json=body).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def with_coach(api, h, me, focus="fat_loss", email="sarah.trainer@fitcoach.com", track="fitness"):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    coach_h, coach = login(api, email, "Trainer@123")
    api.put("/api/profile/intake", json={"focus": focus}, headers=h)
    api.put(f"/api/admin/users/{me['user_id']}/coaches", json={f"{track}_coach_id": coach["user_id"]}, headers=admin)
    return admin, coach_h, coach


def next_monday():
    d = datetime.now(server.APP_TZ).date()
    return (d + timedelta(days=7 - d.weekday())).isoformat()


# ── Free trial ─────────────────────────────────────────
def test_trial_is_limited_and_includes_one_intro_session(api):
    h, me = register(api, consent=True)
    admin, coach_h, coach = with_coach(api, h, me)
    m = api.get("/api/me/membership", headers=h).json()
    assert m["is_trial"] and m["credits"] == 1 and set(m["trial_features"]) == {"workouts", "messages", "food"}
    # included: chat
    assert api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}", json={"body": "hi"}, headers=h).status_code == 200
    # not included: instant calls, meal plans, pose checks
    r = api.post("/api/calls/instant", json={"peer_id": coach["user_id"]}, headers=h)
    assert r.status_code == 402 and "free trial" in r.json()["detail"]
    assert api.get("/api/workouts/plan", params={"type": "meal"}, headers=h).status_code == 402
    # a meal plan approved during the trial stays hidden until they join
    d = api.post(f"/api/coach/clients/{me['user_id']}/plans/draft", json={"type": "meal"}, headers=coach_h).json()
    api.post(f"/api/plans/{d['id']}/approve", headers=coach_h)
    assert "meal" not in api.get("/api/my/plans", headers=h).json()
    # one free intro session, then booking needs a pack or plan
    assert api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": next_monday(), "time": "07:00"}, headers=h).status_code == 200
    r = api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": next_monday(), "time": "08:00"}, headers=h)
    assert r.status_code == 402 and "intro session" in r.json()["detail"]
    # paying unlocks everything
    run(server.activate_membership(me["user_id"], run(server.get_plan("monthly")), "test"))
    assert api.get("/api/workouts/plan", params={"type": "meal"}, headers=h).status_code == 200
    assert "meal" in api.get("/api/my/plans", headers=h).json()


def test_admin_chooses_trial_features(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    b = api.get("/api/admin/billing", headers=admin).json()
    assert "pose_check" in b["trial_feature_options"]
    body = {k: b[k] for k in ("session_price_inr", "trial_days", "grace_days", "referral_reward_days", "referee_bonus_days",
                              "payout_per_client_inr", "payout_per_session_inr", "packs")}
    assert api.put("/api/admin/billing", json={**body, "trial_features": ["hacking"]}, headers=admin).status_code == 400
    assert api.put("/api/admin/billing", json={**body, "trial_session_credits": 99}, headers=admin).status_code == 400
    saved = api.put("/api/admin/billing", json={**body, "trial_features": ["workouts", "calls"], "trial_session_credits": 0}, headers=admin).json()
    assert saved["trial_features"] == ["workouts", "calls"] and saved["trial_session_credits"] == 0
    h, me = register(api)
    _, _, coach = with_coach(api, h, me)
    assert api.get("/api/me/membership", headers=h).json()["credits"] == 0
    assert api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}", json={"body": "hi"}, headers=h).status_code == 402
    # saving without the trial fields keeps them
    api.put("/api/admin/billing", json=body, headers=admin)
    assert api.get("/api/admin/billing", headers=admin).json()["trial_features"] == ["workouts", "calls"]


# ── Consent ────────────────────────────────────────────
def test_consent_recorded_at_signup_and_audited(api):
    h, me = register(api, consent=True, photo_consent=False, marketing=True)
    c = me["consents"]
    assert c["health_data"] and c["marketing"] and not c.get("photos") and c["version"] == server.CONSENT_VERSION
    h2, me2 = register(api)
    assert me2.get("consents") is None  # the app then asks before anything else
    r = api.post("/api/me/consent", json={"health_data": False}, headers=h2)
    assert r.status_code == 400
    u = api.post("/api/me/consent", json={"health_data": True, "photos": True}, headers=h2).json()
    assert u["consents"]["health_data"] and u["consents"]["photos"]
    log = run(server.db.consent_log.find({"user_id": me2["user_id"]}).to_list(10))
    assert log[-1]["changes"] == {"health_data": True, "photos": True}
    assert api.get("/api/auth/config").json()["privacy_contact"]


def test_photos_need_consent_and_withdrawal_erases_them(api):
    h, me = register(api, consent=True)
    up = lambda: api.post("/api/progress/photos", files={"file": ("p.png", PNG, "image/png")}, headers=h)  # noqa: E731
    r = up()
    assert r.status_code == 403 and "Privacy settings" in r.json()["detail"]
    api.post("/api/me/consent", json={"health_data": True, "photos": True}, headers=h)
    photo = up().json()
    assert api.get(f"/api{photo['url'][4:]}", headers=h).status_code == 200
    run(server.db.pose_checks.insert_one({"id": "pc1", "client_id": me["user_id"], "snapshot": "data:image/png;base64,AAA", "status": "pending"}))
    api.post("/api/me/consent", json={"health_data": True, "photos": False}, headers=h)
    assert api.get("/api/progress/photos", headers=h).json() == []
    assert api.get(f"/api{photo['url'][4:]}", headers=h).status_code == 404
    pc = run(server.db.pose_checks.find_one({"id": "pc1"}))
    assert pc["snapshot"] is None and pc["snapshot_removed"]


# ── Export & deletion ──────────────────────────────────
def test_export_contains_my_data_only(api):
    h, me = register(api, name="Export Me", consent=True)
    _, coach_h, coach = with_coach(api, h, me)
    api.post("/api/progress", json={"weight": 70}, headers=h)
    api.put("/api/today/checkin", json={"sleep": 3, "energy": 3, "soreness": 3, "mood": 3}, headers=h)
    api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}", json={"body": "hello coach"}, headers=h)
    r = api.get("/api/me/export", headers=h)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["name"] == "Export Me" and "password_hash" not in data["account"]
    assert data["progress"][0]["weight"] == 70 and data["daily_logs"] and data["messages"][0]["body"] == "hello coach"
    assert all(t["user_id"] == me["user_id"] for t in data["transactions"])


def test_delete_account_erases_personal_data_keeps_anonymous_payments(api):
    h, me = register(api, name="Leaving Soon", email=f"leave_{uuid.uuid4().hex[:6]}@example.com", consent=True, photo_consent=True)
    _, coach_h, coach = with_coach(api, h, me)
    uid = me["user_id"]
    api.post("/api/progress", json={"weight": 70}, headers=h)
    api.post("/api/progress/photos", files={"file": ("p.png", PNG, "image/png")}, headers=h)
    api.post(f"/api/messages/{uid}/{coach['user_id']}", json={"body": "bye"}, headers=h)
    run(server.db.transactions.insert_one({"id": "t-del", "user_id": uid, "type": "plan", "amount_inr": 15000, "status": "paid", "paid_at": server._now_iso()}))
    run(server.db.leads.insert_one({"id": "lead-del", "email": me["email"], "status": "converted", "created_at": server._now_iso()}))
    assert api.request("DELETE", "/api/me", json={"confirm": "nope"}, headers=h).status_code == 400
    assert api.request("DELETE", "/api/me", json={"confirm": "delete"}, headers=h).status_code == 200
    for coll, field in (("users", "user_id"), ("progress", "user_id"), ("progress_photos", "user_id"), ("messages", "client_id"),
                        ("files", "owner_id"), ("daily_logs", "user_id")):
        assert run(server.db[coll].count_documents({field: uid})) == 0, coll
    assert run(server.db.leads.count_documents({"id": "lead-del"})) == 0
    t = run(server.db.transactions.find_one({"id": "t-del"}))
    assert t["user_id"] == "deleted" and t["amount_inr"] == 15000
    assert api.get("/api/auth/me", headers=h).status_code == 401
    # coaches can't self-delete; admins can delete clients
    assert api.request("DELETE", "/api/me", json={"confirm": "DELETE"}, headers=coach_h).status_code == 400
    h2, me2 = register(api)
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    assert api.delete(f"/api/admin/users/{me2['user_id']}", headers=coach_h).status_code == 403
    assert api.delete(f"/api/admin/users/{coach['user_id']}", headers=admin).status_code == 400
    assert api.delete(f"/api/admin/users/{me2['user_id']}", headers=admin).status_code == 200


# ── Leads ──────────────────────────────────────────────
LEAD = {"name": "Kavya Iyer", "phone": "+91 98765 43210", "email": "Kavya@Example.com", "goal": "fat_loss",
        "preferred_slot": "evening", "message": "Postpartum, want to lose 8 kg", "consent": True}


def test_lead_validation_and_admin_flow(api):
    run(server.db.leads.delete_many({}))
    assert api.post("/api/leads", json={**LEAD, "consent": False}).status_code == 400
    assert api.post("/api/leads", json={**LEAD, "phone": "12345"}).status_code == 400
    assert api.post("/api/leads", json={**LEAD, "preferred_date": "2001-01-01"}).status_code == 400
    assert api.post("/api/leads", json={**LEAD, "website": "spam.example"}).json() == {"ok": True}  # honeypot: silently dropped
    tomorrow = (datetime.now(server.APP_TZ).date() + timedelta(days=1)).isoformat()
    assert api.post("/api/leads", json={**LEAD, "preferred_date": tomorrow}).status_code == 200
    assert api.post("/api/leads", json={**LEAD, "message": "updated"}).status_code == 200  # same phone → same lead
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    data = api.get("/api/admin/leads", headers=admin).json()
    assert len(data["leads"]) == 1 and data["counts"]["new"] == 1
    lead = data["leads"][0]
    assert lead["phone"] == "+919876543210" and lead["email"] == "kavya@example.com" and lead["message"] == "updated"
    assert "ip_hash" not in lead
    note = run(server.db.notifications.find_one({"title": "New consultation request"}, sort=[("created_at", -1)]))
    assert "Kavya Iyer" in note["body"] and note["link"] == "/admin/leads"
    upd = api.put(f"/api/admin/leads/{lead['id']}", json={"status": "contacted", "note": "Called, call booked Sat 6pm"}, headers=admin).json()
    assert upd["status"] == "contacted" and upd["notes"][0]["text"].startswith("Called")
    assert api.put(f"/api/admin/leads/{lead['id']}", json={"status": "bogus"}, headers=admin).status_code == 400
    coach_h, _ = login(api, "sarah.trainer@fitcoach.com", "Trainer@123")
    assert api.get("/api/admin/leads", headers=coach_h).status_code == 403
    # signing up with the same email converts the lead
    register(api, name="Kavya Iyer", email="kavya@example.com", consent=True)
    assert api.get("/api/admin/leads", params={"status": "converted"}, headers=admin).json()["leads"][0]["id"] == lead["id"]


def test_lead_rate_limit_and_retention(api):
    run(server.db.leads.delete_many({}))
    for i in range(5):
        assert api.post("/api/leads", json={**LEAD, "phone": f"98765432{i:02d}"}).status_code == 200
    assert api.post("/api/leads", json={**LEAD, "phone": "9876543299"}).status_code == 429
    old = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()
    run(server.db.leads.update_many({}, {"$set": {"created_at": old}}))
    run(server.purge_old_leads())
    assert run(server.db.leads.count_documents({})) == 0


# ── Insights ───────────────────────────────────────────
def test_insights(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    before = api.get("/api/admin/insights", headers=admin).json()
    h, me = register(api, consent=True)
    _, coach_h, coach = with_coach(api, h, me)
    # a converted trial with a renewal
    h2, me2 = register(api, consent=True)
    run(server.db.transactions.insert_many([
        {"id": str(uuid.uuid4()), "user_id": me2["user_id"], "type": "plan", "amount_inr": 15000, "status": "paid",
         "paid_at": (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()},
        {"id": str(uuid.uuid4()), "user_id": me2["user_id"], "type": "subscription", "amount_inr": 15000, "status": "paid",
         "paid_at": datetime.now(timezone.utc).isoformat()},
    ]))
    # an expired trial (drop-off)
    h3, me3 = register(api, name="Gone Quiet", consent=True)
    run(server.db.users.update_one({"user_id": me3["user_id"]}, {"$set": {"membership_expires_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()}}))
    # coach replies after 30 min; another client message is left unanswered for 2 days
    t0 = datetime.now(timezone.utc) - timedelta(days=3)
    msgs = [(me["user_id"], t0), (coach["user_id"], t0 + timedelta(minutes=30)), (me["user_id"], t0 + timedelta(days=1))]
    run(server.db.messages.insert_many([{"id": str(uuid.uuid4()), "client_id": me["user_id"], "coach_id": coach["user_id"], "sender_id": s,
                                         "body": "x", "created_at": t.isoformat()} for s, t in msgs]))
    ins = api.get("/api/admin/insights", headers=admin).json()
    assert ins["signups"][-1]["count"] >= before["signups"][-1]["count"] + 3
    assert ins["signups_30d"] >= 3 and len(ins["signups"]) == 8
    assert ins["renewals_30d"] >= 1 and ins["revenue"]["this_month"] >= 15000
    assert any(d["name"] == "Gone Quiet" for d in ins["dropoffs"]["trial"])
    assert ins["trial_conversion"]["converted"] >= 1 and ins["trial_conversion"]["ended_unpaid"] >= 1
    sarah = next(c for c in ins["coaches"] if c["coach_id"] == coach["user_id"])
    assert sarah["replies"] >= 1 and sarah["overdue"] >= 1 and sarah["waiting"] >= 1
    coach_h2, _ = login(api, "mike.trainer@fitcoach.com", "Trainer@123")
    assert api.get("/api/admin/insights", headers=coach_h2).status_code == 403


def test_median():
    assert server._median([]) is None and server._median([5, 1, 3]) == 3 and server._median([1, 2, 3, 10]) == 2.5
