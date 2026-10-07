"""
Business-risk fixes, in-process: the login cookie can't be used by other websites, relay (TURN) credentials for
calls, trial intro sessions needing the coach's OK, and coach client limits.
"""
import asyncio
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from inprocess import server


@pytest.fixture()
def api():
    with TestClient(server.app) as c:
        asyncio.run(server.db.app_settings.delete_many({"_id": "billing"}))
        yield c


def run(coro):
    return asyncio.run(coro)


def login(api, email, pw="Trainer@123"):
    r = api.post("/api/auth/login", json={"email": email, "password": pw}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def new_client(api, coach_email="sarah.trainer@fitcoach.com"):
    r = api.post("/api/auth/register", json={"name": "Rel Test", "email": f"rel_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", "consent": True})
    me = r.json()
    h = {"Authorization": f"Bearer {me['access_token']}"}
    api.put("/api/profile/intake", json={"focus": "fat_loss"}, headers=h)
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    coach_h, coach = login(api, coach_email)
    api.put(f"/api/admin/users/{me['user_id']}/coaches", json={"fitness_coach_id": coach["user_id"], "force": True}, headers=admin)
    return h, me, coach_h, coach, admin, r.cookies.get("access_token")


def next_slot(days=7):
    """A free slot for Sarah, well away from the dates other test files book."""
    d = datetime.now(server.APP_TZ).date() + timedelta(days=days + 40)
    while True:
        if d.weekday() in server.DEFAULT_DAYS:
            for t in server.DEFAULT_TIMES:
                if not run(server.db.bookings.find_one({"date": d.isoformat(), "time": t})):
                    return d.isoformat(), t
        d += timedelta(days=1)


# ── security ─────────────────────────────────────────
def test_cookie_is_ignored_on_requests_from_other_websites(api):
    h, me, *_ , cookie = new_client(api)
    jar = {"access_token": cookie}
    api.cookies.clear()
    assert api.get("/api/auth/me", cookies=jar).status_code == 200                                       # same-site use still works
    assert api.get("/api/auth/me", cookies=jar, headers={"Origin": "https://evil.example"}).status_code == 401
    assert api.get("/api/auth/me", cookies=jar, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 401
    assert api.post("/api/payments/subscription/cancel", cookies=jar, headers={"Origin": "https://evil.example"}).status_code == 401
    assert api.get("/api/auth/me", headers={**h, "Origin": "https://evil.example"}).status_code == 200  # the app's Bearer header is unaffected


def test_older_app_builds_can_still_sign_in_across_sites(api):
    """Builds that send requests "with credentials" need this header, or the browser discards the sign-in reply."""
    r = api.options("/api/auth/login", headers={"Origin": "https://thefitcoach.in", "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "content-type"})
    assert r.headers.get("access-control-allow-credentials") == "true"
    assert r.headers.get("access-control-allow-origin") == "https://thefitcoach.in"
    # …and the cookie still can't be used by another site (see test_cookie_is_ignored_on_requests_from_other_websites)

# ── calls: relay servers ─────────────────────────────
class FakeResp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class FakeHttp:
    calls = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, **k):
        FakeHttp.calls.append(url)
        return FakeResp(200, [{"urls": "turn:global.relay.metered.ca:80", "username": "u", "credential": "c"}])

    async def post(self, url, **k):
        FakeHttp.calls.append(url)
        return FakeResp(201, {"iceServers": [{"urls": ["turn:turn.cloudflare.com:3478?transport=udp"], "username": "x", "credential": "y"}]})


def test_relay_credentials_from_providers_are_cached(api, monkeypatch):
    h, *_ = new_client(api)
    assert api.get("/api/calls/ice", headers=h).json()["relay"] is False
    monkeypatch.setattr(server, "METERED_DOMAIN", "fitcoach.metered.live")
    monkeypatch.setattr(server, "METERED_API_KEY", "k")
    monkeypatch.setattr(server, "CLOUDFLARE_TURN_KEY_ID", "kid")
    monkeypatch.setattr(server, "CLOUDFLARE_TURN_API_TOKEN", "tok")
    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setitem(server._relay_cache, "at", None)
    FakeHttp.calls.clear()
    ice = api.get("/api/calls/ice", headers=h).json()
    urls = [s["urls"] for s in ice["iceServers"]]
    assert ice["relay"] is True and "turn:global.relay.metered.ca:80" in urls and ["turn:turn.cloudflare.com:3478?transport=udp"] in urls
    api.get("/api/calls/ice", headers=h)
    assert len(FakeHttp.calls) == 2  # second request served from the cache


# ── trial intro sessions ─────────────────────────────
def test_trial_intro_session_needs_coach_ok(api):
    h, me, coach_h, coach, admin, _ = new_client(api)
    date, time = next_slot()
    b = api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": date, "time": time}, headers=h).json()
    assert b["status"] == "requested" and b["paid"] is True
    assert api.post(f"/api/calls/booking/{b['id']}", headers=h).status_code == 409
    todo = api.get("/api/coach/attention", headers=coach_h).json()
    assert any(i["kind"] == "session_request" and i["booking_id"] == b["id"] for i in todo)
    # another coach can't decide it
    other_h, _ = login(api, "mike.trainer@fitcoach.com")
    assert api.post(f"/api/bookings/{b['id']}/decision", json={"approve": True}, headers=other_h).status_code == 404
    # decline → slot freed and the free session returned
    assert api.post(f"/api/bookings/{b['id']}/decision", json={"approve": False, "note": "Fully booked that day"}, headers=coach_h).json()["status"] == "declined"
    assert api.get("/api/me/membership", headers=h).json()["credits"] == 1
    # book again → approve → the call opens
    b2 = api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": date, "time": time}, headers=h).json()
    assert api.post(f"/api/bookings/{b2['id']}/decision", json={"approve": True}, headers=coach_h).json()["status"] == "confirmed"
    assert api.post(f"/api/calls/booking/{b2['id']}", headers=h).status_code == 200
    note = run(server.db.notifications.find_one({"user_id": me["user_id"], "title": "Intro session confirmed"}))
    assert note is not None


def test_intro_approval_can_be_switched_off_and_paid_members_skip_it(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    b = api.get("/api/admin/billing", headers=admin).json()
    body = {k: b[k] for k in ("session_price_inr", "trial_days", "grace_days", "referral_reward_days", "referee_bonus_days",
                              "payout_per_client_inr", "payout_per_session_inr", "packs")}
    api.put("/api/admin/billing", json={**body, "trial_intro_approval": False}, headers=admin)
    h, me, coach_h, coach, *_ = new_client(api)
    date, time = next_slot(8)
    assert api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": date, "time": time}, headers=h).json()["status"] == "confirmed"
    api.put("/api/admin/billing", json={**body, "trial_intro_approval": True}, headers=admin)
    h2, me2, _, _, _, _ = new_client(api)
    run(server.activate_membership(me2["user_id"], run(server.get_plan("monthly")), "test"))
    date2, time2 = next_slot(9)
    assert api.post("/api/bookings", json={"trainer_id": coach["user_id"], "date": date2, "time": time2}, headers=h2).json()["status"] == "confirmed"


# ── coach capacity ───────────────────────────────────
def test_coach_client_limit(api):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    _, mike = login(api, "mike.trainer@fitcoach.com")
    api.put(f"/api/admin/users/{mike['user_id']}/coach-type", json={"coach_type": "fitness", "max_clients": 1}, headers=admin)
    clients = []
    for _ in range(2):
        r = api.post("/api/auth/register", json={"name": "Cap", "email": f"cap_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", "consent": True}).json()
        clients.append(r["user_id"])
    current = run(server.db.users.count_documents({"role": "client", "fitness_coach_id": mike["user_id"]}))
    if current == 0:
        assert api.put(f"/api/admin/users/{clients[0]}/coaches", json={"fitness_coach_id": mike["user_id"]}, headers=admin).status_code == 200
    r = api.put(f"/api/admin/users/{clients[1]}/coaches", json={"fitness_coach_id": mike["user_id"]}, headers=admin)
    assert r.status_code == 409 and "of 1 clients" in r.json()["detail"]
    assert not run(server.db.notifications.find_one({"user_id": clients[1], "title": "Your coach is here"}))  # nothing sent on refusal
    assert api.put(f"/api/admin/users/{clients[1]}/coaches", json={"fitness_coach_id": mike["user_id"], "force": True}, headers=admin).status_code == 200
    api.put(f"/api/admin/users/{mike['user_id']}/coach-type", json={"coach_type": "fitness", "max_clients": 30}, headers=admin)


def test_slots_never_offer_times_that_have_passed(api):
    h, me, coach_h, coach, *_ = new_client(api)
    today = datetime.now(server.APP_TZ).date()
    for offset in range(8):  # find today-or-later days the coach works
        d = today + timedelta(days=offset)
        slots = api.get(f"/api/trainers/{coach['user_id']}/slots", params={"date": d.isoformat()}, headers=h).json()["slots"]
        for t in slots:
            assert server.booking_dt(d.isoformat(), t) > datetime.now(server.timezone.utc), (d, t)
    past = (today - timedelta(days=1)).isoformat()
    assert api.get(f"/api/trainers/{coach['user_id']}/slots", params={"date": past}, headers=h).json()["slots"] == []


# ── calls: screen-share status reaches the other person ─────
def test_screen_share_state_is_relayed(api):
    h, me, coach_h, coach, *_ = new_client(api)
    call = api.post("/api/calls/instant", json={"peer_id": me["user_id"]}, headers=coach_h).json()
    api.post(f"/api/calls/{call['id']}/join", headers=h)
    api.post(f"/api/calls/{call['id']}/join", headers=coach_h)
    api.get(f"/api/calls/{call['id']}/signals", headers=h)  # clear anything already waiting
    assert api.post(f"/api/calls/{call['id']}/signal", json={"type": "state", "payload": {"screen": True}}, headers=coach_h).status_code == 200
    got = api.get(f"/api/calls/{call['id']}/signals", headers=h).json()["signals"]
    assert [(s["type"], s["payload"]) for s in got] == [("state", {"screen": True})]


def test_show_a_photo_in_a_call(api):
    h, me, coach_h, coach, *_ = new_client(api)
    call = api.post("/api/calls/instant", json={"peer_id": me["user_id"]}, headers=coach_h).json()
    api.post(f"/api/calls/{call['id']}/join", headers=h)
    api.post(f"/api/calls/{call['id']}/join", headers=coach_h)
    api.get(f"/api/calls/{call['id']}/signals", headers=coach_h)
    png = b"\\x89PNG\\r\\n\\x1a\\n" + b"0" * 64
    r = api.post(f"/api/calls/{call['id']}/show", files={"file": ("plan.png", png, "image/png")}, headers=h)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    got = api.get(f"/api/calls/{call['id']}/signals", headers=coach_h).json()["signals"]
    assert [(s["type"], s["payload"]) for s in got] == [("state", {"show": url})]
    assert api.get(url, headers=coach_h).status_code == 200          # the other person can open it
    other_h, _ = login(api, "mike.trainer@fitcoach.com")
    assert api.get(url, headers=other_h).status_code == 404          # nobody else can
    assert api.post(f"/api/calls/{call['id']}/show", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=h).status_code == 400
