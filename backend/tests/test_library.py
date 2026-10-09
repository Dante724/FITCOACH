"""
The exercise & yoga library (backend/library.json, built from library_src/): every entry is complete, and every
exercise or pose the plan builder can put in a plan links to a library entry (the app looks them up by name).
"""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import engine

ROOT = Path(__file__).resolve().parent.parent
LIB = json.loads((ROOT / "library.json").read_text(encoding="utf-8"))


def norm(s):  # same rules as frontend/src/lib/library.js
    s = unicodedata.normalize("NFKD", str(s or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch) or "ऀ" <= ch <= "ॿ").replace("़", "")
    s = re.sub(r"[^a-z0-9ऀ-ॿ]+", " ", s)
    s = s.replace("aa", "a").replace("ee", "i").replace("oo", "u").replace("w", "v")
    s = re.sub(r"([bcdfghjklmnpqrstvxz])\1", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


BY_NAME = {}
for e in LIB:
    for n in [e["id"], e["name"], e.get("sanskrit"), *e["aliases"]]:
        if n:
            BY_NAME[norm(n)] = e


def find(name):
    if norm(name) in BY_NAME:
        return BY_NAME[norm(name)]
    inner = re.search(r"\(([^)]+)\)", name)
    if inner and norm(inner.group(1)) in BY_NAME:
        return BY_NAME[norm(inner.group(1))]
    return BY_NAME.get(norm(re.sub(r"\([^)]*\)", "", name)))


def test_library_is_built_from_source_and_valid():
    out = subprocess.run([sys.executable, str(ROOT / "library_src" / "build.py")], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    assert json.loads((ROOT / "library.json").read_text(encoding="utf-8")) == LIB  # committed file is up to date


def test_tabs_have_plenty_and_ids_are_unique():
    cats = {c: [e for e in LIB if e["category"] == c] for c in ("home", "gym", "yoga")}
    assert len(cats["home"]) >= 50 and len(cats["gym"]) >= 45 and len(cats["yoga"]) >= 55
    assert len({e["id"] for e in LIB}) == len(LIB)


def test_every_plan_exercise_and_pose_has_a_library_entry():
    missing = [ex[0] for ex in engine.EXERCISES if not find(ex[0])] + [p[0] for p in engine.POSES if not find(p[0])]
    assert missing == []


def test_hindi_names_and_safety_notes():
    for e in LIB:
        assert any("ऀ" <= ch <= "ॿ" for ch in e["hindi"]), e["id"]
        assert e["steps"] and e["mistakes"], e["id"]
    kapal = find("Kapalbhati")
    assert kapal and any("pregnancy" in a for a in kapal["avoid_if"]) and any("blood pressure" in a for a in kapal["avoid_if"])


def test_pose_check_links_point_to_real_poses():
    checks = {e["pose_check"] for e in LIB if e.get("pose_check")}
    assert checks == {"tree", "triangle", "downdog", "chair", "plank", "cobra", "bridge", "warrior2"}
