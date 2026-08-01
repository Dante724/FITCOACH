"""Iteration 10 — landing/membership pricing + weekly photo reminder."""
import io
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv('/app/frontend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
TEST_SESSION = "test_session_fitcoach_1"


@pytest.fixture
def client():
    s = requests.Session()
    return s


@pytest.fixture
def auth_client():
    s = requests.Session()
    s.cookies.set("session_token", TEST_SESSION)
    return s


@pytest.fixture
def nutri_client():
    """Login as nutriuser@example.com to test the Membership page for a real client."""
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "nutriuser@example.com", "password": "Passw0rd!"})
    if r.status_code == 429:
        pytest.skip("Rate limited on login")
    assert r.status_code == 200, r.text
    return s


# ── Membership plan pricing via /api/payments/config ────────────────────────
class TestPaymentsConfig:
    def test_config_returns_new_prices(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/payments/config")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "plans" in body
        plans = {p["id"]: p for p in body["plans"]}
        assert plans["monthly"]["price_inr"] == 15000
        assert plans["quarterly"]["price_inr"] == 30000
        assert plans["annual"]["price_inr"] == 85000
        # ensure each plan has name + days
        for pid in ("monthly", "quarterly", "annual"):
            assert isinstance(plans[pid]["name"], str) and plans[pid]["name"]
            assert isinstance(plans[pid]["days"], int)

    def test_config_requires_auth(self, client):
        r = client.get(f"{BASE_URL}/api/payments/config")
        assert r.status_code in (401, 403)

    def test_config_for_email_client(self, nutri_client):
        r = nutri_client.get(f"{BASE_URL}/api/payments/config")
        assert r.status_code == 200
        prices = {p["id"]: p["price_inr"] for p in r.json()["plans"]}
        assert prices == {"monthly": 15000, "quarterly": 30000, "annual": 85000}


# ── Weekly progress-photo reminder in /api/notifications ────────────────────
def _get_photos(client):
    r = client.get(f"{BASE_URL}/api/progress/photos")
    assert r.status_code == 200, r.text
    j = r.json()
    if isinstance(j, list):
        return j
    return j.get("photos", [])


def _cleanup_photos(client, ids):
    for pid in ids:
        try:
            client.delete(f"{BASE_URL}/api/progress/photos/{pid}")
        except Exception:
            pass


class TestPhotoReminder:
    def test_reminder_present_when_no_recent_photo(self, auth_client):
        # Ensure clean slate — delete any existing photos for the test user
        existing = _get_photos(auth_client)
        ids = [p["id"] for p in existing]
        _cleanup_photos(auth_client, ids)

        r = auth_client.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        body = r.json()
        reminders = body.get("reminders", [])
        rem = next((x for x in reminders if x["id"] == "rem-photo-weekly"), None)
        assert rem is not None, f"missing rem-photo-weekly in {reminders}"
        assert rem["title"] == "Time for a progress photo"
        assert rem["link"] == "/progress"
        # badge should count the reminder
        assert body["badge"] >= body.get("unread", 0)  # reminder increments badge

    def test_reminder_disappears_after_upload_and_reappears_after_delete(self, auth_client):
        # start clean
        for p in _get_photos(auth_client):
            auth_client.delete(f"{BASE_URL}/api/progress/photos/{p['id']}")

        # Upload a photo (tiny PNG)
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
            b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00"
            b"\x03\x00\x01^\xf3*:\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        from datetime import date
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        data = {"date": date.today().isoformat(), "weight": "", "note": "TEST_reminder"}
        up = auth_client.post(f"{BASE_URL}/api/progress/photos", files=files, data=data)
        assert up.status_code == 200, up.text
        new_id = up.json()["id"]

        try:
            # reminder should be gone
            r = auth_client.get(f"{BASE_URL}/api/notifications")
            assert r.status_code == 200
            reminders = r.json().get("reminders", [])
            assert not any(x["id"] == "rem-photo-weekly" for x in reminders), \
                f"rem-photo-weekly should not appear after recent upload: {reminders}"
        finally:
            # cleanup — delete the uploaded photo
            d = auth_client.delete(f"{BASE_URL}/api/progress/photos/{new_id}")
            assert d.status_code in (200, 204)

        # And once deleted, reminder should reappear
        r2 = auth_client.get(f"{BASE_URL}/api/notifications")
        reminders2 = r2.json().get("reminders", [])
        assert any(x["id"] == "rem-photo-weekly" for x in reminders2), \
            "reminder should reappear after last photo deleted"


# ── Landing page (public HTML) sanity ───────────────────────────────────────
class TestLandingPublic:
    def test_landing_html_loads(self, client):
        # SPA root should return the index HTML (200) without auth
        r = client.get(BASE_URL + "/", timeout=30)
        assert r.status_code == 200
        assert "<div id=\"root\"" in r.text or "<html" in r.text.lower()
