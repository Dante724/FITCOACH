"""
Clients abroad (NRIs), in-process: country/time zone/units, session times in their own time zone, prices in their
currency, ingredient swaps in meal plans, foods common abroad, and health screening tuned for South Asians.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

import engine
import locale_info as L
from inprocess import server
from test_billing import FakeRazorpay, sign, register, login, with_coach


class FakeRazorpayFx(FakeRazorpay):
    def __init__(self):
        super().__init__()
        self.payment = SimpleNamespace(fetch=lambda pid: {"id": pid, "currency": "USD", "base_currency": "INR", "base_amount": 410000})


@pytest.fixture()
def rz(monkeypatch):
    fake = FakeRazorpayFx()
    monkeypatch.setattr(server, "_razorpay_client", lambda: fake)
    return fake


@pytest.fixture()
def api(rz):
    with TestClient(server.app) as c:
        asyncio.run(server.db.app_settings.update_one({"_id": "billing"}, {"$set": {"trial_session_credits": 0}}, upsert=True))
        yield c


def run(coro):
    return asyncio.run(coro)


def nri(api, country="US", tz="America/New_York", units=None):
    h, me = register(api, name="Anita NRI")
    body = {"country": country, "timezone": tz}
    if units:
        body["units"] = units
    loc = api.put("/api/me/locale", json=body, headers=h)
    assert loc.status_code == 200, loc.text
    return h, me, loc.json()


# ── where they live ──
def test_locale_defaults_and_validation(api):
    h, me = register(api)
    assert api.get("/api/me/locale", headers=h).json() == {"country": "IN", "timezone": "Asia/Kolkata", "units": "metric",
                                                           "currency": "INR", "abroad": False,
                                                           "country_name": "India"}
    assert api.put("/api/me/locale", json={"country": "ZZ"}, headers=h).status_code == 400
    assert api.put("/api/me/locale", json={"country": "US", "timezone": "Mars/Base"}, headers=h).status_code == 400
    loc = api.put("/api/me/locale", json={"country": "us", "timezone": "America/Chicago"}, headers=h).json()
    assert loc == {"country": "US", "timezone": "America/Chicago", "units": "imperial", "currency": "USD", "abroad": True,
                   "country_name": "United States"}
    assert api.get("/api/auth/me", headers=h).json()["country"] == "US"
    opts = api.get("/api/locale/options").json()
    assert {"code": "AE", "name": "United Arab Emirates", "currency": "AED", "units": "metric"} in opts["countries"]


# ── session times in their time zone ──
def test_slots_are_offered_for_their_own_day_and_booking_uses_coach_time(api):
    h, me, _ = nri(api)
    _, coach_h, coach = with_coach(api, h, me)
    run(server.db.users.update_one({"user_id": me["user_id"]}, {"$set": {"session_credits": 2}}))
    local_day = (datetime.now(ZoneInfo("America/New_York")).date() + timedelta(days=60))
    while local_day.weekday() != 2:  # a Wednesday, well clear of other tests
        local_day += timedelta(days=1)
    r = api.get(f"/api/trainers/{coach['user_id']}/slots", params={"date": local_day.isoformat(), "tz": "America/New_York"}, headers=h).json()
    assert r["options"], r
    for o in r["options"]:
        start = datetime.fromisoformat(o["starts_at"])
        assert start.astimezone(ZoneInfo("America/New_York")).date() == local_day
        assert server.booking_dt(o["date"], o["time"]) == start
    # Some of a New York day's sessions fall on the next day in India
    assert len({o["date"] for o in r["options"]}) >= 1
    pick = r["options"][0]
    b = api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": pick["date"], "time": pick["time"]}, headers=h)
    assert b.status_code == 200, b.text
    doc = run(server.db.bookings.find_one({"id": b.json()["id"]}))
    assert doc["client_tz"] == "America/New_York"
    assert server._client_when(doc).endswith("(New York time)")
    assert "IST" in server._both_when(doc) and server._both_when(doc).endswith("(New York time) for the client")


def test_home_dates_cover_a_whole_local_day():
    assert L.home_dates_for_local_day("2026-11-04", "America/Los_Angeles") == ["2026-11-04", "2026-11-05"]
    assert L.home_dates_for_local_day("2026-11-04", "Asia/Dubai") == ["2026-11-04", "2026-11-05"]  # 01:30 → 01:29 IST
    assert L.home_dates_for_local_day("2026-11-04", "Asia/Colombo") == ["2026-11-04"]                # same clock as India
    assert L.home_dates_for_local_day("2026-11-04", "Pacific/Auckland") == ["2026-11-03", "2026-11-04"]


def test_describe_time():
    t = datetime(2026, 11, 4, 13, 0, tzinfo=timezone.utc)  # 18:30 IST
    assert L.describe_time(t, "Asia/Kolkata") == "04 Nov at 18:30"
    assert L.describe_time(t, "America/New_York") == "Wed 04 Nov, 8:00 AM (New York time)"


# ── prices in their currency ──
def test_local_prices_and_checkout_in_dollars(api, rz):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    plan = next(p for p in api.get("/api/admin/plans", headers=admin).json() if p["id"] == "monthly")
    body = {k: plan[k] for k in ("name", "price_inr", "days", "period", "interval", "included_sessions", "unlimited_sessions",
                                 "blurb", "features", "featured", "active", "sort")}
    r = api.put("/api/admin/plans/monthly", json={**body, "prices": {"usd": 49, "GBP": 39, "XYZ": 5, "EUR": -1}}, headers=admin)
    assert r.status_code == 200 and r.json()["prices"] == {"USD": 49.0, "GBP": 39.0}
    try:
        pub = api.get("/api/plans", params={"country": "US"}).json()
        monthly = next(p for p in pub["plans"] if p["id"] == "monthly")
        assert pub["currency"] == "USD" and monthly["price"] == {"amount": 49.0, "currency": "USD"}
        quarterly = next(p for p in pub["plans"] if p["id"] == "quarterly")
        assert quarterly["price"]["currency"] == "INR"  # no dollar price set → charged in rupees
        assert next(p for p in api.get("/api/plans").json()["plans"] if p["id"] == "monthly")["price"]["currency"] == "INR"

        h, me, _ = nri(api)
        cfg = api.get("/api/payments/config", headers=h).json()
        m = next(p for p in cfg["plans"] if p["id"] == "monthly")
        assert m["price"]["amount"] == 49 and m["auto_renew"] is False
        order = api.post("/api/payments/order", json={"type": "plan", "plan_id": "monthly"}, headers=h).json()
        assert rz.orders[-1]["currency"] == "USD" and rz.orders[-1]["amount"] == 4900 and order["currency"] == "USD"
        good = {"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_usd1", "razorpay_signature": sign(f"{order['order_id']}|pay_usd1")}
        assert api.post("/api/payments/verify", json=good, headers=h).status_code == 200
        txn = run(server.db.transactions.find_one({"order_id": order["order_id"]}))
        assert txn["amount"] == 49 and txn["currency"] == "USD" and txn["amount_inr"] == 4100
        assert api.get("/api/me/membership", headers=h).json()["plan"] == "monthly"
        # auto-renew is rupees-only
        assert api.post("/api/payments/subscription", json={"plan_id": "monthly"}, headers=h).status_code == 400
        ins = api.get("/api/admin/insights", headers=admin).json()["abroad"]
        assert ins["clients"] >= 1 and ins["payments_30d"].get("USD", 0) >= 49
        assert any(c["code"] == "US" for c in ins["countries"])
    finally:
        api.put("/api/admin/plans/monthly", json={**body, "prices": {}}, headers=admin)


def test_clean_prices_and_money():
    assert L.clean_prices({"inr": 100, "aed": "199.999", "usd": 0}) == {"AED": 200.0}
    assert L.money(15000, "INR") == "₹15,000" and L.money(49, "USD") == "$49" and L.money(39.5, "GBP") == "£39.50"


# ── food abroad ──
def test_every_swap_is_well_formed():
    swaps = engine._DATA["abroad_swaps"]
    assert len(swaps) >= 20
    for sw in swaps:
        assert sw["for"] and all(w == w.lower() for w in sw["for"]) and sw["swap"] and sw["why"]


def test_foods_common_abroad():
    cc = engine.analyze_meal("1 cup cottage cheese")
    assert cc["items"][0].startswith("Cottage cheese (Western)") and cc["calories"] == 220  # not paneer (≈600 kcal)
    assert engine.analyze_meal("100 g paneer")["items"][0].startswith("Paneer")
    am = engine.analyze_meal("a glass of almond milk")
    assert am["items"][0].startswith("Almond milk") and am["calories"] == 40


# ── health screening ──
def test_south_asian_health_flags():
    flags = L.health_flags({"height_cm": 165, "sex": "male", "waist_cm": 94, "hba1c": 6.0, "vitamin_d": 15, "diet": "veg", "age": 38,
                            "conditions": ["thyroid"]}, 64, abroad=True)
    text = " ".join(f["text"] for f in flags)
    assert flags[0]["level"] == "high"
    assert "overweight for Indians" in text          # BMI 23.5 — "normal" on Western charts
    assert "Waist 94 cm" in text and "prediabetes" in text and "Vitamin D 15" in text and "Thyroid" in text
    assert "B12" in text                              # vegetarian, no B12 test → tip
    assert not L.health_flags({}, None, abroad=False)


def test_health_endpoint_and_coach_view(api):
    h, me, _ = nri(api, "GB", "Europe/London")
    _, coach_h, coach = with_coach(api, h, me)
    intake = {"focus": "fat_loss", "height_cm": 170, "weight_kg": 80, "sex": "female", "waist_cm": 88, "hba1c": 6.7,
              "conditions": ["diabetes", "made-up"], "vitamin_d": 999}
    assert api.put("/api/profile/intake", json=intake, headers=h).status_code == 200
    me_health = api.get("/api/me/health", headers=h).json()
    assert me_health["intake"]["conditions"] == ["diabetes"] and me_health["intake"]["vitamin_d"] is None
    assert any("diabetes range" in f["text"] for f in me_health["flags"])
    detail = api.get(f"/api/coach/clients/{me['user_id']}", headers=coach_h).json()
    assert detail["locale"]["country"] == "GB" and detail["locale"]["timezone"] == "Europe/London"
    assert any(f["level"] == "high" for f in detail["health_flags"])


def test_booking_messages_use_the_clients_clock(api):
    h, me, _ = nri(api, "US", "America/Los_Angeles")
    _, coach_h, coach = with_coach(api, h, me)
    run(server.activate_membership(me["user_id"], run(server.get_plan("monthly")), "test"))
    day = datetime.now(ZoneInfo("America/Los_Angeles")).date() + timedelta(days=75)
    while day.weekday() != 1:
        day += timedelta(days=1)
    opt = api.get(f"/api/trainers/{coach['user_id']}/slots", params={"date": day.isoformat(), "tz": "America/Los_Angeles"}, headers=h).json()["options"][0]
    assert api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": opt["date"], "time": opt["time"]}, headers=h).status_code == 200
    mine = run(server.db.notifications.find_one({"user_id": me["user_id"], "title": "Session booked"}))
    assert "(Los Angeles time)" in mine["body"] and opt["time"] not in mine["body"]
    theirs = run(server.db.notifications.find_one({"user_id": coach["user_id"], "title": "New booking", "body": {"$regex": "Anita"}}, sort=[("created_at", -1)]))
    assert f"{opt['date']} at {opt['time']} IST" in theirs["body"] and "Los Angeles time) for the client" in theirs["body"]
