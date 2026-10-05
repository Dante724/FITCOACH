"""
Admin password management, in-process: the admin changes their own password in the app (kept across restarts),
ADMIN_PASSWORD on the server still works as an emergency reset, and admins can give someone a temporary password
that they must replace at next sign-in.
"""
import asyncio
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from inprocess import server

ORIGINAL = "Admin@12345"


@pytest.fixture()
def api():
    with TestClient(server.app) as c:
        yield c


def run(coro):
    return asyncio.run(coro)


def login(api, email, pw):
    return api.post("/api/auth/login", json={"email": email, "password": pw})


def bearer(r):
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_admin_changes_own_password_and_it_survives_restarts(api, monkeypatch):
    old = bearer(login(api, "admin@fitcoach.com", ORIGINAL))
    try:
        assert api.get("/api/auth/password", headers=old).json()["is_main_admin"] is True
        assert api.put("/api/auth/password", json={"current_password": "nope", "new_password": "NewAdminPass1"}, headers=old).status_code == 400
        assert api.put("/api/auth/password", json={"current_password": ORIGINAL, "new_password": "short1"}, headers=old).status_code == 400  # admins need 10+
        time.sleep(1.1)
        r = api.put("/api/auth/password", json={"current_password": ORIGINAL, "new_password": "NewAdminPass1"}, headers=old)
        assert r.status_code == 200
        assert api.get("/api/auth/me", headers=old).status_code == 401              # other sessions signed out
        assert api.get("/api/auth/me", headers=bearer(r)).status_code == 200        # this one stays in
        run(server.seed_roles())                                                     # a restart doesn't undo it
        assert login(api, "admin@fitcoach.com", "NewAdminPass1").status_code == 200
        assert login(api, "admin@fitcoach.com", ORIGINAL).status_code == 401
        # changing ADMIN_PASSWORD on the server is the emergency reset
        monkeypatch.setattr(server, "ADMIN_PASSWORD", "EmergencyReset99")
        run(server.seed_roles())
        assert login(api, "admin@fitcoach.com", "EmergencyReset99").status_code == 200
        assert login(api, "admin@fitcoach.com", "NewAdminPass1").status_code == 401
    finally:
        monkeypatch.setattr(server, "ADMIN_PASSWORD", ORIGINAL)
        run(server.seed_roles())  # back to the test password for the other suites
    assert login(api, "admin@fitcoach.com", ORIGINAL).status_code == 200


def test_admin_sets_a_temporary_password(api):
    admin = bearer(login(api, "admin@fitcoach.com", ORIGINAL))
    me_admin = api.get("/api/auth/me", headers=admin).json()
    email = f"temp_{uuid.uuid4().hex[:8]}@example.com"
    reg = api.post("/api/auth/register", json={"name": "Locked Out", "email": email, "password": "Forgotten123", "consent": True}).json()
    their_old = {"Authorization": f"Bearer {reg['access_token']}"}
    time.sleep(1.1)
    assert api.post(f"/api/admin/users/{reg['user_id']}/password", json={"new_password": "short"}, headers=admin).status_code == 400
    assert api.post(f"/api/admin/users/{reg['user_id']}/password", json={"new_password": "TempPass-4821"}, headers=admin).status_code == 200
    assert api.get("/api/auth/me", headers=their_old).status_code == 401
    r = login(api, email, "TempPass-4821")
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    h = bearer(r)
    note = run(server.db.notifications.find_one({"user_id": reg["user_id"], "title": "Your password was reset"}))
    assert note is not None
    api.put("/api/auth/password", json={"current_password": "TempPass-4821", "new_password": "MyOwnPass99"}, headers=h)
    assert login(api, email, "MyOwnPass99").json()["must_change_password"] is False
    assert run(server.db.audit_log.count_documents({"user_id": reg["user_id"]})) == 2
    # guard rails
    assert api.post(f"/api/admin/users/{me_admin['user_id']}/password", json={"new_password": "Whatever123"}, headers=admin).status_code == 400
    coach = bearer(login(api, "sarah.trainer@fitcoach.com", "Trainer@123"))
    assert api.post(f"/api/admin/users/{reg['user_id']}/password", json={"new_password": "Whatever123"}, headers=coach).status_code == 403
