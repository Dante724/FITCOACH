from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import logging
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import httpx
from pydantic import BaseModel, Field, ConfigDict

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
GEMINI_MODEL = "gemini-3-flash-preview"

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

VALID_FOCUS = {"strength", "nutrition", "yoga", "muscle_fat"}


# ───────────────────────────── Models ─────────────────────────────
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    focus: Optional[str] = None
    created_at: Optional[str] = None


class FocusUpdate(BaseModel):
    focus: str


class Booking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    trainer_id: str
    trainer_name: str
    specialty: str
    date: str
    time: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BookingCreate(BaseModel):
    trainer_id: str
    date: str
    time: str


class ProgressEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    date: str
    weight: Optional[float] = None
    body_fat: Optional[float] = None
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    arms: Optional[float] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProgressCreate(BaseModel):
    weight: Optional[float] = None
    body_fat: Optional[float] = None
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    arms: Optional[float] = None


class FoodAnalyzeRequest(BaseModel):
    description: str


class BodyScanRequest(BaseModel):
    image_base64: str


class WorkoutSessionCreate(BaseModel):
    name: str
    exercises: List[dict] = []
    duration_min: Optional[int] = None
    notes: Optional[str] = None


# ───────────────────────────── Auth ─────────────────────────────
async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> User:
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


@api_router.post("/auth/session")
async def process_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient() as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name")), "picture": data.get("picture")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name", email),
            "picture": data.get("picture"),
            "focus": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    response.set_cookie(
        key="session_token", value=session_token, httponly=True,
        secure=True, samesite="none", path="/", max_age=7 * 24 * 60 * 60,
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.get("/auth/me", response_model=User)
async def auth_me(user: User = Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(None),
                 authorization: Optional[str] = Header(None)):
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api_router.put("/profile/focus", response_model=User)
async def set_focus(payload: FocusUpdate, user: User = Depends(get_current_user)):
    if payload.focus not in VALID_FOCUS:
        raise HTTPException(status_code=400, detail="Invalid focus")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"focus": payload.focus}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


# ───────────────────────────── Trainers / Booking ─────────────────────────────
TRAINERS = [
    {"trainer_id": "t1", "name": "Sarah Johnson", "specialty": "Strength & Conditioning", "initials": "SJ"},
    {"trainer_id": "t2", "name": "Mike Chen", "specialty": "Muscle Building & Fat Loss", "initials": "MC"},
    {"trainer_id": "t3", "name": "Priya Sharma", "specialty": "Yoga & Flexibility", "initials": "PS"},
    {"trainer_id": "t4", "name": "Raj Patel", "specialty": "Nutrition & Conditioning", "initials": "RP"},
]
SLOT_TIMES = ["07:00", "08:00", "09:00", "10:00", "16:00", "17:00", "18:00", "19:00"]


@api_router.get("/trainers")
async def get_trainers(user: User = Depends(get_current_user)):
    return {"trainers": TRAINERS, "slots": SLOT_TIMES}


@api_router.get("/bookings")
async def list_bookings(user: User = Depends(get_current_user)):
    docs = await db.bookings.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
    return docs


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, user: User = Depends(get_current_user)):
    trainer = next((t for t in TRAINERS if t["trainer_id"] == payload.trainer_id), None)
    if not trainer:
        raise HTTPException(status_code=400, detail="Invalid trainer")
    clash = await db.bookings.find_one({"user_id": user.user_id, "date": payload.date, "time": payload.time})
    if clash:
        raise HTTPException(status_code=409, detail="You already have a booking at this time")
    booking = Booking(
        user_id=user.user_id, trainer_id=trainer["trainer_id"], trainer_name=trainer["name"],
        specialty=trainer["specialty"], date=payload.date, time=payload.time,
    )
    await db.bookings.insert_one(booking.model_dump())
    return booking


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: User = Depends(get_current_user)):
    await db.bookings.delete_one({"id": booking_id, "user_id": user.user_id})
    return {"ok": True}


# ───────────────────────────── Progress ─────────────────────────────
@api_router.get("/progress")
async def list_progress(user: User = Depends(get_current_user)):
    docs = await db.progress.find({"user_id": user.user_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda x: x.get("date", ""))
    return docs


@api_router.post("/progress", response_model=ProgressEntry)
async def create_progress(payload: ProgressCreate, user: User = Depends(get_current_user)):
    entry = ProgressEntry(
        user_id=user.user_id, date=datetime.now(timezone.utc).date().isoformat(),
        **payload.model_dump(),
    )
    await db.progress.insert_one(entry.model_dump())
    return entry


@api_router.delete("/progress/{entry_id}")
async def delete_progress(entry_id: str, user: User = Depends(get_current_user)):
    await db.progress.delete_one({"id": entry_id, "user_id": user.user_id})
    return {"ok": True}


# ───────────────────────────── Workouts ─────────────────────────────
FOCUS_PLANS = {
    "strength": {
        "name": "Strength & Conditioning — Lower Body",
        "exercises": [
            {"name": "Back Squat", "meta": "5 x 5"},
            {"name": "Romanian Deadlift", "meta": "4 x 6"},
            {"name": "Walking Lunge", "meta": "3 x 10"},
            {"name": "Weighted Plank", "meta": "3 x 45s"},
            {"name": "Kettlebell Swing", "meta": "4 x 15"},
        ],
    },
    "yoga": {
        "name": "Vinyasa Flow — Mobility & Balance",
        "exercises": [
            {"name": "Sun Salutation A", "meta": "5 rounds"},
            {"name": "Warrior II Flow", "meta": "3 x 60s"},
            {"name": "Tree Pose", "meta": "2 x 45s"},
            {"name": "Pigeon Pose", "meta": "2 x 90s"},
            {"name": "Seated Meditation", "meta": "5 min"},
        ],
    },
    "muscle_fat": {
        "name": "Hypertrophy & Conditioning — Push",
        "exercises": [
            {"name": "Incline Dumbbell Press", "meta": "4 x 10"},
            {"name": "Cable Fly", "meta": "3 x 12"},
            {"name": "Overhead Press", "meta": "4 x 8"},
            {"name": "Triceps Rope Pushdown", "meta": "3 x 15"},
            {"name": "Treadmill Intervals", "meta": "12 min"},
        ],
    },
    "nutrition": {
        "name": "Light Conditioning Circuit",
        "exercises": [
            {"name": "Bodyweight Squat", "meta": "3 x 15"},
            {"name": "Push-ups", "meta": "3 x 12"},
            {"name": "Brisk Walk", "meta": "20 min"},
        ],
    },
}


@api_router.get("/workouts/plan")
async def workout_plan(user: User = Depends(get_current_user)):
    focus = user.focus or "strength"
    return FOCUS_PLANS.get(focus, FOCUS_PLANS["strength"])


@api_router.get("/workouts/sessions")
async def list_sessions(user: User = Depends(get_current_user)):
    docs = await db.workout_sessions.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


@api_router.post("/workouts/sessions")
async def create_session(payload: WorkoutSessionCreate, user: User = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "name": payload.name,
        "exercises": payload.exercises,
        "duration_min": payload.duration_min,
        "notes": payload.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workout_sessions.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


# ───────────────────────────── Gemini helpers ─────────────────────────────
def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    raise ValueError("Could not parse AI response")


@api_router.post("/food/analyze")
async def analyze_food(payload: FoodAnalyzeRequest, user: User = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    system = (
        "You are a nutrition analysis engine. Given a meal description, estimate nutrition. "
        "Respond ONLY with strict JSON, no prose, using this schema: "
        '{"meal_name": string, "items": [string], "calories": number, "protein_g": number, '
        '"carbs_g": number, "fat_g": number, "health_score": number (0-100), "notes": string}'
    )
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"food-{user.user_id}-{uuid.uuid4().hex[:6]}",
                   system_message=system).with_model("gemini", GEMINI_MODEL)
    try:
        reply = await chat.send_message(UserMessage(text=f"Meal: {payload.description}"))
        result = _extract_json(reply)
    except Exception as e:
        logger.exception("food analyze failed")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "description": payload.description,
        "result": result,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.food_logs.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/food/logs")
async def food_logs(user: User = Depends(get_current_user)):
    docs = await db.food_logs.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


@api_router.delete("/food/logs/{log_id}")
async def delete_food(log_id: str, user: User = Depends(get_current_user)):
    await db.food_logs.delete_one({"id": log_id, "user_id": user.user_id})
    return {"ok": True}


@api_router.post("/bodyscan/analyze")
async def analyze_body(payload: BodyScanRequest, user: User = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    b64 = payload.image_base64
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    system = (
        "You are a fitness body-composition assistant. Analyze the person's physique from the photo "
        "and classify their somatotype. Respond ONLY with strict JSON, no prose, using this schema: "
        '{"body_type": "Ectomorph"|"Mesomorph"|"Endomorph", "confidence": number (0-100), '
        '"description": string, "training_focus": string, "nutrition_focus": string, '
        '"recommended_split": string}. Be encouraging and professional.'
    )
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"scan-{user.user_id}-{uuid.uuid4().hex[:6]}",
                   system_message=system).with_model("gemini", GEMINI_MODEL)
    try:
        msg = UserMessage(
            text="Analyze this body photo and return the JSON classification.",
            file_contents=[ImageContent(image_base64=b64)],
        )
        reply = await chat.send_message(msg)
        result = _extract_json(reply)
    except Exception as e:
        logger.exception("body scan failed")
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "result": result,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.body_scans.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/bodyscan/history")
async def body_history(user: User = Depends(get_current_user)):
    docs = await db.body_scans.find({"user_id": user.user_id}, {"_id": 0}).to_list(100)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


@api_router.get("/")
async def root():
    return {"message": "FitCoach API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
