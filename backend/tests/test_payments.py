"""
FitCoach payments tests (pytest) — Razorpay integration in DISABLED state.
RAZORPAY_KEY_ID/SECRET are empty, so PAYMENTS_ENABLED=false and the app must
degrade gracefully:
- /payments/config returns enabled=false and correct plans/prices
- /payments/order returns 503 for both plan and session
- /payments/verify returns 503
- /payments/history returns a list
- All /payments/* endpoints require auth (401 without a session)
"""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://fitness-dashboard-115.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
TOKEN = os.environ.get("TEST_SESSION_TOKEN", "test_session_fitcoach_1")


@pytest.fixture(scope="module")
def bearer():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ─────────────────────────── /payments/config ───────────────────────────
class TestPaymentsConfig:
    def test_config_unauth_returns_401(self, anon):
        r = anon.get(f"{API}/payments/config")
        assert r.status_code == 401, r.text

    def test_config_shape_and_values(self, bearer):
        r = bearer.get(f"{API}/payments/config")
        assert r.status_code == 200, r.text
        data = r.json()
        # payments disabled, no key exposed
        assert data["enabled"] is False
        assert data["key_id"] is None
        assert data["currency"] == "INR"
        assert data["session_price_inr"] == 1000
        # plans
        plans = {p["id"]: p for p in data["plans"]}
        assert set(plans.keys()) == {"monthly", "quarterly", "annual"}
        assert plans["monthly"]["price_inr"] == 10000
        assert plans["quarterly"]["price_inr"] == 30000
        assert plans["annual"]["price_inr"] == 50000
        # each plan has name + blurb + days
        for p in data["plans"]:
            assert isinstance(p["name"], str) and p["name"]
            assert isinstance(p["blurb"], str)
            assert isinstance(p["days"], int) and p["days"] > 0


# ─────────────────────────── /payments/order ───────────────────────────
class TestPaymentsOrder:
    def test_order_unauth_returns_401(self, anon):
        r = anon.post(f"{API}/payments/order", json={"type": "plan", "plan_id": "monthly"})
        assert r.status_code == 401, r.text

    def test_order_plan_returns_503_while_disabled(self, bearer):
        r = bearer.post(f"{API}/payments/order", json={"type": "plan", "plan_id": "monthly"})
        assert r.status_code == 503, r.text
        detail = r.json().get("detail", "")
        assert "not configured" in detail.lower() or "razorpay" in detail.lower()

    def test_order_session_returns_503_while_disabled(self, bearer):
        r = bearer.post(f"{API}/payments/order", json={"type": "session", "booking_id": "any"})
        assert r.status_code == 503, r.text

    def test_order_all_plan_ids_503(self, bearer):
        for pid in ("monthly", "quarterly", "annual"):
            r = bearer.post(f"{API}/payments/order", json={"type": "plan", "plan_id": pid})
            assert r.status_code == 503, f"{pid}: {r.text}"


# ─────────────────────────── /payments/verify ───────────────────────────
class TestPaymentsVerify:
    def test_verify_unauth_returns_401(self, anon):
        r = anon.post(f"{API}/payments/verify", json={
            "razorpay_order_id": "x", "razorpay_payment_id": "y", "razorpay_signature": "z"
        })
        assert r.status_code == 401

    def test_verify_returns_503_while_disabled(self, bearer):
        r = bearer.post(f"{API}/payments/verify", json={
            "razorpay_order_id": "order_test", "razorpay_payment_id": "pay_test", "razorpay_signature": "sig_test"
        })
        assert r.status_code == 503, r.text


# ─────────────────────────── /payments/history ───────────────────────────
class TestPaymentsHistory:
    def test_history_unauth_returns_401(self, anon):
        r = anon.get(f"{API}/payments/history")
        assert r.status_code == 401

    def test_history_returns_list(self, bearer):
        r = bearer.get(f"{API}/payments/history")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # each item (if any) should have expected keys
        for t in data:
            assert "id" in t and "user_id" in t and "type" in t and "amount_inr" in t


# ─────────────────────────── Booking regression (payments disabled) ───────────────────────────
class TestBookingRegression:
    """Ensure booking create/list/cancel still works while payments are disabled."""

    def test_create_list_cancel_booking(self, bearer):
        # create — use a real seeded trainer, a valid weekday and an available slot
        import datetime as _dt
        trainers = bearer.get(f"{API}/trainers").json()["trainers"]
        assert trainers, "expected seeded trainers"
        tid = trainers[0]["trainer_id"]
        t = _dt.date.today()
        monday = t + _dt.timedelta(days=((0 - t.weekday()) % 7) + 7)  # a future Monday
        date = monday.isoformat()
        slots = bearer.get(f"{API}/trainers/{tid}/slots", params={"date": date}).json()["slots"]
        assert slots, "expected available slots on a weekday"
        slot = slots[0]

        r = bearer.post(f"{API}/bookings", json={"trainer_id": tid, "date": date, "time": slot})
        assert r.status_code in (200, 409), r.text
        if r.status_code == 409:
            lst = bearer.get(f"{API}/bookings").json()
            b = next((x for x in lst if x["date"] == date and x["time"] == slot), None)
            assert b, "expected leftover booking"
            bid = b["id"]
        else:
            b = r.json()
            assert b["date"] == date
            assert b.get("paid") is False or b.get("paid") is None
            assert b.get("room"), "booking should have a video room"
            bid = b["id"]

        # list contains it
        r = bearer.get(f"{API}/bookings")
        assert r.status_code == 200
        assert any(x["id"] == bid for x in r.json())

        # cancel
        r = bearer.delete(f"{API}/bookings/{bid}")
        assert r.status_code == 200
