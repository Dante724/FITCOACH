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
