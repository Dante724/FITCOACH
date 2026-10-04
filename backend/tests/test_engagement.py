"""
Engagement and coach tools, in-process: daily check-ins and streaks, coach-set daily targets, the weekly share card,
voice notes (and who can play them), plan templates / copying a plan between clients, quick replies and the
AI weekly summary (with the AI mocked, and the rule-based fallback).
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
        yield c


def run(coro):
    return asyncio.run(coro)


def login(api, email, pw):
    r = api.post("/api/auth/login", json={"email": email, "password": pw}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def new_client(api, name="Eng Tester", coach_email="sarah.trainer@fitcoach.com", track="fitness"):
    r = api.post("/api/auth/register", json={"name": name, "email": f"eng_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!"}).json()
    h = {"Authorization": f"Bearer {r['access_token']}"}
    api.put("/api/profile/intake", json={"focus": "fat_loss" if track == "fitness" else "yoga"}, headers=h)
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    coach_h, coach = login(api, coach_email, "Trainer@123")
    api.put(f"/api/admin/users/{r['user_id']}/coaches", json={f"{track}_coach_id": coach["user_id"]}, headers=admin)
    return h, r, coach_h, coach


CHECKIN = {"sleep": 4, "energy": 4, "soreness": 2, "mood": 5, "note": "Felt good"}


def test_checkin_upserts_and_streak(api):
    h, me, coach_h, coach = new_client(api)
    t = api.get("/api/today", headers=h).json()
    assert t["checkin"] is None and t["streak"] == 0 and t["targets"] == []
    assert api.put("/api/today/checkin", json={**CHECKIN, "sleep": 9}, headers=h).status_code == 422
    t = api.put("/api/today/checkin", json=CHECKIN, headers=h).json()
    assert t["checkin"]["mood"] == 5 and t["streak"] == 1
    t = api.put("/api/today/checkin", json={**CHECKIN, "mood": 3}, headers=h).json()  # editing doesn't duplicate
    assert t["checkin"]["mood"] == 3
    assert run(server.db.daily_logs.count_documents({"user_id": me["user_id"]})) == 1
    # two earlier days → streak 3; a gap breaks it
    today = datetime.now(server.APP_TZ).date()
    for d in (1, 2, 4):
        run(server.db.daily_logs.insert_one({"user_id": me["user_id"], "date": (today - timedelta(days=d)).isoformat(), "checkin": CHECKIN}))
    assert api.get("/api/today", headers=h).json()["streak"] == 3
    # coaches can't use the client endpoint
    assert api.put("/api/today/checkin", json=CHECKIN, headers=coach_h).status_code == 403


def test_low_checkin_notifies_coach_once(api):
    h, me, coach_h, coach = new_client(api, name="Low Day")
    api.put("/api/today/checkin", json={**CHECKIN, "energy": 1, "note": "Exhausted"}, headers=h)
    api.put("/api/today/checkin", json={**CHECKIN, "energy": 1}, headers=h)
    notes = run(server.db.notifications.find({"user_id": coach["user_id"], "title": "Low Day checked in"}).to_list(10))
    assert len(notes) == 1 and "very low energy" in notes[0]["body"]


def test_targets_set_by_coach_and_ticked(api):
    h, me, coach_h, coach = new_client(api)
    other_h, _ = login(api, "mike.trainer@fitcoach.com", "Trainer@123")
    body = {"targets": [{"label": "Steps", "goal": 8000, "unit": "steps"}, {"label": "Water", "goal": 3, "unit": "L"}, {"label": "  "}]}
    assert api.put(f"/api/coach/clients/{me['user_id']}/targets", json=body, headers=other_h).status_code == 403
    assert api.put(f"/api/coach/clients/{me['user_id']}/targets", json={"targets": [{"label": f"t{i}"} for i in range(9)]}, headers=coach_h).status_code == 400
    targets = api.put(f"/api/coach/clients/{me['user_id']}/targets", json=body, headers=coach_h).json()["targets"]
    assert [t["label"] for t in targets] == ["Steps", "Water"] and targets[0]["goal"] == 8000
    t = api.get("/api/today", headers=h).json()
    assert len(t["targets"]) == 2
    steps = targets[0]["id"]
    t = api.put(f"/api/today/targets/{steps}", json={"done": True, "value": 8500}, headers=h).json()
    assert t["done"] == {steps: 8500}
    t = api.put(f"/api/today/targets/{steps}", json={"done": False}, headers=h).json()
    assert t["done"] == {}
    assert api.put("/api/today/targets/nope", json={"done": True}, headers=h).status_code == 404
    # editing keeps ids, so today's ticks survive
    api.put(f"/api/today/targets/{steps}", json={"done": True}, headers=h)
    kept = api.put(f"/api/coach/clients/{me['user_id']}/targets", json={"targets": [{**targets[0], "goal": 10000}]}, headers=coach_h).json()["targets"]
    assert kept[0]["id"] == steps and api.get("/api/today", headers=h).json()["done"] == {steps: True}
    # the coach sees the log and the brief counts it
    d = api.get(f"/api/coach/clients/{me['user_id']}", headers=coach_h).json()
    assert d["targets"][0]["goal"] == 10000 and d["daily"][-1]["targets"] == {steps: True}
    assert d["brief"]["targets_pct"] == round(100 / 7)


def test_brief_flags_poor_recovery(api):
    h, me, coach_h, _ = new_client(api)
    today = datetime.now(server.APP_TZ).date()
    for d in range(4):
        run(server.db.daily_logs.insert_one({"user_id": me["user_id"], "date": (today - timedelta(days=d)).isoformat(),
                                             "checkin": {"sleep": 2, "energy": 2, "soreness": 5, "mood": 4}}))
    brief = api.get(f"/api/coach/clients/{me['user_id']}", headers=coach_h).json()["brief"]
    kinds = {f["kind"] for f in brief["flags"]}
    assert {"poor_sleep", "low_energy", "sore"} <= kinds and "low_mood" not in kinds
    assert brief["checkins_7d"] == 4 and "4/7 check-ins" in brief["headline"]
    assert "lighter week" in brief["suggestion"]


def test_week_card(api):
    h, me, _, _ = new_client(api, name="Card Person")
    api.put("/api/today/checkin", json=CHECKIN, headers=h)
    api.post("/api/workouts/sessions", json={"name": "Leg day", "exercises": [], "duration_minutes": 40}, headers=h)
    w = api.get("/api/me/week", headers=h).json()
    assert w["name"] == "Card Person" and w["coach"] == "Sarah Johnson" and w["streak"] == 1 and w["checkins"] == 1
    assert w["workouts"] == 1


def test_voice_notes_only_for_the_thread(api):
    h, me, coach_h, coach = new_client(api)
    audio = ("note.webm", b"\x1aE\xdf\xa3fake-webm-bytes", "audio/webm")
    r = api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}/voice", files={"file": audio}, data={"duration": "6.4"}, headers=h)
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["audio"]["duration"] == 6.4 and msg["body"] == ""
    url = msg["audio"]["url"].replace("/api", "", 1)
    assert api.get(f"/api{url}", headers=h).content.startswith(b"\x1aE")
    assert api.get(f"/api{url}", headers=coach_h).status_code == 200
    # another coach (even one assigned to this client on a different track) can't play it
    admin, _ = login(api, "admin@fitcoach.com", "Admin@12345")
    yoga_h, yoga = login(api, "priya.trainer@fitcoach.com", "Trainer@123")
    api.put(f"/api/admin/users/{me['user_id']}/coaches", json={"fitness_coach_id": coach["user_id"], "yoga_coach_id": yoga["user_id"]}, headers=admin)
    assert api.get(f"/api{url}", headers=yoga_h).status_code == 404
    assert api.get(f"/api{url}", headers=admin).status_code == 200
    # coach replies with a voice note; it lands in the same thread
    r = api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}/voice", files={"file": ("r.m4a", b"....", "audio/mp4")}, data={"duration": "3"}, headers=coach_h)
    assert r.status_code == 200
    thread = api.get(f"/api/messages/{me['user_id']}/{coach['user_id']}", headers=h).json()
    assert [bool(m.get("audio")) for m in thread] == [True, True]
    # wrong type / too long / admin
    assert api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}/voice", files={"file": ("x.txt", b"hi", "text/plain")}, headers=h).status_code == 400
    assert api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}/voice", files={"file": audio}, data={"duration": "400"}, headers=h).status_code == 400
    assert api.post(f"/api/messages/{me['user_id']}/{coach['user_id']}/voice", files={"file": audio}, headers=admin).status_code == 403


def _approve_draft(api, coach_h, client_id, ptype="workout"):
    d = api.post(f"/api/coach/clients/{client_id}/plans/draft", json={"type": ptype}, headers=coach_h).json()
    assert api.post(f"/api/plans/{d['id']}/approve", headers=coach_h).status_code == 200
    return d


def test_templates_and_copy_between_clients(api):
    rh, rahul, coach_h, coach = new_client(api, name="Rahul")
    ph, priya, _, _ = new_client(api, name="Priya")
    src = _approve_draft(api, coach_h, rahul["user_id"])
    # another client's plan shows up as a source; copy it to Priya as a draft
    sources = api.get("/api/coach/plan-sources", params={"type": "workout"}, headers=coach_h).json()
    assert any(p["plan_id"] == src["id"] and p["client_name"] == "Rahul" for p in sources["client_plans"])
    draft = api.post(f"/api/coach/clients/{priya['user_id']}/plans/copy", json={"type": "workout", "plan_id": src["id"]}, headers=coach_h).json()
    assert draft["status"] == "draft" and draft["client_id"] == priya["user_id"] and "Rahul" in draft["ai_note"]
    assert draft["content"]["days"] == src["content"]["days"]
    # Priya doesn't see it until approved
    assert api.get("/api/my/plans", headers=ph).json() == {}
    # copying again replaces the draft rather than stacking drafts
    api.post(f"/api/coach/clients/{priya['user_id']}/plans/copy", json={"type": "workout", "plan_id": src["id"]}, headers=coach_h)
    assert run(server.db.plans.count_documents({"client_id": priya["user_id"], "type": "workout", "status": "draft"})) == 1
    # save as template, then start from it
    tpl = api.post("/api/coach/templates", json={"name": "Beginner 3-day", "type": "workout", "plan_id": src["id"]}, headers=coach_h).json()
    assert tpl["name"] == "Beginner 3-day"
    assert api.get("/api/coach/plan-sources", params={"type": "workout"}, headers=coach_h).json()["templates"][0]["id"] == tpl["id"]
    d2 = api.post(f"/api/coach/clients/{priya['user_id']}/plans/copy", json={"type": "workout", "template_id": tpl["id"]}, headers=coach_h).json()
    assert "Beginner 3-day" in d2["ai_note"]
    # type mismatch, other coach's template, other coach's client
    assert api.post(f"/api/coach/clients/{priya['user_id']}/plans/copy", json={"type": "meal", "template_id": tpl["id"]}, headers=coach_h).status_code == 400
    mike_h, _ = login(api, "mike.trainer@fitcoach.com", "Trainer@123")
    assert api.post(f"/api/coach/clients/{priya['user_id']}/plans/copy", json={"type": "workout", "template_id": tpl["id"]}, headers=mike_h).status_code == 403
    assert api.post("/api/coach/templates", json={"name": "Steal", "type": "workout", "plan_id": src["id"]}, headers=mike_h).status_code == 403
    assert api.delete(f"/api/coach/templates/{tpl['id']}", headers=mike_h).status_code == 404
    assert api.delete(f"/api/coach/templates/{tpl['id']}", headers=coach_h).status_code == 200


def test_yoga_coach_cannot_copy_fitness_plans(api):
    h, me, fit_h, fit = new_client(api, name="Hybrid")
    src = _approve_draft(api, fit_h, me["user_id"])
    yh, ystu, yoga_h, yoga = new_client(api, name="Yogi", coach_email="priya.trainer@fitcoach.com", track="yoga")
    assert api.post(f"/api/coach/clients/{ystu['user_id']}/plans/copy", json={"type": "workout", "plan_id": src["id"]}, headers=yoga_h).status_code == 403


def test_quick_replies(api):
    _, _, coach_h, _ = new_client(api)
    defaults = api.get("/api/coach/quick-replies", headers=coach_h).json()["replies"]
    assert len(defaults) >= 3 and any("{name}" in r for r in defaults)
    saved = api.put("/api/coach/quick-replies", json={"replies": ["Nice!", "  ", "x" * 900]}, headers=coach_h).json()["replies"]
    assert saved == ["Nice!", "x" * 500]
    assert api.get("/api/coach/quick-replies", headers=coach_h).json()["replies"] == saved
    assert api.put("/api/coach/quick-replies", json={"replies": []}, headers=coach_h).json()["replies"] == []
    assert api.get("/api/coach/quick-replies", headers=coach_h).json()["replies"] == []  # emptied on purpose stays empty
    client_h, _, _, _ = new_client(api)
    assert api.get("/api/coach/quick-replies", headers=client_h).status_code == 403


def test_ai_summary_cached_and_fallback(api, monkeypatch):
    h, me, coach_h, coach = new_client(api, name="Asha Rao")
    api.put("/api/today/checkin", json=CHECKIN, headers=h)
    calls = []

    async def fake_ai(system, prompt, tag):
        calls.append(prompt)
        return {"summary": "Asha had a steady week.", "wins": ["Checked in"], "concerns": [], "next_step": "Add a 4th session.",
                "message": "Hi Asha, lovely week!"}

    monkeypatch.setattr(server, "_ai_json", fake_ai)
    s = api.get(f"/api/coach/clients/{me['user_id']}/summary", headers=coach_h).json()
    assert s["ai"] is True and s["summary"] == "Asha had a steady week." and s["message"].startswith("Hi Asha")
    assert '"sleep": 4' in calls[0] and "Goal: fat loss" in calls[0]
    api.get(f"/api/coach/clients/{me['user_id']}/summary", headers=coach_h)
    assert len(calls) == 1  # cached for the week
    api.get(f"/api/coach/clients/{me['user_id']}/summary", params={"refresh": True}, headers=coach_h)
    assert len(calls) == 2

    async def broken(*a):
        raise RuntimeError("no key")

    monkeypatch.setattr(server, "_ai_json", broken)
    s = api.get(f"/api/coach/clients/{me['user_id']}/summary", params={"refresh": True}, headers=coach_h).json()
    assert s["ai"] is False and s["message"].startswith(("Great week, Asha", "Hi Asha")) and s["next_step"]
    # the client and other coaches can't read it
    assert api.get(f"/api/coach/clients/{me['user_id']}/summary", headers=h).status_code == 403
    mike_h, _ = login(api, "mike.trainer@fitcoach.com", "Trainer@123")
    assert api.get(f"/api/coach/clients/{me['user_id']}/summary", headers=mike_h).status_code == 403


def test_yoga_coach_summary_hides_weight(api, monkeypatch):
    h, me, yoga_h, _ = new_client(api, name="Weight Private", coach_email="priya.trainer@fitcoach.com", track="yoga")
    api.post("/api/progress", json={"weight": 71.5}, headers=h)
    seen = []

    async def fake_ai(system, prompt, tag):
        seen.append(prompt)
        return {"summary": "ok", "wins": [], "concerns": [], "next_step": "x", "message": "y"}

    monkeypatch.setattr(server, "_ai_json", fake_ai)
    api.get(f"/api/coach/clients/{me['user_id']}/summary", headers=yoga_h)
    assert "measurements_4_weeks" not in seen[0] and '"weight_change_7d"' not in seen[0]
