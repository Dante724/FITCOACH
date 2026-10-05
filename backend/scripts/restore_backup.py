"""
Restore a FitCoach backup into a MongoDB database.

    python scripts/restore_backup.py fitcoach-backup-2026-10-05-0300.json.gz --mongo-url "mongodb+srv://..." --db fitcoach

By default it refuses to write into a database that already has users, so you can't overwrite live data by
accident. Add --replace to wipe the collections in the backup first (use this to recover from a disaster).
Backups made without files don't contain photo/voice bytes; files already in object storage are untouched.
"""
import argparse
import gzip
import sys

from bson import json_util
from pymongo import MongoClient


def load(path: str) -> dict:
    with open(path, "rb") as f:
        raw = f.read()
    data = json_util.loads(gzip.decompress(raw) if path.endswith(".gz") else raw)
    if data.get("app") != "fitcoach" or "collections" not in data:
        sys.exit("This doesn't look like a FitCoach backup.")
    return data


def restore(data: dict, db, replace: bool = False) -> dict:
    if not replace and db.users.estimated_document_count():
        sys.exit("The target database already has users. Re-run with --replace to overwrite it.")
    counts = {}
    for name, docs in data["collections"].items():
        if replace:
            db[name].delete_many({})
        if docs:
            db[name].insert_many(docs, ordered=False)
        counts[name] = len(docs)
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("backup")
    ap.add_argument("--mongo-url", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--replace", action="store_true", help="delete existing data in the backed-up collections first")
    args = ap.parse_args()
    data = load(args.backup)
    print(f"Backup from {data['created_at']} with {sum(len(v) for v in data['collections'].values())} records")
    counts = restore(data, MongoClient(args.mongo_url)[args.db], args.replace)
    for name, n in sorted(counts.items()):
        print(f"  {name}: {n}")
    print("Restore complete. Restart the API so indexes are rebuilt.")


if __name__ == "__main__":
    main()
