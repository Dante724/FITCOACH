"""
The built-in plan engine (no AI key): calorie maths, diet/allergy/injury rules, food-log parsing, and that the API
uses it for plan drafts and food estimates when no GEMINI_API_KEY is set.
"""
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import engine  # noqa: E402

NONVEG = {"chicken", "chicken_curry", "tandoori_chicken", "fish_curry", "grilled_fish", "mutton_curry"}
EGG = {"egg", "egg_whites", "omelette", "egg_bhurji"}
DAIRY = {k for k in engine.F if "dairy" in engine._tags(k)}


def client(diet="veg", focus="fat_loss", **intake):
    base = {"age": 30, "sex": "female", "height_cm": 160, "weight_kg": 70, "days_per_week": 4, "diet": diet,
            "experience": "beginner", "equipment": "gym"}
    return {"focus": focus, "intake": {**base, **intake}}


def keys_in(plan):
    names = " | ".join(i for m in plan["meals"] for i in m["items"]).lower()
    return {k for k, row in engine.F.items() if row[0].lower() in names}


def test_targets_follow_mifflin_st_jeor():
    t = engine.targets({"age": 30, "sex": "male", "height_cm": 175, "days_per_week": 4}, 80, "maintain")
    bmr = 10 * 80 + 6.25 * 175 - 5 * 30 + 5
    assert abs(t["tdee"] - bmr * 1.55) < 1 and abs(t["calories"] - bmr * 1.55) <= 5
    loss = engine.targets({"age": 30, "sex": "male", "height_cm": 175, "days_per_week": 4}, 80, "fat_loss")
    gain = engine.targets({"age": 30, "sex": "male", "height_cm": 175, "days_per_week": 4}, 80, "muscle_gain")
    assert loss["calories"] < t["calories"] < gain["calories"]
    assert loss["protein_g"] == round(1.6 * 80) and gain["protein_g"] == round(1.8 * 80)
    # never below a safe floor
    assert engine.targets({"age": 60, "sex": "female", "height_cm": 145, "days_per_week": 1}, 45, "fat_loss")["calories"] >= 1200


@pytest.mark.parametrize("diet,banned", [("veg", NONVEG | EGG), ("eggetarian", NONVEG), ("vegan", NONVEG | EGG | DAIRY),
                                         ("jain", NONVEG | EGG | {"aloo_sabzi", "aloo_paratha", "masala_dosa", "rajma", "chole", "sprouts", "sambar"})])
def test_meal_plan_respects_diet(diet, banned):
    for seed in range(12):
        plan = engine.build_meal_plan(client(diet), 70, seed=seed)
        assert not (keys_in(plan) & banned), (diet, seed, keys_in(plan) & banned)


def test_meal_plan_respects_allergies_and_dislikes_and_lands_near_target():
    for seed in range(12):
        plan = engine.build_meal_plan(client("veg", allergies="peanuts, dairy", dislikes="poha, bhindi"), 70, seed=seed)
        used = keys_in(plan)
        assert not used & ({"peanuts", "peanut_butter", "poha", "bhindi"} | DAIRY)
        total = sum(m["calories"] for m in plan["meals"])
        assert abs(total - plan["targets"]["calories"]) / plan["targets"]["calories"] < 0.15


def test_coach_note_changes_calories_and_protein():
    base = engine.build_meal_plan(client(), 70, "", seed=1)["targets"]
    less = engine.build_meal_plan(client(), 70, "Weight flat for 3 weeks — drop 150 kcal and more protein", seed=1)["targets"]
    assert less["calories"] == base["calories"] - 150 and less["protein_g"] > base["protein_g"]


def test_workout_respects_equipment_injuries_and_days():
    plan = engine.build_workout_plan(client(equipment="bodyweight", injuries="bad knees, lower back pain", days_per_week=3))
    assert len(plan["days"]) == 3
    names = {e["name"] for d in plan["days"] for e in d["exercises"]}
    assert not names & {"Back Squat", "Walking Lunge", "Romanian Deadlift", "Leg Press", "Bench Press"}  # knee/back or gym-only
    assert "Box Squat to Bench" in names and "knee" in plan["summary"]
    gym = engine.build_workout_plan(client(focus="muscle_gain", experience="intermediate", days_per_week=5))
    assert [d["focus"] for d in gym["days"]] == ["Upper body", "Lower body", "Push", "Pull", "Legs"]
    assert all(e["sets"] >= 3 for d in gym["days"] for e in d["exercises"][:2])
    six = engine.build_workout_plan(client(days_per_week=6))
    assert len(six["days"]) == 6
    note = engine.build_workout_plan(client(days_per_week=3), "switch to 4 days, home workouts")
    assert len(note["days"]) == 4 and "dumbbells at home" in note["summary"]


def test_adjustment_without_notes_progresses():
    first = engine.build_workout_plan(client(experience="intermediate"), seed=2)
    nxt = engine.build_workout_plan(client(experience="intermediate"), "", seed=2, active=first)
    assert sum(e["sets"] for d in nxt["days"] for e in d["exercises"]) > sum(e["sets"] for d in first["days"] for e in d["exercises"])
    assert "Progression" in nxt["summary"]


def test_yoga_avoids_poses_for_injuries():
    plan = engine.build_yoga_plan(client(focus="yoga", injuries="wrist pain and high blood pressure", days_per_week=4))
    names = {e["name"] for d in plan["days"] for e in d["exercises"]}
    assert len(plan["days"]) == 4
    assert not any(n.startswith(("Downward Dog", "Cat–Cow", "Sun Salutation", "Camel")) for n in names)
    assert any(n.startswith("Corpse") for n in names)
    preg = engine.build_yoga_plan(client(focus="yoga", injuries="5 months pregnant"))
    assert "doctor" in preg["summary"]
    assert not {e["name"] for d in preg["days"] for e in d["exercises"]} & {"Cobra (Bhujangasana)", "Boat (Navasana)", "Supine Twist (Supta Matsyendrasana)"}


@pytest.mark.parametrize("text,expected_kcal,foods", [
    ("2 roti, 1 katori dal and 100g paneer", 635, ["Roti", "Dal", "Paneer"]),
    ("3 idli sambar", 304, ["Idli", "Sambar"]),
    ("pizza 2 slices", 570, ["Pizza"]),
    ("200 ml milk with 2 banana", 330, ["Milk", "Banana"]),
    ("2 ande ka omelette", 190, ["Omelette"]),
    ("1 small bowl poha", 188, ["Poha"]),
    ("dal chawal", 345, ["Dal", "Steamed rice"]),
])
def test_food_parsing(text, expected_kcal, foods):
    r = engine.analyze_meal(text)
    assert abs(r["calories"] - expected_kcal) <= 3, r
    assert all(any(i.startswith(f) for i in r["items"]) for f in foods) and len(r["items"]) == len(foods)


def test_food_parsing_unknown_and_empty():
    r = engine.analyze_meal("mystery stew, 2 eggs")
    assert r["calories"] == 156 and r["unrecognised"] == ["mystery stew"] and "Couldn't recognise" in r["notes"]
    assert engine.analyze_meal("qwerty asdf") == {}
    junk = engine.analyze_meal("2 samosa and coke")["health_score"]
    healthy = engine.analyze_meal("grilled chicken 150g, salad, 1 roti")["health_score"]
    assert healthy > junk


# ── through the API, with no AI key ─────────────────────
def test_api_uses_engine_without_key():
    from fastapi.testclient import TestClient
    from inprocess import server
    assert not server.GEMINI_API_KEY
    with TestClient(server.app) as api:
        r = api.post("/api/auth/register", json={"name": "Engine Test", "email": f"eng_{uuid.uuid4().hex[:8]}@example.com",
                                                 "password": "Passw0rd!", "consent": True}).json()
        h = {"Authorization": f"Bearer {r['access_token']}"}
        api.put("/api/profile/intake", json={"focus": "fat_loss", "diet": "eggetarian", "days_per_week": 3, "injuries": "knee"}, headers=h)
        admin = {"Authorization": "Bearer " + api.post("/api/auth/login", json={"email": "admin@fitcoach.com", "password": "Admin@12345"}).json()["access_token"]}
        coach = api.post("/api/auth/login", json={"email": "sarah.trainer@fitcoach.com", "password": "Trainer@123"}).json()
        ch = {"Authorization": f"Bearer {coach['access_token']}"}
        api.put(f"/api/admin/users/{r['user_id']}/coaches", json={"fitness_coach_id": coach["user_id"]}, headers=admin)
        meal = api.post(f"/api/coach/clients/{r['user_id']}/plans/draft", json={"type": "meal"}, headers=ch).json()
        assert meal["source"] == "engine" and not meal["ai_generated"] and "built-in plan builder" in meal["ai_note"]
        assert meal["content"]["meals"] and meal["content"]["total_calories"] > 1000
        work = api.post(f"/api/coach/clients/{r['user_id']}/plans/draft", json={"type": "workout"}, headers=ch).json()
        assert len(work["content"]["days"]) == 3
        food = api.post("/api/food/analyze", json={"description": "2 roti and 1 katori dal"}, headers=h)
        assert food.status_code == 200 and food.json()["result"]["calories"] == 370
        assert api.post("/api/food/analyze", json={"description": "zzzz qqqq"}, headers=h).status_code == 400
        assert api.get("/api/legal").json()["ai_enabled"] is False


def test_food_parsing_units_and_vegetables():
    assert engine.analyze_meal("a tablespoon of olive oil")["calories"] == 135
    assert engine.analyze_meal("1 tbsp peanut butter")["calories"] == 95  # peanut butter's serving is already a tbsp
    r = engine.analyze_meal("grilled chicken breast with a cup of brown rice and steamed broccoli")
    assert r["unrecognised"] == [] and len(r["items"]) == 3



def test_offline_sync_is_idempotent_and_keeps_time_and_my_foods():
    from datetime import datetime, timedelta, timezone
    from fastapi.testclient import TestClient
    from inprocess import server
    with TestClient(server.app) as api:
        r = api.post("/api/auth/register", json={"name": "Offline Test", "email": f"off_{uuid.uuid4().hex[:8]}@example.com",
                                                 "password": "Passw0rd!", "consent": True}).json()
        h = {"Authorization": f"Bearer {r['access_token']}"}
        # a food taught offline, synced with the id the phone created
        food = {"id": "phone-made-id-1", "name": "Chunda", "aliases": ["mom ka chunda"], "unit": "1 tbsp", "kcal": 60, "carbs_g": 15}
        assert api.post("/api/me/foods", json=food, headers=h).status_code == 200
        assert api.post("/api/me/foods", json={**food, "kcal": 65}, headers=h).json()["kcal"] == 65  # same id → update, not duplicate
        assert len(api.get("/api/me/foods", headers=h).json()) == 1
        assert api.post("/api/me/foods", json={**food, "id": "x2", "kcal": 99999}, headers=h).status_code == 400
        # a meal logged offline two hours ago, sent twice (retry) → stored once with the original time
        eaten = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        body = {"description": "2 roti and mom ka chunda", "client_ref": "ref-123", "logged_at": eaten}
        first = api.post("/api/food/analyze", json=body, headers=h).json()
        again = api.post("/api/food/analyze", json=body, headers=h).json()
        assert first["id"] == again["id"] and first["created_at"][:16] == eaten[:16]
        assert first["result"]["calories"] == 220 + 65
        assert len(api.get("/api/food/logs", headers=h).json()) == 1
        # nonsense timestamps fall back to now
        odd = api.post("/api/food/analyze", json={"description": "1 roti", "client_ref": "ref-124", "logged_at": "2001-01-01T00:00:00Z"}, headers=h).json()
        assert odd["created_at"][:4] == str(datetime.now(timezone.utc).year)
        # my foods are private, exported, and deletable
        other = api.post("/api/auth/register", json={"name": "Other", "email": f"oth_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", "consent": True}).json()
        oh = {"Authorization": f"Bearer {other['access_token']}"}
        assert api.get("/api/me/foods", headers=oh).json() == []
        assert api.post("/api/me/foods", json=food, headers=oh).status_code == 409  # can't overwrite someone else's food id
        assert api.get("/api/me/export", headers=h).json()["user_foods"][0]["name"] == "Chunda"
        api.delete("/api/me/foods/phone-made-id-1", headers=h)
        assert api.get("/api/me/foods", headers=h).json() == []


# ── offline parity: the app's JavaScript engine must give identical answers ─────────
import json  # noqa: E402
from pathlib import Path  # noqa: E402

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
FIXTURE = FRONTEND / "src" / "lib" / "nutrition.cases.json"
MY_FOODS = [{"id": "t1", "name": "Thepla", "aliases": ["thepla", "methi thepla"], "unit": "piece", "grams": 50, "kcal": 120, "protein_g": 3, "carbs_g": 17, "fat_g": 4.5},
            {"id": "t2", "name": "Mom's rajma", "aliases": ["moms rajma", "home rajma"], "unit": "katori", "kcal": 230, "protein_g": 12, "carbs_g": 31, "fat_g": 7}]
MEALS = [
    "2 roti, 1 katori dal and 100g paneer", "3 idli sambar", "pizza 2 slices", "200 ml milk with 2 banana", "2 ande ka omelette",
    "1 small bowl poha", "dal chawal", "masala dosa and filter coffee", "mystery stew, 2 eggs", "qwerty asdf", "1/2 bowl rice and 100gms paneer",
    "a tablespoon of olive oil", "1 tbsp peanut butter", "grilled chicken breast with a cup of brown rice and steamed broccoli",
    "2 chapathi with paner bhurji", "dall and chawal", "1 large plate chicken biryani + coke", "half glass milk", "two boiled eggs and toast",
    "chole bhature", "3 egg omelette and 2 toast", "1.5 cup rice, rajma, salad", "upma; chai", "1 kg watermelon", "250g curd",
    "do roti aur sabzi", "ek katori dal", "palak paneer with 2 rotis", "sprouts salad", "whey protein shake with banana", "makhana",
    "2 samosa and coke", "grilled chicken 150g, salad, 1 roti", "khichdi with curd", "bajra roti 2 and dal", "3 dhokla", "4 almonds",
    "soya chunks 50g", "tofu 200 g stir fry", "fish curry rice", "mutton curry and 3 roti", "1 vada pav", "gulab jamun 2 pieces",
    "oats with milk", "dalia", "aloo paratha with curd", "jeera rice and dal fry", "paneer tikka", "egg whites 6", "1 apple and 10 almonds",
    "2 thepla with curd", "methi thepla 3", "moms rajma with rice", "home rajma", "big bowl of fruit", "small cup tea", "½ plate poha",
    "chicken curry 300g", "bhindi sabzi, 2 phulka", "lassi",
]
TARGETS = [({"age": 30, "sex": "male", "height_cm": 175, "days_per_week": 4}, 80, "fat_loss"),
           ({"age": 45, "sex": "female", "height_cm": 152, "days_per_week": 2}, 58, "fat_loss"),
           ({"age": 24, "sex": "male", "height_cm": 180, "days_per_week": 5}, 70, "muscle_gain"),
           ({"age": 35, "height_cm": 165, "days_per_week": 3, "target_weight_kg": 75}, 102, "yoga"),
           ({}, None, "hybrid")]


def build_cases():
    return {"my_foods": MY_FOODS,
            "meals": [{"text": m, "expected": engine.analyze_meal(m, MY_FOODS)} for m in MEALS],
            "targets": [{"intake": i, "weight": w, "focus": f, "expected": {k: engine.targets(i, w, f)[k] for k in ("calories", "protein_g", "fat_g", "carbs_g")}}
                        for i, w, f in TARGETS]}


def write_cases():
    FIXTURE.write_text(json.dumps(build_cases(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


@pytest.mark.skipif(not FRONTEND.exists(), reason="frontend not checked out")
def test_app_food_table_and_parity_fixture_are_current():
    app_copy = json.loads((FRONTEND / "src" / "data" / "foods.json").read_text(encoding="utf-8"))
    assert app_copy == json.loads((Path(engine.__file__).parent / "food_data.json").read_text(encoding="utf-8")), \
        "frontend/src/data/foods.json is out of date — run `npm run sync-foods` in frontend/"
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == json.loads(json.dumps(build_cases(), ensure_ascii=False)), \
        "Parity fixture is out of date — run `python tests/test_engine.py` in backend/"


if __name__ == "__main__":
    write_cases()
    print(f"wrote {FIXTURE}")
