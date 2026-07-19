"""
FitCoach — Email/Password auth tests (JWT + coexistence with Google session).

Covers:
- POST /api/auth/register  → 200 sets access_token cookie, returns user
- POST /api/auth/register  → 409 for duplicate email
- POST /api/auth/register  → 400 for password < 8 chars
- POST /api/auth/login     → 200 sets access_token cookie
- GET  /api/auth/me        → 200 with the JWT cookie
- POST /api/auth/login     → 401 for wrong password
- Brute force              → 429 after 5 wrong attempts (same ip+email)
- POST /api/auth/logout    → clears cookies
- Coexistence              → protected endpoints (bookings, profile/focus)
  work for BOTH Google Bearer session and JWT cookie users.
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://fitness-dashboard-115.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE}/api"
GOOGLE_TOKEN = os.getenv("TEST_GOOGLE_SESSION", "test_session_fitcoach_1")
SEEDED_EMAIL = os.getenv("TEST_CLIENT_EMAIL", "pwuser@example.com")
SEEDED_PASSWORD = os.getenv("TEST_CLIENT_PASSWORD", "Passw0rd!")


# ─────────────────────────── Helpers ───────────────────────────
def _mongo_login_attempts():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    return MongoClient(mongo_url)[db_name].login_attempts


@pytest.fixture(autouse=True)
def _clear_login_attempts_for_seeded_email():
    """Clear brute-force lockouts for the SEEDED email before EACH test.
    Uses a targeted delete (identifier suffix match) so parallel workers
    don't wipe each other's brute-force state.
    """
    try:
        col = _mongo_login_attempts()
        col.delete_many({"identifier": {"$regex": f":{SEEDED_EMAIL}$"}})
    except Exception:
        pass
    yield


@pytest.fixture
def anon():
    return requests.Session()


# ─────────────────────────── Register ───────────────────────────
class TestRegister:
    def test_register_new_user_sets_cookie(self, anon):
        unique = f"testreg_{uuid.uuid4().hex[:10]}@example.com"
        r = anon.post(f"{API}/auth/register", json={
            "name": "Reg User", "email": unique, "password": "Passw0rd!"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == unique
        assert data["name"] == "Reg User"
        assert "user_id" in data
        # httpOnly access_token cookie set
        assert "access_token" in anon.cookies.get_dict(), anon.cookies.get_dict()
        # /auth/me via the cookie returns the SAME user
        me = anon.get(f"{API}/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["user_id"] == data["user_id"]

    def test_register_duplicate_returns_409(self, anon):
        r = anon.post(f"{API}/auth/register", json={
            "name": "Dup", "email": SEEDED_EMAIL, "password": "Passw0rd!"
        })
        assert r.status_code == 409, r.text

    def test_register_short_password_returns_400(self, anon):
        r = anon.post(f"{API}/auth/register", json={
            "name": "Short",
            "email": f"testreg_{uuid.uuid4().hex[:10]}@example.com",
            "password": "short",
        })
        assert r.status_code == 400, r.text


# ─────────────────────────── Login ───────────────────────────
class TestLogin:
    def test_login_success_sets_cookie_and_me_works(self, anon):
        r = anon.post(f"{API}/auth/login", json={
            "email": SEEDED_EMAIL, "password": SEEDED_PASSWORD
        })
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == SEEDED_EMAIL
        assert "access_token" in anon.cookies.get_dict()
        me = anon.get(f"{API}/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["email"] == SEEDED_EMAIL

    def test_login_wrong_password_returns_401(self, anon):
        r = anon.post(f"{API}/auth/login", json={
            "email": SEEDED_EMAIL, "password": "WRONG_password_1"
        })
        assert r.status_code == 401, r.text

    def test_brute_force_lockout_returns_429(self, anon):
        # Use a UNIQUE email so parallel test workers don't interfere with the
        # login_attempts counter. Any 5 wrong attempts for the same (ip,email)
        # should trigger 429.
        target_email = f"lockout_{uuid.uuid4().hex[:10]}@example.com"
        # Pre-clean any prior state for this identifier
        try:
            _mongo_login_attempts().delete_many({"identifier": {"$regex": f":{target_email}$"}})
        except Exception:
            pass
        for i in range(5):
            r = anon.post(f"{API}/auth/login", json={
                "email": target_email, "password": f"wrong_{i}"
            })
            assert r.status_code == 401, f"attempt {i} unexpected: {r.status_code} {r.text}"
        r6 = anon.post(f"{API}/auth/login", json={
            "email": target_email, "password": "wrong_final"
        })
        assert r6.status_code == 429, r6.text
        # cleanup
        try:
            _mongo_login_attempts().delete_many({"identifier": {"$regex": f":{target_email}$"}})
        except Exception:
            pass


# ─────────────────────────── Logout ───────────────────────────
class TestLogout:
    def test_logout_clears_cookie(self, anon):
        # Login first
        r = anon.post(f"{API}/auth/login", json={
            "email": SEEDED_EMAIL, "password": SEEDED_PASSWORD
        })
        assert r.status_code == 200, r.text
        assert "access_token" in anon.cookies.get_dict()

        lo = anon.post(f"{API}/auth/logout")
        assert lo.status_code == 200
        # After logout requests session cookie is cleared
        assert "access_token" not in anon.cookies.get_dict()
        # And /auth/me now 401
        me = anon.get(f"{API}/auth/me")
        assert me.status_code == 401


# ─────────────────────────── Coexistence ───────────────────────────
class TestCoexistence:
    def test_google_bearer_still_works(self, anon):
        r = anon.get(f"{API}/auth/me", headers={
            "Authorization": f"Bearer {GOOGLE_TOKEN}"
        })
        assert r.status_code == 200, r.text
        assert r.json()["user_id"] == "user_testfitcoach1"

    def test_jwt_user_can_call_protected_endpoints(self, anon):
        # Login as email/password user → cookie session
        r = anon.post(f"{API}/auth/login", json={
            "email": SEEDED_EMAIL, "password": SEEDED_PASSWORD
        })
        assert r.status_code == 200, r.text
        # protected GET /api/bookings
        rb = anon.get(f"{API}/bookings")
        assert rb.status_code == 200, rb.text
        assert isinstance(rb.json(), list)
        # protected PUT /api/profile/focus
        rf = anon.put(f"{API}/profile/focus", json={"focus": "strength"})
        assert rf.status_code == 200, rf.text
        assert rf.json()["focus"] == "strength"

    def test_google_user_can_still_call_protected(self, anon):
        r = anon.get(f"{API}/bookings", headers={
            "Authorization": f"Bearer {GOOGLE_TOKEN}"
        })
        assert r.status_code == 200, r.text
