"""
FitCoach backend tests (pytest)
Covers: auth, focus, trainers, bookings, progress, workouts, food (Gemini),
body scan (Gemini vision).
"""
import os
import io
import base64
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://fitness-dashboard-115.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
TOKEN = "test_session_fitcoach_1"


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


# Real jpeg image with visual features (procedurally generated silhouette)
@pytest.fixture(scope="module")
def person_image_b64():
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (240, 360), (230, 220, 200))
    d = ImageDraw.Draw(img)
    # head
    d.ellipse((100, 30, 140, 78), fill=(210, 175, 145))
    # torso
    d.rectangle((90, 80, 150, 200), fill=(80, 100, 160))
    # arms
    d.rectangle((70, 82, 90, 190), fill=(80, 100, 160))
    d.rectangle((150, 82, 170, 190), fill=(80, 100, 160))
    # hands
    d.ellipse((66, 186, 92, 208), fill=(210, 175, 145))
    d.ellipse((148, 186, 174, 208), fill=(210, 175, 145))
    # legs
    d.rectangle((95, 200, 118, 330), fill=(40, 40, 60))
    d.rectangle((122, 200, 145, 330), fill=(40, 40, 60))
    # shoes
    d.rectangle((90, 328, 122, 344), fill=(30, 30, 30))
    d.rectangle((122, 328, 152, 344), fill=(30, 30, 30))
    # ground line
    d.line((0, 345, 240, 345), fill=(120, 120, 120), width=2)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ─────────────────────────── Auth ───────────────────────────
class TestAuth:
    def test_me_bearer(self, bearer):
        r = bearer.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == "user_testfitcoach1"
        assert data["email"] == "test.fit@example.com"
        assert data["focus"] in {"strength", "nutrition", "yoga", "muscle_fat"}

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
        for f in ["strength", "nutrition", "yoga", "muscle_fat"]:
            r = bearer.put(f"{API}/profile/focus", json={"focus": f})
            assert r.status_code == 200, r.text
            assert r.json()["focus"] == f
        # restore
        bearer.put(f"{API}/profile/focus", json={"focus": "muscle_fat"})

    def test_invalid_focus(self, bearer):
        r = bearer.put(f"{API}/profile/focus", json={"focus": "invalid"})
        assert r.status_code == 400


# ─────────────────────────── Trainers ───────────────────────────
class TestTrainers:
    def test_list_trainers(self, bearer):
        r = bearer.get(f"{API}/trainers")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data["trainers"], list) and len(data["trainers"]) > 0
        assert isinstance(data["slots"], list) and len(data["slots"]) > 0
        assert "trainer_id" in data["trainers"][0]


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

    def test_plan_matches_focus(self, bearer):
        # ensure user focus is muscle_fat
        bearer.put(f"{API}/profile/focus", json={"focus": "muscle_fat"})
        r = bearer.get(f"{API}/workouts/plan")
        assert r.status_code == 200
        plan = r.json()
        assert "Hypertrophy" in plan["name"]  # muscle_fat plan
        assert isinstance(plan["exercises"], list) and len(plan["exercises"]) > 0

    def test_plan_strength_variant(self, bearer):
        bearer.put(f"{API}/profile/focus", json={"focus": "strength"})
        r = bearer.get(f"{API}/workouts/plan")
        assert r.status_code == 200
        assert "Strength" in r.json()["name"]
        bearer.put(f"{API}/profile/focus", json={"focus": "muscle_fat"})

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


# ─────────────────────────── AI Body Scan (Gemini vision) ───────────────────────────
class TestBodyScan:
    scan_id = None

    def test_analyze_body(self, bearer, person_image_b64):
        r = bearer.post(f"{API}/bodyscan/analyze", json={"image_base64": person_image_b64}, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        result = data["result"]
        assert result["body_type"] in {"Ectomorph", "Mesomorph", "Endomorph"}
        assert isinstance(result["description"], str) and len(result["description"]) > 10
        assert isinstance(result["training_focus"], str) and len(result["training_focus"]) > 5
        assert isinstance(result["nutrition_focus"], str) and len(result["nutrition_focus"]) > 5
        TestBodyScan.scan_id = data["id"]

    def test_history(self, bearer):
        r = bearer.get(f"{API}/bodyscan/history")
        assert r.status_code == 200
        assert any(h["id"] == TestBodyScan.scan_id for h in r.json())
