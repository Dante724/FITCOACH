"""
FitCoach backend tests (pytest)
Covers: auth, focus, trainers, bookings, progress, workouts, food (Gemini).
"""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://fitness-dashboard-115.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
TOKEN = os.environ.get("TEST_SESSION_TOKEN", "test_session_fitcoach_1")


# ─────────────────────────── Fixtures ───────────────────────────
@pytest.fixture(scope="module")
def bearer():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def cookie_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.cookies.set("session_token", TOKEN)
    return s


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ─────────────────────────── Auth ───────────────────────────
class TestAuth:
    def test_me_bearer(self, bearer):
        r = bearer.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == "user_testfitcoach1"
        assert data["email"] == "test.fit@example.com"
        assert data["focus"] in {"fat_loss", "muscle_gain", "yoga", "hybrid"}

    def test_me_cookie(self, cookie_client):
        r = cookie_client.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        assert r.json()["user_id"] == "user_testfitcoach1"

    def test_me_no_auth(self, anon):
        r = anon.get(f"{API}/auth/me")
        assert r.status_code == 401


# ─────────────────────────── Focus ───────────────────────────
class TestFocus:
    def test_set_all_focus_values(self, bearer):
        for f in ["fat_loss", "muscle_gain", "yoga", "hybrid"]:
            r = bearer.put(f"{API}/profile/focus", json={"focus": f})
            assert r.status_code == 200, r.text
            assert r.json()["focus"] == f
        # v1 programme keys are still accepted and mapped to v2 goals
        assert bearer.put(f"{API}/profile/focus", json={"focus": "muscle_fat"}).json()["focus"] == "fat_loss"

    def test_invalid_focus(self, bearer):
        r = bearer.put(f"{API}/profile/focus", json={"focus": "invalid"})
        assert r.status_code == 400


# ─────────────────────────── Trainers ───────────────────────────
class TestTrainers:
    def test_list_trainers(self, bearer):
        r = bearer.get(f"{API}/trainers")
        assert r.status_code == 200
        data = r.json()
        # clients only see their own assigned coaches
        assert isinstance(data["trainers"], list)
        for t in data["trainers"]:
            assert "trainer_id" in t and t["coach_type"] in {"fitness", "yoga"}


# ─────────────────────────── Bookings ───────────────────────────
class TestBookings:
    booking_id = None
    date = "2026-12-25"
    time = "07:00"

    def test_create_booking(self, bearer):
        r = bearer.post(f"{API}/bookings", json={"trainer_id": "t1", "date": self.date, "time": self.time})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["trainer_name"] == "Sarah Johnson"
        assert b["date"] == self.date
        TestBookings.booking_id = b["id"]

    def test_list_contains_created(self, bearer):
        r = bearer.get(f"{API}/bookings")
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert TestBookings.booking_id in ids

    def test_duplicate_returns_409(self, bearer):
        r = bearer.post(f"{API}/bookings", json={"trainer_id": "t1", "date": self.date, "time": self.time})
        assert r.status_code == 409

    def test_delete_booking(self, bearer):
        r = bearer.delete(f"{API}/bookings/{TestBookings.booking_id}")
        assert r.status_code == 200
        r2 = bearer.get(f"{API}/bookings")
        assert TestBookings.booking_id not in [b["id"] for b in r2.json()]


# ─────────────────────────── Progress ───────────────────────────
class TestProgress:
    entry_id = None

    def test_create_entry(self, bearer):
        payload = {"weight": 74.2, "body_fat": 18.4, "chest": 102, "waist": 82, "hips": 96, "arms": 36}
        r = bearer.post(f"{API}/progress", json=payload)
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["weight"] == 74.2
        assert e["waist"] == 82
        TestProgress.entry_id = e["id"]

    def test_list_contains(self, bearer):
        r = bearer.get(f"{API}/progress")
        assert r.status_code == 200
        entries = r.json()
        assert any(e["id"] == TestProgress.entry_id for e in entries)

    def test_delete_entry(self, bearer):
        r = bearer.delete(f"{API}/progress/{TestProgress.entry_id}")
        assert r.status_code == 200


# ─────────────────────────── Workouts ───────────────────────────
class TestWorkouts:
    session_id = None

    def test_plan_is_coach_approved_or_null(self, bearer):
        # plans are drafted by the assigned coach; until one is approved the client gets null
        r = bearer.get(f"{API}/workouts/plan")
        assert r.status_code == 200
        plan = r.json()["plan"]
        assert plan is None or (plan["status"] == "active" and plan["approved_by_name"])

    def test_log_session(self, bearer):
        payload = {"name": "TEST_Session", "exercises": [{"name": "Squat", "meta": "5x5"}], "duration_min": 30, "notes": "1/5"}
        r = bearer.post(f"{API}/workouts/sessions", json=payload)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["name"] == "TEST_Session"
        TestWorkouts.session_id = s["id"]

    def test_list_sessions(self, bearer):
        r = bearer.get(f"{API}/workouts/sessions")
        assert r.status_code == 200
        assert any(s["id"] == TestWorkouts.session_id for s in r.json())


# ─────────────────────────── AI Food (Gemini) ───────────────────────────
class TestFoodAI:
    log_id = None

    def test_analyze_returns_real_macros(self, bearer):
        payload = {"description": "2 boiled eggs and a bowl of oatmeal with berries"}
        r = bearer.post(f"{API}/food/analyze", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        result = data["result"]
        # numeric macros
        for k in ("calories", "protein_g", "carbs_g", "fat_g"):
            assert isinstance(result[k], (int, float)), f"{k} not numeric: {result.get(k)!r}"
        # reasonable ranges (not mocked zeros)
        assert 150 <= result["calories"] <= 800, result["calories"]
        assert result["protein_g"] > 5
        TestFoodAI.log_id = data["id"]

    def test_logs_contains(self, bearer):
        r = bearer.get(f"{API}/food/logs")
        assert r.status_code == 200
        assert any(l["id"] == TestFoodAI.log_id for l in r.json())

    def test_delete_log(self, bearer):
        r = bearer.delete(f"{API}/food/logs/{TestFoodAI.log_id}")
        assert r.status_code == 200


