"""
File storage and backups, in-process with a fake S3 bucket: photos stored in the database or object storage,
moving existing files out of the database, downloadable and automatic backups (with restore), and the
"database nearly full" alert.
"""
import asyncio
import gzip
import io
import os
import sys
import uuid

import pytest
from bson import json_util
from fastapi.testclient import TestClient

from inprocess import server

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import restore_backup  # noqa: E402

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


class FakeS3:
    def __init__(self):
        self.objs = {}

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.objs[Key] = bytes(Body)

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objs[Key])}

    def delete_objects(self, Bucket, Delete):
        for o in Delete["Objects"]:
            self.objs.pop(o["Key"], None)

    def list_objects_v2(self, Bucket, Prefix=""):
        return {"Contents": [{"Key": k} for k in self.objs if k.startswith(Prefix)]}


@pytest.fixture()
def api():
    with TestClient(server.app) as c:
        yield c


def use_s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(server, "S3_BUCKET", "fitcoach-test")
    monkeypatch.setattr(server, "S3_ACCESS_KEY_ID", "k")
    monkeypatch.setattr(server, "S3_SECRET_ACCESS_KEY", "s")
    monkeypatch.setattr(server, "_s3", lambda: fake)
    return fake


def run(coro):
    return asyncio.run(coro)


def client(api):
    r = api.post("/api/auth/register", json={"name": "Store Test", "email": f"st_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!",
                                             "consent": True, "photo_consent": True}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}, r


def admin(api):
    r = api.post("/api/auth/login", json={"email": "admin@fitcoach.com", "password": "Admin@12345"}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}


def upload(api, h):
    return api.post("/api/progress/photos", files={"file": ("p.png", PNG, "image/png")}, headers=h).json()


def test_files_go_to_the_database_by_default(api):
    h, _ = client(api)
    photo = upload(api, h)
    rec = run(server.db.files.find_one({"storage_path": photo["storage_path"]}))
    assert rec["store"] == "db" and run(server.db.file_blobs.find_one({"storage_path": photo["storage_path"]}))
    assert api.get(f"/api{photo['url'][4:]}", headers=h).content == PNG


def test_object_storage_upload_serve_delete(api, monkeypatch):
    fake = use_s3(monkeypatch)
    h, _ = client(api)
    photo = upload(api, h)
    path = photo["storage_path"]
    assert fake.objs[path] == PNG and not run(server.db.file_blobs.find_one({"storage_path": path}))
    assert api.get(f"/api{photo['url'][4:]}", headers=h).content == PNG
    api.delete(f"/api/progress/photos/{photo['id']}", headers=h)
    assert path not in fake.objs


def test_moving_existing_files_out_of_the_database(api, monkeypatch):
    h, _ = client(api)
    photos = [upload(api, h) for _ in range(3)]
    a = admin(api)
    assert api.post("/api/admin/storage/migrate", headers=a).status_code == 400  # not configured yet
    fake = use_s3(monkeypatch)
    before = api.get("/api/admin/storage", headers=a).json()
    assert before["object_storage"] is True and before["files_in_db"] >= 3
    r = api.post("/api/admin/storage/migrate", params={"limit": 500}, headers=a).json()
    assert r["moved"] >= 3 and r["failed"] == 0 and r["remaining"] == 0
    for p in photos:
        assert p["storage_path"] in fake.objs and not run(server.db.file_blobs.find_one({"storage_path": p["storage_path"]}))
        assert api.get(f"/api{p['url'][4:]}", headers=h).content == PNG  # still viewable
    after = api.get("/api/admin/storage", headers=a).json()
    assert after["files_in_db"] == 0 and after["files_in_storage"] >= 3
    h2, _ = client(api)
    assert api.post("/api/admin/storage/migrate", headers=h2).status_code == 403


def test_backup_download_and_restore_round_trip(api):
    import mongomock
    h, me = client(api)
    upload(api, h)
    api.post("/api/progress", json={"weight": 71.4}, headers=h)
    a = admin(api)
    assert api.get("/api/admin/backup", headers=h).status_code == 403
    r = api.get("/api/admin/backup", headers=a)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = json_util.loads(gzip.decompress(r.content))
    assert data["app"] == "fitcoach" and "file_blobs" not in data["collections"]
    assert any(u["user_id"] == me["user_id"] for u in data["collections"]["users"])
    assert any(p.get("weight") == 71.4 for p in data["collections"]["progress"])
    with_files = json_util.loads(gzip.decompress(api.get("/api/admin/backup", params={"include_files": True}, headers=a).content))
    assert with_files["collections"]["file_blobs"]
    # restore into an empty database
    target = mongomock.MongoClient()["restored"]
    counts = restore_backup.restore(data, target)
    assert counts["users"] == len(data["collections"]["users"]) and target.progress.find_one({"weight": 71.4})
    with pytest.raises(SystemExit):
        restore_backup.restore(data, target)  # refuses to overwrite a database with users
    restore_backup.restore(data, target, replace=True)
    assert target.users.count_documents({}) == counts["users"]


def test_nightly_backup_keeps_the_newest_14(api, monkeypatch):
    assert run(server.backup_to_storage()) is None  # nothing to do without object storage
    fake = use_s3(monkeypatch)
    for i in range(20):
        fake.objs[f"backups/fitcoach-2026-01-{i + 1:02d}T000000Z.json.gz"] = b"old"
    status = run(server.backup_to_storage())
    keys = sorted(k for k in fake.objs if k.startswith("backups/"))
    assert status["error"] is None and len(keys) == 14 and keys[-1] == status["last_backup_key"]
    assert json_util.loads(gzip.decompress(fake.objs[status["last_backup_key"]]))["app"] == "fitcoach"
    a = admin(api)
    assert api.get("/api/admin/storage", headers=a).json()["backup"]["last_backup_key"] == status["last_backup_key"]


def test_full_database_warns_admins_once_a_day(api, monkeypatch):
    monkeypatch.setattr(server, "DB_STORAGE_LIMIT_MB", 0.001)  # pretend the database is tiny
    run(server.db.app_settings.delete_many({"_id": "storage_alert"}))
    run(server.db.notifications.delete_many({"title": {"$regex": "^Database"}}))
    run(server.storage_watch())
    run(server.storage_watch())
    notes = run(server.db.notifications.find({"title": {"$regex": "^Database"}}).to_list(10))
    admins = run(server.db.users.count_documents({"role": "admin"}))
    assert len(notes) == admins and "full" in notes[0]["title"]


def test_pose_snapshots_are_files_not_database_records(api, monkeypatch):
    import base64
    fake = use_s3(monkeypatch)
    h, me = client(api)
    a = admin(api)
    api.put("/api/profile/intake", json={"focus": "yoga"}, headers=h)
    yoga = api.post("/api/auth/login", json={"email": "priya.trainer@fitcoach.com", "password": "Trainer@123"}).json()
    yh = {"Authorization": f"Bearer {yoga['access_token']}"}
    api.put(f"/api/admin/users/{me['user_id']}/coaches", json={"yoga_coach_id": yoga["user_id"], "force": True}, headers=a)
    run(server.activate_membership(me["user_id"], run(server.get_plan("monthly")), "test"))
    snap = "data:image/png;base64," + base64.b64encode(PNG).decode()
    r = api.post("/api/pose-checks", json={"pose": "tree", "pose_label": "Tree", "score": 80, "frames": 10, "snapshot": snap,
                                          "checks": [], "flags": []}, headers=h)
    assert r.status_code == 200, r.text
    check = r.json()
    assert check["snapshot"].startswith("/api/files/pose/") and fake.objs[check["snapshot_path"]] == PNG
    stored = run(server.db.pose_checks.find_one({"id": check["id"]}))
    assert "base64" not in stored["snapshot"]  # the record only holds a link
    url = f"/api{check['snapshot'][4:]}"
    assert api.get(url, headers=h).content == PNG and api.get(url, headers=yh).status_code == 200
    mike = api.post("/api/auth/login", json={"email": "mike.trainer@fitcoach.com", "password": "Trainer@123"}).json()
    assert api.get(url, headers={"Authorization": f"Bearer {mike['access_token']}"}).status_code == 404
    # withdrawing photo consent deletes it
    api.post("/api/me/consent", json={"health_data": True, "photos": False}, headers=h)
    assert check["snapshot_path"] not in fake.objs
    assert run(server.db.pose_checks.find_one({"id": check["id"]}))["snapshot"] is None
