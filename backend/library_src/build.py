"""
Builds backend/library.json (the exercise & yoga library shared with the app) from home.py, gym.py and yoga.py,
checking every entry. Run: python3 library_src/build.py
"""
import importlib, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(HERE, "..", "library.json")

GROUPS = {
    "home": ["Full body", "Legs & glutes", "Chest & arms", "Back & shoulders", "Core & abs", "Cardio & HIIT", "Mobility & stretching", "Low impact / seniors"],
    "gym": ["Chest", "Back", "Shoulders", "Arms", "Legs", "Glutes", "Core", "Cardio machines", "Full body"],
    "yoga": ["Warm-up", "Surya Namaskar", "Standing", "Balance", "Backbends", "Forward bends", "Seated & hips", "Twists", "Inversions", "Core", "Restorative", "Pranayama (breathing)"],
}
MUSCLES = set("chest back shoulders biceps triceps forearms core obliques glutes quads hamstrings calves hips cardio neck spine".split()) | {"lower back", "full body"}
EQUIP = {"none", "mat", "chair", "wall", "towel", "backpack", "water bottles", "resistance band", "dumbbells", "kettlebell", "barbell", "bench",
         "cable machine", "machine", "pull-up bar", "box/step", "strap", "block"}
BONES = [((1, 3), 14), ((2, 4), 14), ((3, 5), 13), ((4, 6), 13), ((7, 9), 19), ((8, 10), 19), ((9, 11), 19), ((10, 12), 19)]


def check(e, ids):
    w, errs = e.get("id"), []
    if w in ids:
        errs.append("duplicate id")
    cat = e["category"]
    if e["group"] not in GROUPS[cat]:
        errs.append(f"group {e['group']!r}")
    if cat == "yoga" and not (e.get("sanskrit") and e.get("benefits")):
        errs.append("yoga needs sanskrit + benefits")
    if not any("ऀ" <= ch <= "ॿ" for ch in e["hindi"]):
        errs.append("hindi must be Devanagari")
    errs += [f"muscle {m!r}" for m in e["muscles"] if m not in MUSCLES]
    errs += [f"equipment {q!r}" for q in e["equipment"] if q not in EQUIP]
    if e["level"] not in ("beginner", "intermediate", "advanced"):
        errs.append("level")
    if not 2 <= len(e["steps"]) <= 5:
        errs.append("2-5 steps")
    if not 1 <= len(e["mistakes"]) <= 3:
        errs.append("1-3 mistakes")
    if not 5 <= len(e["keywords"]) <= 16:
        errs.append(f"5-16 keywords (has {len(e['keywords'])})")
    for fr in ("start", "end"):
        pts = e["figure"][fr]
        if len(pts) != 13:
            errs.append(f"{fr}: 13 joints")
            continue
        for (a, b), L in BONES:
            d = math.dist(pts[a], pts[b])
            if abs(d - L) > 1.5:
                errs.append(f"{fr}: bone {a}-{b} = {d:.1f}")
    return errs


def main():
    entries, problems = [], []
    for mod in ("home", "gym", "yoga"):
        try:
            entries += importlib.import_module(mod).ENTRIES
        except ModuleNotFoundError as ex:
            if ex.name != mod:
                raise
    ids = set()
    for e in entries:
        problems += [f"{e.get('id')}: {p}" for p in check(e, ids)]
        ids.add(e["id"])
    # fit every figure into the 0–100 box (wide poses are scaled down a little, keeping the floor line)
    for e in entries:
        f = e["figure"]
        pts = f["start"] + f["end"]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        span = max(max(xs) - min(xs), 1)
        scale = min(1.0, 92 / span, 86 / max(92 - min(ys) + 5, 1))
        cx = (min(xs) + max(xs)) / 2
        for fr in ("start", "end"):
            f[fr] = [[round(50 + (x - cx) * scale, 1), round(92 - (92 - y) * scale, 1)] for x, y in f[fr]]
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    json.dump(entries, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    counts = {}
    for e in entries:
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    print(f"library.json: {len(entries)} entries {counts}")


if __name__ == "__main__":
    main()
