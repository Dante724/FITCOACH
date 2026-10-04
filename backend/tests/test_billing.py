"""
Billing, in-process with Razorpay simulated (orders/plans/subscriptions are faked; signatures are real HMACs):
trials and the membership lock, one-time plans, session packs and credits, auto-renewing subscriptions and
webhooks, referrals, the admin plan/settings editor and the coach payout report.
"""
import asyncio
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from inprocess import server

SECRET, WEBHOOK_SECRET = "rzp_test_secret", "whsec_test"
sign = lambda msg, secret=SECRET: hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()  # noqa: E731


class FakeRazorpay:
    def __init__(self):
        self.orders, self.plans, self.subs, self.cancels = [], [], [], []
        self.order = SimpleNamespace(create=self._order)
        self.plan = SimpleNamespace(create=self._plan)
        self.subscription = SimpleNamespace(create=self._sub, cancel=self._cancel)

    def _order(self, d):
        self.orders.append(d)
        return {"id": f"order_{uuid.uuid4().hex[:10]}"}

    def _plan(self, d):
        self.plans.append(d)
        return {"id": f"plan_{uuid.uuid4().hex[:10]}"}

    def _sub(self, d):
        self.subs.append(d)
        return {"id": f"sub_{uuid.uuid4().hex[:10]}"}

    def _cancel(self, sub_id, d):
        self.cancels.append((sub_id, d))
        return {"id": sub_id, "status": "cancelled"}


@pytest.fixture()
def rz(monkeypatch):
    fake = FakeRazorpay()
    monkeypatch.setattr(server, "_razorpay_client", lambda: fake)
    return fake


@pytest.fixture()
def api(rz):
    with TestClient(server.app) as c:
        # billing maths below is written without the free intro session or trial feature limits
        run(server.db.app_settings.update_one({"_id": "billing"}, {"$set": {"trial_session_credits": 0, "trial_features": list(server.TRIAL_FEATURES)}}, upsert=True))
        yield c


def run(coro):
    return asyncio.run(coro)


def register(api, name="Bill Tester", referral_code=None):
    body = {"name": name, "email": f"bill_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!"}
    if referral_code:
        body["referral_code"] = referral_code
    r = api.post("/api/auth/register", json=body).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def login(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def set_expiry(user_id, when):
    run(server.db.users.update_one({"user_id": user_id}, {"$set": {"membership_expires_at": when.isoformat()}}))


def days_until(iso):
    return (datetime.fromisoformat(iso) - datetime.now(timezone.utc)).total_seconds() / 86400


def with_coach(api, client_h, client):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    coach_h, coach = login(api, "sarah.trainer@fitcoach.com", "Trainer@123")
    api.put("/api/profile/intake", json={"focus": "fat_loss"}, headers=client_h)
    api.put(f"/api/admin/users/{client['user_id']}/coaches", json={"fitness_coach_id": coach["user_id"]}, headers=admin)
    return admin, coach_h, coach


def next_monday():
    d = datetime.now(timezone.utc).date() + timedelta(days=14)
    return (d + timedelta(days=(0 - d.weekday()) % 7)).isoformat()


# ── trials and the lock ──
def test_signup_starts_a_trial_with_referral_code(api):
    h, _ = register(api)
    m = api.get("/api/me/membership", headers=h).json()
    assert m["is_trial"] and m["active"] and m["days_left"] == 7
    assert len(m["referral"]["code"]) == 6 and m["referral"]["path"].startswith("/r/")


def test_expired_members_are_locked_after_grace_but_keep_progress(api):
    h, me = register(api)
    set_expiry(me["user_id"], datetime.now(timezone.utc) - timedelta(days=1))   # within 3-day grace
    assert api.get("/api/my/plans", headers=h).status_code == 200
    assert api.get("/api/me/membership", headers=h).json()["in_grace"] is True
    set_expiry(me["user_id"], datetime.now(timezone.utc) - timedelta(days=5))   # past grace
    for method, path, body in [("get", "/api/my/plans", None), ("get", "/api/workouts/plan", None),
                               ("post", "/api/food/analyze", {"description": "dal and rice"})]:
        r = getattr(api, method)(path, headers=h, **({"json": body} if body else {}))
        assert r.status_code == 402 and "renew" in r.json()["detail"]
    assert api.get("/api/progress", headers=h).status_code == 200
    assert api.post("/api/progress", json={"weight": 80}, headers=h).status_code == 200


def test_credits_let_lapsed_clients_book_and_cancellation_refunds(api):
    h, me = register(api)
    admin, coach_h, coach = with_coach(api, h, me)
    set_expiry(me["user_id"], datetime.now(timezone.utc) - timedelta(days=10))
    body = {"trainer_id": coach["user_id"], "date": next_monday(), "time": "07:00"}
    assert api.post("/api/bookings", json=body, headers=h).status_code == 402
    api.post(f"/api/admin/users/{me['user_id']}/credits", json={"delta": 2}, headers=admin)
    b = api.post("/api/bookings", json=body, headers=h)
    assert b.status_code == 200 and b.json()["paid"] is True
    assert api.get("/api/me/membership", headers=h).json()["credits"] == 1
    assert api.delete(f"/api/bookings/{b.json()['id']}", headers=h).json()["credit_refunded"] is True
    assert api.get("/api/me/membership", headers=h).json()["credits"] == 2


# ── one-time purchases ──
def test_plan_purchase_stacks_on_trial_and_adds_sessions(api, rz):
    h, me = register(api)
    order = api.post("/api/payments/order", json={"type": "plan", "plan_id": "monthly"}, headers=h).json()
    assert rz.orders[-1]["amount"] == 15000 * 100
    bad = {"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_1", "razorpay_signature": "forged"}
    assert api.post("/api/payments/verify", json=bad, headers=h).status_code == 400
    good = {**bad, "razorpay_payment_id": "pay_good1", "razorpay_signature": sign(f"{order['order_id']}|pay_good1")}
    assert api.post("/api/payments/verify", json=good, headers=h).status_code == 200
    m = api.get("/api/me/membership", headers=h).json()
    assert m["plan"] == "monthly" and not m["is_trial"] and 36 < days_until(m["expires_at"]) <= 37.1  # 7 trial + 30
    assert m["credits"] == 4


def test_session_pack_adds_credits(api, rz):
    h, _ = register(api)
    order = api.post("/api/payments/order", json={"type": "pack", "pack_id": "pack5"}, headers=h).json()
    assert rz.orders[-1]["amount"] == 4500 * 100
    api.post("/api/payments/verify", headers=h, json={"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_pk",
                                                      "razorpay_signature": sign(f"{order['order_id']}|pay_pk")})
    assert api.get("/api/me/membership", headers=h).json()["credits"] == 5


def test_annual_plan_books_sessions_without_credits(api):
    h, me = register(api)
    admin, _, coach = with_coach(api, h, me)
    api.put(f"/api/admin/users/{me['user_id']}/membership", json={"plan_id": "annual"}, headers=admin)
    m = api.get("/api/me/membership", headers=h).json()
    assert m["unlimited_sessions"] and m["credits"] == 0
    b = api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": next_monday(), "time": "08:00"}, headers=h).json()
    assert b["paid"] is True


# ── auto-renewal ──
def webhook(api, event):
    body = json.dumps(event)
    return api.post("/api/payments/webhook", content=body, headers={"x-razorpay-signature": sign(body, WEBHOOK_SECRET), "content-type": "application/json"})


def test_subscription_lifecycle(api, rz):
    h, me = register(api)
    sub = api.post("/api/payments/subscription", json={"plan_id": "quarterly"}, headers=h).json()
    assert rz.plans[-1]["period"] == "monthly" and rz.plans[-1]["interval"] == 3 and rz.plans[-1]["item"]["amount"] == 3000000
    assert rz.subs[-1]["notes"]["user_id"] == me["user_id"]
    sid = sub["subscription_id"]
    verify = {"razorpay_payment_id": "pay_s1", "razorpay_subscription_id": sid, "razorpay_signature": sign(f"pay_s1|{sid}")}
    assert api.post("/api/payments/subscription/verify", json=verify, headers=h).status_code == 200
    m = api.get("/api/me/membership", headers=h).json()
    assert m["auto_renew"] and m["plan"] == "quarterly" and 96 < days_until(m["expires_at"]) <= 97.1
    charged = {"event": "subscription.charged", "payload": {"subscription": {"entity": {"id": sid}},
                                                            "payment": {"entity": {"id": "pay_s1", "amount": 3000000}}}}
    webhook(api, charged)   # same payment as the checkout callback → must not extend twice
    assert 96 < days_until(api.get("/api/me/membership", headers=h).json()["expires_at"]) <= 97.1
    charged["payload"]["payment"]["entity"]["id"] = "pay_s2"   # next quarter's renewal
    assert webhook(api, charged).status_code == 200
    assert 186 < days_until(api.get("/api/me/membership", headers=h).json()["expires_at"]) <= 187.1
    assert api.post("/api/payments/webhook", content=json.dumps(charged), headers={"x-razorpay-signature": "nope"}).status_code == 400
    assert api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h).status_code == 409
    assert api.post("/api/payments/subscription/cancel", headers=h).status_code == 200
    assert rz.cancels[-1] == (sid, {"cancel_at_cycle_end": 1})
    m = api.get("/api/me/membership", headers=h).json()
    assert not m["auto_renew"] and m["active"]   # keeps access until the paid period ends


def test_halted_subscription_notifies(api):
    h, me = register(api)
    sid = api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h).json()["subscription_id"]
    webhook(api, {"event": "subscription.halted", "payload": {"subscription": {"entity": {"id": sid}}}})
    notes = api.get("/api/notifications", headers=h).json()["notifications"]
    assert any(n["title"] == "Payment didn't go through" for n in notes)


def test_razorpay_plan_is_recreated_only_when_price_changes(api, rz):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    h1, _ = register(api)
    h2, _ = register(api)
    h3, _ = register(api)
    api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h1)
    n = len(rz.plans)
    api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h2)
    assert len(rz.plans) == n
    plan = next(p for p in api.get("/api/admin/plans", headers=admin).json() if p["id"] == "monthly")
    upd = {k: plan[k] for k in ("name", "days", "period", "interval", "included_sessions", "unlimited_sessions", "blurb", "features", "featured", "active", "sort")}
    api.put("/api/admin/plans/monthly", json={**upd, "price_inr": 16000}, headers=admin)
    api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h3)
    assert len(rz.plans) == n + 1 and rz.plans[-1]["item"]["amount"] == 1600000
    api.put("/api/admin/plans/monthly", json={**upd, "price_inr": 15000}, headers=admin)


# ── referrals ──
def test_referral_gives_friend_a_week_and_rewards_referrer_once(api):
    ha, a = register(api, "Referrer")
    code = api.get("/api/me/membership", headers=ha).json()["referral"]["code"]
    before = days_until(api.get("/api/me/membership", headers=ha).json()["expires_at"])
    hb, b = register(api, "Friend", referral_code=code.lower())
    assert 13 < days_until(api.get("/api/me/membership", headers=hb).json()["expires_at"]) <= 14.1   # 7 trial + 7 bonus
    for pay_id in ("pay_ref1", "pay_ref2"):
        order = api.post("/api/payments/order", json={"type": "plan", "plan_id": "monthly"}, headers=hb).json()
        api.post("/api/payments/verify", headers=hb, json={"razorpay_order_id": order["order_id"], "razorpay_payment_id": pay_id,
                                                          "razorpay_signature": sign(f"{order['order_id']}|{pay_id}")})
    after = api.get("/api/me/membership", headers=ha).json()
    assert 6.9 < days_until(after["expires_at"]) - before < 7.1
    assert after["referral"]["rewarded"] == 1
    hx, _ = register(api, "Self", referral_code="ZZZZZZ")   # unknown code: just a normal trial
    assert days_until(api.get("/api/me/membership", headers=hx).json()["expires_at"]) <= 7.1


# ── admin ──
def test_admin_plan_and_settings_editor(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    ch, _ = register(api)
    plan = {"name": "Starter Month", "price_inr": 9999, "days": 30, "period": "monthly", "interval": 1, "included_sessions": 2,
            "unlimited_sessions": False, "blurb": "Lighter coaching", "features": ["Coach chat", "2 sessions"], "featured": False, "active": True, "sort": 0}
    assert api.post("/api/admin/plans", json=plan, headers=ch).status_code == 403
    assert api.post("/api/admin/plans", json={**plan, "period": "daily"}, headers=admin).status_code == 400
    created = api.post("/api/admin/plans", json=plan, headers=admin).json()
    assert created["id"].startswith("starter-month")
    assert any(p["id"] == created["id"] for p in api.get("/api/plans").json()["plans"])   # public list
    api.put(f"/api/admin/plans/{created['id']}", json={**plan, "active": False}, headers=admin)
    assert not any(p["id"] == created["id"] for p in api.get("/api/plans").json()["plans"])
    s = api.get("/api/admin/billing", headers=admin).json()
    new = {**s, "session_price_inr": 1200, "trial_days": 10, "packs": [*s["packs"], {"name": "3 sessions", "sessions": 3, "price_inr": 2900, "active": True}]}
    assert api.put("/api/admin/billing", json={**new, "grace_days": 99}, headers=admin).status_code == 400
    saved = api.put("/api/admin/billing", json=new, headers=admin).json()
    assert saved["session_price_inr"] == 1200 and any(p["id"] == "3-sessions" for p in saved["packs"])
    api.put("/api/admin/billing", json=s, headers=admin)   # restore defaults for other tests


def test_payout_report(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    s = api.get("/api/admin/billing", headers=admin).json()
    api.put("/api/admin/billing", json={**s, "payout_per_client_inr": 2000, "payout_per_session_inr": 500}, headers=admin)
    h, me = register(api, "Payout Client")
    _, coach_h, coach = with_coach(api, h, me)
    past = datetime.now(server.APP_TZ) - timedelta(hours=2)
    run(server.db.bookings.insert_one({"id": str(uuid.uuid4()), "user_id": me["user_id"], "trainer_id": coach["user_id"],
                                       "date": past.date().isoformat(), "time": past.strftime("%H:%M"),
                                       "starts_at": past.astimezone(timezone.utc).isoformat()}))
    month = past.strftime("%Y-%m")
    rep = api.get("/api/admin/payouts", params={"month": month}, headers=admin).json()
    row = next(r for r in rep["coaches"] if r["coach_id"] == coach["user_id"])
    assert row["active_clients"] >= 1 and row["sessions"] >= 1
    assert row["payout_inr"] == row["active_clients"] * 2000 + row["sessions"] * 500
    csv = api.get("/api/admin/payouts.csv", params={"month": month}, headers=admin)
    assert csv.headers["content-type"].startswith("text/csv") and "Sarah Johnson" in csv.text
    assert api.get("/api/admin/payouts", params={"month": "bad"}, headers=admin).status_code == 400
    assert api.get("/api/admin/payouts", params={"month": month}, headers=coach_h).status_code == 403
    api.put("/api/admin/billing", json=s, headers=admin)
