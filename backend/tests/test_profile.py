"""Profile Settings feature tests: PUT /api/profile, POST /api/profile/photo, GET /api/files/{path}."""
import io
import os
import struct
import zlib

import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_backend_url()


def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


def _png_bytes() -> bytes:
    """Return a tiny valid 1x1 PNG."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def client_session():
    return _login("pwuser@example.com", "Passw0rd!")


@pytest.fixture(scope="module")
def trainer_session():
    return _login("sarah.trainer@fitcoach.com", "Trainer@123")


@pytest.fixture(scope="module")
def admin_session():
    return _login("admin@fitcoach.com", "Admin@12345")


# ─── PUT /api/profile (rename) ───
class TestProfileRename:
    def test_client_rename_and_persist(self, client_session):
        me0 = client_session.get(f"{BASE_URL}/api/auth/me").json()
        original = me0["name"]
        new_name = "Pat TestRenamed"
        r = client_session.put(f"{BASE_URL}/api/profile", json={"name": new_name})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        # persistence via /me
        me = client_session.get(f"{BASE_URL}/api/auth/me").json()
        assert me["name"] == new_name
        # restore
        client_session.put(f"{BASE_URL}/api/profile", json={"name": original})

    def test_empty_name_rejected(self, client_session):
        r = client_session.put(f"{BASE_URL}/api/profile", json={"name": "   "})
        assert r.status_code == 400

    def test_too_long_name_rejected(self, client_session):
        r = client_session.put(f"{BASE_URL}/api/profile", json={"name": "x" * 61})
        assert r.status_code == 400

    def test_trainer_rename(self, trainer_session):
        me0 = trainer_session.get(f"{BASE_URL}/api/auth/me").json()
        r = trainer_session.put(f"{BASE_URL}/api/profile", json={"name": "Sarah Test"})
        assert r.status_code == 200
        assert r.json()["name"] == "Sarah Test"
        trainer_session.put(f"{BASE_URL}/api/profile", json={"name": me0["name"]})

    def test_admin_rename(self, admin_session):
        me0 = admin_session.get(f"{BASE_URL}/api/auth/me").json()
        r = admin_session.put(f"{BASE_URL}/api/profile", json={"name": "Admin Test"})
        assert r.status_code == 200
        assert r.json()["name"] == "Admin Test"
        admin_session.put(f"{BASE_URL}/api/profile", json={"name": me0["name"]})

    def test_unauth_rejected(self):
        r = requests.put(f"{BASE_URL}/api/profile", json={"name": "Nope"}, timeout=15)
        assert r.status_code in (401, 403)


# ─── POST /api/profile/photo + GET /api/files ───
class TestProfilePhoto:
    def test_upload_photo_and_serve(self, client_session):
        png = _png_bytes()
        r = client_session.post(
            f"{BASE_URL}/api/profile/photo",
            files={"file": ("avatar.png", io.BytesIO(png), "image/png")},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("picture", "").startswith("http")
        assert "/api/files/" in data["picture"]

        # Fetch the served image with auth
        img = client_session.get(data["picture"])
        assert img.status_code == 200, f"file serve failed: {img.status_code}"
        assert img.headers.get("content-type", "").startswith("image/")
        assert len(img.content) == len(png)

        # Unauthenticated should be 401
        img_noauth = requests.get(data["picture"], timeout=15)
        assert img_noauth.status_code == 401

    def test_reject_non_image(self, client_session):
        r = client_session.post(
            f"{BASE_URL}/api/profile/photo",
            files={"file": ("bad.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert r.status_code == 400

    def test_reject_oversize(self, client_session):
        big = b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024 + 10)
        r = client_session.post(
            f"{BASE_URL}/api/profile/photo",
            files={"file": ("big.png", io.BytesIO(big), "image/png")},
        )
        assert r.status_code == 400

    def test_file_serve_unknown_path(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/files/does/not/exist.png")
        assert r.status_code == 404


# ─── Regression sanity ───
class TestRegression:
    def test_me_endpoint(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == "pwuser@example.com"

    def test_trainers_list(self, client_session):
        r = client_session.get(f"{BASE_URL}/api/trainers")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, (list, dict))
