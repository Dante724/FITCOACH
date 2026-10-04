"""
v2 coach-led flow: intake, admin coach assignment, permission boundaries, AI-draft → coach-approve plans,
revisions, the coach "needs attention" queue, weekly briefs and coach↔client messages.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fitness-dashboard-115.preview.emergentagent.com").rstrip("/")
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
