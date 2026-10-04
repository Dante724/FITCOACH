"""
Web Push, tested in-process with the push service simulated: key management, subscriptions,
fan-out of notifications, call notifications with Answer/Decline, and cleanup of dead subscriptions.
"""
import asyncio
import time
import uuid

import pytest
import pywebpush
from fastapi.testclient import TestClient

from inprocess import server

SUB = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "BPkey", "auth": "authkey"}}


class FakePush:
    def __init__(self, status_by_endpoint=None):
        self.calls, self.status = [], status_by_endpoint or {}

    def __call__(self, subscription_info, data, vapid_private_key, vapid_claims, ttl, headers, timeout):
        import json
        self.calls.append({"endpoint": subscription_info["endpoint"], "payload": json.loads(data), "ttl": ttl, "headers": headers})
        code = self.status.get(subscription_info["endpoint"])
        if code:
            class R:
                status_code = code
            raise pywebpush.WebPushException("gone", response=R())


def wait_for(cond, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture()
def fake(monkeypatch):
    f = FakePush()
    monkeypatch.setattr(pywebpush, "webpush", f)
    return f


@pytest.fixture()
def api(fake):
    with TestClient(server.app) as c:
        yield c


def register(api, name="Push Tester"):
    r = api.post("/api/auth/register", json={"name": name, "email": f"push_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", "consent": True})
    tok = r.json()["access_token"]
    asyncio.run(server.activate_membership(r.json()["user_id"], asyncio.run(server.get_plan("monthly")), "test"))
    return {"Authorization": f"Bearer {tok}"}, r.json()


def login(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


def test_keys_generated_once_and_reused(api):
    h, _ = register(api)
    key1 = api.get("/api/push/config", headers=h).json()["public_key"]
    assert key1 and key1.startswith("B") and len(key1) == 87  # uncompressed P-256 point, base64url
    import asyncio
    asyncio.run(server.load_vapid_keys())  # reload from MongoDB, as after a restart
    assert api.get("/api/push/config", headers=h).json()["public_key"] == key1


def test_subscribe_validation_and_device_count(api):
    h, _ = register(api)
    assert api.post("/api/push/subscribe", json={**SUB, "endpoint": "http://insecure"}, headers=h).status_code == 400
    assert api.post("/api/push/subscribe", json={"endpoint": SUB["endpoint"], "keys": {}}, headers=h).status_code == 400
    sub = {**SUB, "endpoint": f"https://push.example/{uuid.uuid4().hex}"}
    assert api.post("/api/push/subscribe", json=sub, headers=h).status_code == 200
    assert api.post("/api/push/subscribe", json=sub, headers=h).status_code == 200  # idempotent
    assert api.get("/api/push/config", headers=h).json()["devices"] == 1
    api.post("/api/push/unsubscribe", json={"endpoint": sub["endpoint"]}, headers=h)
    assert api.get("/api/push/config", headers=h).json()["devices"] == 0


def test_notifications_fan_out_and_dead_subscriptions_are_removed(api, fake):
    h, me = register(api)
    live, dead = f"https://push.example/{uuid.uuid4().hex}", f"https://push.example/{uuid.uuid4().hex}"
    fake.status[dead] = 410
    for ep in (live, dead):
        api.post("/api/push/subscribe", json={**SUB, "endpoint": ep}, headers=h)
    r = api.post("/api/push/test", headers=h)
    assert r.json()["sent"] == 1
    assert {c["endpoint"] for c in fake.calls} >= {live, dead}
    assert api.get("/api/push/config", headers=h).json()["devices"] == 1


def test_incoming_call_push_with_answer_and_decline(api, fake):
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    coach_h, coach = login(api, "sarah.trainer@fitcoach.com", "Trainer@123")
    client_h, client = register(api, "Caller Client")
    api.put("/api/profile/intake", json={"focus": "fat_loss"}, headers=client_h)
    api.put(f"/api/admin/users/{client['user_id']}/coaches", json={"fitness_coach_id": coach["user_id"]}, headers=admin)
    coach_ep = f"https://push.example/{uuid.uuid4().hex}"
    api.post("/api/push/subscribe", json={**SUB, "endpoint": coach_ep}, headers=coach_h)

    call = api.post("/api/calls/instant", json={"peer_id": coach["user_id"]}, headers=client_h).json()
    api.post(f"/api/calls/{call['id']}/join", headers=client_h)
    assert wait_for(lambda: any(c["endpoint"] == coach_ep and c["payload"].get("kind") == "call" for c in fake.calls))
    push = [c for c in fake.calls if c["endpoint"] == coach_ep and c["payload"].get("kind") == "call"][-1]
    p = push["payload"]
    assert p["title"] == "Incoming call from Caller Client" and p["url"] == f"/call/live/{call['id']}"
    assert [a["action"] for a in p["actions"]] == ["answer", "decline"] and p["requireInteraction"] is True
    assert push["headers"]["Urgency"] == "high" and push["ttl"] == 45

    assert api.post(f"/api/calls/{call['id']}/decline-push", params={"t": "forged"}).status_code == 401
    other_token = server.call_decline_token("some-other-call", coach["user_id"])
    assert api.post(f"/api/calls/{call['id']}/decline-push", params={"t": other_token}).status_code == 401
    assert api.post(p["decline_url"]).status_code == 200
    assert api.get(f"/api/calls/{call['id']}", headers=client_h).json()["status"] == "declined"


def test_real_encrypted_push_end_to_end(api):
    """No mocks: act as a browser's push service, receive the real request, verify VAPID and decrypt the payload."""
    import asyncio
    import base64
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    import http_ece
    import jwt as pyjwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()  # noqa: E731
    received = {}

    class PushService(BaseHTTPRequestHandler):
        def do_POST(self):
            received["headers"] = dict(self.headers)
            received["body"] = self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(201)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), PushService)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    endpoint = f"http://127.0.0.1:{srv.server_port}/push/device-1"

    # the "browser": a P-256 key pair + auth secret, like PushManager.subscribe() creates
    device_key = ec.generate_private_key(ec.SECP256R1())
    auth = b"0123456789abcdef"
    p256dh = b64(device_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint))

    _, me = register(api, "E2E Push")
    sub = {"user_id": me["user_id"], "endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": b64(auth)}}
    asyncio.run(server.db.push_subscriptions.insert_one(dict(sub)))
    import importlib
    real_webpush = importlib.reload(pywebpush).webpush  # undo the fixture's fake for this test
    try:
        sent = asyncio.run(server.send_web_push(me["user_id"], {"title": "Session in 10 minutes", "body": "Join from the app",
                                                                   "url": "/call/abc", "urgency": "high", "ttl": 600}))
    finally:
        srv.shutdown()
    assert sent == 1 and real_webpush

    h = {k.lower(): v for k, v in received["headers"].items()}
    assert h["content-encoding"] == "aes128gcm" and h["ttl"] == "600" and h["urgency"] == "high"
    scheme, params = h["authorization"].split(" ", 1)
    parts = dict(p.strip().split("=", 1) for p in params.split(","))
    assert scheme == "vapid" and parts["k"] == api.get("/api/push/config", headers={"Authorization": f"Bearer {me['access_token']}"}).json()["public_key"]
    claims = pyjwt.decode(parts["t"], options={"verify_signature": False})
    assert claims["aud"] == f"http://127.0.0.1:{srv.server_port}" and claims["sub"].startswith("mailto:")

    plain = http_ece.decrypt(received["body"], private_key=device_key, auth_secret=auth, version="aes128gcm")
    payload = json.loads(plain)
    assert payload["title"] == "Session in 10 minutes" and payload["url"] == "/call/abc"
