"""
Backend tests for roles (admin/trainer/client), trainers listing + availability,
double-booking prevention, /sessions/{id}, /trainer/* and /admin/* endpoints.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fitness-dashboard-115.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@fitcoach.com"
ADMIN_PASSWORD = "Admin@12345"
TRAINER_EMAIL = "sarah.trainer@fitcoach.com"
TRAINER_PASSWORD = "Trainer@123"
CLIENT_EMAIL = "pwuser@example.com"
CLIENT_PASSWORD = "Passw0rd!"
GOOGLE_TEST_SESSION = "test_session_fitcoach_1"


def _next_monday_iso():
    d = datetime.now(timezone.utc).date()
    # find next Monday strictly in the future (>=7 days) to avoid slot collision
    days_ahead = (7 - d.weekday()) % 7 or 7
    return (d + timedelta(days=days_ahead + 7)).isoformat()


def _next_sunday_iso():
    d = datetime.now(timezone.utc).date()
    days_ahead = (6 - d.weekday()) % 7 or 7
    return (d + timedelta(days=days_ahead + 7)).isoformat()


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 429:
        pytest.skip(f"Rate-limited on {email}")
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json(), r.cookies.get("access_token")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ─── Auth + role gating ─────────────────────────────
class TestAdminAuth:
    def test_admin_login_role(self):
        data, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert data["role"] == "admin"
        assert tok

    def test_admin_stats_ok(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.get(f"{API}/admin/stats", headers=_auth(tok))
        assert r.status_code == 200
        body = r.json()
        for k in ("clients", "trainers", "bookings", "active_members"):
            assert k in body

    def test_admin_users_ok(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.get(f"{API}/admin/users", headers=_auth(tok))
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 4
        assert not any("password_hash" in u for u in users)

    def test_admin_stats_forbidden_for_client(self):
        # Use Google-session bearer
        r = requests.get(f"{API}/admin/stats", headers=_auth(GOOGLE_TEST_SESSION))
        assert r.status_code == 403

    def test_admin_stats_unauth(self):
        r = requests.get(f"{API}/admin/stats")
        assert r.status_code == 401


# ─── Trainers listing ─────────────────────────────
class TestTrainersList:
    def test_get_trainers_seeded(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        r = requests.get(f"{API}/trainers", headers=_auth(tok))
        assert r.status_code == 200
        trainers = r.json()["trainers"]
        emails_names = {t["name"] for t in trainers}
        assert any("Sarah" in n for n in emails_names)
        assert any("Mike" in n for n in emails_names)
        assert any("Priya" in n for n in emails_names)
        # No stale t1..t4
        assert not any(t["trainer_id"].startswith("t") and len(t["trainer_id"]) <= 3 for t in trainers)
        for t in trainers:
            assert set(t["available_days"]).issubset({0, 1, 2, 3, 4})
            assert "07:00" in t["available_times"] or "17:00" in t["available_times"]


# ─── Slots ─────────────────────────────
class TestSlots:
    def test_slots_on_monday_non_empty(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        trainers = requests.get(f"{API}/trainers", headers=_auth(tok)).json()["trainers"]
        tid = trainers[0]["trainer_id"]
        r = requests.get(f"{API}/trainers/{tid}/slots", params={"date": _next_monday_iso()}, headers=_auth(tok))
        assert r.status_code == 200
        assert len(r.json()["slots"]) > 0

    def test_slots_on_sunday_empty(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        trainers = requests.get(f"{API}/trainers", headers=_auth(tok)).json()["trainers"]
        tid = trainers[0]["trainer_id"]
        r = requests.get(f"{API}/trainers/{tid}/slots", params={"date": _next_sunday_iso()}, headers=_auth(tok))
        assert r.status_code == 200
        assert r.json()["slots"] == []


# ─── Bookings + double-booking ─────────────────────────────
class TestBookingsDoubleBook:
    def test_booking_and_double_booking(self):
        # Client 1 = pwuser (email/pw)
        _, tok_client = _login(CLIENT_EMAIL, CLIENT_PASSWORD)
        # Client 2 = Google test session (different user_id)
        _, tok_admin = _login(ADMIN_EMAIL, ADMIN_PASSWORD)  # for lookups only
        trainers = requests.get(f"{API}/trainers", headers=_auth(tok_admin)).json()["trainers"]
        tid = trainers[0]["trainer_id"]
        monday = _next_monday_iso()

        slots = requests.get(f"{API}/trainers/{tid}/slots", params={"date": monday},
                             headers=_auth(tok_client)).json()["slots"]
        assert slots, "No slots available on chosen Monday"
        chosen = slots[-1]  # pick a slot unlikely to collide

        # cleanup any existing pwuser booking at that slot
        my_bookings = requests.get(f"{API}/bookings", headers=_auth(tok_client)).json()
        for b in my_bookings:
            if b.get("trainer_id") == tid and b.get("date") == monday and b.get("time") == chosen:
                requests.delete(f"{API}/bookings/{b['id']}", headers=_auth(tok_client))

        # 1st booking OK
        r1 = requests.post(f"{API}/bookings", headers=_auth(tok_client),
                           json={"trainer_id": tid, "date": monday, "time": chosen})
        assert r1.status_code == 200, r1.text
        booking = r1.json()
        assert booking["room"], "room field missing"
        assert booking["trainer_id"] == tid

        try:
            # slot disappears
            slots2 = requests.get(f"{API}/trainers/{tid}/slots", params={"date": monday},
                                  headers=_auth(tok_client)).json()["slots"]
            assert chosen not in slots2

            # 2nd booking by SAME client -> 409
            r2 = requests.post(f"{API}/bookings", headers=_auth(tok_client),
                               json={"trainer_id": tid, "date": monday, "time": chosen})
            assert r2.status_code == 409

            # 2nd booking by DIFFERENT client (Google session) -> 409
            r3 = requests.post(f"{API}/bookings", headers=_auth(GOOGLE_TEST_SESSION),
                               json={"trainer_id": tid, "date": monday, "time": chosen})
            assert r3.status_code == 409, r3.text

            # Time NOT in trainer availability -> 409
            r4 = requests.post(f"{API}/bookings", headers=_auth(tok_client),
                               json={"trainer_id": tid, "date": monday, "time": "23:30"})
            assert r4.status_code == 409

            # Sunday -> 409
            r5 = requests.post(f"{API}/bookings", headers=_auth(tok_client),
                               json={"trainer_id": tid, "date": _next_sunday_iso(), "time": chosen})
            assert r5.status_code == 409

            # /sessions/{id} for client (owner)
            s_client = requests.get(f"{API}/sessions/{booking['id']}", headers=_auth(tok_client))
            assert s_client.status_code == 200
            assert s_client.json()["room"] == booking["room"]

            # /sessions/{id} for trainer (assigned)
            _, tok_trainer = _login(TRAINER_EMAIL, TRAINER_PASSWORD)
            s_trainer = requests.get(f"{API}/sessions/{booking['id']}", headers=_auth(tok_trainer))
            # tid may be Sarah (first trainer) — assert 200 only if the booking's trainer_id matches
            if booking["trainer_id"] == _me(tok_trainer)["user_id"]:
                assert s_trainer.status_code == 200
            # /sessions/{id} for unrelated user (Google test session, which is a client not the owner)
            s_other = requests.get(f"{API}/sessions/{booking['id']}", headers=_auth(GOOGLE_TEST_SESSION))
            assert s_other.status_code == 404
        finally:
            requests.delete(f"{API}/bookings/{booking['id']}", headers=_auth(tok_client))


def _me(tok):
    return requests.get(f"{API}/auth/me", headers=_auth(tok)).json()


# ─── Trainer endpoints ─────────────────────────────
class TestTrainerEndpoints:
    def test_trainer_me(self):
        _, tok = _login(TRAINER_EMAIL, TRAINER_PASSWORD)
        me = _me(tok)
        assert me["role"] == "trainer"
        r = requests.get(f"{API}/trainer/me", headers=_auth(tok))
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"specialty", "available_days", "available_times"}

    def test_trainer_update_and_readback(self):
        _, tok = _login(TRAINER_EMAIL, TRAINER_PASSWORD)
        payload = {
            "specialty": "Strength & Conditioning",
            "bio": "Coach Sarah",
            "available_days": [0, 1, 2, 3, 4],
            "available_times": ["07:00", "08:00", "09:00", "17:00", "18:00", "19:00"],
        }
        r = requests.put(f"{API}/trainer/me", headers=_auth(tok), json=payload)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/trainer/me", headers=_auth(tok))
        assert r2.json()["specialty"] == "Strength & Conditioning"
        assert r2.json()["available_days"] == [0, 1, 2, 3, 4]

    def test_trainer_sessions(self):
        _, tok = _login(TRAINER_EMAIL, TRAINER_PASSWORD)
        r = requests.get(f"{API}/trainer/sessions", headers=_auth(tok))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_trainer_endpoints_forbidden_for_client(self):
        r = requests.get(f"{API}/trainer/me", headers=_auth(GOOGLE_TEST_SESSION))
        assert r.status_code == 403
        r2 = requests.get(f"{API}/trainer/sessions", headers=_auth(GOOGLE_TEST_SESSION))
        assert r2.status_code == 403


# ─── Admin role / membership management ─────────────────────────────
class TestAdminManagement:
    def _make_temp_client(self):
        email = f"TEST_admin_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "Temp User", "email": email, "password": "Passw0rd!"})
        assert r.status_code == 200, r.text
        return r.json()["user_id"], email

    def test_role_change_promote_and_invalid(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        uid, _ = self._make_temp_client()
        # invalid role
        r_bad = requests.put(f"{API}/admin/users/{uid}/role",
                             headers=_auth(tok), json={"role": "wizard"})
        assert r_bad.status_code == 400
        # promote to trainer
        r_ok = requests.put(f"{API}/admin/users/{uid}/role",
                            headers=_auth(tok), json={"role": "trainer"})
        assert r_ok.status_code == 200
        # verify persistence + seeded availability
        users = requests.get(f"{API}/admin/users", headers=_auth(tok)).json()
        target = next(u for u in users if u["user_id"] == uid)
        assert target["role"] == "trainer"
        assert target.get("available_times")
        assert target.get("available_days") == [0, 1, 2, 3, 4]

    def test_membership_grant_and_revoke(self):
        _, tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        uid, _ = self._make_temp_client()
        # invalid plan
        r_bad = requests.put(f"{API}/admin/users/{uid}/membership",
                             headers=_auth(tok), json={"plan_id": "lifetime"})
        assert r_bad.status_code == 400
        # grant monthly
        r_ok = requests.put(f"{API}/admin/users/{uid}/membership",
                            headers=_auth(tok), json={"plan_id": "monthly"})
        assert r_ok.status_code == 200
        body = r_ok.json()
        assert body["membership_plan"] == "monthly"
        assert body["membership_expires_at"]
        # revoke
        r_rev = requests.put(f"{API}/admin/users/{uid}/membership",
                             headers=_auth(tok), json={"plan_id": None})
        assert r_rev.status_code == 200
        assert r_rev.json()["membership_plan"] is None
