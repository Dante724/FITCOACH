"""
Clients in India and abroad (NRIs): where they live, which currency they pay in, their time zone, units, and health
screening tuned for South Asians. Pure functions — no database — so they're easy to test.
"""
from datetime import date as _date, datetime, timedelta
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Currencies we can price and charge in (Razorpay takes all of these once international payments are enabled).
# All use 2 decimal places, so the charge amount is major × 100.
CURRENCIES: Dict[str, dict] = {
    "INR": {"symbol": "₹", "name": "Indian rupee"},
    "USD": {"symbol": "$", "name": "US dollar"},
    "GBP": {"symbol": "£", "name": "British pound"},
    "EUR": {"symbol": "€", "name": "Euro"},
    "AED": {"symbol": "AED ", "name": "UAE dirham"},
    "SAR": {"symbol": "SAR ", "name": "Saudi riyal"},
    "QAR": {"symbol": "QAR ", "name": "Qatari riyal"},
    "CAD": {"symbol": "C$", "name": "Canadian dollar"},
    "AUD": {"symbol": "A$", "name": "Australian dollar"},
    "NZD": {"symbol": "NZ$", "name": "New Zealand dollar"},
    "SGD": {"symbol": "S$", "name": "Singapore dollar"},
}

# Countries with the most Indians abroad, plus India. (code, name, currency, default units)
COUNTRIES: List[tuple] = [
    ("IN", "India", "INR", "metric"),
    ("US", "United States", "USD", "imperial"),
    ("GB", "United Kingdom", "GBP", "metric"),
    ("AE", "United Arab Emirates", "AED", "metric"),
    ("SA", "Saudi Arabia", "SAR", "metric"),
    ("QA", "Qatar", "QAR", "metric"),
    ("KW", "Kuwait", "USD", "metric"),
    ("OM", "Oman", "USD", "metric"),
    ("BH", "Bahrain", "USD", "metric"),
    ("CA", "Canada", "CAD", "metric"),
    ("AU", "Australia", "AUD", "metric"),
    ("NZ", "New Zealand", "NZD", "metric"),
    ("SG", "Singapore", "SGD", "metric"),
    ("MY", "Malaysia", "USD", "metric"),
    ("DE", "Germany", "EUR", "metric"),
    ("NL", "Netherlands", "EUR", "metric"),
    ("IE", "Ireland", "EUR", "metric"),
    ("FR", "France", "EUR", "metric"),
    ("IT", "Italy", "EUR", "metric"),
    ("ZA", "South Africa", "USD", "metric"),
    ("OTHER", "Another country", "USD", "metric"),
]
COUNTRY = {c[0]: {"code": c[0], "name": c[1], "currency": c[2], "units": c[3]} for c in COUNTRIES}
UNITS = {"metric", "imperial"}
HOME_TZ = "Asia/Kolkata"


def currency_for(country: Optional[str]) -> str:
    return COUNTRY.get((country or "IN").upper(), COUNTRY["OTHER"])["currency"]


def valid_tz(tz: Optional[str]) -> Optional[str]:
    if not tz or len(tz) > 64:
        return None
    try:
        ZoneInfo(tz)
        return tz
    except (ZoneInfoNotFoundError, ValueError):
        return None


def is_abroad(user: dict) -> bool:
    return (user.get("country") or "IN").upper() != "IN"


# ── prices ──
def price_in(inr: int, prices: Optional[dict], currency: str) -> dict:
    """The price to show and charge. A local price set by the admin wins; otherwise the rupee price is charged in INR."""
    currency = (currency or "INR").upper()
    local = (prices or {}).get(currency)
    if currency != "INR" and isinstance(local, (int, float)) and local > 0:
        return {"amount": float(local), "currency": currency}
    return {"amount": float(inr), "currency": "INR"}


def clean_prices(prices: Optional[dict]) -> dict:
    out = {}
    for k, v in (prices or {}).items():
        k = str(k).upper()
        if k in CURRENCIES and k != "INR":
            try:
                v = round(float(v), 2)
            except (TypeError, ValueError):
                continue
            if 0 < v <= 100000:
                out[k] = v
    return out


def money(amount: float, currency: str) -> str:
    sym = CURRENCIES.get(currency, {}).get("symbol", f"{currency} ")
    if currency == "INR":
        return f"{sym}{int(round(amount)):,}"
    return f"{sym}{amount:,.2f}".replace(".00", "")


# ── times ──
def describe_time(starts_at: datetime, tz: Optional[str]) -> str:
    """'Fri 10 Oct, 7:30 AM (New York time)' for someone abroad; '10 Oct at 18:00' at home."""
    tz = valid_tz(tz) or HOME_TZ
    local = starts_at.astimezone(ZoneInfo(tz))
    if tz == HOME_TZ:
        return f"{local.strftime('%d %b')} at {local.strftime('%H:%M')}"
    city = tz.split("/")[-1].replace("_", " ")
    return f"{local.strftime('%a %d %b')}, {local.strftime('%I:%M %p').lstrip('0')} ({city} time)"


def home_dates_for_local_day(local_day: str, tz: str) -> List[str]:
    """The business-time (IST) dates that overlap one calendar day in the client's time zone."""
    d = _date.fromisoformat(local_day)
    z = ZoneInfo(tz)
    start = datetime(d.year, d.month, d.day, tzinfo=z)
    end = start + timedelta(days=1) - timedelta(seconds=1)
    home = ZoneInfo(HOME_TZ)
    a, b = start.astimezone(home).date(), end.astimezone(home).date()
    out, cur = [], a
    while cur <= b:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


# ── units ──
KG_PER_LB = 0.45359237


def kg_to_lb(kg: float) -> float:
    return round(kg / KG_PER_LB, 1)


def lb_to_kg(lb: float) -> float:
    return round(lb * KG_PER_LB, 2)


# ── health screening for South Asians ──
# Indian/Asian thresholds (ICMR / WHO Asia-Pacific; ADA screening advice for Asian Americans). Not a diagnosis.
CONDITIONS = {"diabetes": "Diabetes", "prediabetes": "Prediabetes", "thyroid": "Thyroid", "bp": "High blood pressure",
              "cholesterol": "High cholesterol", "pcos": "PCOS / PCOD", "heart": "Heart condition"}


def _f(v) -> Optional[float]:
    try:
        v = float(v)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def health_flags(intake: dict, weight_kg: Optional[float], abroad: bool) -> List[dict]:
    """Things the coach (and client) should know, most important first. level: high | watch | tip."""
    it = intake or {}
    flags: List[dict] = []
    add = lambda level, text: flags.append({"level": level, "text": text})  # noqa: E731
    h, w = _f(it.get("height_cm")), _f(weight_kg) or _f(it.get("weight_kg"))
    sex = (it.get("sex") or "").lower()
    if h and w:
        bmi = w / ((h / 100) ** 2)
        if bmi >= 25:
            add("high", f"BMI {bmi:.1f} — in the obese range for Indians (25+). Higher risk of diabetes and heart disease.")
        elif bmi >= 23:
            add("watch", f"BMI {bmi:.1f} — overweight for Indians (23–24.9), even though it looks normal on Western charts.")
        elif bmi < 18.5:
            add("watch", f"BMI {bmi:.1f} — underweight.")
    waist = _f(it.get("waist_cm"))
    if waist:
        limit = 90 if sex.startswith("m") else 80
        if waist >= limit:
            add("high", f"Waist {waist:.0f} cm — above the Indian limit ({limit} cm). Belly fat drives diabetes risk most.")
    a1c = _f(it.get("hba1c"))
    if a1c:
        if a1c >= 6.5:
            add("high", f"HbA1c {a1c}% — in the diabetes range (6.5%+). Diet and training changes should follow the doctor's advice.")
        elif a1c >= 5.7:
            add("watch", f"HbA1c {a1c}% — prediabetes range (5.7–6.4%). Very reversible with diet and training.")
    vd = _f(it.get("vitamin_d"))
    if vd:
        if vd < 20:
            add("high", f"Vitamin D {vd:g} ng/mL — deficient (under 20). Worth asking the doctor about supplements; it affects energy and bones.")
        elif vd < 30:
            add("watch", f"Vitamin D {vd:g} ng/mL — insufficient (20–29).")
    b12 = _f(it.get("b12"))
    if b12:
        if b12 < 200:
            add("high", f"Vitamin B12 {b12:g} pg/mL — deficient (under 200). Common in vegetarians; worth asking the doctor.")
        elif b12 < 300:
            add("watch", f"Vitamin B12 {b12:g} pg/mL — borderline (200–300).")
    for c in it.get("conditions") or []:
        if c in CONDITIONS:
            add("watch", f"{CONDITIONS[c]} — medicines and the doctor's advice come first when changing the diet.")
    veg = (it.get("diet") or "") in ("veg", "vegan", "jain")
    age = _f(it.get("age"))
    if not vd and abroad:
        add("tip", "Living abroad: low vitamin D is very common in Indians outside India (less sun, darker skin). A vitamin D test is worth doing.")
    if not b12 and veg:
        add("tip", "Vegetarian: B12 is often low. A B12 test is worth doing.")
    if not a1c and age and age >= 30 and (abroad or (h and w and w / ((h / 100) ** 2) >= 23)):
        add("tip", "South Asians get diabetes earlier and at lower weights. An HbA1c (blood sugar) test is worth doing — advised from age 30 or BMI 23.")
    order = {"high": 0, "watch": 1, "tip": 2}
    return sorted(flags, key=lambda f: order[f["level"]])
