"""
External scheduler for free hosting, in-process: /api/cron/tick is protected by CRON_SECRET, runs due jobs on
their own intervals, and reminders are never sent twice even when both the built-in timer and the tick run them.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from inprocess import server


@pytest.fixture()
def api():
    with TestClient(server.app) as c:
        yield c


def run(coro):
    return asyncio.run(coro)


def test_tick_needs_the_secret(api, monkeypatch):
    monkeypatch.setattr(server, "CRON_SECRET", "")
    assert api.get("/api/cron/tick", params={"key": "x"}).status_code == 503
    monkeypatch.setattr(server, "CRON_SECRET", "s3cret-key")
    assert api.get("/api/cron/tick").status_code == 403
    assert api.get("/api/cron/tick", params={"key": "wrong"}).status_code == 403
    assert api.post("/api/cron/tick", headers={"X-Cron-Key": "s3cret-key"}).status_code == 200


def test_tick_runs_due_jobs_on_their_own_schedule(api, monkeypatch):
    monkeypatch.setattr(server, "CRON_SECRET", "s3cret-key")
    run(server.db.app_settings.delete_many({"_id": "cron_state"}))
    first = api.get("/api/cron/tick", params={"key": "s3cret-key"}).json()
    assert {"session_alerts", "email_reminders", "membership_reminders", "storage_watch", "purge_leads", "backup"} <= set(first["ran"])
    second = api.get("/api/cron/tick", params={"key": "s3cret-key"}).json()
    assert set(second["ran"]) == {"session_alerts", "email_reminders"}  # the others aren't due again yet
    old = (datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()
    run(server.db.app_settings.update_one({"_id": "cron_state"}, {"$set": {"membership_reminders": old}}))
    assert "membership_reminders" in api.get("/api/cron/tick", params={"key": "s3cret-key"}).json()["ran"]


def test_reminders_are_never_sent_twice(api):
    uid, coach = f"user_{uuid.uuid4().hex[:10]}", f"user_{uuid.uuid4().hex[:10]}"
    starts = datetime.now(timezone.utc) + timedelta(minutes=30)
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({"id": bid, "user_id": uid, "trainer_id": coach, "client_name": "A", "trainer_name": "B",
                                       "date": starts.date().isoformat(), "time": "07:00", "starts_at": starts.isoformat(), "status": "confirmed"}))
    run(server.send_session_alerts())
    run(server.send_session_alerts())  # e.g. the timer and a tick right after each other
    assert run(server.db.notifications.count_documents({"user_id": uid, "title": "Session in about an hour"})) == 1
    exp = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    run(server.db.users.insert_one({"user_id": uid, "email": f"{uid}@example.com", "name": "A", "role": "client",
                                    "membership_plan": "monthly", "membership_expires_at": exp}))
    run(server.send_membership_reminders())
    run(server.send_membership_reminders())
    assert run(server.db.notifications.count_documents({"user_id": uid, "title": "Your membership ends soon"})) == 1
