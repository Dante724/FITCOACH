"""
Forgot / reset password, in-process: emailed one-time links, no account enumeration, expiry and single use,
old sessions signed out, rate limits, and the admin "copy reset link" fallback when email isn't set up.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from inprocess import server


@pytest.fixture()
def api(monkeypatch):
    sent = []

    async def fake_send(to, subject, text, html):
        sent.append({"to": to, "subject": subject, "text": text, "html": html})
        return True

    monkeypatch.setattr(server, "send_email", fake_send)
    monkeypatch.setenv("APP_URL", "https://fitcoach.example")
    with TestClient(server.app) as c:
        c.sent = sent
        yield c


def run(coro):
    return asyncio.run(coro)


def register(api, email=None):
    email = email or f"reset_{uuid.uuid4().hex[:8]}@example.com"
    r = api.post("/api/auth/register", json={"name": "Reset Me", "email": email, "password": "OldPassw0rd", "consent": True}).json()
    return email, {"Authorization": f"Bearer {r['access_token']}"}, r


def link_token(mail):
    return mail["text"].split("token=")[1].split()[0]


def test_reset_flow_signs_out_old_sessions(api):
    email, old_h, me = register(api)
    assert api.get("/api/auth/me", headers=old_h).status_code == 200
    r = api.post("/api/auth/forgot", json={"email": email.upper()})
    assert r.json()["ok"] is True
    mail = api.sent[-1]
    assert mail["to"] == [email] and "https://fitcoach.example/reset-password?token=" in mail["text"]
    token = link_token(mail)
    stored = run(server.db.password_resets.find_one({"user_id": me["user_id"], "used": False}))
    assert token not in str(stored)  # only a hash is kept
    assert api.post("/api/auth/reset", json={"token": token, "password": "short"}).status_code == 400
    import time
    time.sleep(1.1)  # tokens carry whole-second timestamps
    assert api.post("/api/auth/reset", json={"token": token, "password": "NewPassw0rd"}).json()["email"] == email
    # old password and old sessions stop working; the new password works
    assert api.post("/api/auth/login", json={"email": email, "password": "OldPassw0rd"}).status_code == 401
    assert api.get("/api/auth/me", headers=old_h).status_code == 401
    assert api.post("/api/auth/login", json={"email": email, "password": "NewPassw0rd"}).status_code == 200
    # the link only works once
    r = api.post("/api/auth/reset", json={"token": token, "password": "Another1234"})
    assert r.status_code == 400 and "expired or was already used" in r.json()["detail"]


def test_unknown_email_gives_same_answer_and_no_mail(api):
    before = len(api.sent)
    r = api.post("/api/auth/forgot", json={"email": "nobody-here@example.com"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert api.post("/api/auth/forgot", json={"email": "not an email"}).json()["ok"] is True
    assert len(api.sent) == before


def test_expired_links_and_rate_limit(api):
    email, _, me = register(api)
    api.post("/api/auth/forgot", json={"email": email})
    token = link_token(api.sent[-1])
    run(server.db.password_resets.update_many({"user_id": me["user_id"]}, {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}}))
    assert api.post("/api/auth/reset", json={"token": token, "password": "NewPassw0rd"}).status_code == 400
    assert api.post("/api/auth/reset", json={"token": "made-up", "password": "NewPassw0rd"}).status_code == 400
    for _ in range(5):
        api.post("/api/auth/forgot", json={"email": email})
    mine = [m for m in api.sent if m["to"] == [email]]
    assert len(mine) == 3  # at most 3 emails an hour per account


def test_admin_reset_link_fallback(api):
    email, _, me = register(api)
    admin = {"Authorization": "Bearer " + api.post("/api/auth/login", json={"email": "admin@fitcoach.com", "password": "Admin@12345"}).json()["access_token"]}
    coach = {"Authorization": "Bearer " + api.post("/api/auth/login", json={"email": "sarah.trainer@fitcoach.com", "password": "Trainer@123"}).json()["access_token"]}
    assert api.post(f"/api/admin/users/{me['user_id']}/reset-link", headers=coach).status_code == 403
    r = api.post(f"/api/admin/users/{me['user_id']}/reset-link", headers=admin).json()
    assert r["link"].startswith("https://fitcoach.example/reset-password?token=") and r["expires_in_minutes"] == 60
    token = r["link"].split("token=")[1]
    assert api.post("/api/auth/reset", json={"token": token, "password": "ByAdminLink1"}).status_code == 200
    assert api.post("/api/auth/login", json={"email": email, "password": "ByAdminLink1"}).status_code == 200


def test_email_links_point_to_the_website(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://coach.example/")
    assert server.app_url() == "https://coach.example"
    monkeypatch.delenv("APP_URL")
    monkeypatch.delenv("APP_ORIGIN", raising=False)
    monkeypatch.setattr(server, "CORS_ORIGINS", ["https://fitcoach-web.onrender.com"])
    assert server.app_url() == "https://fitcoach-web.onrender.com"  # the website, not the API's own address


def test_change_password_while_signed_in(api):
    import time
    email, h, me = register(api)
    other_device = dict(h)
    assert api.get("/api/auth/password", headers=h).json()["has_password"] is True
    assert api.put("/api/auth/password", json={"current_password": "wrong-one", "new_password": "NewPassw0rd"}, headers=h).status_code == 400
    assert api.put("/api/auth/password", json={"current_password": "OldPassw0rd", "new_password": "short"}, headers=h).status_code == 400
    time.sleep(1.1)
    r = api.put("/api/auth/password", json={"current_password": "OldPassw0rd", "new_password": "NewPassw0rd"}, headers=h).json()
    this_device = {"Authorization": f"Bearer {r['access_token']}"}
    assert api.get("/api/auth/me", headers=this_device).status_code == 200      # stays signed in here
    assert api.get("/api/auth/me", headers=other_device).status_code == 401     # signed out elsewhere
    assert api.post("/api/auth/login", json={"email": email, "password": "NewPassw0rd"}).status_code == 200
    # Google-only accounts can add a password without a current one
    run(server.db.users.update_one({"user_id": me["user_id"]}, {"$unset": {"password_hash": ""}}))
    assert api.get("/api/auth/password", headers=this_device).json()["has_password"] is False
    assert api.put("/api/auth/password", json={"new_password": "FirstPass99"}, headers=this_device).status_code == 200
