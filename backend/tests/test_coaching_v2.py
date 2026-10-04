"""
v2 coach-led flow: intake, admin coach assignment, permission boundaries, AI-draft → coach-approve plans,
revisions, the coach "needs attention" queue, weekly briefs and coach↔client messages.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = (os.getenv("TEST_ADMIN_EMAIL", "admin@fitcoach.com"), os.getenv("TEST_ADMIN_PASSWORD", "Admin@12345"))
FITNESS = ("sarah.trainer@fitcoach.com", "Trainer@123")
OTHER_FITNESS = ("mike.trainer@fitcoach.com", "Trainer@123")
YOGA = ("priya.trainer@fitcoach.com", "Trainer@123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 429:
        pytest.skip(f"Rate-limited on {email}")
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.cookies.get('access_token')}"
    s.me = r.json()
    return s


@pytest.fixture(scope="module")
def ctx():
    email = f"v2client_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={"name": "Asha Test", "email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    client = requests.Session()
    client.headers["Authorization"] = f"Bearer {r.cookies.get('access_token')}"
    client.me = r.json()
    return {"client": client, "cid": client.me["user_id"], "admin": _login(*ADMIN), "fit": _login(*FITNESS),
            "other": _login(*OTHER_FITNESS), "yoga": _login(*YOGA), "plans": {}}


class TestCoachingFlow:
    def test_intake(self, ctx):
        r = ctx["client"].put(f"{API}/profile/intake", json={
            "focus": "hybrid", "weight_kg": 82, "height_cm": 170, "days_per_week": 3, "equipment": "home",
            "diet": "veg", "injuries": "left knee", "experience": "beginner"})
        assert r.status_code == 200, r.text
        assert r.json()["focus"] == "hybrid" and r.json()["intake"]["diet"] == "veg"
        assert ctx["client"].get(f"{API}/progress").json()[0]["weight"] == 82

    def test_unassigned_client_is_blocked(self, ctx):
        c = ctx["client"]
        assert c.get(f"{API}/trainers").json()["trainers"] == []
        assert c.get(f"{API}/workouts/plan").json()["plan"] is None
        assert c.get(f"{API}/my/coaches").json()["needs"] == ["fitness", "yoga"]
        sarah = ctx["fit"].me["user_id"]
        r = c.post(f"{API}/bookings", json={"trainer_id": sarah, "date": "2030-01-07", "time": "07:00"})
        assert r.status_code == 403
        assert ctx["fit"].get(f"{API}/coach/clients/{ctx['cid']}").status_code == 403
        assert ctx["admin"].get(f"{API}/admin/stats").json()["unassigned"] >= 1

    def test_admin_assigns_coaches(self, ctx):
        a, cid = ctx["admin"], ctx["cid"]
        bad = a.put(f"{API}/admin/users/{cid}/coaches", json={"yoga_coach_id": ctx["fit"].me["user_id"]})
        assert bad.status_code == 400  # a fitness coach can't be the yoga coach
        r = a.put(f"{API}/admin/users/{cid}/coaches", json={
            "fitness_coach_id": ctx["fit"].me["user_id"], "yoga_coach_id": ctx["yoga"].me["user_id"]})
        assert r.status_code == 200, r.text
        names = {t["name"] for t in ctx["client"].get(f"{API}/trainers").json()["trainers"]}
        assert names == {ctx["fit"].me["name"], ctx["yoga"].me["name"]}
        coaches = a.get(f"{API}/admin/coaches").json()
        assert any(c["user_id"] == ctx["fit"].me["user_id"] and c["clients"] >= 1 for c in coaches)

    def test_permission_boundaries(self, ctx):
        cid = ctx["cid"]
        assert ctx["other"].get(f"{API}/coach/clients/{cid}").status_code == 403
        assert ctx["client"].post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "meal"}).status_code == 403
        assert ctx["fit"].post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "yoga"}).status_code == 403
        assert ctx["yoga"].post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "meal"}).status_code == 403

    def test_attention_lists_missing_plans(self, ctx):
        items = ctx["fit"].get(f"{API}/coach/attention").json()
        mine = {i["plan_type"] for i in items if i["client_id"] == ctx["cid"] and i["kind"] == "needs_plan"}
        assert mine == {"workout", "meal"}

    def test_draft_edit_approve_workout(self, ctx):
        fit, cid = ctx["fit"], ctx["cid"]
        r = fit.post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "workout", "notes": "Protect the left knee"}, timeout=120)
        assert r.status_code == 200, r.text
        plan = r.json()
        assert plan["status"] == "draft" and plan["content"]["days"]
        assert ctx["client"].get(f"{API}/workouts/plan").json()["plan"] is None  # drafts stay hidden from the client

        content = plan["content"]
        content["days"][0]["exercises"][0]["name"] = "Box Squat"
        r = fit.put(f"{API}/plans/{plan['id']}", json={"title": "Asha — Block 1", "content": content, "coach_note": "Go easy week 1"})
        assert r.status_code == 200 and r.json()["content"]["title"] == "Asha — Block 1"

        r = fit.post(f"{API}/plans/{plan['id']}/approve")
        assert r.status_code == 200 and r.json()["status"] == "active"
        live = ctx["client"].get(f"{API}/workouts/plan").json()["plan"]
        assert live["id"] == plan["id"] and live["approved_by_name"] == ctx["fit"].me["name"]
        assert live["content"]["days"][0]["exercises"][0]["name"] == "Box Squat"
        assert fit.put(f"{API}/plans/{plan['id']}", json={"content": content}).status_code == 409
        ctx["plans"]["workout"] = plan["id"]

    def test_meal_and_yoga_plans(self, ctx):
        cid = ctx["cid"]
        meal = ctx["fit"].post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "meal"}, timeout=120).json()
        assert meal["content"]["meals"] and "total_calories" in meal["content"]
        assert ctx["fit"].post(f"{API}/plans/{meal['id']}/approve").status_code == 200
        yoga = ctx["yoga"].post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "yoga"}, timeout=120).json()
        assert ctx["yoga"].post(f"{API}/plans/{yoga['id']}/approve").status_code == 200
        mine = ctx["client"].get(f"{API}/my/plans").json()
        assert set(mine) == {"workout", "meal", "yoga"}

    def test_revision_replaces_active_plan(self, ctx):
        fit, cid = ctx["fit"], ctx["cid"]
        r = fit.post(f"{API}/coach/clients/{cid}/plans/draft", json={"type": "workout", "notes": "Weight flat for 3 weeks"}, timeout=120)
        draft = r.json()
        assert draft["revises"] == ctx["plans"]["workout"] and draft["reason"] == "Weight flat for 3 weeks"
        fit.post(f"{API}/plans/{draft['id']}/approve")
        live = ctx["client"].get(f"{API}/workouts/plan").json()["plan"]
        assert live["id"] == draft["id"] and live["reason"] == "Weight flat for 3 weeks"
        plans = fit.get(f"{API}/coach/clients/{cid}").json()["plans"]
        assert {p["status"] for p in plans if p["type"] == "workout"} == {"active", "archived"}

        copy = fit.post(f"{API}/plans/{draft['id']}/revise").json()
        assert copy["status"] == "draft"
        assert fit.delete(f"{API}/plans/{copy['id']}").status_code == 200

    def test_brief_and_detail(self, ctx):
        detail = ctx["fit"].get(f"{API}/coach/clients/{ctx['cid']}").json()
        assert detail["brief"]["weight"] == 82
        assert detail["tracks"] == ["fitness"]
        listed = [c for c in ctx["fit"].get(f"{API}/coach/clients").json() if c["user_id"] == ctx["cid"]][0]
        assert listed["active_plans"] == ["meal", "workout"]  # the yoga plan belongs to the yoga coach
        assert {p["type"] for p in detail["plans"]} == {"meal", "workout"}

    def test_messages(self, ctx):
        c, fit, cid = ctx["client"], ctx["fit"], ctx["cid"]
        sarah = fit.me["user_id"]
        r = c.post(f"{API}/messages/{cid}/{sarah}", json={"body": "Is this dinner OK?", "context_type": "food",
                                                           "context_id": "x1", "context_label": "Paneer tikka"})
        assert r.status_code == 200 and r.json()["context"]["label"] == "Paneer tikka"
        assert fit.get(f"{API}/messages/unread").json()["threads"][cid] == 1
        assert any(i["kind"] == "message" and i["client_id"] == cid for i in fit.get(f"{API}/coach/attention").json())
        thread = fit.get(f"{API}/messages/{cid}/{sarah}").json()
        assert len(thread) == 1
        assert fit.get(f"{API}/messages/unread").json()["threads"][cid] == 0
        assert fit.post(f"{API}/messages/{cid}/{sarah}", json={"body": "Looks great, add a salad."}).status_code == 200
        assert c.get(f"{API}/messages/unread").json()["threads"][sarah] == 1
        assert ctx["yoga"].get(f"{API}/messages/{cid}/{sarah}").status_code == 403
        assert ctx["other"].get(f"{API}/messages/{cid}/{sarah}").status_code == 403


# 1×1 JPEG — stands in for the annotated snapshot the browser sends
TINY_JPEG = ("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
              "wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==")
POSE = {"pose": "warrior2", "pose_label": "Warrior II", "score": 72, "frames": 80, "snapshot": TINY_JPEG,
        "checks": [{"id": "back_leg", "label": "Back leg straight", "ok": False, "value": 141, "unit": "°", "cue": "Straighten your back leg"}],
        "flags": ["Straighten your back leg"]}


class TestPoseChecks:
    def test_client_submits_and_sees_provisional(self, ctx):
        c = ctx["client"]
        assert c.post(f"{API}/pose-checks", json={**POSE, "snapshot": "javascript:alert(1)"}).status_code == 400
        r = c.post(f"{API}/pose-checks", json=POSE)
        assert r.status_code == 200, r.text
        ctx["pose_id"] = r.json()["id"]
        mine = c.get(f"{API}/pose-checks").json()
        assert mine[0]["status"] == "pending" and mine[0]["provisional"] is True

    def test_only_the_yoga_coach_reviews(self, ctx):
        cid = ctx["cid"]
        items = ctx["yoga"].get(f"{API}/coach/attention").json()
        assert any(i["kind"] == "pose_review" and i["client_id"] == cid for i in items)
        assert not any(i["kind"] == "pose_review" for i in ctx["fit"].get(f"{API}/coach/attention").json())
        assert ctx["fit"].get(f"{API}/pose-checks", params={"client_id": cid}).status_code == 403
        assert ctx["fit"].post(f"{API}/pose-checks/{ctx['pose_id']}/review", json={"verdict": "confirmed"}).status_code == 403
        assert ctx["yoga"].get(f"{API}/coach/clients/{cid}").json()["pose_checks"][0]["id"] == ctx["pose_id"]
        assert ctx["fit"].get(f"{API}/coach/clients/{cid}").json()["pose_checks"] == []
        # nutrition alerts belong to the fitness coach, not the yoga coach
        yoga_brief = ctx["yoga"].get(f"{API}/coach/clients/{cid}").json()["brief"]
        assert not any(f["kind"] in ("no_food", "plateau", "off_track") for f in yoga_brief["flags"])
        assert any(f["kind"] == "no_food" for f in ctx["fit"].get(f"{API}/coach/clients/{cid}").json()["brief"]["flags"])

    def test_review_reaches_client(self, ctx):
        r = ctx["yoga"].post(f"{API}/pose-checks/{ctx['pose_id']}/review", json={
            "verdict": "adjusted", "flags": ["Straighten your back leg", "Sink a little lower"], "score": 68, "coach_note": "Good effort!"})
        assert r.status_code == 200, r.text
        mine = ctx["client"].get(f"{API}/pose-checks").json()[0]
        assert mine["status"] == "reviewed" and "provisional" not in mine
        assert mine["coach_flags"] == ["Straighten your back leg", "Sink a little lower"] and mine["coach_score"] == 68
        assert mine["reviewed_by_name"] == ctx["yoga"].me["name"]

    def test_client_without_yoga_coach_is_refused(self):
        email = f"v2fit_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"name": "Fit Only", "email": email, "password": "Passw0rd!"})
        s = requests.Session()
        s.headers["Authorization"] = f"Bearer {r.cookies.get('access_token')}"
        s.put(f"{API}/profile/intake", json={"focus": "fat_loss"})
        assert s.post(f"{API}/pose-checks", json=POSE).status_code == 400


def _ist(minutes_from_now):
    from datetime import datetime, timedelta, timezone
    t = datetime.now(timezone(timedelta(hours=5, minutes=30))) + timedelta(minutes=minutes_from_now)
    return t.strftime("%Y-%m-%d"), t.strftime("%H:%M")


class TestCalls:
    def test_instant_call_lifecycle(self, ctx):
        c, fit, cid = ctx["client"], ctx["fit"], ctx["cid"]
        sarah = fit.me["user_id"]
        assert c.post(f"{API}/calls/instant", json={"peer_id": ctx["other"].me["user_id"]}).status_code == 403
        assert ctx["other"].post(f"{API}/calls/instant", json={"peer_id": cid}).status_code == 403

        call = c.post(f"{API}/calls/instant", json={"peer_id": sarah}).json()
        assert call["status"] == "ringing" and call["role"] == "answerer" and call["peer_id"] == sarah
        c.post(f"{API}/calls/{call['id']}/join")
        live = fit.get(f"{API}/calls-live").json()
        assert [i["id"] for i in live["incoming"]] == [call["id"]]
        assert ctx["yoga"].get(f"{API}/calls/{call['id']}").status_code == 404

        joined = fit.post(f"{API}/calls/{call['id']}/join").json()
        assert joined["status"] == "active" and joined["role"] == "offerer" and joined["peer_present"]
        fit.post(f"{API}/calls/{call['id']}/signal", json={"type": "offer", "payload": {"sdp": "v=0", "type": "offer"}})
        fit.post(f"{API}/calls/{call['id']}/signal", json={"type": "ice", "payload": {"candidate": "c1"}})
        got = c.get(f"{API}/calls/{call['id']}/signals").json()
        assert [s["type"] for s in got["signals"]] == ["offer", "ice"] and got["peer_present"]
        assert c.get(f"{API}/calls/{call['id']}/signals").json()["signals"] == []  # mailbox drained
        c.post(f"{API}/calls/{call['id']}/signal", json={"type": "answer", "payload": {"sdp": "v=0", "type": "answer"}})
        assert fit.get(f"{API}/calls/{call['id']}/signals").json()["signals"][0]["type"] == "answer"
        assert c.post(f"{API}/calls/{call['id']}/signal", json={"type": "evil"}).status_code == 400

        c.post(f"{API}/calls/{call['id']}/leave")
        assert fit.get(f"{API}/calls/{call['id']}/signals").json()["signals"][-1]["type"] == "bye"

    def test_decline(self, ctx):
        c, fit, cid = ctx["client"], ctx["fit"], ctx["cid"]
        # previous call between this pair may still be active; end it from both sides first
        call = fit.post(f"{API}/calls/instant", json={"peer_id": cid}).json()
        fit.post(f"{API}/calls/{call['id']}/leave")
        call = ctx["yoga"].post(f"{API}/calls/instant", json={"peer_id": cid}).json()
        ctx["yoga"].post(f"{API}/calls/{call['id']}/join")
        assert c.post(f"{API}/calls/{call['id']}/decline").status_code == 200
        assert c.get(f"{API}/calls/{call['id']}").json()["status"] == "declined"
        assert c.post(f"{API}/calls/{call['id']}/join").status_code == 410

    def test_coach_schedules_and_both_join_same_room(self, ctx):
        fit, c, cid = ctx["fit"], ctx["client"], ctx["cid"]
        d, t = _ist(6)
        assert ctx["other"].post(f"{API}/coach/clients/{cid}/sessions", json={"date": d, "time": t}).status_code == 403
        past_d, past_t = _ist(-120)
        assert fit.post(f"{API}/coach/clients/{cid}/sessions", json={"date": past_d, "time": past_t}).status_code == 400
        for offset in range(6, 12):  # the slot may already be taken by an earlier run against the same database
            d, t = _ist(offset)
            r = fit.post(f"{API}/coach/clients/{cid}/sessions", json={"date": d, "time": t})
            if r.status_code != 409:
                break
        assert r.status_code == 200, r.text
        booking = r.json()
        assert any(b["id"] == booking["id"] for b in c.get(f"{API}/bookings").json())
        soon = c.get(f"{API}/calls-live").json()["starting_soon"]
        assert any(s["booking_id"] == booking["id"] and 0 <= s["minutes"] <= 12 for s in soon)
        a = c.post(f"{API}/calls/booking/{booking['id']}").json()
        b = fit.post(f"{API}/calls/booking/{booking['id']}").json()
        assert a["id"] == b["id"] and a["kind"] == "scheduled"
        assert ctx["yoga"].post(f"{API}/calls/booking/{booking['id']}").status_code == 404

    def test_ice_servers(self, ctx):
        ice = ctx["client"].get(f"{API}/calls/ice").json()
        assert ice["iceServers"][0]["urls"][0].startswith("stun:")


# 1×1 PNG
TINY_PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                         "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


class TestPhotosInMongo:
    def test_progress_photo_roundtrip_and_privacy(self, ctx):
        c = ctx["client"]
        r = c.post(f"{API}/progress/photos", files={"file": ("me.png", TINY_PNG, "image/png")}, data={"weight": "80.5", "note": "week 1"})
        assert r.status_code == 200, r.text
        photo = r.json()
        assert photo["url"].startswith("/api/files/progress/")
        path = photo["url"]
        tok = lambda s: s.headers["Authorization"].split(" ", 1)[1]  # noqa: E731
        own = requests.get(f"{BASE_URL}{path}", params={"auth": tok(c)})
        assert own.status_code == 200 and own.content == TINY_PNG and own.headers["content-type"] == "image/png"
        assert requests.get(f"{BASE_URL}{path}", params={"auth": tok(ctx["fit"])}).status_code == 200    # their coach
        assert requests.get(f"{BASE_URL}{path}", params={"auth": tok(ctx["other"])}).status_code == 404  # not their coach
        assert requests.get(f"{BASE_URL}{path}").status_code == 401
        assert c.delete(f"{API}/progress/photos/{photo['id']}").status_code == 200
        assert requests.get(f"{BASE_URL}{path}", params={"auth": tok(c)}).status_code == 404

    def test_avatar_upload(self, ctx):
        c = ctx["client"]
        assert c.post(f"{API}/profile/photo", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
        r = c.post(f"{API}/profile/photo", files={"file": ("me.png", TINY_PNG, "image/png")})
        assert r.status_code == 200 and r.json()["picture"].startswith("/api/files/avatar/")
        # avatars are visible to any signed-in user (they appear in coach and admin lists)
        tok = ctx["other"].headers["Authorization"].split(" ", 1)[1]
        assert requests.get(f"{BASE_URL}{r.json()['picture']}", params={"auth": tok}).status_code == 200

    def test_google_login_not_configured(self):
        assert requests.post(f"{API}/auth/google", json={"credential": "x"}).status_code == 503
