"""
Google sign-in, tested in-process with Google's token check simulated (no network, no running server).
Run from backend/:  python -m pytest tests/test_google_login.py
"""
import os

import pytest

from inprocess import server
from fastapi.testclient import TestClient  # noqa: E402

CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]


class FakeResponse:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


def fake_google(claims_by_token):
    class FakeAsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None):
            assert url == "https://oauth2.googleapis.com/tokeninfo"
            claims = claims_by_token.get(params["id_token"])
            return FakeResponse(200, claims) if claims else FakeResponse(400, {"error": "invalid_token"})
    return FakeAsyncClient


GOOD = {"aud": CLIENT_ID, "iss": "https://accounts.google.com", "email": "Priya.Rao@Gmail.com", "email_verified": "true",
        "name": "Priya Rao", "picture": "https://lh3.googleusercontent.com/a/photo", "sub": "1234567890"}


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setattr(server.httpx, "AsyncClient", fake_google({
        "good": GOOD,
        "wrong-aud": {**GOOD, "aud": "someone-else.apps.googleusercontent.com"},
        "unverified": {**GOOD, "email_verified": "false"},
        "wrong-iss": {**GOOD, "iss": "evil.example.com"},
    }))
    with TestClient(server.app) as c:
        yield c


def test_config_exposes_client_id(api):
    assert api.get("/api/auth/config").json() == {"google_client_id": CLIENT_ID}


def test_new_google_user_is_created_and_signed_in(api):
    r = api.post("/api/auth/google", json={"credential": "good"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "priya.rao@gmail.com" and body["role"] == "client" and body["name"] == "Priya Rao"
    assert body["picture"].startswith("https://lh3.googleusercontent.com/")
    me = api.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["user_id"] == body["user_id"]


def test_existing_email_account_is_linked_not_duplicated(api):
    reg = api.post("/api/auth/register", json={"name": "Arjun", "email": "arjun@example.com", "password": "Passw0rd!"}).json()
    server_claims = {**GOOD, "email": "arjun@example.com", "sub": "999"}
    from unittest.mock import patch
    with patch.object(server.httpx, "AsyncClient", fake_google({"arjun": server_claims})):
        r = api.post("/api/auth/google", json={"credential": "arjun"})
    assert r.status_code == 200 and r.json()["user_id"] == reg["user_id"]


@pytest.mark.parametrize("token", ["wrong-aud", "unverified", "wrong-iss", "garbage"])
def test_rejects_bad_tokens(api, token):
    assert api.post("/api/auth/google", json={"credential": token}).status_code == 401
