"""Backend tests for the Meal Plan Builder feature.

Covers:
- POST /api/meal-plans/generate (Gemini AI) — returns plan dict, does NOT persist
- POST /api/meal-plans — save a generated plan
- GET  /api/meal-plans — list current user's saved plans (no _id leaks)
- DELETE /api/meal-plans/{id} — remove a saved plan
- Auth requirement (401 without cookies)
"""
import os
import time
import pytest
import requests

def _load_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert url, "REACT_APP_BACKEND_URL not set"
    return url.rstrip("/")

BASE_URL = _load_url()
NUTRI_EMAIL = "nutriuser@example.com"
NUTRI_PW = "Passw0rd!"


def _clear_lockout():
    try:
        import subprocess
        subprocess.run(
            ["mongosh", "--quiet", "--eval",
             "db.getSiblingDB('test_database').login_attempts.deleteMany({})"],
            capture_output=True, timeout=8,
        )
    except Exception:
        pass


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _clear_lockout()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": NUTRI_EMAIL, "password": NUTRI_PW}, timeout=15)
    if r.status_code == 429:
        _clear_lockout(); time.sleep(1)
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": NUTRI_EMAIL, "password": NUTRI_PW}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


# ── Auth guard ─────────────────────────────────────────────────
def test_list_requires_auth():
    r = requests.get(f"{BASE_URL}/api/meal-plans", timeout=10)
    assert r.status_code == 401


def test_generate_requires_auth():
    r = requests.post(f"{BASE_URL}/api/meal-plans/generate",
                      json={"goal": "fat_loss", "diet": "balanced"}, timeout=10)
    assert r.status_code == 401


# ── Core flow ──────────────────────────────────────────────────
def test_generate_returns_plan_and_does_not_persist(client):
    before = client.get(f"{BASE_URL}/api/meal-plans", timeout=15).json()
    r = client.post(f"{BASE_URL}/api/meal-plans/generate",
                    json={"goal": "fat_loss", "diet": "high_protein",
                          "calories": 1800, "allergies": "peanuts"},
                    timeout=90)
    assert r.status_code == 200, r.text
    plan = r.json()
    # Structure
    assert isinstance(plan, dict)
    assert "meals" in plan and isinstance(plan["meals"], list)
    assert len(plan["meals"]) >= 3
    for m in plan["meals"]:
        assert "meal" in m
        assert "calories" in m
    assert "total_calories" in plan
    # NOT persisted
    after = client.get(f"{BASE_URL}/api/meal-plans", timeout=15).json()
    assert len(after) == len(before)
    # Cache the generated plan on session for save test
    client._last_plan = plan  # type: ignore[attr-defined]


def test_save_list_delete_flow(client):
    plan = getattr(client, "_last_plan", None) or {
        "title": "Test plan", "meals": [
            {"meal": "Breakfast", "name": "Oats", "calories": 400,
             "protein_g": 20, "carbs_g": 60, "fat_g": 10, "items": ["oats", "milk"]},
        ], "total_calories": 1500, "total_protein_g": 100,
        "total_carbs_g": 150, "total_fat_g": 50,
    }
    name = f"TEST_plan_{int(time.time())}"

    # Save
    r = client.post(f"{BASE_URL}/api/meal-plans",
                    json={"name": name, "goal": "fat_loss",
                          "diet": "high_protein", "plan": plan}, timeout=15)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["name"] == name
    assert saved["goal"] == "fat_loss"
    assert saved["diet"] == "high_protein"
    assert "id" in saved
    assert "_id" not in saved
    plan_id = saved["id"]

    # List — the saved plan appears; no _id key
    r = client.get(f"{BASE_URL}/api/meal-plans", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    found = [i for i in items if i.get("id") == plan_id]
    assert len(found) == 1
    assert "_id" not in found[0]
    assert found[0]["name"] == name
    assert found[0]["plan"]["total_calories"] == plan["total_calories"]

    # Delete
    r = client.delete(f"{BASE_URL}/api/meal-plans/{plan_id}", timeout=15)
    assert r.status_code in (200, 204)

    # Verify gone
    r = client.get(f"{BASE_URL}/api/meal-plans", timeout=15)
    assert not any(i.get("id") == plan_id for i in r.json())


def test_save_rejects_missing_plan(client):
    r = client.post(f"{BASE_URL}/api/meal-plans",
                    json={"name": "TEST_no_plan"}, timeout=15)
    assert r.status_code in (400, 422)
