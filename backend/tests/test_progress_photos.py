"""Tests for the new Progress Photo Timeline endpoints."""
import io
import os
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "pwuser@example.com"
PASSWORD = "Passw0rd!"


def _make_png(w=8, h=8, color=(255, 0, 0)):
    """Create a minimal valid PNG in memory."""
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = b""
    row = bytes(color) * w
    for _ in range(h):
        raw += b"\x00" + row
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    # Try to clear any prior rate limits by logging in cleanly
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code == 429:
        pytest.skip("Login rate limited (429). Clear login_attempts and retry.")
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def created_ids():
    return []


def test_login(session):
    r = session.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert r.json().get("email") == EMAIL


def test_list_photos_authed(session):
    r = session.get(f"{API}/progress/photos")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_photos_unauth():
    r = requests.get(f"{API}/progress/photos")
    assert r.status_code in (401, 403)


def test_upload_photo(session, created_ids):
    png = _make_png()
    files = {"file": ("TEST_progress.png", io.BytesIO(png), "image/png")}
    data = {"date": "2025-01-05", "weight": "72.5", "note": "TEST_upload"}
    r = session.post(f"{API}/progress/photos", files=files, data=data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "id" in body and "url" in body
    assert body["date"] == "2025-01-05"
    assert body["weight"] == 72.5
    assert body["note"] == "TEST_upload"
    assert "_id" not in body
    assert "/api/files/" in body["url"]
    created_ids.append(body["id"])
    # verify persistence
    lst = session.get(f"{API}/progress/photos").json()
    assert any(p["id"] == body["id"] for p in lst)


def test_authed_image_serve(session, created_ids):
    assert created_ids, "no upload happened"
    lst = session.get(f"{API}/progress/photos").json()
    photo = next(p for p in lst if p["id"] == created_ids[0])
    url = photo["url"]
    # authed
    r = session.get(url)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    assert len(r.content) > 0
    # unauth should be denied
    r2 = requests.get(url)
    assert r2.status_code in (401, 403)


def test_upload_rejects_bad_ext(session):
    files = {"file": ("bad.txt", io.BytesIO(b"hello"), "text/plain")}
    r = session.post(f"{API}/progress/photos", files=files, data={"date": "2025-01-06"})
    assert r.status_code == 400


def test_upload_second_photo_ordering(session, created_ids):
    png = _make_png(color=(0, 255, 0))
    files = {"file": ("TEST_progress2.png", io.BytesIO(png), "image/png")}
    r = session.post(f"{API}/progress/photos", files=files, data={"date": "2025-02-10", "weight": "71.0"})
    assert r.status_code == 200
    pid = r.json()["id"]
    created_ids.append(pid)
    lst = session.get(f"{API}/progress/photos").json()
    ids = [p["id"] for p in lst]
    # Sorted by date asc → earlier photo comes first
    idx1 = ids.index(created_ids[0])
    idx2 = ids.index(created_ids[1])
    assert idx1 < idx2


def test_delete_photo(session, created_ids):
    # Delete both created photos
    for pid in list(created_ids):
        r = session.delete(f"{API}/progress/photos/{pid}")
        assert r.status_code == 200
    lst = session.get(f"{API}/progress/photos").json()
    for pid in created_ids:
        assert not any(p["id"] == pid for p in lst)
    # deleting non-existent returns 404
    r = session.delete(f"{API}/progress/photos/nonexistent-id-xyz")
    assert r.status_code == 404
    created_ids.clear()


def test_measurements_regression(session):
    r = session.get(f"{API}/progress")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
