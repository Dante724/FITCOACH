"""
FitCoach's built-in plan engine — no AI service, no API key, runs on our own server.

It drafts starting points that a coach then reviews and approves:
  * nutrition: calorie and macro targets (Mifflin–St Jeor) and a one-day Indian meal plan from a food table,
    respecting diet type (veg / egg / non-veg / vegan / Jain), allergies and dislikes;
  * training: a weekly split chosen from goal, days per week, equipment, experience and injuries;
  * yoga: a weekly practice sequenced warm-up → standing → balance → floor → rest, avoiding poses that clash
    with listed injuries;
  * food logging: estimates calories/macros from a plain-language meal description ("2 roti, 1 katori dal").

Nutrition values are typical per-serving figures for home-style Indian food (based on common Indian food
composition references), rounded. They're estimates — portions and recipes vary — which is why a coach reviews
every plan.
"""
import difflib
import random
import re
from fractions import Fraction
from typing import List, Optional, Tuple

# ───────────────────────────── Food table ─────────────────────────────
# key: (name, serving label, grams per serving, kcal, protein g, carbs g, fat g, tags, aliases)
#   aliases: '|'-separated names people type (Hindi and English)
#   tags: diet → "veg" (no egg/meat; may contain dairy), "egg", "nonveg"; "vegan" if no dairy/animal products;
#         jain → "jain" (fine as is), "jain_adapt" (fine when cooked without onion/garlic), none = not Jain-friendly;
#         allergens → "dairy", "gluten", "nuts", "peanut", "soy", "egg_a", "fish"; "count" = counted in pieces;
#         "junk" = not used in plans.
F = {
    # grains & breads
    "roti": ("Roti / chapati", "roti", 40, 110, 3.5, 20, 2.5, "veg vegan jain gluten count", "roti|chapati|chapatti|phulka|fulka|chapathi"),
    "bajra_roti": ("Bajra / jowar roti", "roti", 45, 115, 3, 21, 2.5, "veg vegan jain count", "bajra roti|jowar roti|bhakri|millet roti|ragi roti"),
    "paratha": ("Plain paratha", "paratha", 60, 200, 4, 28, 8, "veg jain gluten dairy count", "paratha|parantha|plain paratha"),
    "aloo_paratha": ("Aloo paratha", "paratha", 100, 260, 6, 36, 10, "veg gluten dairy count", "aloo paratha|alu paratha"),
    "rice": ("Steamed rice", "cup (150 g)", 150, 195, 4, 43, 0.5, "veg vegan jain", "rice|chawal|plain rice|white rice|steamed rice"),
    "brown_rice": ("Brown rice", "cup (150 g)", 150, 165, 3.5, 34, 1.3, "veg vegan jain", "brown rice"),
    "jeera_rice": ("Jeera rice", "cup (150 g)", 150, 230, 4, 42, 5, "veg jain_adapt dairy", "jeera rice|pulao"),
    "poha": ("Poha", "plate (150 g)", 150, 250, 5, 45, 6, "veg vegan jain_adapt peanut", "poha|pohe|aval"),
    "upma": ("Upma", "bowl (150 g)", 150, 220, 6, 34, 7, "veg vegan jain_adapt gluten", "upma|uppit|rava upma"),
    "idli": ("Idli", "idli", 40, 58, 2, 12, 0.2, "veg vegan jain count", "idli|idly"),
    "dosa": ("Plain dosa", "dosa", 80, 170, 4, 28, 4.5, "veg vegan jain count", "dosa|dosai|plain dosa"),
    "masala_dosa": ("Masala dosa", "dosa", 160, 300, 6, 45, 11, "veg vegan count", "masala dosa"),
    "oats": ("Oats", "bowl (40 g dry)", 40, 150, 5, 27, 3, "veg vegan jain", "oats|oatmeal|porridge"),
    "dalia": ("Dalia (broken wheat)", "bowl (150 g)", 150, 170, 6, 32, 1.5, "veg vegan jain gluten", "dalia|daliya|broken wheat"),
    "bread": ("Whole-wheat bread", "slice", 28, 70, 3, 12, 1, "veg vegan jain gluten count", "bread|toast|brown bread|bread slice"),
    "besan_chilla": ("Besan chilla", "chilla", 60, 150, 8, 18, 5, "veg vegan jain_adapt count", "besan chilla|chilla|cheela|pudla"),
    "moong_chilla": ("Moong dal chilla", "chilla", 60, 130, 8, 17, 3.5, "veg vegan jain_adapt count", "moong chilla|moong dal chilla|pesarattu"),
    "khichdi": ("Moong dal khichdi", "bowl (200 g)", 200, 230, 9, 38, 5, "veg jain dairy", "khichdi|khichri"),
    "dhokla": ("Dhokla", "pieces (100 g)", 100, 160, 6, 22, 5, "veg vegan jain", "dhokla|khaman"),
    # dals & legumes
    "dal": ("Dal (toor / masoor)", "katori (150 g)", 150, 150, 9, 20, 4, "veg vegan jain_adapt", "dal|daal|toor dal|arhar dal|masoor dal|dal tadka|dal fry|yellow dal"),
    "moong_dal": ("Moong dal", "katori (150 g)", 150, 140, 10, 19, 3, "veg vegan jain_adapt", "moong dal|mung dal|green moong"),
    "rajma": ("Rajma", "katori (150 g)", 150, 210, 11, 30, 5, "veg vegan", "rajma|kidney beans|rajma chawal"),
    "chole": ("Chole", "katori (150 g)", 150, 240, 11, 32, 8, "veg vegan", "chole|chana masala|chickpeas|chhole|chole bhature"),
    "sambar": ("Sambar", "katori (150 g)", 150, 130, 6, 18, 4, "veg vegan", "sambar|sambhar"),
    "sprouts": ("Sprouts salad", "bowl (100 g)", 100, 110, 8, 17, 1, "veg vegan", "sprouts|sprout salad|moong sprouts"),
    "soya": ("Soya chunks", "bowl (30 g dry)", 30, 105, 16, 10, 0.2, "veg vegan jain soy", "soya chunks|soy chunks|nutrela|soya"),
    "tofu": ("Tofu", "100 g", 100, 145, 15, 3, 9, "veg vegan jain soy", "tofu"),
    "chana_roasted": ("Roasted chana", "handful (30 g)", 30, 110, 6, 18, 1.8, "veg vegan jain", "roasted chana|bhuna chana|chana"),
    # dairy
    "curd": ("Curd (dahi)", "cup (200 g)", 200, 120, 7, 9, 6, "veg jain dairy", "curd|dahi|yogurt|yoghurt"),
    "hung_curd": ("Hung curd / Greek yogurt", "150 g", 150, 130, 15, 6, 5, "veg jain dairy", "hung curd|greek yogurt|greek yoghurt"),
    "milk": ("Milk (toned)", "glass (250 ml)", 250, 150, 8, 12, 7.5, "veg jain dairy", "milk|doodh"),
    "buttermilk": ("Buttermilk (chaas)", "glass (250 ml)", 250, 40, 3, 4, 1, "veg jain dairy", "buttermilk|chaas|chhaas|mattha"),
    "paneer": ("Paneer", "100 g", 100, 265, 18, 3, 20, "veg jain dairy", "paneer|cottage cheese"),
    "palak_paneer": ("Palak paneer", "katori (150 g)", 150, 280, 14, 10, 20, "veg jain_adapt dairy", "palak paneer|saag paneer"),
    "paneer_bhurji": ("Paneer bhurji", "katori (120 g)", 120, 300, 18, 7, 22, "veg jain_adapt dairy", "paneer bhurji"),
    "raita": ("Raita", "katori (150 g)", 150, 90, 5, 7, 4, "veg jain dairy", "raita"),
    "whey": ("Whey protein", "scoop (30 g)", 30, 120, 24, 3, 1.5, "veg jain dairy count", "whey|whey protein|protein shake|protein powder"),
    # eggs, meat & fish
    "egg": ("Boiled egg", "egg", 50, 78, 6, 0.6, 5, "egg egg_a count", "egg|eggs|boiled egg|boiled eggs|anda|ande"),
    "egg_whites": ("Egg whites", "3 whites", 99, 51, 11, 0.7, 0.2, "egg egg_a", "egg white|egg whites"),
    "omelette": ("Omelette (2 eggs)", "omelette", 130, 190, 13, 2, 14, "egg egg_a count", "omelette|omelet|anda omelette"),
    "egg_bhurji": ("Egg bhurji (2 eggs)", "plate", 130, 200, 13, 4, 15, "egg egg_a", "egg bhurji|anda bhurji|scrambled eggs"),
    "chicken": ("Grilled chicken breast", "100 g", 100, 165, 31, 0, 3.6, "nonveg", "grilled chicken|chicken breast|chicken"),
    "chicken_curry": ("Chicken curry", "katori (150 g)", 150, 250, 25, 6, 14, "nonveg", "chicken curry|butter chicken|chicken masala"),
    "tandoori_chicken": ("Tandoori chicken", "2 pieces (150 g)", 150, 260, 35, 4, 11, "nonveg dairy", "tandoori chicken|chicken tikka"),
    "fish_curry": ("Fish curry", "katori (150 g)", 150, 220, 22, 5, 12, "nonveg fish", "fish curry|machli"),
    "grilled_fish": ("Grilled fish", "100 g", 100, 140, 24, 0, 4, "nonveg fish", "grilled fish|fish fry|fish tikka|fish"),
    "mutton_curry": ("Mutton curry", "katori (150 g)", 150, 330, 25, 6, 23, "nonveg", "mutton curry|mutton|goat curry"),
    # vegetables
    "mixed_veg": ("Mixed vegetable sabzi", "katori (150 g)", 150, 120, 3, 12, 7, "veg vegan", "mixed veg|sabzi|sabji|subzi|vegetable curry|veg curry|mix veg"),
    "lauki": ("Lauki / tori sabzi", "katori (150 g)", 150, 90, 2, 10, 5, "veg vegan jain", "lauki|ghiya|dudhi|bottle gourd|tori|turai"),
    "cabbage": ("Cabbage / beans sabzi", "katori (150 g)", 150, 100, 3, 10, 6, "veg vegan jain_adapt", "cabbage|patta gobhi|beans sabzi|cabbage sabzi"),
    "palak": ("Palak / methi sabzi", "katori (150 g)", 150, 110, 4, 8, 7, "veg vegan jain_adapt", "palak|spinach|methi|saag"),
    "bhindi": ("Bhindi sabzi", "katori (150 g)", 150, 130, 3, 12, 8, "veg vegan jain_adapt", "bhindi|okra|ladyfinger"),
    "aloo_sabzi": ("Aloo sabzi", "katori (150 g)", 150, 180, 3, 24, 8, "veg vegan", "aloo sabzi|potato|aloo|alu|jeera aloo"),
    "salad": ("Cucumber–tomato salad", "bowl", 150, 40, 1.5, 8, 0.3, "veg vegan jain", "salad|cucumber|kheera|tomato"),
    "veg_soup": ("Vegetable soup", "bowl (250 ml)", 250, 80, 3, 12, 2, "veg vegan", "soup|vegetable soup|veg soup"),
    "sauteed_veg": ("Sautéed vegetables", "bowl (150 g)", 150, 90, 3, 10, 4, "veg vegan jain_adapt", "sauteed vegetables|stir fry vegetables|stir fry|steamed vegetables|vegetables|veggies|broccoli|capsicum|mushroom|mushrooms|beans|gobi|cauliflower"),
    # fruit, nuts & snacks
    "banana": ("Banana", "banana", 118, 105, 1.3, 27, 0.4, "veg vegan jain count", "banana|kela"),
    "apple": ("Apple", "apple", 180, 95, 0.5, 25, 0.3, "veg vegan jain count", "apple|seb"),
    "fruit": ("Seasonal fruit", "bowl (150 g)", 150, 90, 1, 22, 0.4, "veg vegan jain", "fruit|fruits|papaya|guava|orange|watermelon|pomegranate|fruit bowl|mango"),
    "almonds": ("Almonds", "10 almonds", 12, 70, 2.5, 2.5, 6, "veg vegan jain nuts", "almonds|almond|badam|nuts"),
    "peanuts": ("Roasted peanuts", "handful (30 g)", 30, 170, 7.5, 5, 14, "veg vegan jain peanut", "peanuts|moongfali|groundnuts"),
    "peanut_butter": ("Peanut butter", "tbsp", 16, 95, 4, 3, 8, "veg vegan jain peanut count", "peanut butter"),
    "makhana": ("Roasted makhana", "bowl (30 g)", 30, 120, 3, 21, 2.5, "veg jain dairy", "makhana|fox nuts|lotus seeds"),
    "ghee": ("Ghee", "tsp", 5, 45, 0, 0, 5, "veg jain dairy count", "ghee"),
    "oil": ("Cooking oil", "tsp", 5, 45, 0, 0, 5, "veg vegan jain count", "oil|olive oil|cooking oil|mustard oil|butter"),
    "tea": ("Tea with milk & sugar", "cup", 150, 70, 2, 10, 2, "veg jain dairy count junk", "tea|chai"),
    "coffee": ("Coffee with milk", "cup", 150, 80, 3, 10, 3, "veg jain dairy count junk", "coffee"),
    # common foods for logging only
    "samosa": ("Samosa", "samosa", 100, 260, 4, 30, 14, "veg vegan gluten count junk", "samosa"),
    "veg_biryani": ("Veg biryani", "plate (300 g)", 300, 380, 8, 60, 12, "veg dairy junk", "veg biryani|biryani"),
    "chicken_biryani": ("Chicken biryani", "plate (300 g)", 300, 500, 25, 55, 18, "nonveg dairy junk", "chicken biryani"),
    "pav_bhaji": ("Pav bhaji", "plate", 300, 400, 9, 55, 16, "veg dairy gluten junk", "pav bhaji"),
    "vada_pav": ("Vada pav", "vada pav", 140, 290, 6, 40, 12, "veg vegan gluten count junk", "vada pav|wada pav"),
    "pizza": ("Pizza", "slice", 107, 285, 12, 36, 10, "veg dairy gluten count junk", "pizza"),
    "burger": ("Burger", "burger", 200, 350, 15, 40, 14, "veg dairy gluten count junk", "burger"),
    "gulab_jamun": ("Gulab jamun", "piece", 50, 150, 2, 25, 5, "veg dairy gluten count junk", "gulab jamun"),
    "soft_drink": ("Soft drink", "glass (300 ml)", 300, 130, 0, 33, 0, "veg vegan jain junk", "coke|pepsi|soft drink|cold drink|soda"),
    "chips": ("Chips", "small pack (30 g)", 30, 160, 2, 15, 10, "veg vegan junk", "chips|crisps|wafers"),
}

ALLERGEN_WORDS = {
    "dairy": ["dairy", "milk", "lactose", "paneer", "curd"], "gluten": ["gluten", "wheat", "celiac", "coeliac"],
    "nuts": ["nut", "almond", "cashew", "walnut"], "peanut": ["peanut", "groundnut"], "soy": ["soy", "soya"],
    "egg_a": ["egg"], "fish": ["fish", "seafood", "prawn", "shellfish"],
}


def _tags(key: str) -> set:
    return set(F[key][7].split())


def food_allowed(key: str, diet: str, allergens: set, dislikes: List[str]) -> bool:
    t = _tags(key)
    if "junk" in t:
        return False
    diet = diet or "veg"
    if "nonveg" in t and diet != "non_veg":
        return False
    if "egg" in t and diet not in ("non_veg", "eggetarian"):
        return False
    if diet == "vegan" and "vegan" not in t:
        return False
    if diet == "jain" and not ({"jain", "jain_adapt"} & t):
        return False
    if allergens & t:
        return False
    name = (F[key][0] + " " + F[key][8].replace("|", " ")).lower()
    return not any(d and d in name for d in dislikes)


def parse_allergens(text: str) -> set:
    text = (text or "").lower()
    return {a for a, words in ALLERGEN_WORDS.items() if any(w in text for w in words)}


def parse_dislikes(*texts: str) -> List[str]:
    out = []
    for text in texts:
        for part in re.split(r"[,;/\n]| and ", (text or "").lower()):
            part = re.sub(r"\b(no|avoid|without|hate|dislike|don't like|not)\b", "", part).strip(" .")
            if 2 < len(part) < 30:
                out.append(part)
    return out


# ───────────────────────────── Targets ─────────────────────────────
def _num(v, default=None):
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def targets(intake: dict, weight: Optional[float], focus: str, kcal_delta: int = 0, protein_boost: float = 0) -> dict:
    """Daily calories and macros from Mifflin–St Jeor × activity, adjusted for the goal."""
    age = _num(intake.get("age"), 30)
    height = _num(intake.get("height_cm"), 165)
    weight = _num(weight, None) or _num(intake.get("weight_kg"), 70)
    days = int(_num(intake.get("days_per_week"), 3))
    base = 10 * weight + 6.25 * height - 5 * age
    sex = (intake.get("sex") or "").lower()
    bmr = base + 5 if sex == "male" else base - 161 if sex == "female" else base - 78
    activity = 1.375 if days <= 2 else 1.55 if days <= 4 else 1.725
    tdee = bmr * activity
    if focus == "fat_loss":
        kcal = tdee * 0.8
        floor = 1500 if sex == "male" else 1200
        kcal = max(kcal, floor)
    elif focus == "muscle_gain":
        kcal = tdee * 1.1
    else:
        kcal = tdee
    kcal = round((kcal + kcal_delta) / 10) * 10
    bmi = weight / ((height / 100) ** 2)
    ref_weight = _num(intake.get("target_weight_kg"), None) if bmi >= 30 else None
    per_kg = {"fat_loss": 1.6, "muscle_gain": 1.8}.get(focus, 1.2) + protein_boost
    protein = round(per_kg * (ref_weight or weight))
    fat = round(kcal * 0.25 / 9)
    carbs = max(50, round((kcal - protein * 4 - fat * 9) / 4))
    return {"calories": kcal, "protein_g": protein, "fat_g": fat, "carbs_g": carbs, "tdee": round(tdee),
            "weight": weight, "height": height, "age": age, "activity": activity}


# ───────────────────────────── Coach notes ─────────────────────────────
INJURY_WORDS = {
    "knee": ["knee", "acl", "meniscus", "patella"], "back": ["back", "spine", "disc", "sciatica", "lumbar", "slip disc"],
    "shoulder": ["shoulder", "rotator"], "wrist": ["wrist", "carpal"], "neck": ["neck", "cervical"],
    "ankle": ["ankle"], "hip": ["hip"], "bp": ["blood pressure", "hypertension", " bp", "bp "],
    "pregnancy": ["pregnan", "postpartum", "post-partum", "after delivery", "c-section"],
}


def parse_injuries(*texts: str) -> set:
    text = " " + " ".join(t or "" for t in texts).lower() + " "
    return {k for k, words in INJURY_WORDS.items() if any(w in text for w in words)}


def parse_notes(notes: str) -> dict:
    """Pull simple instructions out of a coach's note, e.g. 'drop 150 kcal, more protein, knee pain, 4 days, home'."""
    n = (notes or "").lower()
    out: dict = {}
    m = re.search(r"(drop|reduce|cut|minus|lower|less|decrease|-)\s*(?:by\s*)?(\d{2,4})\s*(?:k?cals?|calories)", n)
    if m:
        out["kcal_delta"] = -int(m.group(2))
    m = re.search(r"(add|increase|raise|more|plus|\+)\s*(?:by\s*)?(\d{2,4})\s*(?:k?cals?|calories)", n)
    if m:
        out["kcal_delta"] = int(m.group(2))
    if re.search(r"(more|high|higher|increase|extra)\s+protein", n):
        out["protein_boost"] = 0.2
    m = re.search(r"\b([2-6])\s*(?:days?|x|times)\b", n)
    if m:
        out["days"] = int(m.group(1))
    if "no equipment" in n or "bodyweight" in n or "body weight" in n:
        out["equipment"] = "bodyweight"
    elif "home" in n or "dumbbell" in n:
        out["equipment"] = "home"
    elif "gym" in n:
        out["equipment"] = "gym"
    if re.search(r"more volume|harder|progress|increase sets", n):
        out["volume"] = 1
    if re.search(r"deload|lighter|easier|recovery|less volume|tired|fatigue", n):
        out["volume"] = -1
    for lvl in ("beginner", "intermediate", "advanced"):
        if lvl in n:
            out["level"] = lvl
    out["injuries"] = parse_injuries(n)
    out["dislikes"] = [w.strip() for w in re.findall(r"(?:no|avoid|without|remove)\s+([a-z ]{3,20}?)(?=[,.;]|$| and )", n)]
    return out


# ───────────────────────────── Meal plans ─────────────────────────────
MEAL_TEMPLATES = {
    "Breakfast": [
        ("Poha with curd", [("poha", 1), ("curd", 0.5)]),
        ("Vegetable upma & chaas", [("upma", 1), ("buttermilk", 1)]),
        ("Idli with sambar", [("idli", 3), ("sambar", 1)]),
        ("Besan chillas with curd", [("besan_chilla", 2), ("curd", 0.5)]),
        ("Moong dal chillas with curd", [("moong_chilla", 2), ("curd", 0.5)]),
        ("Oats with milk & almonds", [("oats", 1), ("milk", 1), ("almonds", 1)]),
        ("Dalia with milk & fruit", [("dalia", 1), ("milk", 0.5), ("fruit", 0.5)]),
        ("Eggs on toast & fruit", [("egg", 2), ("bread", 2), ("fruit", 1)]),
        ("Omelette with toast", [("omelette", 1), ("bread", 2)]),
        ("Tofu bhurji on toast", [("tofu", 1), ("bread", 2), ("sauteed_veg", 0.5)]),
        ("Plain dosa with sambar", [("dosa", 2), ("sambar", 1)]),
        ("Paneer bhurji with roti", [("paneer_bhurji", 0.75), ("roti", 2)]),
    ],
    "Lunch": [
        ("Roti, dal & sabzi", [("roti", 2), ("dal", 1), ("mixed_veg", 1), ("salad", 1)]),
        ("Roti, dal & lauki", [("roti", 2), ("dal", 1), ("lauki", 1), ("salad", 1)]),
        ("Rajma chawal", [("rice", 1), ("rajma", 1), ("salad", 1)]),
        ("Chole with rice", [("rice", 1), ("chole", 1), ("salad", 1)]),
        ("Roti with palak paneer", [("roti", 2), ("palak_paneer", 1), ("salad", 1)]),
        ("Rice, sambar & cabbage", [("rice", 1), ("sambar", 1), ("cabbage", 1), ("curd", 0.5)]),
        ("Khichdi with curd", [("khichdi", 1.5), ("curd", 0.5), ("salad", 1)]),
        ("Millet roti, dal & sabzi", [("bajra_roti", 2), ("moong_dal", 1), ("palak", 1)]),
        ("Roti with chicken curry", [("roti", 2), ("chicken_curry", 1), ("salad", 1)]),
        ("Rice with fish curry", [("rice", 1), ("fish_curry", 1), ("salad", 1)]),
        ("Roti, soya curry & sabzi", [("roti", 2), ("soya", 1), ("cabbage", 1), ("salad", 1)]),
    ],
    "Snack": [
        ("Curd & fruit", [("curd", 1), ("fruit", 1)]),
        ("Roasted chana & chaas", [("chana_roasted", 1), ("buttermilk", 1)]),
        ("Makhana & chaas", [("makhana", 1), ("buttermilk", 1)]),
        ("Sprouts salad", [("sprouts", 1.5)]),
        ("Fruit & almonds", [("fruit", 1), ("almonds", 1)]),
        ("Boiled eggs", [("egg", 2)]),
        ("Peanut-butter toast", [("bread", 1), ("peanut_butter", 1)]),
        ("Dhokla", [("dhokla", 1)]),
        ("Hung curd with fruit", [("hung_curd", 1), ("fruit", 0.5)]),
        ("Banana & roasted peanuts", [("banana", 1), ("peanuts", 0.5)]),
    ],
    "Dinner": [
        ("Roti, moong dal & palak", [("roti", 2), ("moong_dal", 1), ("palak", 1)]),
        ("Roti with paneer & veggies", [("roti", 1), ("paneer", 1), ("sauteed_veg", 1)]),
        ("Grilled chicken, roti & salad", [("chicken", 1.5), ("roti", 1), ("salad", 1)]),
        ("Grilled fish with sabzi", [("grilled_fish", 1.5), ("roti", 1), ("bhindi", 1)]),
        ("Soya, roti & lauki", [("soya", 1), ("roti", 2), ("lauki", 1)]),
        ("Tofu, rice & vegetables", [("tofu", 1.5), ("rice", 0.5), ("sauteed_veg", 1)]),
        ("Egg bhurji with roti", [("egg_bhurji", 1), ("roti", 2), ("salad", 1)]),
        ("Dal, roti & bhindi", [("dal", 1), ("roti", 2), ("bhindi", 1)]),
        ("Soup, paneer & salad", [("veg_soup", 1), ("paneer", 0.75), ("salad", 1), ("roti", 1)]),
        ("Khichdi & raita", [("khichdi", 1.5), ("raita", 1)]),
    ],
}
SLOT_SHARE = {"Breakfast": 0.25, "Lunch": 0.32, "Snack": 0.13, "Dinner": 0.30}
FIXED_SIDES = {"salad", "buttermilk", "lauki", "cabbage", "palak", "bhindi", "mixed_veg", "sauteed_veg", "veg_soup", "raita", "sambar", "fruit", "almonds"}


def _is_protein(key: str) -> bool:
    _, _, _, kcal, p, *_ = F[key]
    return kcal > 0 and p * 4 / kcal >= 0.25
PROTEIN_BOOSTERS = ["egg_whites", "whey", "chicken", "soya", "hung_curd", "tofu", "sprouts", "paneer", "curd"]  # leanest first
CARB_ITEMS = {"rice", "brown_rice", "roti", "bajra_roti", "bread", "poha", "upma", "oats", "dalia", "khichdi", "dosa", "idli"}


def _macros(key: str, servings: float) -> Tuple[float, float, float, float]:
    _, _, _, kcal, p, c, f, *_ = F[key]
    return kcal * servings, p * servings, c * servings, f * servings


def _max_servings(key: str) -> float:
    if "count" in _tags(key):
        return 6 if key in ("idli", "egg") else 4
    return 2.5


def _round_servings(key: str, s: float) -> float:
    if "count" in _tags(key):
        return max(1, min(_max_servings(key), round(s)))
    return max(0.5, min(_max_servings(key), round(s * 2) / 2))


def fmt_qty(key: str, s: float) -> str:
    """Readable portion, e.g. 'Roti / chapati — 2 rotis', 'Paneer — 75 g', 'Dal — 1½ katori (225 g)'."""
    name, unit, grams = F[key][0], F[key][1], F[key][2]
    frac = {0.25: "¼", 0.5: "½", 0.75: "¾", 1.5: "1½", 2.5: "2½"}.get(s, f"{s:g}")
    if "count" in _tags(key):
        n = int(round(s))
        word = unit.split(" (")[0]
        return f"{name} — {n} {word}{'s' if n != 1 and not word.endswith('s') else ''}"
    if re.fullmatch(r"\d+ (g|ml)", unit):
        return f"{name} — {round(grams * s)} {unit.split()[1]}"
    m = re.fullmatch(r"(.*?)\s*\((\d+) (g|ml)(.*)\)", unit)
    if m:
        base, num, u, extra = m.group(1), int(m.group(2)), m.group(3), m.group(4)
        if base[:1].isdigit():
            return f"{name} — {round(num * s)} {u}{extra}"
        if s > 1 and not base.endswith("s"):
            base += "es" if base.endswith(("sh", "ch", "x")) else "s"
        return f"{name} — {frac} {base} ({round(num * s)} {u}{extra})"
    if s > 1 and re.fullmatch(r"[a-z]+", unit):
        unit += "es" if unit.endswith(("s", "sh", "ch", "x")) else "s"
    return f"{name} — {frac} {unit}"


def _diet_note(diet: str) -> str:
    return {"jain": "Jain-style: no onion, garlic or root vegetables in any dish.",
            "vegan": "Vegan: use plant milk/curd where dairy would normally go."}.get(diet, "")


def build_meal_plan(client: dict, weight: Optional[float], notes: str = "", seed: int = 0) -> dict:
    intake = client.get("intake") or {}
    focus = client.get("focus") or "fat_loss"
    diet = intake.get("diet") or "veg"
    n = parse_notes(notes)
    t = targets(intake, weight, focus, n.get("kcal_delta", 0), n.get("protein_boost", 0))
    allergens = parse_allergens(intake.get("allergies"))
    dislikes = parse_dislikes(intake.get("dislikes")) + n.get("dislikes", [])
    rng = random.Random(seed)
    ok = lambda k: food_allowed(k, diet, allergens, dislikes)  # noqa: E731

    meals, used_mains = [], set()
    for slot, share in SLOT_SHARE.items():
        options = [(name, items) for name, items in MEAL_TEMPLATES[slot] if all(ok(k) for k, _ in items)]
        if not options:
            continue
        fresh = [o for o in options if not ({k for k, _ in o[1]} - FIXED_SIDES - CARB_ITEMS) & used_mains]  # vary the main dish
        name, items = rng.choice(fresh or options)
        used_mains.update({k for k, _ in items} - FIXED_SIDES - CARB_ITEMS)
        goal_kcal, goal_prot = t["calories"] * share, t["protein_g"] * share
        # vegetables and drinks stay a normal portion; protein foods scale to the protein target;
        # staples (roti, rice, poha…) fill the remaining calories
        fixed = [(k, s) for k, s in items if k in FIXED_SIDES]
        prot = [(k, s) for k, s in items if k not in FIXED_SIDES and _is_protein(k)]
        rest = [(k, s) for k, s in items if k not in FIXED_SIDES and not _is_protein(k)]
        p_now = sum(_macros(k, s)[1] for k, s in prot)
        pf = max(0.5, min(2.0, (goal_prot - sum(_macros(k, s)[1] for k, s in fixed + rest)) / p_now)) if p_now else 1
        prot = [(k, _round_servings(k, s * pf)) for k, s in prot]
        left = goal_kcal - sum(_macros(k, s)[0] for k, s in fixed + prot)
        r_now = sum(_macros(k, s)[0] for k, s in rest)
        rf = max(0.5, min(2.5, left / r_now)) if r_now else 1
        rest = [(k, _round_servings(k, s * rf)) for k, s in rest]
        if not rest and not prot:
            fixed = [(k, _round_servings(k, s * max(0.5, min(2, goal_kcal / max(1, sum(_macros(k2, s2)[0] for k2, s2 in items)))))) for k, s in fixed]
        order = {k: i for i, (k, _) in enumerate(items)}
        meals.append({"meal": slot, "name": name, "parts": sorted(fixed + prot + rest, key=lambda ks: order[ks[0]])})

    def totals():
        tot = [0.0, 0.0, 0.0, 0.0]
        for m in meals:
            for k, s in m["parts"]:
                for i, v in enumerate(_macros(k, s)):
                    tot[i] += v
        return tot

    # top up protein with diet-appropriate foods, trimming starch to stay near the calorie target
    boosters = [k for k in PROTEIN_BOOSTERS if ok(k)]
    for step in range(4):
        prot = totals()[1]
        if prot >= t["protein_g"] * 0.9 or not boosters:
            break
        add = boosters[step % len(boosters)]
        target_meal = min((m for m in meals if m["meal"] in ("Snack", "Breakfast", "Dinner")), key=lambda m: sum(_macros(k, s)[1] for k, s in m["parts"]), default=None)
        if not target_meal:
            break
        existing = dict(target_meal["parts"])
        target_meal["parts"] = [(k, s) for k, s in target_meal["parts"] if k != add] + [(add, _round_servings(add, existing.get(add, 0) + 1))]
        short = F[add][0].split(" (")[0].split(" /")[0].lower()
        target_meal["name"] += "" if short in target_meal["name"].lower() else f" + {short}"
    for _ in range(6):
        kcal = totals()[0]
        if kcal <= t["calories"] * 1.07:
            break
        carbs = [(m, i) for m in meals for i, (k, s) in enumerate(m["parts"]) if k in CARB_ITEMS and s > (1 if "count" in _tags(k) else 0.5)]
        if not carbs:
            break
        m, i = max(carbs, key=lambda mi: _macros(*mi[0]["parts"][mi[1]])[0])
        k, s = m["parts"][i]
        m["parts"][i] = (k, s - (1 if "count" in _tags(k) else 0.5))
    for _ in range(8):  # still over: trim the fattiest protein/side portions while protein stays on target
        kcal, prot = totals()[0], totals()[1]
        if kcal <= t["calories"] * 1.07:
            break
        trims = [(m, i) for m in meals for i, (k, s) in enumerate(m["parts"])
                 if k not in CARB_ITEMS and k not in ("salad", "buttermilk") and s > (1 if "count" in _tags(k) else 0.5)]
        trims = [(m, i) for m, i in trims if prot - _macros(m["parts"][i][0], 0.5)[1] >= t["protein_g"] * 0.92]
        if not trims:
            break
        m, i = max(trims, key=lambda mi: F[mi[0]["parts"][mi[1]][0]][6])  # most fat per serving first
        k, s = m["parts"][i]
        m["parts"][i] = (k, s - (1 if "count" in _tags(k) else 0.5))
    for _ in range(6):
        kcal = totals()[0]
        if kcal >= t["calories"] * 0.93:
            break
        carbs = [(m, i) for m in meals for i, (k, s) in enumerate(m["parts"]) if k in CARB_ITEMS and s < _max_servings(k)]
        if not carbs:
            break
        m, i = min(carbs, key=lambda mi: mi[0]["parts"][mi[1]][1] / _max_servings(mi[0]["parts"][mi[1]][0]))  # top up the smallest portion
        k, s = m["parts"][i]
        m["parts"][i] = (k, min(_max_servings(k), s + (1 if "count" in _tags(k) else 0.5)))

    # very high targets: add a second snack; very low ones: drop the snack if that lands closer
    kcal = totals()[0]
    if kcal < t["calories"] * 0.92:
        taken = {m["name"] for m in meals}
        extra = [(nm, it) for nm, it in MEAL_TEMPLATES["Snack"] if all(ok(k) for k, _ in it) and nm not in taken]
        if extra:
            nm, it = rng.choice(extra)
            base = sum(_macros(k, s2)[0] for k, s2 in it) or 1
            f = max(0.5, min(2.5, (t["calories"] - kcal) / base))
            meals.append({"meal": "Evening snack", "name": nm, "parts": [(k, _round_servings(k, s2 * (1 if k in FIXED_SIDES else f))) for k, s2 in it]})
    elif kcal > t["calories"] * 1.1:
        snack = next((m for m in meals if m["meal"] == "Snack"), None)
        if snack:
            snack_kcal = sum(_macros(k, s2)[0] for k, s2 in snack["parts"])
            if abs(kcal - snack_kcal - t["calories"]) < abs(kcal - t["calories"]):
                meals.remove(snack)

    out_meals = []
    for m in meals:
        kc = pr = cb = ft = 0.0
        items = []
        for k, s in m["parts"]:
            a, b, c, d = _macros(k, s)
            kc, pr, cb, ft = kc + a, pr + b, cb + c, ft + d
            label = fmt_qty(k, s)
            if diet == "jain" and "jain_adapt" in _tags(k):
                label += " (Jain style)"
            items.append(label)
        out_meals.append({"meal": m["meal"], "name": m["name"], "items": items, "calories": round(kc),
                          "protein_g": round(pr), "carbs_g": round(cb), "fat_g": round(ft)})
    total_kcal = sum(m["calories"] for m in out_meals)
    gap = t["calories"] - total_kcal
    gap_txt = (f" These portions come to ≈ {total_kcal} kcal — add about {round(gap, -1):g} kcal (e.g. a glass of milk, a banana or an extra roti)"
               " to reach the target." if gap > t["calories"] * 0.08 else "")
    goal_txt = {"fat_loss": "fat loss (about 20% below maintenance)", "muscle_gain": "lean muscle gain (about 10% above maintenance)"}.get(focus, "maintenance")
    summary = (f"Target ≈ {t['calories']} kcal and {t['protein_g']} g protein a day for {goal_txt}, estimated from "
               f"{t['weight']:g} kg, {t['height']:g} cm, age {t['age']:g} and {intake.get('days_per_week') or 3} training days a week."
               + (f" Adjusted {n['kcal_delta']:+d} kcal per your note." if n.get("kcal_delta") else "")
               + (" " + _diet_note(diet) if _diet_note(diet) else "")
               + (f" Avoids: {', '.join(sorted(allergens))}." if allergens else "") + gap_txt)
    return {"title": f"{t['calories']} kcal · {t['protein_g']} g protein day", "summary": summary, "meals": out_meals,
            "targets": {k: t[k] for k in ("calories", "protein_g", "carbs_g", "fat_g")}}


# ───────────────────────────── Training plans ─────────────────────────────
# (name, pattern, equipment allowed, minimum level, injuries to avoid, cue)
G, H, B = "gym", "home", "bodyweight"
EXERCISES = [
    ("Back Squat", "squat", {G}, 1, {"knee", "back"}, "Brace, sit between the hips, knees track over toes"),
    ("Goblet Squat", "squat", {G, H}, 0, {"knee"}, "Elbows inside knees, chest tall"),
    ("Leg Press", "squat", {G}, 0, set(), "Lower until hips start to tuck, then press"),
    ("Box Squat to Bench", "squat", {G, H, B}, 0, set(), "Sit back to the box, stand tall — knee-friendly depth"),
    ("Bodyweight Squat", "squat", {B, H}, 0, {"knee"}, "Slow down, quick up"),
    ("Romanian Deadlift", "hinge", {G, H}, 0, {"back"}, "Soft knees, push hips back, flat back"),
    ("Hip Thrust", "hinge", {G, H, B}, 0, set(), "Chin tucked, ribs down, squeeze glutes at the top"),
    ("Glute Bridge", "hinge", {G, H, B}, 0, set(), "Drive through heels, pause 1 s at the top"),
    ("Trap-bar Deadlift", "hinge", {G}, 1, {"back"}, "Push the floor away, stand tall"),
    ("Reverse Lunge", "lunge", {G, H, B}, 0, {"knee"}, "Step back, front shin vertical"),
    ("Walking Lunge", "lunge", {G, H, B}, 1, {"knee", "ankle"}, "Long steps, torso upright"),
    ("Step-up (low box)", "lunge", {G, H, B}, 0, set(), "Whole foot on the box, drive through the heel"),
    ("Bulgarian Split Squat", "lunge", {G, H}, 1, {"knee"}, "Rear foot on bench, drop straight down"),
    ("Bench Press", "push_h", {G}, 1, {"shoulder"}, "Shoulder blades pinned, bar to lower chest"),
    ("Dumbbell Bench Press", "push_h", {G, H}, 0, {"shoulder"}, "Elbows ~45°, control the lowering"),
    ("Dumbbell Floor Press", "push_h", {G, H}, 0, set(), "Pause elbows on the floor — shoulder-friendly"),
    ("Push-up", "push_h", {G, H, B}, 0, {"wrist", "shoulder"}, "Straight line head to heels"),
    ("Incline Push-up", "push_h", {G, H, B}, 0, {"wrist"}, "Hands on a bench or wall, body straight"),
    ("Overhead Press", "push_v", {G}, 1, {"shoulder", "back"}, "Squeeze glutes, press the bar past your face"),
    ("Dumbbell Shoulder Press", "push_v", {G, H}, 0, {"shoulder"}, "Seated, wrists over elbows"),
    ("Landmine / Half-kneeling Press", "push_v", {G}, 0, set(), "Press up and slightly forward — easier on shoulders"),
    ("Pike Push-up", "push_v", {B}, 1, {"shoulder", "wrist", "bp"}, "Hips high, head to the floor between hands"),
    ("Seated Cable Row", "pull_h", {G}, 0, set(), "Chest up, pull elbows to the hips"),
    ("One-arm Dumbbell Row", "pull_h", {G, H}, 0, set(), "Hand on bench, row to the hip"),
    ("Backpack Row", "pull_h", {B}, 0, {"back"}, "Hinge forward, row a loaded backpack to the belly"),
    ("Chest-supported Row", "pull_h", {G}, 0, set(), "Chest on incline bench — back-friendly"),
    ("Lat Pulldown", "pull_v", {G}, 0, set(), "Pull to the upper chest, elbows down"),
    ("Assisted Pull-up", "pull_v", {G}, 1, {"shoulder"}, "Full hang to chin over bar"),
    ("Band / Towel Pulldown", "pull_v", {H, B}, 0, set(), "Pull elbows down into the back pockets"),
    ("Plank", "core", {G, H, B}, 0, {"wrist", "shoulder", "pregnancy"}, "Ribs down, squeeze glutes"),
    ("Dead Bug", "core", {G, H, B}, 0, {"pregnancy"}, "Lower back stays on the floor"),
    ("Bird Dog", "core", {G, H, B}, 0, set(), "Reach long, hips level"),
    ("Side Plank (knees)", "core", {G, H, B}, 0, {"shoulder"}, "Hips high, body in one line"),
    ("Pallof Press", "core", {G}, 0, set(), "Resist the twist, press straight out"),
    ("Dumbbell Curl", "biceps", {G, H}, 0, set(), "Elbows still, full range"),
    ("Cable Triceps Pushdown", "triceps", {G}, 0, set(), "Elbows pinned to the sides"),
    ("Overhead Dumbbell Triceps Extension", "triceps", {H}, 0, {"shoulder"}, "Elbows point forward"),
    ("Close-grip Push-up", "triceps", {B}, 0, {"wrist", "shoulder"}, "Elbows brush the ribs"),
    ("Standing Calf Raise", "calves", {G, H, B}, 0, set(), "Pause at the top and bottom"),
    ("Brisk Walk / Cycle", "cardio", {G, H, B}, 0, set(), "Conversational pace — you can talk but not sing"),
    ("Low-impact Intervals (step jacks, marching)", "cardio", {G, H, B}, 0, set(), "30 s brisk, 30 s easy"),
    ("Mountain Climbers", "cardio", {G, H, B}, 1, {"wrist", "shoulder", "pregnancy"}, "Hips level, quick feet"),
    ("Rowing Machine Intervals", "cardio", {G}, 1, {"back"}, "Legs, then hips, then arms"),
]
LEVEL = {"beginner": 0, "intermediate": 1, "advanced": 2}

SPLITS = {
    "full": [("Full body A", ["squat", "push_h", "pull_h", "hinge", "core", "cardio"]),
             ("Full body B", ["hinge", "push_v", "pull_v", "lunge", "core", "cardio"]),
             ("Full body C", ["lunge", "push_h", "pull_h", "squat", "core", "cardio"])],
    "upper": ("Upper body", ["push_h", "pull_h", "push_v", "pull_v", "core"]),
    "lower": ("Lower body", ["squat", "hinge", "lunge", "calves", "core"]),
    "push": ("Push", ["push_h", "push_v", "push_h", "triceps", "core"]),
    "pull": ("Pull", ["pull_v", "pull_h", "hinge", "biceps", "core"]),
    "legs": ("Legs", ["squat", "hinge", "lunge", "calves"]),
    "cond": ("Conditioning & core", ["cardio", "lunge", "core", "core", "cardio"]),
}


def _split(days: int, focus: str) -> List[Tuple[str, List[str]]]:
    full = SPLITS["full"]
    if days <= 3 and (focus != "muscle_gain" or days < 3):
        return full[:days]
    if focus == "muscle_gain":
        plan = {3: ["push", "pull", "legs"], 4: ["upper", "lower", "upper", "lower"], 5: ["upper", "lower", "push", "pull", "legs"],
                6: ["push", "pull", "legs", "push", "pull", "legs"]}[days]
    else:
        plan = {4: ["upper", "lower", "upper", "lower"], 5: ["upper", "lower", "cond", "upper", "lower"],
                6: ["upper", "lower", "cond", "upper", "lower", "cond"]}[days]
    return [SPLITS[k] for k in plan]


def build_workout_plan(client: dict, notes: str = "", seed: int = 0, active: Optional[dict] = None) -> dict:
    intake = client.get("intake") or {}
    focus = client.get("focus") or "fat_loss"
    n = parse_notes(notes)
    days = max(2, min(6, n.get("days") or int(_num(intake.get("days_per_week"), 3))))
    equipment = n.get("equipment") or intake.get("equipment") or "gym"
    level = LEVEL.get(n.get("level") or intake.get("experience") or "beginner", 0)
    injuries = parse_injuries(intake.get("injuries"), notes)
    volume = n.get("volume", 0)
    if active and not notes.strip():
        volume = 1  # an adjustment with no instructions = progress the programme
    rng = random.Random(seed)

    def pick(pattern: str, used: set, rotation: int):
        pool = [e for e in EXERCISES if e[1] == pattern and equipment in e[2] and e[3] <= level and not (e[4] & injuries) and e[0] not in used]
        if not pool and pattern == "pull_v":
            return pick("pull_h", used, rotation)
        if not pool:
            return None
        pool.sort(key=lambda e: (-e[3], e[0]))  # harder variations first for experienced lifters
        return pool[(rotation + rng.randrange(2)) % len(pool)] if len(pool) > 1 else pool[0]

    out_days, seen = [], {}
    for i, (label, patterns) in enumerate(_split(days, focus)):
        rotation = seen.get(label, 0)
        seen[label] = rotation + 1
        used, exercises = set(), []
        for j, pattern in enumerate(patterns):
            e = pick(pattern, used, rotation + j)
            if not e:
                continue
            used.add(e[0])
            main = j < 2 and pattern not in ("core", "cardio")
            if pattern == "cardio":
                if focus == "muscle_gain" and label != "Conditioning & core":
                    continue
                sets, reps, rest = (1, "20–30 min", "—") if "Walk" in e[0] else (1 if level == 0 else 2, "8 rounds 30 s on / 30 s off", "2 min")
            elif pattern == "core":
                sets, reps, rest = 3, "30–45 s" if "Plank" in e[0] else "8–10 each side", "45 s"
            elif focus == "muscle_gain":
                sets, reps, rest = (4, "6–8", "2 min") if main and level else (3, "8–10", "2 min") if main else (3, "10–12", "75 s")
            else:
                sets, reps, rest = (3, "8–12", "90 s") if main else (3, "12–15", "60 s")
            if level == 0 and pattern not in ("cardio",):
                sets = max(2, sets - 1)
            if volume and main:
                sets = max(2, min(5, sets + volume))
            exercises.append({"name": e[0], "sets": sets, "reps": reps, "rest": rest, "notes": e[5]})
        out_days.append({"name": f"Day {i + 1}", "focus": label, "exercises": exercises})

    eq_txt = {"gym": "a full gym", "home": "dumbbells at home", "bodyweight": "no equipment"}[equipment] if equipment in ("gym", "home", "bodyweight") else equipment
    goal = {"fat_loss": "fat loss", "muscle_gain": "muscle gain"}.get(focus, "general fitness")
    summary = (f"{days} days a week for {goal}, using {eq_txt}. Warm up 5–10 min before each session; leave 1–2 reps in reserve"
               f"{' and add weight or reps when every set feels easy' if volume >= 0 else ' — this is a lighter week to recover'}."
               + (f" Exercises chosen to avoid strain on: {', '.join(sorted(injuries))}." if injuries else ""))
    if volume > 0 and active:
        summary += " Progression from the previous plan: one more set on the main lifts."
    return {"title": f"{days}-day {goal} programme", "summary": summary, "days": out_days}


# ───────────────────────────── Yoga practice ─────────────────────────────
# (name, category, level, avoid, hold, cue)
POSES = [
    ("Cat–Cow (Marjaryasana–Bitilasana)", "warmup", 0, {"wrist"}, "8 breaths", "Move with the breath"),
    ("Seated neck & shoulder release", "warmup", 0, set(), "1 min", "Slow circles, no forcing"),
    ("Sun Salutation A (Surya Namaskar A)", "warmup", 0, {"wrist", "bp", "back", "pregnancy"}, "{rounds} rounds", "One breath per movement"),
    ("Mountain (Tadasana)", "standing", 0, set(), "5 breaths", "Weight even across both feet"),
    ("Warrior II (Virabhadrasana II)", "standing", 0, set(), "{hold} each side", "Front knee over ankle"),
    ("Warrior I (Virabhadrasana I)", "standing", 0, {"knee"}, "{hold} each side", "Square hips forward"),
    ("Triangle (Trikonasana)", "standing", 0, {"neck"}, "{hold} each side", "Lengthen both sides of the waist"),
    ("Extended Side Angle (Utthita Parsvakonasana)", "standing", 1, {"knee"}, "{hold} each side", "Long line from heel to fingertips"),
    ("Chair (Utkatasana)", "standing", 0, {"knee"}, "{hold}", "Weight in the heels"),
    ("Goddess (Utkata Konasana)", "standing", 0, {"knee"}, "{hold}", "Knees track over toes"),
    ("Tree (Vrikshasana)", "balance", 0, set(), "{hold} each side", "Press foot and leg together"),
    ("Warrior III (Virabhadrasana III)", "balance", 1, {"back", "bp"}, "{hold} each side", "Hips level"),
    ("Eagle (Garudasana)", "balance", 1, {"knee", "shoulder"}, "{hold} each side", "Sink low, squeeze midline"),
    ("Sphinx (Salamba Bhujangasana)", "backbend", 0, {"pregnancy"}, "{hold}", "Forearms down, gentle lift"),
    ("Cobra (Bhujangasana)", "backbend", 0, {"back", "pregnancy"}, "{hold}", "Shoulders away from ears"),
    ("Bridge (Setu Bandhasana)", "backbend", 0, {"neck"}, "{hold}", "Knees hip-width"),
    ("Camel (Ustrasana)", "backbend", 1, {"back", "neck", "knee", "bp"}, "{hold}", "Hips over knees"),
    ("Seated Forward Bend (Paschimottanasana)", "seated", 0, {"back", "pregnancy"}, "{hold}", "Lead with the chest"),
    ("Bound Angle (Baddha Konasana)", "seated", 0, {"knee", "hip"}, "{hold}", "Sit tall, knees relax down"),
    ("Staff (Dandasana)", "seated", 0, set(), "5 breaths", "Press thighs down, spine tall"),
    ("Supine Twist (Supta Matsyendrasana)", "twist", 0, {"pregnancy"}, "{hold} each side", "Both shoulders stay heavy"),
    ("Half Lord of the Fishes (Ardha Matsyendrasana)", "twist", 1, {"back", "pregnancy"}, "{hold} each side", "Lengthen, then twist"),
    ("Downward Dog (Adho Mukha Svanasana)", "inversion", 0, {"wrist", "bp", "shoulder"}, "5 breaths", "Hips high, heels reach down"),
    ("Legs up the Wall (Viparita Karani)", "inversion", 0, {"pregnancy"}, "3 min", "Let the legs feel heavy"),
    ("Boat (Navasana)", "core", 1, {"back", "pregnancy"}, "{hold}", "Lift the chest, long spine"),
    ("Forearm Plank", "core", 0, {"shoulder", "pregnancy"}, "{hold}", "Ribs down"),
    ("Child's Pose (Balasana)", "rest", 0, {"knee"}, "1 min", "Relax the jaw"),
    ("Corpse (Savasana)", "rest", 0, set(), "5 min", "Let the body be still"),
    ("Alternate nostril breathing (Anulom Vilom)", "breath", 0, set(), "5 min", "Slow, even breaths"),
    ("Humming bee breath (Bhramari)", "breath", 0, set(), "7 rounds", "Gentle hum on the exhale"),
]
YOGA_DAYS = [
    ("Strength & stability", ["warmup", "warmup", "standing", "standing", "standing", "balance", "core", "twist", "rest", "breath"]),
    ("Flexibility & spine", ["warmup", "warmup", "standing", "inversion", "backbend", "seated", "seated", "twist", "rest", "breath"]),
    ("Balance & core", ["warmup", "standing", "balance", "balance", "core", "backbend", "seated", "rest", "breath"]),
    ("Recovery & breath", ["warmup", "standing", "backbend", "twist", "inversion", "rest", "breath", "breath"]),
]


def build_yoga_plan(client: dict, notes: str = "", seed: int = 0, active: Optional[dict] = None) -> dict:
    intake = client.get("intake") or {}
    n = parse_notes(notes)
    days = max(2, min(6, n.get("days") or int(_num(intake.get("days_per_week"), 3))))
    level = LEVEL.get(n.get("level") or intake.get("experience") or "beginner", 0)
    if active and not notes.strip():
        level = min(2, level + 1) if level < 1 else level
    injuries = parse_injuries(intake.get("injuries"), notes)
    hold = ["20–30 s", "30–45 s", "45–60 s"][level]
    rounds = [3, 5, 8][level]
    rng = random.Random(seed)
    out_days = []
    for i in range(days):
        focus, cats = YOGA_DAYS[i % len(YOGA_DAYS)]
        used, poses = set(), []
        for j, cat in enumerate(cats):
            pool = [p for p in POSES if p[1] == cat and p[2] <= level and not (p[3] & injuries) and p[0] not in used]
            if not pool:
                continue
            p = pool[(i + j + rng.randrange(len(pool))) % len(pool)]
            used.add(p[0])
            reps = p[4].format(hold=hold, rounds=rounds)
            poses.append({"name": p[0], "sets": 2 if "each side" not in reps and cat in ("standing", "balance", "core", "backbend") and level else 1,
                          "reps": reps, "rest": "—" if cat in ("rest", "breath", "warmup") else "3 breaths", "notes": p[5]})
        out_days.append({"name": f"Day {i + 1}", "focus": focus, "exercises": poses})
    summary = (f"{days} sessions a week, about {[25, 35, 45][level]} minutes each, at {['beginner', 'intermediate', 'advanced'][level]} level. "
               "Move slowly, never into pain; use a wall or blocks for balance and reach.")
    if injuries:
        summary += f" Poses that load these areas are left out: {', '.join(sorted(injuries))}."
    if "pregnancy" in injuries:
        summary += " Pregnancy/postpartum: practise only with your doctor's clearance."
    return {"title": f"{days}-day yoga practice", "summary": summary, "days": out_days}


def build_plan(ptype: str, client: dict, weight: Optional[float], notes: str = "", seed: int = 0, active: Optional[dict] = None) -> dict:
    if ptype == "meal":
        return build_meal_plan(client, weight, notes, seed)
    if ptype == "yoga":
        return build_yoga_plan(client, notes, seed, active)
    return build_workout_plan(client, notes, seed, active)


# ───────────────────────────── Food logging ─────────────────────────────
WORD_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "half": 0.5, "quarter": 0.25,
            "double": 2, "couple": 2, "few": 3, "ek": 1, "do": 2, "teen": 3, "aadha": 0.5}
UNIT_WORDS = {"g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g", "ml": "ml", "kg": "kg", "l": "l", "litre": "l", "liter": "l",
              "bowl": "serving", "bowls": "serving", "katori": "serving", "katoris": "serving", "cup": "serving", "cups": "serving",
              "plate": "serving", "plates": "serving", "glass": "serving", "glasses": "serving", "serving": "serving", "servings": "serving",
              "piece": "serving", "pieces": "serving", "pc": "serving", "pcs": "serving", "slice": "serving", "slices": "serving",
              "scoop": "serving", "scoops": "serving", "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp", "tsp": "serving",
              "teaspoon": "serving", "teaspoons": "serving", "spoon": "serving", "spoons": "serving",
              "handful": "serving", "small": "small", "medium": "serving", "large": "large", "big": "large", "of": None}


def _alias_table() -> List[Tuple[str, str]]:
    table = [(row[0].lower(), key) for key, row in F.items()]
    table += [(alias, key) for key, row in F.items() for alias in row[8].split("|")]
    table.sort(key=lambda a: -len(a[0]))  # longest phrase wins: "masala dosa" before "dosa"
    return table


ALIASES = _alias_table()
ALIAS_KEYS = {a: k for a, k in ALIASES}


def _qty(tokens: List[str]) -> Tuple[Optional[float], Optional[str], List[str]]:
    """Quantity (None if not given), unit and the leftover words."""
    qty, unit, rest = None, None, []
    for t in tokens:
        if qty is None and re.fullmatch(r"\d+(\.\d+)?", t):
            qty = float(t)
        elif qty is None and re.fullmatch(r"\d+/\d+", t):
            qty = float(Fraction(t))
        elif qty is None and t in ("½", "¼", "¾"):
            qty = {"½": 0.5, "¼": 0.25, "¾": 0.75}[t]
        elif qty is None and t in WORD_NUM:
            qty = WORD_NUM[t]
        elif m := re.fullmatch(r"(\d+(?:\.\d+)?)(g|gm|gms|grams|ml|kg)", t):
            qty, unit = float(m.group(1)), UNIT_WORDS[m.group(2)]
        elif t in UNIT_WORDS and unit is None:
            unit = UNIT_WORDS[t]
        else:
            rest.append(t)
    return qty, unit, rest


def _match(text: str) -> Optional[str]:
    padded = f" {text} "
    for alias, key in ALIASES:
        if f" {alias} " in padded:
            return key
    close = difflib.get_close_matches(text, list(ALIAS_KEYS), n=1, cutoff=0.78)
    if close:
        return ALIAS_KEYS[close[0]]
    for word in text.split():  # last try: any single word close to a known food
        close = difflib.get_close_matches(word, [a for a in ALIAS_KEYS if " " not in a], n=1, cutoff=0.85)
        if close:
            return ALIAS_KEYS[close[0]]
    return None


def analyze_meal(description: str) -> dict:
    """Estimate a meal's calories and macros from plain text. Returns the same shape as the AI analysis."""
    text = description.lower().replace("½", " ½ ").replace("¼", " ¼ ").replace("¾", " ¾ ")
    parts = [p.strip() for p in re.split(r",|;|\n|\+|&|\band\b|\bwith\b|\baur\b", text) if p.strip()]
    found, unknown = [], []
    for part in parts:
        words = re.findall(r"[a-z]+|\d+(?:\.\d+)?(?:g|gm|gms|grams|ml|kg)?|\d+/\d+|[½¼¾]", part)
        # find every known food in the phrase, longest names first ("3 idli sambar" → idli and sambar)
        taken, hits = [False] * len(words), []
        for alias, key in ALIASES:
            a = alias.split()
            for i in range(len(words) - len(a) + 1):
                if words[i:i + len(a)] == a and not any(taken[i:i + len(a)]):
                    hits.append((i, i + len(a), key))
                    taken[i:i + len(a)] = [True] * len(a)
        if not hits:
            qty, unit, rest = _qty(words)
            key = _match(" ".join(rest)) if rest else None
            if key:
                hits_q = [(key, qty, unit)]
            else:
                if rest:
                    unknown.append(part)
                continue
        else:
            hits.sort()
            hits_q = []
            for n, (start, end, key) in enumerate(hits):
                prev_end = hits[n - 1][1] if n else 0
                next_start = hits[n + 1][0] if n + 1 < len(hits) else len(words)
                qty, unit, _ = _qty(words[prev_end:start])
                if qty is None and unit is None:
                    qty, unit, _ = _qty(words[end:next_start])  # "pizza 2 slices"
                hits_q.append((key, qty, unit))
        dish = next((k for k, _, _ in hits_q if k in ("omelette", "egg_bhurji")), None)
        if dish and any(k == "egg" for k, _, _ in hits_q):  # "2 ande ka omelette" = one dish made of 2 eggs
            eggs = next(q for k, q, _ in hits_q if k == "egg") or 2
            hits_q = [(k, eggs / 2 if k == dish else q, u) for k, q, u in hits_q if k != "egg"]
        for key, qty, unit in hits_q:
            qty = 1.0 if qty is None else qty
            grams = F[key][2]
            if unit in ("g", "ml"):
                servings = qty / grams
            elif unit in ("kg", "l"):
                servings = qty * 1000 / grams
            else:
                servings = qty * (0.75 if unit == "small" else 1.3 if unit == "large" else 3 if unit == "tbsp" and F[key][1] == "tsp" else 1)
            found.append((key, max(0.1, min(servings, 20))))
    if not found:
        return {}
    tot = [0.0, 0.0, 0.0, 0.0]
    items = []
    for key, s in found:
        vals = _macros(key, s)
        tot = [a + b for a, b in zip(tot, vals)]
        q = f"{s:g}" if s >= 1 else f"{s:.2g}"
        items.append(f"{F[key][0]} × {q} ({F[key][1]}) — {round(vals[0])} kcal")
    kcal, prot, carbs, fat = tot
    score = 60
    score += min(20, prot / max(kcal, 1) * 1000 * 0.25)          # protein density
    score -= max(0, (fat * 9 / max(kcal, 1)) - 0.35) * 100        # very fatty
    score -= 15 * sum(1 for k, _ in found if "junk" in _tags(k))
    score += 8 if any(k in ("salad", "mixed_veg", "lauki", "cabbage", "palak", "bhindi", "sauteed_veg", "veg_soup", "sprouts", "fruit") for k, _ in found) else 0
    names = [F[k][0].split(" (")[0].split(" /")[0] for k, _ in found]
    meal_name = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " & " + names[-1]
    notes = "Estimated from typical home-style portions."
    if unknown:
        notes += f" Couldn't recognise: {', '.join(unknown)} — not counted. Try simpler names or add grams."
    return {"meal_name": meal_name[:80], "items": items, "calories": round(kcal), "protein_g": round(prot), "carbs_g": round(carbs),
            "fat_g": round(fat), "health_score": int(max(10, min(95, score))), "notes": notes, "estimated_by": "food-table",
            "unrecognised": unknown}
