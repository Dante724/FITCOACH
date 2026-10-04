"""
Core API checks against a running FitCoach API: accounts and auth, profile and photos, measurements,
bookings (incl. double-booking), payments while disabled, notifications and role permissions.
Creates its own users, so it can run against any fresh database started with SEED_DEMO_DATA=true.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = (os.getenv("TEST_ADMIN_EMAIL", "admin@fitcoach.com"), os.getenv("TEST_ADMIN_PASSWORD", "Admin@12345"))
TRAINER = ("sarah.trainer@fitcoach.com", "Trainer@123")
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


def session_for(token):
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"
    return s


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    s = session_for(r.json()["access_token"])
    s.me = r.json()
    return s


def register(name="Core Tester"):
    email = f"core_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/auth/register", json={"name": name, "email": email, "password": "Passw0rd!"}, timeout=15)
    assert r.status_code == 200, r.text
    s = session_for(r.json()["access_token"])
    s.me, s.email = r.json(), email
    return s


def next_weekday(weekday, weeks_ahead=2):
    d = datetime.now(timezone.utc).date() + timedelta(weeks=weeks_ahead)
    return (d + timedelta(days=(weekday - d.weekday()) % 7)).isoformat()


@pytest.fixture(scope="module")
def admin():
    return login(*ADMIN)


@pytest.fixture(scope="module")
def trainer():
    return login(*TRAINER)


@pytest.fixture(scope="module")
def client(admin, trainer):
    c = register("Core Client")
    c.put(f"{API}/profile/intake", json={"focus": "fat_loss", "weight_kg": 90})
    admin.put(f"{API}/admin/users/{c.me['user_id']}/coaches", json={"fitness_coach_id": trainer.me["user_id"]})
    return c


class TestAuth:
    def test_register_returns_token_and_cookie(self):
        email = f"core_{uuid.uuid4().hex[:10]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"name": "A", "email": email, "password": "Passw0rd!"})
        assert r.status_code == 200 and r.json()["access_token"] and r.json()["role"] == "client"
        assert "password_hash" not in r.json()
        assert "access_token" in r.cookies
        # duplicate and weak password
        assert requests.post(f"{API}/auth/register", json={"name": "A", "email": email, "password": "Passw0rd!"}).status_code == 409
        assert requests.post(f"{API}/auth/register", json={"name": "A", "email": "x" + email, "password": "short"}).status_code == 400

    def test_bearer_and_cookie_both_authenticate(self):
        c = register()
        assert c.get(f"{API}/auth/me").json()["email"] == c.email
        # The cookie fallback is HTTPS-only and cross-site capable (it can't be replayed over plain http here).
        r = requests.post(f"{API}/auth/login", json={"email": c.email, "password": "Passw0rd!"})
        cookie = r.headers["set-cookie"].lower()
        assert "access_token=" in cookie and "httponly" in cookie and "secure" in cookie and "samesite=none" in cookie
        assert requests.get(f"{API}/auth/me").status_code == 401
        assert session_for("not-a-token").get(f"{API}/auth/me").status_code == 401

    def test_wrong_password_and_lockout(self):
        c = register()
        codes = [requests.post(f"{API}/auth/login", json={"email": c.email, "password": "nope-nope"}).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429

    def test_auth_config_is_public(self):
        assert "google_client_id" in requests.get(f"{API}/auth/config").json()


class TestProfile:
    def test_rename_validation(self, client):
        assert client.put(f"{API}/profile", json={"name": "  Renamed Client "}).json()["name"] == "Renamed Client"
        assert client.put(f"{API}/profile", json={"name": " "}).status_code == 400
        assert client.put(f"{API}/profile", json={"name": "x" * 61}).status_code == 400

    def test_photo_rules(self, client):
        assert client.post(f"{API}/profile/photo", files={"file": ("a.txt", b"hello", "text/plain")}).status_code == 400
        big = PNG + b"0" * (5 * 1024 * 1024)
        assert client.post(f"{API}/profile/photo", files={"file": ("big.png", big, "image/png")}).status_code == 400
        r = client.post(f"{API}/profile/photo", files={"file": ("me.png", PNG, "image/png")})
        assert r.status_code == 200
        token = client.headers["Authorization"].split(" ", 1)[1]
        img = requests.get(f"{BASE_URL}{r.json()['picture']}", params={"auth": token})
        assert img.status_code == 200 and img.content == PNG
        assert requests.get(f"{API}/files/avatar/nope.png", params={"auth": token}).status_code == 404


class TestProgress:
    def test_measurements_crud(self, client):
        assert client.post(f"{API}/progress", json={"weight": 89.4, "waist": 96}).status_code == 200
        entries = client.get(f"{API}/progress").json()
        assert any(e.get("weight") == 89.4 for e in entries)
        eid = [e for e in entries if e.get("weight") == 89.4][0]["id"]
        assert client.delete(f"{API}/progress/{eid}").status_code == 200
        assert not any(e["id"] == eid for e in client.get(f"{API}/progress").json())

    def test_photo_reminder_tracks_uploads(self, client):
        ids = lambda: {r["id"] for r in client.get(f"{API}/notifications").json()["reminders"]}  # noqa: E731
        assert "rem-photo-weekly" in ids()
        photo = client.post(f"{API}/progress/photos", files={"file": ("p.png", PNG, "image/png")}).json()
        assert "rem-photo-weekly" not in ids()
        client.delete(f"{API}/progress/photos/{photo['id']}")
        assert "rem-photo-weekly" in ids()


class TestBookings:
    def test_book_double_book_and_cancel(self, client, trainer):
        tid = trainer.me["user_id"]
        monday = next_weekday(0)
        slots = client.get(f"{API}/trainers/{tid}/slots", params={"date": monday}).json()["slots"]
        assert slots
        slot = slots[-1]
        b = client.post(f"{API}/bookings", json={"trainer_id": tid, "date": monday, "time": slot})
        assert b.status_code == 200, b.text
        booking = b.json()
        assert slot not in client.get(f"{API}/trainers/{tid}/slots", params={"date": monday}).json()["slots"]
        assert client.post(f"{API}/bookings", json={"trainer_id": tid, "date": monday, "time": slot}).status_code == 409
        assert client.post(f"{API}/bookings", json={"trainer_id": tid, "date": monday, "time": "23:30"}).status_code == 409
        assert client.post(f"{API}/bookings", json={"trainer_id": tid, "date": next_weekday(6), "time": slot}).status_code == 409
        assert client.get(f"{API}/sessions/{booking['id']}").json()["with"] == trainer.me["name"]
        assert any(s["id"] == booking["id"] for s in trainer.get(f"{API}/trainer/sessions").json())
        assert client.delete(f"{API}/bookings/{booking['id']}").status_code == 200
        assert not any(x["id"] == booking["id"] for x in client.get(f"{API}/bookings").json())

    def test_cannot_book_someone_elses_coach(self, admin):
        loner = register()
        mike = [t for t in admin.get(f"{API}/trainers").json()["trainers"] if t["name"] == "Mike Chen"][0]
        r = loner.post(f"{API}/bookings", json={"trainer_id": mike["trainer_id"], "date": next_weekday(0), "time": "07:00"})
        assert r.status_code == 403


class TestPayments:
    def test_config_and_disabled_checkout(self, client):
        cfg = client.get(f"{API}/payments/config").json()
        assert {p["id"]: p["price_inr"] for p in cfg["plans"]} == {"monthly": 15000, "quarterly": 30000, "annual": 85000}
        assert cfg["session_price_inr"] == 1000 and cfg["currency"] == "INR"
        if not cfg["enabled"]:
            assert client.post(f"{API}/payments/order", json={"type": "plan", "plan_id": "monthly"}).status_code == 503
            assert client.post(f"{API}/payments/verify", json={"razorpay_order_id": "a", "razorpay_payment_id": "b", "razorpay_signature": "c"}).status_code == 503
        assert isinstance(client.get(f"{API}/payments/history").json(), list)
        assert requests.get(f"{API}/payments/config").status_code == 401


class TestRoles:
    def test_admin_only_endpoints(self, client, trainer, admin):
        for s in (client, trainer):
            assert s.get(f"{API}/admin/stats").status_code == 403
            assert s.get(f"{API}/admin/users").status_code == 403
        stats = admin.get(f"{API}/admin/stats").json()
        assert {"clients", "trainers", "unassigned", "active_members"} <= set(stats)
        assert all("password_hash" not in u for u in admin.get(f"{API}/admin/users").json())

    def test_trainer_only_endpoints(self, client, trainer):
        assert client.get(f"{API}/trainer/me").status_code == 403
        assert trainer.get(f"{API}/trainer/me").status_code == 200

    def test_admin_grants_membership(self, admin, client):
        r = admin.put(f"{API}/admin/users/{client.me['user_id']}/membership", json={"plan_id": "quarterly"})
        assert r.status_code == 200
        me = client.get(f"{API}/auth/me").json()
        assert me["membership_plan"] == "quarterly"
        admin.put(f"{API}/admin/users/{client.me['user_id']}/membership", json={"plan_id": None})
