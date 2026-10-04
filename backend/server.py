from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie, Header, BackgroundTasks, UploadFile, File, Query, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import ssl
import smtplib
import asyncio
import logging
import uuid
import secrets
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import httpx
import requests
from pydantic import BaseModel, Field, ConfigDict, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
GEMINI_MODEL = "gemini-3-flash-preview"

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_DAYS = 7
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', '').strip()
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '').strip()
PAYMENTS_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@fitcoach.com').strip().lower()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Admin@12345')
ADMIN_PASSWORD_RESET = os.environ.get('ADMIN_PASSWORD_RESET', 'false').lower() == 'true'


DEFAULT_DAYS = [0, 1, 2, 3, 4]
DEFAULT_TIMES = ["07:00", "08:00", "09:00", "17:00", "18:00", "19:00"]

GMAIL_ADDRESS = os.environ.get('GMAIL_ADDRESS', '').strip()
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '').replace(' ', '').strip()
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '465'))
EMAIL_ENABLED = os.environ.get('EMAIL_ENABLED', 'true').lower() == 'true'
REMINDER_HOURS_BEFORE = int(os.environ.get('REMINDER_HOURS_BEFORE', '24'))
# Session dates/times are entered as local wall-clock time in the business's timezone.
APP_TZ = ZoneInfo(os.environ.get('APP_TIMEZONE', 'Asia/Kolkata'))
# Optional TURN relay for calls on restrictive networks (STUN alone works for most home/mobile networks).
TURN_URLS = [u.strip() for u in os.environ.get('TURN_URLS', '').split(',') if u.strip()]
TURN_USERNAME = os.environ.get('TURN_USERNAME', '')
TURN_CREDENTIAL = os.environ.get('TURN_CREDENTIAL', '')


def booking_dt(date: str, time: str) -> datetime:
    """A booking's start as an aware datetime (raises ValueError on bad input)."""
    return datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M").replace(tzinfo=APP_TZ)

MEMBERSHIP_PLANS = [
    {"id": "monthly", "name": "Monthly", "price_inr": 15000, "days": 30, "blurb": "Full access, billed monthly"},
    {"id": "quarterly", "name": "Quarterly", "price_inr": 30000, "days": 90, "blurb": "Save with a 3-month commitment"},
    {"id": "annual", "name": "Annual", "price_inr": 85000, "days": 365, "blurb": "Best value — a full year of training"},
]
SESSION_PRICE_INR = 1000

# ───────────────────────────── Object Storage (profile photos) ─────────────────────────────
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
STORAGE_APP_NAME = "fitcoach"
_storage_key = None
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
IMAGE_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_LLM_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY is not set — object storage is disabled")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if resp.status_code == 403:
        # storage key expired — re-init once and retry
        global _storage_key
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 403:
        global _storage_key
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")



app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

VALID_FOCUS = {"fat_loss", "muscle_gain", "yoga", "hybrid"}
FITNESS_FOCUS = {"fat_loss", "muscle_gain", "hybrid"}
YOGA_FOCUS = {"yoga", "hybrid"}
# v1 programme keys → v2 goals (migrated at startup)
LEGACY_FOCUS = {"strength": "muscle_gain", "muscle_fat": "fat_loss", "nutrition": "fat_loss"}
COACH_TYPES = {"fitness", "yoga"}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_access_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", path="/", max_age=ACCESS_TOKEN_DAYS * 24 * 60 * 60,
    )


def get_client_ip(request: Request) -> str:
    # Behind the K8s ingress the TCP peer is a rotating proxy pod, so trust X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.client.host if request.client else "unknown"


# ───────────────────────────── Models ─────────────────────────────
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    role: str = "client"
    picture: Optional[str] = None
    focus: Optional[str] = None
    specialty: Optional[str] = None
    bio: Optional[str] = None
    available_days: Optional[List[int]] = None
    available_times: Optional[List[str]] = None
    membership_plan: Optional[str] = None
    membership_expires_at: Optional[str] = None
    coach_type: Optional[str] = None
    max_clients: Optional[int] = None
    fitness_coach_id: Optional[str] = None
    yoga_coach_id: Optional[str] = None
    intake: Optional[dict] = None
    created_at: Optional[str] = None


class FocusUpdate(BaseModel):
    focus: str


class IntakeUpdate(BaseModel):
    focus: str
    age: Optional[int] = None
    sex: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    target_weight_kg: Optional[float] = None
    experience: Optional[str] = None      # beginner | intermediate | advanced
    days_per_week: Optional[int] = None
    equipment: Optional[str] = None       # gym | home | bodyweight
    injuries: Optional[str] = None
    diet: Optional[str] = None            # veg | non_veg | eggetarian | vegan | jain
    allergies: Optional[str] = None
    dislikes: Optional[str] = None


class ProfileUpdate(BaseModel):
    name: str


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TrainerProfile(BaseModel):
    specialty: str = ""
    bio: str = ""
    available_days: List[int] = []
    available_times: List[str] = []


class RoleUpdate(BaseModel):
    role: str


class MembershipUpdate(BaseModel):
    plan_id: Optional[str] = None


class CoachTypeUpdate(BaseModel):
    coach_type: str
    max_clients: Optional[int] = None


class CoachAssignment(BaseModel):
    fitness_coach_id: Optional[str] = None
    yoga_coach_id: Optional[str] = None


class Booking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    client_name: str = ""
    client_email: str = ""
    trainer_id: str
    trainer_name: str
    trainer_email: str = ""
    specialty: str
    date: str
    time: str
    room: str = ""
    paid: bool = False
    reminder_at: str = ""
    reminder_email_sent: bool = False
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


class WorkoutSessionCreate(BaseModel):
    name: str
    exercises: List[dict] = []
    duration_min: Optional[int] = None
    notes: Optional[str] = None
    plan_id: Optional[str] = None
    kind: Optional[str] = None            # workout | yoga


class PlanDraftRequest(BaseModel):
    type: str                             # workout | meal | yoga
    notes: Optional[str] = None           # coach instructions / reason for an adjustment


class PlanUpdate(BaseModel):
    title: Optional[str] = None
    content: dict
    coach_note: Optional[str] = None


class PoseCheckCreate(BaseModel):
    pose: str
    pose_label: str
    score: int
    checks: List[dict] = []
    flags: List[str] = []
    snapshot: str                          # annotated JPEG data URL of the best frame — the video never leaves the device
    frames: Optional[int] = None
    plan_id: Optional[str] = None


class PoseReview(BaseModel):
    verdict: str                           # confirmed | adjusted
    flags: List[str] = []                  # the corrections the client should see (coach may edit the AI's)
    score: Optional[int] = None
    coach_note: Optional[str] = None


class MessageCreate(BaseModel):
    body: str
    context_type: Optional[str] = None    # food | workout | plan | photo | progress
    context_id: Optional[str] = None
    context_label: Optional[str] = None


# ───────────────────────────── Auth ─────────────────────────────
async def _user_from_google_session(token: str) -> Optional[User]:
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return User(**user_doc) if user_doc else None


async def _user_from_jwt(token: str) -> Optional[User]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    user_doc = await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})
    return User(**user_doc) if user_doc else None


async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(None),
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> User:
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization.split(" ", 1)[1]

    # 1) Google OAuth session (session_token cookie, or a Bearer that matches a session)
    for candidate in (session_token, bearer):
        if candidate:
            user = await _user_from_google_session(candidate)
            if user:
                return user

    # 2) Email/password JWT (access_token cookie, or Bearer as a JWT)
    for candidate in (access_token, bearer):
        if candidate:
            user = await _user_from_jwt(candidate)
            if user:
                return user

    raise HTTPException(status_code=401, detail="Not authenticated")


def require_role(*roles):
    async def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


async def push_notification(user_id: str, title: str, body: str, link: str = ""):
    if not user_id:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "title": title, "body": body,
        "link": link, "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })


def email_configured() -> bool:
    return bool(GMAIL_ADDRESS and GMAIL_APP_PASSWORD and EMAIL_ENABLED)


def _send_sync(to: List[str], subject: str, text: str, html: str):
    msg = EmailMessage()
    msg["From"] = f"FitCoach <{GMAIL_ADDRESS}>"
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=20) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)


async def send_email(to: List[str], subject: str, text: str, html: str) -> bool:
    to = [t for t in to if t]
    if not to:
        return False
    if not email_configured():
        logger.info("Email not configured; skipping: %s", subject)
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, text, html)
        logger.info("Email sent: %s -> %s", subject, to)
        return True
    except Exception:
        logger.exception("Email send failed: %s", subject)
        return False


def _email_shell(title: str, lines: List[str], cta_label: str = "", cta_url: str = "") -> str:
    body = "".join(f'<p style="margin:0 0 10px;color:#4b5563;font-size:15px;line-height:1.6">{l}</p>' for l in lines)
    cta = ""
    if cta_label and cta_url:
        cta = (f'<a href="{cta_url}" style="display:inline-block;margin-top:14px;padding:12px 24px;'
               f'background:#e05c37;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">{cta_label}</a>')
    return (
        f'<div style="background:#eef1f7;padding:32px 0;font-family:Arial,Helvetica,sans-serif">'
        f'<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:32px 34px;'
        f'box-shadow:0 8px 30px rgba(70,85,120,0.10)">'
        f'<div style="font-size:20px;font-weight:800;color:#1b2130;margin-bottom:4px">FitCoach</div>'
        f'<div style="height:3px;width:46px;background:#e05c37;border-radius:2px;margin-bottom:20px"></div>'
        f'<h2 style="margin:0 0 14px;color:#1b2130;font-size:21px">{title}</h2>{body}{cta}'
        f'<p style="margin:26px 0 0;color:#93a0b0;font-size:12px">You are receiving this because you have a FitCoach account.</p>'
        f'</div></div>'
    )


async def send_booking_emails(booking: dict, app_origin: str):
    when = f"{booking['date']} at {booking['time']}"
    join = f"{app_origin}/call/{booking['id']}"
    await send_email(
        [booking.get("client_email")], "Your FitCoach session is confirmed",
        f"Your session with {booking['trainer_name']} is booked for {when}.",
        _email_shell("Session confirmed",
                     [f"Hi {booking.get('client_name') or 'there'},",
                      f"Your session with <b>{booking['trainer_name']}</b> ({booking['specialty']}) is booked for <b>{when}</b>.",
                      "You can join the live video call from the button below at your session time."],
                     "Join video call", join),
    )
    await send_email(
        [booking.get("trainer_email")], "New session booked",
        f"{booking.get('client_name')} booked a session for {when}.",
        _email_shell("New booking",
                     [f"<b>{booking.get('client_name')}</b> booked a session with you for <b>{when}</b>.",
                      "Join the video call from your trainer dashboard when it's time."],
                     "Open trainer dashboard", f"{app_origin}/trainer"),
    )


async def send_due_reminders():
    if not email_configured():
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.bookings.find({"reminder_email_sent": {"$ne": True}, "reminder_at": {"$lte": now_iso, "$ne": ""}})
    async for b in cursor:
        try:
            session_dt = booking_dt(b["date"], b["time"])
        except (ValueError, KeyError):
            await db.bookings.update_one({"id": b["id"]}, {"$set": {"reminder_email_sent": True}})
            continue
        if session_dt < datetime.now(timezone.utc):
            await db.bookings.update_one({"id": b["id"]}, {"$set": {"reminder_email_sent": True}})
            continue
        when = f"{b['date']} at {b['time']}"
        origin = os.environ.get('APP_ORIGIN', '')
        await send_email(
            [b.get("client_email"), b.get("trainer_email")], "Reminder: your FitCoach session is coming up",
            f"Your session is scheduled for {when}.",
            _email_shell("Session reminder",
                         [f"This is a reminder that <b>{b.get('client_name')}</b> has a session with <b>{b['trainer_name']}</b> on <b>{when}</b>.",
                          "Be ready a few minutes early and join the video call from the app."]),
        )
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"reminder_email_sent": True}})


def _humanize_until(dt: datetime) -> str:
    delta = dt - datetime.now(timezone.utc)
    mins = int(delta.total_seconds() // 60)
    if mins < 0:
        return "in progress"
    if mins < 60:
        return f"in {mins} min"
    hours = mins // 60
    if hours < 24:
        return f"in {hours}h {mins % 60}m"
    return f"in {hours // 24}d"


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


@api_router.post("/auth/register", response_model=User)
async def register(payload: RegisterRequest, response: Response):
    email = payload.email.lower().strip()
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": payload.name.strip() or email,
        "role": "client",
        "picture": None,
        "focus": None,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = create_access_token(user_id, email)
    set_access_cookie(response, token)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.post("/auth/login", response_model=User)
async def login(payload: LoginRequest, request: Request, response: Response):
    email = payload.email.lower().strip()
    ip = get_client_ip(request)
    identifier = f"{ip}:{email}"

    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= MAX_LOGIN_ATTEMPTS:
        last = attempt.get("last_attempt")
        if isinstance(last, str):
            last = datetime.fromisoformat(last)
        if last and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last and datetime.now(timezone.utc) - last < timedelta(minutes=LOCKOUT_MINUTES):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
        await db.login_attempts.delete_one({"identifier": identifier})

    user_doc = await db.users.find_one({"email": email}, {"_id": 0})
    if not user_doc or not user_doc.get("password_hash") or not verify_password(payload.password, user_doc["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    token = create_access_token(user_doc["user_id"], email)
    set_access_cookie(response, token)
    return User(**user_doc)


@api_router.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(None),
                 authorization: Optional[str] = Header(None)):
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.put("/profile/focus", response_model=User)
async def set_focus(payload: FocusUpdate, user: User = Depends(get_current_user)):
    focus = LEGACY_FOCUS.get(payload.focus, payload.focus)
    if focus not in VALID_FOCUS:
        raise HTTPException(status_code=400, detail="Invalid focus")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"focus": focus}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.put("/profile/intake", response_model=User)
async def set_intake(payload: IntakeUpdate, user: User = Depends(require_role("client"))):
    if payload.focus not in VALID_FOCUS:
        raise HTTPException(status_code=400, detail="Invalid goal")
    intake = payload.model_dump(exclude={"focus"})
    for k in ("injuries", "allergies", "dislikes"):
        if intake.get(k):
            intake[k] = intake[k].strip()[:300]
    first_time = not user.focus
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"focus": payload.focus, "intake": intake}})
    if payload.weight_kg and not await db.progress.find_one({"user_id": user.user_id}):
        entry = ProgressEntry(user_id=user.user_id, date=datetime.now(timezone.utc).date().isoformat(), weight=payload.weight_kg)
        await db.progress.insert_one(entry.model_dump())
    if first_time:
        async for a in db.users.find({"role": "admin"}, {"_id": 0, "user_id": 1}):
            await push_notification(a["user_id"], "New client needs a coach",
                                    f"{user.name} joined ({payload.focus.replace('_', ' ')}).", "/admin")
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.put("/profile", response_model=User)
async def update_profile(payload: ProfileUpdate, user: User = Depends(get_current_user)):
    name = payload.name.strip()
    if not (1 <= len(name) <= 60):
        raise HTTPException(status_code=400, detail="Name must be 1–60 characters")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"name": name}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.post("/profile/photo", response_model=User)
async def upload_profile_photo(request: Request, file: UploadFile = File(...), user: User = Depends(get_current_user)):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP or GIF images are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 5MB or smaller")
    path = f"{STORAGE_APP_NAME}/avatars/{user.user_id}/{uuid.uuid4().hex}.{ext}"
    content_type = IMAGE_MIME.get(ext, file.content_type or "application/octet-stream")
    try:
        result = await asyncio.to_thread(put_object, path, data, content_type)
    except Exception:
        logger.exception("Photo upload failed")
        raise HTTPException(status_code=502, detail="Could not store the image, please try again")
    stored_path = result["path"]
    await db.files.insert_one({
        "id": str(uuid.uuid4()), "storage_path": stored_path, "owner_id": user.user_id,
        "original_filename": file.filename, "content_type": content_type, "size": result.get("size"),
        "kind": "avatar", "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    picture_url = f"{proto}://{host}/api/files/{stored_path}"
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"picture": picture_url}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.get("/files/{path:path}")
async def serve_file(path: str, request: Request,
                     session_token: Optional[str] = Cookie(None),
                     access_token: Optional[str] = Cookie(None),
                     authorization: Optional[str] = Header(None),
                     auth: Optional[str] = Query(None)):
    # Same-origin <img> requests carry the session cookie; also accept a Bearer/query token.
    authed = False
    for cand in (session_token, access_token):
        if cand and (await _user_from_google_session(cand) or await _user_from_jwt(cand)):
            authed = True
            break
    if not authed:
        token = auth or (authorization.split(" ", 1)[1] if authorization and authorization.startswith("Bearer ") else None)
        if token and (await _user_from_google_session(token) or await _user_from_jwt(token)):
            authed = True
    if not authed:
        raise HTTPException(status_code=401, detail="Not authenticated")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, content_type = await asyncio.to_thread(get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=record.get("content_type", content_type),
                    headers={"Cache-Control": "private, max-age=3600"})


# ───────────────────────────── Trainers / Booking ─────────────────────────────
def _trainer_public(u: dict) -> dict:
    return {
        "trainer_id": u["user_id"],
        "name": u.get("name"),
        "specialty": u.get("specialty") or "Personal Trainer",
        "bio": u.get("bio") or "",
        "available_days": u.get("available_days") or DEFAULT_DAYS,
        "available_times": sorted(u.get("available_times") or DEFAULT_TIMES),
        "initials": "".join([p[0] for p in (u.get("name") or "T").split()][:2]).upper(),
        "coach_type": u.get("coach_type") or "fitness",
        "picture": u.get("picture"),
    }


def _room_for(booking_id: str) -> str:
    return "FitCoach-" + booking_id.replace("-", "")


def _my_coach_ids(user: User) -> List[str]:
    return [c for c in (user.fitness_coach_id, user.yoga_coach_id) if c]


@api_router.get("/trainers")
async def get_trainers(user: User = Depends(get_current_user)):
    query = {"role": "trainer"}
    if user.role == "client":
        query["user_id"] = {"$in": _my_coach_ids(user)}
    docs = await db.users.find(query, {"_id": 0}).to_list(200)
    return {"trainers": [_trainer_public(d) for d in docs]}


@api_router.get("/trainers/{trainer_id}/slots")
async def trainer_slots(trainer_id: str, date: str, user: User = Depends(get_current_user)):
    trainer = await db.users.find_one({"user_id": trainer_id, "role": "trainer"}, {"_id": 0})
    if not trainer:
        raise HTTPException(status_code=404, detail="Trainer not found")
    try:
        weekday = datetime.strptime(date, "%Y-%m-%d").weekday()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    days = trainer.get("available_days") or DEFAULT_DAYS
    times = sorted(trainer.get("available_times") or DEFAULT_TIMES)
    if weekday not in days:
        return {"slots": []}
    booked = await db.bookings.find({"trainer_id": trainer_id, "date": date}, {"_id": 0, "time": 1}).to_list(200)
    taken = {b["time"] for b in booked}
    return {"slots": [t for t in times if t not in taken]}


@api_router.get("/bookings")
async def list_bookings(user: User = Depends(get_current_user)):
    docs = await db.bookings.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
    return docs


async def _create_booking(client_doc: dict, trainer: dict, date: str, time: str, request: Request,
                          background: BackgroundTasks, check_availability: bool, scheduled_by: Optional[User] = None) -> Booking:
    try:
        session_dt = booking_dt(date, time)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date or time")
    if session_dt < datetime.now(timezone.utc) - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="That time has already passed")
    if check_availability:
        days = trainer.get("available_days") or DEFAULT_DAYS
        times = trainer.get("available_times") or DEFAULT_TIMES
        if session_dt.weekday() not in days or time not in times:
            raise HTTPException(status_code=409, detail="Trainer is not available at this time")
    # Prevent double booking across ALL clients for this trainer/date/time
    if await db.bookings.find_one({"trainer_id": trainer["user_id"], "date": date, "time": time}):
        raise HTTPException(status_code=409, detail="This slot is already booked")

    booking = Booking(
        user_id=client_doc["user_id"], client_name=client_doc.get("name", ""), client_email=client_doc.get("email", ""),
        trainer_id=trainer["user_id"], trainer_name=trainer.get("name"), trainer_email=trainer.get("email", ""),
        specialty=trainer.get("specialty") or "Personal Trainer", date=date, time=time,
    )
    booking.room = _room_for(booking.id)
    booking.reminder_at = (session_dt - timedelta(hours=REMINDER_HOURS_BEFORE)).astimezone(timezone.utc).isoformat()
    doc = booking.model_dump()
    doc["starts_at"] = session_dt.astimezone(timezone.utc).isoformat()
    doc["scheduled_by"] = scheduled_by.user_id if scheduled_by else client_doc["user_id"]
    await db.bookings.insert_one(doc)
    when = f"{date} at {time}"
    if scheduled_by:
        await push_notification(client_doc["user_id"], "Session scheduled", f"{trainer.get('name')} scheduled a video session on {when}.", "/booking")
    else:
        await push_notification(client_doc["user_id"], "Session booked", f"With {booking.trainer_name} on {when}.", "/booking")
        await push_notification(trainer["user_id"], "New booking", f"{client_doc.get('name')} booked {when}.", "/trainer")
    origin = str(request.base_url).rstrip("/")
    background.add_task(send_booking_emails, booking.model_dump(), origin)
    return booking


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, request: Request, background: BackgroundTasks, user: User = Depends(get_current_user)):
    trainer = await db.users.find_one({"user_id": payload.trainer_id, "role": "trainer"}, {"_id": 0})
    if not trainer:
        raise HTTPException(status_code=400, detail="Invalid trainer")
    if user.role == "client" and payload.trainer_id not in _my_coach_ids(user):
        raise HTTPException(status_code=403, detail="You can only book sessions with your own coach")
    return await _create_booking(user.model_dump(), trainer, payload.date, payload.time, request, background, check_availability=True)


class CoachScheduleRequest(BaseModel):
    date: str
    time: str


@api_router.post("/coach/clients/{client_id}/sessions", response_model=Booking)
async def coach_schedule_session(client_id: str, payload: CoachScheduleRequest, request: Request, background: BackgroundTasks,
                                 user: User = Depends(require_role("trainer"))):
    """A coach schedules a video session for one of their clients at any time they choose."""
    client_doc = await _client_access(user, client_id)
    if not re.match(r"^\d{2}:\d{2}$", payload.time or ""):
        raise HTTPException(status_code=400, detail="Time must be HH:MM")
    trainer = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return await _create_booking(client_doc, trainer, payload.date, payload.time, request, background,
                                 check_availability=False, scheduled_by=user)


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: User = Depends(get_current_user)):
    await db.bookings.delete_one({"id": booking_id, "user_id": user.user_id})
    return {"ok": True}


@api_router.get("/sessions/{booking_id}")
async def get_session(booking_id: str, user: User = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking or user.user_id not in (booking.get("user_id"), booking.get("trainer_id")):
        raise HTTPException(status_code=404, detail="Session not found")
    room = booking.get("room") or _room_for(booking_id)
    other = booking.get("trainer_name") if user.user_id == booking.get("user_id") else booking.get("client_name")
    return {
        "room": room, "display_name": user.name, "date": booking.get("date"),
        "time": booking.get("time"), "with": other, "specialty": booking.get("specialty"),
    }


# ───────────────────────────── Trainer endpoints ─────────────────────────────
@api_router.get("/trainer/me")
async def trainer_me(user: User = Depends(require_role("trainer"))):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return {
        "specialty": doc.get("specialty") or "",
        "bio": doc.get("bio") or "",
        "available_days": doc.get("available_days") or DEFAULT_DAYS,
        "available_times": sorted(doc.get("available_times") or DEFAULT_TIMES),
    }


@api_router.put("/trainer/me")
async def trainer_update(payload: TrainerProfile, user: User = Depends(require_role("trainer"))):
    update = {
        "specialty": payload.specialty.strip(),
        "bio": payload.bio.strip(),
        "available_days": sorted(set(d for d in payload.available_days if 0 <= d <= 6)),
        "available_times": sorted(set(payload.available_times)),
    }
    await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    return {"ok": True, **update}


@api_router.get("/trainer/sessions")
async def trainer_sessions(user: User = Depends(require_role("trainer"))):
    docs = await db.bookings.find({"trainer_id": user.user_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
    return docs


# ───────────────────────────── Admin endpoints ─────────────────────────────
def _needs_coach(c: dict) -> List[str]:
    """Which coach types a client is still missing for their goal."""
    focus = c.get("focus")
    missing = []
    if focus in FITNESS_FOCUS and not c.get("fitness_coach_id"):
        missing.append("fitness")
    if focus in YOGA_FOCUS and not c.get("yoga_coach_id"):
        missing.append("yoga")
    return missing


@api_router.get("/admin/stats")
async def admin_stats(user: User = Depends(require_role("admin"))):
    clients = await db.users.find({"role": "client"}, {"_id": 0, "focus": 1, "fitness_coach_id": 1, "yoga_coach_id": 1}).to_list(5000)
    stale = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    return {
        "clients": len(clients),
        "trainers": await db.users.count_documents({"role": "trainer"}),
        "bookings": await db.bookings.count_documents({}),
        "active_members": await db.users.count_documents({"membership_expires_at": {"$gt": datetime.now(timezone.utc).isoformat()}}),
        "unassigned": sum(1 for c in clients if _needs_coach(c)),
        "stale_drafts": await db.plans.count_documents({"status": "draft", "created_at": {"$lt": stale}}),
    }


@api_router.get("/admin/coaches")
async def admin_coaches(user: User = Depends(require_role("admin"))):
    trainers = await db.users.find({"role": "trainer"}, {"_id": 0, "password_hash": 0}).to_list(500)
    out = []
    for t in trainers:
        field = "yoga_coach_id" if t.get("coach_type") == "yoga" else "fitness_coach_id"
        load = await db.users.count_documents({"role": "client", field: t["user_id"]})
        out.append({"user_id": t["user_id"], "name": t.get("name"), "email": t.get("email"),
                    "coach_type": t.get("coach_type") or "fitness", "max_clients": t.get("max_clients") or 30,
                    "clients": load})
    out.sort(key=lambda x: (x["coach_type"], x["name"] or ""))
    return out


@api_router.put("/admin/users/{target_id}/coach-type")
async def admin_set_coach_type(target_id: str, payload: CoachTypeUpdate, user: User = Depends(require_role("admin"))):
    if payload.coach_type not in COACH_TYPES:
        raise HTTPException(status_code=400, detail="Invalid coach type")
    target = await db.users.find_one({"user_id": target_id, "role": "trainer"}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Trainer not found")
    update = {"coach_type": payload.coach_type}
    if payload.max_clients is not None:
        update["max_clients"] = max(1, min(500, payload.max_clients))
    await db.users.update_one({"user_id": target_id}, {"$set": update})
    return {"ok": True, **update}


@api_router.put("/admin/users/{target_id}/coaches")
async def admin_assign_coaches(target_id: str, payload: CoachAssignment, user: User = Depends(require_role("admin"))):
    client_doc = await db.users.find_one({"user_id": target_id, "role": "client"}, {"_id": 0})
    if not client_doc:
        raise HTTPException(status_code=404, detail="Client not found")
    update = {}
    for field, ctype in (("fitness_coach_id", "fitness"), ("yoga_coach_id", "yoga")):
        if field not in payload.model_fields_set:
            continue
        coach_id = getattr(payload, field) or None
        if coach_id:
            coach = await db.users.find_one({"user_id": coach_id, "role": "trainer"}, {"_id": 0})
            if not coach or (coach.get("coach_type") or "fitness") != ctype:
                raise HTTPException(status_code=400, detail=f"Pick a {ctype} coach")
            if client_doc.get(field) != coach_id:
                await push_notification(coach_id, "New client assigned",
                                        f"{client_doc.get('name')} is now your client.", f"/trainer/clients/{target_id}")
                await push_notification(target_id, "Your coach is here",
                                        f"{coach.get('name')} is now your {ctype} coach.", "/dashboard")
        update[field] = coach_id
    if update:
        await db.users.update_one({"user_id": target_id}, {"$set": update})
    doc = await db.users.find_one({"user_id": target_id}, {"_id": 0, "password_hash": 0})
    return doc


@api_router.get("/admin/users")
async def admin_users(user: User = Depends(require_role("admin"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


@api_router.put("/admin/users/{target_id}/role")
async def admin_set_role(target_id: str, payload: RoleUpdate, user: User = Depends(require_role("admin"))):
    if payload.role not in ("client", "trainer", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    update = {"role": payload.role}
    if payload.role == "trainer" and not target.get("available_times"):
        update["available_days"] = list(DEFAULT_DAYS)
        update["available_times"] = list(DEFAULT_TIMES)
        update["specialty"] = target.get("specialty") or "Personal Trainer"
    if payload.role == "trainer" and not target.get("coach_type"):
        update["coach_type"] = "yoga" if "yoga" in (target.get("specialty") or "").lower() else "fitness"
    await db.users.update_one({"user_id": target_id}, {"$set": update})
    await push_notification(target_id, "Role updated", f"An administrator set your role to {payload.role}.", "/")
    return {"ok": True, "role": payload.role}


@api_router.put("/admin/users/{target_id}/membership")
async def admin_set_membership(target_id: str, payload: MembershipUpdate, user: User = Depends(require_role("admin"))):
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.plan_id is None:
        await db.users.update_one({"user_id": target_id}, {"$set": {"membership_plan": None, "membership_expires_at": None}})
        await push_notification(target_id, "Membership updated", "Your membership was cancelled by an administrator.", "/membership")
        return {"ok": True, "membership_plan": None}
    plan = next((p for p in MEMBERSHIP_PLANS if p["id"] == payload.plan_id), None)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan")
    expires = datetime.now(timezone.utc) + timedelta(days=plan["days"])
    await db.users.update_one({"user_id": target_id}, {"$set": {"membership_plan": plan["id"], "membership_expires_at": expires.isoformat()}})
    await push_notification(target_id, "Membership activated", f"Your {plan['name']} membership is now active.", "/membership")
    return {"ok": True, "membership_plan": plan["id"], "membership_expires_at": expires.isoformat()}


# ───────────────────────────── Notifications ─────────────────────────────
@api_router.get("/notifications")
async def list_notifications(user: User = Depends(get_current_user)):
    stored = await db.notifications.find({"user_id": user.user_id}, {"_id": 0}).to_list(100)
    stored.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    dismissed_docs = await db.dismissed_reminders.find({"user_id": user.user_id}, {"_id": 0}).to_list(500)
    dismissed = {d["reminder_id"]: d.get("dismissed_at", "") for d in dismissed_docs}

    def _dismissed_recently(reminder_id: str, days: int) -> bool:
        ts = dismissed.get(reminder_id)
        if not ts:
            return False
        try:
            dt = datetime.fromisoformat(ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) - dt < timedelta(days=days)
        except (ValueError, TypeError):
            return False

    reminders = []
    bookings = await db.bookings.find(
        {"$or": [{"user_id": user.user_id}, {"trainer_id": user.user_id}]}, {"_id": 0}
    ).to_list(300)
    for b in bookings:
        try:
            dt = booking_dt(b["date"], b["time"])
        except (ValueError, KeyError):
            continue
        delta = dt - datetime.now(timezone.utc)
        rid = f"rem-{b['id']}"
        if rid in dismissed:  # session reminder dismissed → suppress permanently
            continue
        if timedelta(minutes=-30) <= delta <= timedelta(hours=48):
            who = b.get("trainer_name") if b.get("user_id") == user.user_id else (b.get("client_name") or "your client")
            reminders.append({
                "id": rid, "title": "Upcoming session",
                "body": f"With {who} — {_humanize_until(dt)} ({b['date']} at {b['time']})",
                "link": f"/call/{b['id']}", "kind": "reminder",
            })
    reminders.sort(key=lambda r: r["body"])

    # Weekly progress-photo nudge for clients (no photo in the last 7 days, not dismissed this week)
    if user.role == "client" and not _dismissed_recently("rem-photo-weekly", 7):
        last_photo = await db.progress_photos.find_one(
            {"user_id": user.user_id, "is_deleted": {"$ne": True}}, sort=[("created_at", -1)]
        )
        need_nudge = True
        if last_photo:
            try:
                last_dt = datetime.fromisoformat(last_photo["created_at"])
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - last_dt < timedelta(days=7):
                    need_nudge = False
            except (ValueError, TypeError):
                pass
        if need_nudge:
            reminders.append({
                "id": "rem-photo-weekly", "title": "Time for a progress photo",
                "body": "It's been a week — snap a new progress photo to track your transformation.",
                "link": "/progress", "kind": "reminder",
            })

    unread = sum(1 for n in stored if not n.get("read"))
    return {"notifications": stored, "reminders": reminders, "unread": unread, "badge": unread + len(reminders)}


class DismissReminderRequest(BaseModel):
    reminder_id: str


@api_router.post("/notifications/reminders/dismiss")
async def dismiss_reminder(payload: DismissReminderRequest, user: User = Depends(get_current_user)):
    rid = payload.reminder_id.strip()
    if not rid:
        raise HTTPException(status_code=400, detail="reminder_id is required")
    await db.dismissed_reminders.update_one(
        {"user_id": user.user_id, "reminder_id": rid},
        {"$set": {"user_id": user.user_id, "reminder_id": rid, "dismissed_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/notifications/read")
async def mark_notifications_read(user: User = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user.user_id, "read": False}, {"$set": {"read": True}})
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


# ───────────────────────────── Progress Photos ─────────────────────────────
@api_router.get("/progress/photos")
async def list_progress_photos(user: User = Depends(get_current_user)):
    docs = await db.progress_photos.find({"user_id": user.user_id, "is_deleted": {"$ne": True}}, {"_id": 0}).to_list(300)
    docs.sort(key=lambda x: (x.get("date", ""), x.get("created_at", "")))
    return docs


@api_router.post("/progress/photos")
async def upload_progress_photo(
    request: Request,
    file: UploadFile = File(...),
    date: Optional[str] = Form(None),
    weight: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP or GIF images are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 5MB or smaller")
    path = f"{STORAGE_APP_NAME}/progress/{user.user_id}/{uuid.uuid4().hex}.{ext}"
    content_type = IMAGE_MIME.get(ext, file.content_type or "application/octet-stream")
    try:
        result = await asyncio.to_thread(put_object, path, data, content_type)
    except Exception:
        logger.exception("Progress photo upload failed")
        raise HTTPException(status_code=502, detail="Could not store the image, please try again")
    stored_path = result["path"]
    await db.files.insert_one({
        "id": str(uuid.uuid4()), "storage_path": stored_path, "owner_id": user.user_id,
        "original_filename": file.filename, "content_type": content_type, "size": result.get("size"),
        "kind": "progress", "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    url = f"{proto}://{host}/api/files/{stored_path}"
    weight_val = None
    try:
        if weight not in (None, ""):
            weight_val = float(weight)
    except ValueError:
        weight_val = None
    doc = {
        "id": str(uuid.uuid4()), "user_id": user.user_id, "url": url, "storage_path": stored_path,
        "date": (date or datetime.now(timezone.utc).date().isoformat())[:10],
        "weight": weight_val, "note": (note or "").strip()[:200] or None,
        "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.progress_photos.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.delete("/progress/photos/{photo_id}")
async def delete_progress_photo(photo_id: str, user: User = Depends(get_current_user)):
    photo = await db.progress_photos.find_one({"id": photo_id, "user_id": user.user_id})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    await db.progress_photos.update_one({"id": photo_id, "user_id": user.user_id}, {"$set": {"is_deleted": True}})
    if photo.get("storage_path"):
        await db.files.update_one({"storage_path": photo["storage_path"]}, {"$set": {"is_deleted": True}})
    return {"ok": True}


# ───────────────────────────── Workouts ─────────────────────────────
@api_router.get("/workouts/plan")
async def workout_plan(type: str = "workout", user: User = Depends(get_current_user)):
    """The client's coach-approved plan of this type, or null while the coach prepares it."""
    if type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid plan type")
    doc = await db.plans.find_one({"client_id": user.user_id, "type": type, "status": "active"}, {"_id": 0})
    return {"plan": doc}


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
        "plan_id": payload.plan_id,
        "kind": payload.kind if payload.kind in ("workout", "yoga") else "workout",
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


# ───────────────────────────── Coaching: access ─────────────────────────────
PLAN_TYPES = {"workout": "fitness", "meal": "fitness", "yoga": "yoga"}
PLAN_LABELS = {"workout": "workout plan", "meal": "nutrition plan", "yoga": "yoga practice"}
CLIENT_PUBLIC = {"_id": 0, "password_hash": 0}


def _coach_tracks(coach_id: str, client: dict) -> set:
    tracks = set()
    if client.get("fitness_coach_id") == coach_id:
        tracks.add("fitness")
    if client.get("yoga_coach_id") == coach_id:
        tracks.add("yoga")
    return tracks


async def _client_access(user: User, client_id: str, track: Optional[str] = None) -> dict:
    """Return the client doc if `user` may see it: the client themself, an assigned coach, or an admin.
    With `track`, a coach must be assigned on that track (fitness coaches can't touch yoga plans and vice versa)."""
    client_doc = await db.users.find_one({"user_id": client_id, "role": "client"}, CLIENT_PUBLIC)
    if not client_doc:
        raise HTTPException(status_code=404, detail="Client not found")
    if user.role == "admin" or (user.role == "client" and user.user_id == client_id):
        return client_doc
    if user.role == "trainer":
        tracks = _coach_tracks(user.user_id, client_doc)
        if tracks and (track is None or track in tracks):
            return client_doc
    raise HTTPException(status_code=403, detail="This client is not assigned to you")


def _fitness_view(user: User, client: dict) -> bool:
    return user.role != "trainer" or "fitness" in _coach_tracks(user.user_id, client)


def _sees_plan_type(user: User, client: dict, ptype: str) -> bool:
    """Coaches only see plans on their own track; admins see everything."""
    return user.role == "admin" or PLAN_TYPES[ptype] in _coach_tracks(user.user_id, client)


async def _my_clients(user: User) -> List[dict]:
    if user.role == "admin":
        query = {"role": "client"}
    else:
        query = {"role": "client", "$or": [{"fitness_coach_id": user.user_id}, {"yoga_coach_id": user.user_id}]}
    docs = await db.users.find(query, CLIENT_PUBLIC).to_list(1000)
    docs.sort(key=lambda d: (d.get("name") or "").lower())
    return docs


def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value) if len(value) > 10 else datetime.fromisoformat(value + "T12:00:00")
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ───────────────────────────── Coaching: weekly brief ─────────────────────────────
async def _client_brief(client: dict, fitness_view: bool = True) -> dict:
    """Rule-based weekly summary for the coach: trend, adherence, flags and one suggested action.
    With fitness_view=False (a yoga-only coach) weight and nutrition alerts are left to the fitness coach."""
    cid = client["user_id"]
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    focus = client.get("focus")

    progress = await db.progress.find({"user_id": cid}, {"_id": 0}).to_list(500)
    progress.sort(key=lambda x: (x.get("date", ""), x.get("created_at", "")))
    weights = [(p["date"], p["weight"]) for p in progress if isinstance(p.get("weight"), (int, float))]
    sessions = await db.workout_sessions.find({"user_id": cid}, {"_id": 0, "created_at": 1}).to_list(500)
    foods = await db.food_logs.find({"user_id": cid}, {"_id": 0, "created_at": 1, "result": 1}).to_list(500)
    photos = await db.progress_photos.find({"user_id": cid, "is_deleted": {"$ne": True}}, {"_id": 0, "created_at": 1}).to_list(300)

    def recent(docs):
        return [d for d in docs if (_parse_dt(d.get("created_at")) or now - timedelta(days=999)) >= week_ago]

    sessions_7d, foods_7d = recent(sessions), recent(foods)
    kcals = [f["result"].get("calories") for f in foods_7d if isinstance((f.get("result") or {}).get("calories"), (int, float))]
    days_logged = len({(f.get("created_at") or "")[:10] for f in foods_7d}) or 1
    avg_kcal = round(sum(kcals) / days_logged) if kcals else None

    weight_now = weights[-1][1] if weights else None
    weight_change_7d = None
    if len(weights) >= 2:
        cutoff = (now - timedelta(days=7)).date().isoformat()
        older = [w for d, w in weights if d <= cutoff]
        base = older[-1] if older else weights[0][1]
        weight_change_7d = round(weight_now - base, 1)

    stamps = [_parse_dt(d.get("created_at")) for d in progress + sessions + foods + photos]
    stamps = [t for t in stamps if t]
    last_active = max(stamps) if stamps else _parse_dt(client.get("created_at"))
    inactive_days = (now - last_active).days if last_active else None

    plateau = False
    if focus in FITNESS_FOCUS:
        window = (now - timedelta(days=21)).date().isoformat()
        recent_w = [(d, w) for d, w in weights if d >= window]
        if len(recent_w) >= 3:
            span = (_parse_dt(recent_w[-1][0]) - _parse_dt(recent_w[0][0])).days
            vals = [w for _, w in recent_w]
            plateau = span >= 14 and (max(vals) - min(vals)) < 0.5

    flags = []
    if inactive_days is not None and inactive_days >= 5:
        flags.append({"kind": "inactive", "text": f"No logs for {inactive_days} days"})
    if plateau and fitness_view:
        flags.append({"kind": "plateau", "text": "Weight flat for 3 weeks"})
    if weight_change_7d is not None and fitness_view:
        if focus == "fat_loss" and weight_change_7d >= 0.5:
            flags.append({"kind": "off_track", "text": f"Weight up {weight_change_7d} kg this week"})
        if focus == "muscle_gain" and weight_change_7d <= -0.5:
            flags.append({"kind": "off_track", "text": f"Weight down {abs(weight_change_7d)} kg this week"})
    if focus in FITNESS_FOCUS and fitness_view and not foods_7d:
        flags.append({"kind": "no_food", "text": "No meals logged this week"})

    parts = []
    if weight_now is not None:
        parts.append(f"{weight_now} kg" + (f" ({'+' if weight_change_7d > 0 else ''}{weight_change_7d} this week)" if weight_change_7d not in (None, 0) else ""))
    parts.append(f"{len(sessions_7d)} workout{'s' if len(sessions_7d) != 1 else ''}")
    if focus in FITNESS_FOCUS and fitness_view:
        parts.append(f"{len(foods_7d)} meals logged" + (f", ~{avg_kcal} kcal/day" if avg_kcal else ""))

    kinds = {f["kind"] for f in flags}
    if "inactive" in kinds:
        suggestion = "Send a check-in message — they've gone quiet."
    elif "plateau" in kinds:
        suggestion = "Draft an adjustment: small calorie change or more training volume."
    elif "off_track" in kinds:
        suggestion = "Review their food logs and adjust the nutrition plan."
    elif "no_food" in kinds:
        suggestion = "Ask them to log meals so you can coach nutrition."
    else:
        suggestion = "On track — a quick word of encouragement goes a long way."

    return {
        "headline": " · ".join(parts), "flags": flags, "suggestion": suggestion,
        "weight": weight_now, "weight_change_7d": weight_change_7d, "workouts_7d": len(sessions_7d),
        "meals_7d": len(foods_7d), "avg_kcal": avg_kcal, "inactive_days": inactive_days, "plateau": plateau,
        "last_active": last_active.isoformat() if last_active else None,
    }


# ───────────────────────────── Coaching: plan drafting ─────────────────────────────
DIET_TEXT = {
    "veg": "vegetarian (lacto-vegetarian, no eggs)", "non_veg": "non-vegetarian", "eggetarian": "vegetarian plus eggs",
    "vegan": "vegan", "jain": "Jain (vegetarian, no onion, garlic or root vegetables)",
}
GOAL_TEXT = {"fat_loss": "fat loss", "muscle_gain": "muscle gain", "yoga": "yoga practice", "hybrid": "fitness plus yoga"}


def _profile_text(client: dict, latest: dict) -> str:
    it = client.get("intake") or {}
    bits = [f"Goal: {GOAL_TEXT.get(client.get('focus'), 'general fitness')}"]
    for key, label in (("age", "Age"), ("sex", "Sex"), ("height_cm", "Height (cm)"), ("target_weight_kg", "Target weight (kg)"),
                       ("experience", "Experience"), ("days_per_week", "Training days per week"), ("equipment", "Equipment"),
                       ("injuries", "Injuries/limitations"), ("allergies", "Allergies"), ("dislikes", "Dislikes")):
        if it.get(key):
            bits.append(f"{label}: {it[key]}")
    if it.get("diet"):
        bits.append(f"Diet: {DIET_TEXT.get(it['diet'], it['diet'])}")
    weight = latest.get("weight") or it.get("weight_kg")
    if weight:
        bits.append(f"Current weight (kg): {weight}")
    return "\n".join(bits)


def _ai_system(ptype: str) -> str:
    common = ("You draft plans that a certified human coach will review and approve before the client sees them. "
              "Respond ONLY with strict JSON, no prose. ")
    if ptype == "meal":
        return common + (
            "You are a sports dietitian in India. Build a one-day meal plan. Prefer foods common in Indian homes "
            "(dal, roti, rice, paneer, curd, sabzi, eggs/chicken/fish only if the diet allows) and respect the diet type strictly. "
            'Schema: {"title": string, "summary": string, "meals": [{"meal": "Breakfast"|"Lunch"|"Dinner"|"Snack", '
            '"name": string, "items": [string], "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}]}. '
            "Include Breakfast, Lunch, Dinner and 1-2 Snacks with clear portions.")
    if ptype == "yoga":
        return common + (
            "You are an experienced yoga teacher. Build a weekly yoga practice. "
            'Schema: {"title": string, "summary": string, "days": [{"name": string, "focus": string, '
            '"exercises": [{"name": pose name (English + Sanskrit), "sets": rounds as number, "reps": hold time like "30s" or "5 breaths", '
            '"rest": string, "notes": one alignment cue}]}]}. Respect injuries; offer gentler variations where needed.')
    return common + (
        "You are a strength and conditioning coach. Build a weekly training split. "
        'Schema: {"title": string, "summary": string, "days": [{"name": string, "focus": string, '
        '"exercises": [{"name": string, "sets": number, "reps": string like "8-10" or "45s", "rest": string like "90s", '
        '"notes": short form cue}]}]}. Match the number of days per week, equipment and experience; avoid movements '
        "that aggravate listed injuries.")


async def _ai_json(system: str, prompt: str, tag: str) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"{tag}-{uuid.uuid4().hex[:8]}",
                   system_message=system).with_model("gemini", GEMINI_MODEL)
    reply = await chat.send_message(UserMessage(text=prompt))
    return _extract_json(reply)


def _ex(name, sets, reps, rest="60s", notes=""):
    return {"name": name, "sets": sets, "reps": reps, "rest": rest, "notes": notes}


def _template_plan(ptype: str, client: dict) -> dict:
    """Starting point used when the AI is unavailable; the coach edits it before approving."""
    it = client.get("intake") or {}
    if ptype == "meal":
        diet = it.get("diet") or "veg"
        protein = {"non_veg": "Grilled chicken (150 g)", "eggetarian": "3-egg bhurji", "vegan": "Tofu bhurji (150 g)"}.get(diet, "Paneer bhurji (100 g)")
        return {"title": "Balanced day of eating", "summary": "Starter template — adjust portions to the client's target.", "meals": [
            {"meal": "Breakfast", "name": "Oats & protein", "items": ["Oats (50 g) with milk", "1 banana", "10 almonds"], "calories": 420, "protein_g": 18, "carbs_g": 62, "fat_g": 12},
            {"meal": "Lunch", "name": "Dal, roti, sabzi", "items": ["2 rotis", "1 bowl dal", "1 bowl seasonal sabzi", "Salad"], "calories": 560, "protein_g": 22, "carbs_g": 80, "fat_g": 14},
            {"meal": "Snack", "name": "Curd & fruit", "items": ["Curd (200 g)", "1 apple"], "calories": 220, "protein_g": 10, "carbs_g": 32, "fat_g": 6},
            {"meal": "Dinner", "name": "Protein & greens", "items": [protein, "1 roti", "Stir-fried vegetables"], "calories": 480, "protein_g": 32, "carbs_g": 36, "fat_g": 20},
        ]}
    if ptype == "yoga":
        return {"title": "Foundations flow", "summary": "Starter template — 3 sessions a week.", "days": [
            {"name": "Day 1", "focus": "Mobility", "exercises": [_ex("Sun Salutation A (Surya Namaskar A)", 5, "1 breath per move", "—", "Move with the breath"),
                                                                    _ex("Warrior II (Virabhadrasana II)", 2, "30s each side", "15s", "Front knee over ankle"),
                                                                    _ex("Triangle (Trikonasana)", 2, "30s each side", "15s", "Lengthen both sides of the waist")]},
            {"name": "Day 2", "focus": "Balance", "exercises": [_ex("Tree (Vrikshasana)", 2, "30s each side", "15s", "Press foot and leg together"),
                                                                   _ex("Chair (Utkatasana)", 3, "20s", "15s", "Weight in the heels"),
                                                                   _ex("Bridge (Setu Bandhasana)", 3, "30s", "15s", "Knees hip-width")]},
            {"name": "Day 3", "focus": "Recovery", "exercises": [_ex("Downward Dog (Adho Mukha Svanasana)", 3, "5 breaths", "—", "Hips high, heels reaching down"),
                                                                    _ex("Cobra (Bhujangasana)", 3, "20s", "15s", "Shoulders away from ears"),
                                                                    _ex("Child's Pose (Balasana)", 1, "2 min", "—", "Relax the jaw")]},
        ]}
    days = max(2, min(6, int(it.get("days_per_week") or 3)))
    home = it.get("equipment") in ("home", "bodyweight")
    lower = [_ex("Goblet Squat" if home else "Back Squat", 4, "8-10", "90s", "Chest up, knees track toes"),
             _ex("Romanian Deadlift", 3, "10", "90s", "Hinge at the hips, flat back"),
             _ex("Walking Lunge", 3, "10 each leg", "60s"), _ex("Plank", 3, "40s", "45s")]
    upper = [_ex("Push-ups" if home else "Bench Press", 4, "8-12", "90s"), _ex("Dumbbell Row", 3, "10 each side", "60s"),
             _ex("Shoulder Press", 3, "10", "60s"), _ex("Dead Bug", 3, "10 each side", "45s")]
    cardio = [_ex("Brisk walk or cycle", 1, "25 min", "—", "Conversational pace"), _ex("Mountain Climbers", 3, "30s", "30s")]
    rotation = [("Lower body", lower), ("Upper body", upper), ("Conditioning", cardio)]
    if client.get("focus") == "muscle_gain":
        rotation = [("Lower body", lower), ("Upper body", upper)]
    return {"title": f"{days}-day starter programme", "summary": "Starter template — adjust load and volume after the first week.",
            "days": [{"name": f"Day {i + 1}", "focus": rotation[i % len(rotation)][0], "exercises": rotation[i % len(rotation)][1]} for i in range(days)]}


def _num(v, cap=100000):
    try:
        return max(0, min(cap, round(float(v), 1)))
    except (TypeError, ValueError):
        return 0


def _txt(v, cap=160):
    return str(v if v is not None else "").strip()[:cap]


def _clean_plan(ptype: str, content: dict) -> dict:
    """Normalise AI or coach-edited plan content so the client UI can always render it."""
    if not isinstance(content, dict):
        raise HTTPException(status_code=400, detail="Invalid plan content")
    out = {"title": _txt(content.get("title"), 100) or PLAN_LABELS[ptype].capitalize(), "summary": _txt(content.get("summary"), 400)}
    if ptype == "meal":
        meals = []
        for m in (content.get("meals") or [])[:10]:
            if not isinstance(m, dict):
                continue
            items = [_txt(i, 120) for i in (m.get("items") or []) if _txt(i, 120)][:12]
            meals.append({"meal": _txt(m.get("meal"), 30) or "Meal", "name": _txt(m.get("name"), 80), "items": items,
                          **{k: _num(m.get(k), 5000) for k in ("calories", "protein_g", "carbs_g", "fat_g")}})
        out["meals"] = meals
        for k in ("calories", "protein_g", "carbs_g", "fat_g"):
            out[f"total_{k}"] = round(sum(m[k] for m in meals), 1)
        return out
    days = []
    for d in (content.get("days") or [])[:7]:
        if not isinstance(d, dict):
            continue
        exercises = []
        for e in (d.get("exercises") or [])[:15]:
            if isinstance(e, dict) and _txt(e.get("name"), 80):
                exercises.append({"name": _txt(e.get("name"), 80), "sets": _num(e.get("sets"), 50), "reps": _txt(e.get("reps"), 30),
                                  "rest": _txt(e.get("rest"), 20), "notes": _txt(e.get("notes"), 160)})
        days.append({"name": _txt(d.get("name"), 40) or f"Day {len(days) + 1}", "focus": _txt(d.get("focus"), 60), "exercises": exercises})
    out["days"] = days
    return out


def _plan_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@api_router.post("/coach/clients/{client_id}/plans/draft")
async def draft_plan(client_id: str, payload: PlanDraftRequest, user: User = Depends(require_role("trainer", "admin"))):
    if payload.type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid plan type")
    client_doc = await _client_access(user, client_id, PLAN_TYPES[payload.type])
    latest = await db.progress.find_one({"user_id": client_id, "weight": {"$ne": None}}, {"_id": 0}, sort=[("date", -1)]) or {}
    active = await db.plans.find_one({"client_id": client_id, "type": payload.type, "status": "active"}, {"_id": 0})
    notes = _txt(payload.notes, 500)

    prompt = f"Client profile:\n{_profile_text(client_doc, latest)}\n"
    if active:
        prompt += f"\nCurrent approved plan (revise it rather than starting over):\n{json.dumps(active['content'])[:4000]}\n"
    if notes:
        prompt += f"\nCoach instructions: {notes}\n"
    ai_generated, ai_note = True, ""
    try:
        content = await _ai_json(_ai_system(payload.type), prompt, f"plan-{payload.type}")
    except Exception as e:
        logger.warning("AI draft unavailable, using template: %s", e)
        content = active["content"] if active else _template_plan(payload.type, client_doc)
        ai_generated, ai_note = False, "AI was unavailable, so this draft starts from " + ("the current plan." if active else "a template.")

    doc = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": client_doc.get("name"),
        "coach_id": user.user_id, "coach_name": user.name, "type": payload.type, "status": "draft",
        "content": _clean_plan(payload.type, content), "reason": notes or None, "ai_generated": ai_generated,
        "ai_note": ai_note or None, "coach_note": None, "revises": active["id"] if active else None,
        "created_at": datetime.now(timezone.utc).isoformat(), "approved_at": None,
    }
    await db.plans.insert_one(dict(doc))
    return _plan_out(doc)


async def _editable_plan(plan_id: str, user: User) -> dict:
    plan = await db.plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if user.role not in ("trainer", "admin"):
        raise HTTPException(status_code=403, detail="Only coaches can change plans")
    await _client_access(user, plan["client_id"], PLAN_TYPES[plan["type"]])
    return plan


@api_router.put("/plans/{plan_id}")
async def update_plan(plan_id: str, payload: PlanUpdate, user: User = Depends(require_role("trainer", "admin"))):
    plan = await _editable_plan(plan_id, user)
    if plan["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only drafts can be edited — start a revision instead")
    content = dict(payload.content)
    if payload.title is not None:
        content["title"] = payload.title
    update = {"content": _clean_plan(plan["type"], content)}
    if payload.coach_note is not None:
        update["coach_note"] = _txt(payload.coach_note, 500) or None
    await db.plans.update_one({"id": plan_id}, {"$set": update})
    return _plan_out(await db.plans.find_one({"id": plan_id}, {"_id": 0}))


@api_router.post("/plans/{plan_id}/approve")
async def approve_plan(plan_id: str, user: User = Depends(require_role("trainer", "admin"))):
    plan = await _editable_plan(plan_id, user)
    if plan["status"] != "draft":
        raise HTTPException(status_code=409, detail="This plan is not a draft")
    if not (plan["content"].get("days") or plan["content"].get("meals")):
        raise HTTPException(status_code=400, detail="Add at least one day or meal before approving")
    now = datetime.now(timezone.utc).isoformat()
    await db.plans.update_many({"client_id": plan["client_id"], "type": plan["type"], "status": "active"},
                               {"$set": {"status": "archived", "archived_at": now}})
    await db.plans.update_one({"id": plan_id}, {"$set": {"status": "active", "approved_at": now,
                                                          "approved_by": user.user_id, "approved_by_name": user.name}})
    label = PLAN_LABELS[plan["type"]]
    body = f"{user.name} approved your new {label}." + (f" Why: {plan['reason']}" if plan.get("reason") else "")
    link = {"meal": "/meal-plans", "yoga": "/yoga"}.get(plan["type"], "/workouts")
    await push_notification(plan["client_id"], "Your plan was updated" if plan.get("revises") else "Your plan is ready", body, link)
    return _plan_out(await db.plans.find_one({"id": plan_id}, {"_id": 0}))


@api_router.post("/plans/{plan_id}/revise")
async def revise_plan(plan_id: str, user: User = Depends(require_role("trainer", "admin"))):
    """Copy an approved plan into a new draft so the coach can tweak it by hand."""
    plan = await _editable_plan(plan_id, user)
    existing = await db.plans.find_one({"client_id": plan["client_id"], "type": plan["type"], "status": "draft"}, {"_id": 0})
    if existing:
        return existing
    doc = {**plan, "id": str(uuid.uuid4()), "status": "draft", "coach_id": user.user_id, "coach_name": user.name,
           "ai_generated": False, "ai_note": None, "reason": None, "revises": plan["id"],
           "created_at": datetime.now(timezone.utc).isoformat(), "approved_at": None}
    for k in ("approved_by", "approved_by_name", "archived_at"):
        doc.pop(k, None)
    await db.plans.insert_one(dict(doc))
    return _plan_out(doc)


@api_router.delete("/plans/{plan_id}")
async def discard_plan(plan_id: str, user: User = Depends(require_role("trainer", "admin"))):
    plan = await _editable_plan(plan_id, user)
    if plan["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only drafts can be discarded")
    await db.plans.delete_one({"id": plan_id})
    return {"ok": True}


@api_router.get("/my/plans")
async def my_plans(user: User = Depends(require_role("client"))):
    docs = await db.plans.find({"client_id": user.user_id, "status": "active"}, {"_id": 0}).to_list(10)
    return {d["type"]: d for d in docs}


# ───────────────────────────── Coaching: coach views ─────────────────────────────
def _coach_public(u: Optional[dict]) -> Optional[dict]:
    if not u:
        return None
    return {"user_id": u["user_id"], "name": u.get("name"), "picture": u.get("picture"),
            "specialty": u.get("specialty") or "", "bio": u.get("bio") or "", "coach_type": u.get("coach_type") or "fitness"}


@api_router.get("/my/coaches")
async def my_coaches(user: User = Depends(require_role("client"))):
    out = {}
    for field, key in (("fitness_coach_id", "fitness"), ("yoga_coach_id", "yoga")):
        cid = getattr(user, field)
        out[key] = _coach_public(await db.users.find_one({"user_id": cid}, {"_id": 0})) if cid else None
    return {**out, "needs": _needs_coach(user.model_dump())}


async def _unread_count(client_id: str, coach_id: str, reader_id: str) -> int:
    return await db.messages.count_documents({"client_id": client_id, "coach_id": coach_id,
                                              "sender_id": {"$ne": reader_id}, "read_by": {"$ne": reader_id}})


@api_router.get("/coach/clients")
async def coach_clients(user: User = Depends(require_role("trainer", "admin"))):
    out = []
    for c in await _my_clients(user):
        cid = c["user_id"]
        plans = await db.plans.find({"client_id": cid, "status": {"$in": ["active", "draft"]}}, {"_id": 0, "type": 1, "status": 1}).to_list(20)
        plans = [p for p in plans if _sees_plan_type(user, c, p["type"])]
        out.append({
            "user_id": cid, "name": c.get("name"), "email": c.get("email"), "picture": c.get("picture"),
            "focus": c.get("focus"), "tracks": sorted(_coach_tracks(user.user_id, c)) if user.role == "trainer" else [],
            "active_plans": sorted({p["type"] for p in plans if p["status"] == "active"}),
            "draft_plans": sorted({p["type"] for p in plans if p["status"] == "draft"}),
            "unread": await _unread_count(cid, user.user_id, user.user_id) if user.role == "trainer" else 0,
            "pending_pose": await db.pose_checks.count_documents({"client_id": cid, "status": "pending"})
            if (user.role == "admin" or "yoga" in _coach_tracks(user.user_id, c)) else 0,
            "brief": await _client_brief(c, _fitness_view(user, c)),
        })
    return out


@api_router.get("/coach/clients/{client_id}")
async def coach_client_detail(client_id: str, user: User = Depends(require_role("trainer", "admin"))):
    c = await _client_access(user, client_id)
    progress = await db.progress.find({"user_id": client_id}, {"_id": 0}).to_list(500)
    progress.sort(key=lambda x: (x.get("date", ""), x.get("created_at", "")))
    photos = await db.progress_photos.find({"user_id": client_id, "is_deleted": {"$ne": True}}, {"_id": 0}).to_list(300)
    photos.sort(key=lambda x: (x.get("date", ""), x.get("created_at", "")))
    sessions = await db.workout_sessions.find({"user_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(30)
    foods = await db.food_logs.find({"user_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(40)
    plans = await db.plans.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(60)
    plans = [p for p in plans if _sees_plan_type(user, c, p["type"])]
    tracks = sorted(_coach_tracks(user.user_id, c)) if user.role == "trainer" else ["fitness", "yoga"]
    coaches = {k: _coach_public(await db.users.find_one({"user_id": c.get(f)}, {"_id": 0})) if c.get(f) else None
               for f, k in (("fitness_coach_id", "fitness"), ("yoga_coach_id", "yoga"))}
    pose_checks = []
    if "yoga" in tracks:
        pose_checks = await db.pose_checks.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    bq = {"user_id": client_id, "starts_at": {"$gte": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}}
    if user.role == "trainer":
        bq["trainer_id"] = user.user_id
    upcoming = await db.bookings.find(bq, {"_id": 0}).sort("starts_at", 1).to_list(20)
    return {"client": c, "tracks": tracks, "coaches": coaches, "brief": await _client_brief(c, _fitness_view(user, c)), "progress": progress, "pose_checks": pose_checks,
            "upcoming_sessions": upcoming,
            "photos": photos, "sessions": sessions, "food": foods, "plans": plans}


@api_router.get("/coach/attention")
async def coach_attention(user: User = Depends(require_role("trainer", "admin"))):
    """The coach's to-do list across all their clients, most urgent first."""
    items = []
    today = datetime.now(timezone.utc).date().isoformat()
    for c in await _my_clients(user):
        cid, name = c["user_id"], c.get("name")
        tracks = _coach_tracks(user.user_id, c) if user.role == "trainer" else set()
        types = [t for t, tr in PLAN_TYPES.items() if tr in tracks and
                 ((t != "yoga" and c.get("focus") in FITNESS_FOCUS) or (t == "yoga" and c.get("focus") in YOGA_FOCUS))]
        plans = await db.plans.find({"client_id": cid, "status": {"$in": ["active", "draft"]}}, {"_id": 0}).to_list(20)
        for p in plans:
            if p["status"] == "draft" and p["type"] in types:
                items.append({"id": f"draft-{p['id']}", "kind": "approve", "priority": 1, "client_id": cid, "client_name": name,
                              "text": f"{PLAN_LABELS[p['type']].capitalize()} draft waiting for your approval", "plan_id": p["id"], "plan_type": p["type"]})
        have = {p["type"] for p in plans}
        for t in types:
            if t not in have:
                items.append({"id": f"noplan-{cid}-{t}", "kind": "needs_plan", "priority": 2, "client_id": cid, "client_name": name,
                              "text": f"Needs a {PLAN_LABELS[t]}", "plan_type": t})
        if "yoga" in tracks or user.role == "admin":
            pending = await db.pose_checks.count_documents({"client_id": cid, "status": "pending"})
            if pending:
                items.append({"id": f"pose-{cid}", "kind": "pose_review", "priority": 1, "client_id": cid, "client_name": name,
                              "text": f"{pending} pose check{'s' if pending > 1 else ''} to review"})
        if user.role == "trainer":
            unread = await _unread_count(cid, user.user_id, user.user_id)
            if unread:
                items.append({"id": f"msg-{cid}", "kind": "message", "priority": 1, "client_id": cid, "client_name": name,
                              "text": f"{unread} unread message{'s' if unread > 1 else ''}"})
        brief = await _client_brief(c, _fitness_view(user, c))
        active_types = {p["type"] for p in plans if p["status"] == "active"}
        for f in brief["flags"]:
            item = {"id": f"{f['kind']}-{cid}", "kind": f["kind"], "priority": 3, "client_id": cid, "client_name": name,
                    "text": f["text"], "suggestion": brief["suggestion"]}
            if f["kind"] in ("plateau", "off_track") and "workout" in types and "meal" in active_types:
                item["plan_type"] = "meal"
                item["adjust_reason"] = f["text"]
            items.append(item)
    sessions = await db.bookings.find({"trainer_id": user.user_id, "date": today}, {"_id": 0}).to_list(50)
    for b in sessions:
        items.append({"id": f"session-{b['id']}", "kind": "session", "priority": 0, "client_id": b.get("user_id"),
                      "client_name": b.get("client_name"), "text": f"Session today at {b['time']}", "booking_id": b["id"]})
    items.sort(key=lambda i: (i["priority"], i.get("client_name") or ""))
    return items


# ───────────────────────────── Yoga pose checks ─────────────────────────────
MAX_SNAPSHOT_CHARS = 450_000  # ~330 KB image


def _pose_out(doc: dict, viewer: User) -> dict:
    doc.pop("_id", None)
    if viewer.role == "client" and doc.get("status") != "reviewed":
        # the client sees the automatic result as provisional until their coach confirms it
        doc["provisional"] = True
    return doc


@api_router.post("/pose-checks")
async def create_pose_check(payload: PoseCheckCreate, user: User = Depends(require_role("client"))):
    if user.focus not in YOGA_FOCUS or not user.yoga_coach_id:
        raise HTTPException(status_code=400, detail="Pose checks are reviewed by your yoga coach — one hasn't been assigned yet")
    snap = payload.snapshot
    if not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", snap or ""):
        raise HTTPException(status_code=400, detail="Invalid snapshot")
    if len(snap) > MAX_SNAPSHOT_CHARS:
        raise HTTPException(status_code=400, detail="Snapshot is too large")
    checks = [{"id": _txt(c.get("id"), 40), "label": _txt(c.get("label"), 60), "ok": bool(c.get("ok")),
               "value": _num(c.get("value"), 1000), "unit": _txt(c.get("unit"), 4), "cue": _txt(c.get("cue"), 160) or None}
              for c in payload.checks[:12] if isinstance(c, dict)]
    doc = {
        "id": str(uuid.uuid4()), "client_id": user.user_id, "client_name": user.name, "coach_id": user.yoga_coach_id,
        "pose": _txt(payload.pose, 30), "pose_label": _txt(payload.pose_label, 60),
        "score": max(0, min(100, payload.score)), "checks": checks, "flags": [_txt(f, 160) for f in payload.flags[:8] if _txt(f, 160)],
        "snapshot": snap, "frames": payload.frames, "plan_id": payload.plan_id, "status": "pending",
        "coach_verdict": None, "coach_flags": None, "coach_score": None, "coach_note": None,
        "created_at": datetime.now(timezone.utc).isoformat(), "reviewed_at": None,
    }
    await db.pose_checks.insert_one(dict(doc))
    await push_notification(user.yoga_coach_id, "Pose check to review",
                            f"{user.name} sent a {doc['pose_label']} check (auto score {doc['score']}).",
                            f"/trainer/clients/{user.user_id}?tab=pose")
    return _pose_out(doc, user)


@api_router.get("/pose-checks")
async def list_pose_checks(client_id: Optional[str] = None, user: User = Depends(get_current_user)):
    cid = user.user_id if user.role == "client" else client_id
    if not cid:
        raise HTTPException(status_code=400, detail="client_id is required")
    await _client_access(user, cid, "yoga" if user.role == "trainer" else None)
    docs = await db.pose_checks.find({"client_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [_pose_out(d, user) for d in docs]


@api_router.post("/pose-checks/{check_id}/review")
async def review_pose_check(check_id: str, payload: PoseReview, user: User = Depends(require_role("trainer", "admin"))):
    doc = await db.pose_checks.find_one({"id": check_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pose check not found")
    await _client_access(user, doc["client_id"], "yoga")
    if payload.verdict not in ("confirmed", "adjusted"):
        raise HTTPException(status_code=400, detail="Invalid verdict")
    update = {
        "status": "reviewed", "coach_verdict": payload.verdict, "reviewed_by": user.user_id, "reviewed_by_name": user.name,
        "coach_flags": [_txt(f, 160) for f in payload.flags[:8] if _txt(f, 160)],
        "coach_score": max(0, min(100, payload.score)) if payload.score is not None else doc["score"],
        "coach_note": _txt(payload.coach_note, 500) or None, "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.pose_checks.update_one({"id": check_id}, {"$set": update})
    fixes = len(update["coach_flags"])
    await push_notification(doc["client_id"], f"{user.name} reviewed your {doc['pose_label']}",
                            "Looking good — keep it up!" if not fixes else f"{fixes} thing{'s' if fixes > 1 else ''} to work on.", "/pose-check")
    return {**doc, **update}


# ───────────────────────────── Coaching: messages ─────────────────────────────
async def _thread_access(user: User, client_id: str, coach_id: str) -> dict:
    client_doc = await _client_access(user, client_id)
    if coach_id not in (client_doc.get("fitness_coach_id"), client_doc.get("yoga_coach_id")):
        raise HTTPException(status_code=404, detail="This coach is not assigned to the client")
    if user.role == "trainer" and user.user_id != coach_id:
        raise HTTPException(status_code=403, detail="Not your conversation")
    return client_doc


@api_router.get("/messages/{client_id}/{coach_id}")
async def list_messages(client_id: str, coach_id: str, user: User = Depends(get_current_user)):
    await _thread_access(user, client_id, coach_id)
    docs = await db.messages.find({"client_id": client_id, "coach_id": coach_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    if user.role != "admin":
        await db.messages.update_many({"client_id": client_id, "coach_id": coach_id, "read_by": {"$ne": user.user_id}},
                                      {"$addToSet": {"read_by": user.user_id}})
    return docs


@api_router.post("/messages/{client_id}/{coach_id}")
async def send_message(client_id: str, coach_id: str, payload: MessageCreate, user: User = Depends(get_current_user)):
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Admins can read but not post in coaching chats")
    await _thread_access(user, client_id, coach_id)
    body = payload.body.strip()
    if not (1 <= len(body) <= 2000):
        raise HTTPException(status_code=400, detail="Message must be 1–2000 characters")
    context = None
    if payload.context_type in ("food", "workout", "plan", "photo", "progress") and payload.context_id:
        context = {"type": payload.context_type, "id": _txt(payload.context_id, 60), "label": _txt(payload.context_label, 120)}
    doc = {"id": str(uuid.uuid4()), "client_id": client_id, "coach_id": coach_id, "sender_id": user.user_id,
           "sender_name": user.name, "sender_role": user.role, "body": body, "context": context,
           "read_by": [user.user_id], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.messages.insert_one(dict(doc))
    doc.pop("_id", None)
    recipient = coach_id if user.user_id == client_id else client_id
    link = f"/trainer/clients/{client_id}?tab=chat" if recipient == coach_id else f"/messages?coach={coach_id}"
    preview = body if len(body) <= 80 else body[:77] + "..."
    await db.notifications.delete_many({"user_id": recipient, "link": link, "read": False})  # one live notice per thread
    await push_notification(recipient, f"Message from {user.name}", preview, link)
    return doc


@api_router.get("/messages/unread")
async def unread_messages(user: User = Depends(get_current_user)):
    if user.role == "client":
        counts = {cid: await _unread_count(user.user_id, cid, user.user_id) for cid in _my_coach_ids(user)}
    elif user.role == "trainer":
        counts = {c["user_id"]: await _unread_count(c["user_id"], user.user_id, user.user_id) for c in await _my_clients(user)}
    else:
        counts = {}
    return {"total": sum(counts.values()), "threads": counts}


# ───────────────────────────── In-app video calls (WebRTC) ─────────────────────────────
# Media flows peer-to-peer between the two browsers. This server only relays the small
# connection messages (offer / answer / ICE candidates) and tracks who is in the room.
PRESENCE_TTL = timedelta(seconds=9)
RING_TIMEOUT = timedelta(seconds=45)
SIGNAL_TYPES = {"offer", "answer", "ice", "bye", "ready"}


class InstantCallRequest(BaseModel):
    peer_id: str


class SignalRequest(BaseModel):
    type: str
    payload: Optional[dict] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_fresh(ts: Optional[str], ttl: timedelta = PRESENCE_TTL) -> bool:
    dt = _parse_dt(ts)
    return bool(dt and datetime.now(timezone.utc) - dt < ttl)


def _call_out(call: dict, user: User) -> dict:
    call = {k: v for k, v in call.items() if k != "_id"}
    me_coach = user.user_id == call["coach_id"]
    peer_id = call["client_id"] if me_coach else call["coach_id"]
    call["me"] = user.user_id
    call["peer_id"] = peer_id
    call["peer_name"] = call["client_name"] if me_coach else call["coach_name"]
    call["role"] = "offerer" if me_coach else "answerer"  # the coach always starts the connection (no glare)
    call["peer_present"] = _is_fresh((call.get("present") or {}).get(peer_id))
    return call


async def _call_for(call_id: str, user: User) -> dict:
    call = await db.calls.find_one({"id": call_id}, {"_id": 0})
    if not call or user.user_id not in (call["client_id"], call["coach_id"]):
        raise HTTPException(status_code=404, detail="Call not found")
    return call


async def _pair(user: User, peer_id: str) -> tuple:
    """Return (client_doc, coach_doc) if user and peer are a client and one of their assigned coaches."""
    peer = await db.users.find_one({"user_id": peer_id}, {"_id": 0, "password_hash": 0})
    if not peer:
        raise HTTPException(status_code=404, detail="User not found")
    client_doc, coach_doc = (user.model_dump(), peer) if user.role == "client" else (peer, user.model_dump())
    if client_doc.get("role") != "client" or coach_doc.get("role") != "trainer" or \
            coach_doc["user_id"] not in (client_doc.get("fitness_coach_id"), client_doc.get("yoga_coach_id")):
        raise HTTPException(status_code=403, detail="You can only call your own coach or clients")
    return client_doc, coach_doc


def _new_call(client_doc: dict, coach_doc: dict, kind: str, created_by: str, booking_id: Optional[str] = None) -> dict:
    return {
        "id": str(uuid.uuid4()), "kind": kind, "booking_id": booking_id,
        "client_id": client_doc["user_id"], "client_name": client_doc.get("name"),
        "coach_id": coach_doc["user_id"], "coach_name": coach_doc.get("name"),
        "created_by": created_by, "status": "ringing" if kind == "instant" else "scheduled",
        "present": {}, "created_at": _now_iso(), "started_at": None, "ended_at": None,
    }


@api_router.get("/calls/ice")
async def call_ice_servers(user: User = Depends(get_current_user)):
    servers = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
    if TURN_URLS:
        servers.append({"urls": TURN_URLS, "username": TURN_USERNAME, "credential": TURN_CREDENTIAL})
    return {"iceServers": servers, "relay": bool(TURN_URLS)}


@api_router.post("/calls/instant")
async def start_instant_call(payload: InstantCallRequest, user: User = Depends(require_role("client", "trainer"))):
    client_doc, coach_doc = await _pair(user, payload.peer_id)
    # reuse a call between this pair that is still ringing or live
    recent = (datetime.now(timezone.utc) - RING_TIMEOUT).isoformat()
    existing = await db.calls.find_one({"client_id": client_doc["user_id"], "coach_id": coach_doc["user_id"], "kind": "instant",
                                        "status": {"$in": ["ringing", "active"]}, "created_at": {"$gt": recent}}, {"_id": 0})
    if existing:
        return _call_out(existing, user)
    call = _new_call(client_doc, coach_doc, "instant", user.user_id)
    call["present"] = {user.user_id: _now_iso()}
    await db.calls.insert_one(dict(call))
    return _call_out(call, user)


@api_router.post("/calls/booking/{booking_id}")
async def call_for_booking(booking_id: str, user: User = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking or user.user_id not in (booking.get("user_id"), booking.get("trainer_id")):
        raise HTTPException(status_code=404, detail="Session not found")
    call = await db.calls.find_one({"booking_id": booking_id}, {"_id": 0})
    if not call:
        client_doc = await db.users.find_one({"user_id": booking["user_id"]}, {"_id": 0}) or {"user_id": booking["user_id"], "name": booking.get("client_name")}
        coach_doc = await db.users.find_one({"user_id": booking["trainer_id"]}, {"_id": 0}) or {"user_id": booking["trainer_id"], "name": booking.get("trainer_name")}
        call = _new_call(client_doc, coach_doc, "scheduled", user.user_id, booking_id)
        call["date"], call["time"] = booking.get("date"), booking.get("time")
        await db.calls.insert_one(dict(call))
    return _call_out(call, user)


@api_router.get("/calls/{call_id}")
async def get_call(call_id: str, user: User = Depends(get_current_user)):
    return _call_out(await _call_for(call_id, user), user)


@api_router.post("/calls/{call_id}/join")
async def join_call(call_id: str, user: User = Depends(get_current_user)):
    call = await _call_for(call_id, user)
    if call["status"] in ("declined", "missed") and call["kind"] == "instant":
        raise HTTPException(status_code=410, detail="This call has ended")
    update = {f"present.{user.user_id}": _now_iso()}
    peer_id = call["client_id"] if user.user_id == call["coach_id"] else call["coach_id"]
    if call["status"] in ("ringing", "scheduled", "ended") and _is_fresh((call.get("present") or {}).get(peer_id)):
        update.update({"status": "active", "started_at": call.get("started_at") or _now_iso(), "ended_at": None})
    await db.calls.update_one({"id": call_id}, {"$set": update})
    # clear anything stale addressed to me from a previous attempt
    await db.call_signals.delete_many({"call_id": call_id, "to": user.user_id})
    if call["kind"] == "instant" and call["status"] == "ringing" and user.user_id == call["created_by"] and not call.get("notified"):
        await db.calls.update_one({"id": call_id}, {"$set": {"notified": True}})
        await push_notification(peer_id, f"Incoming call from {user.name}", "Tap to answer.", f"/call/live/{call_id}")
    return _call_out(await db.calls.find_one({"id": call_id}, {"_id": 0}), user)


@api_router.post("/calls/{call_id}/signal")
async def send_signal(call_id: str, payload: SignalRequest, user: User = Depends(get_current_user)):
    call = await _call_for(call_id, user)
    if payload.type not in SIGNAL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid signal")
    if len(json.dumps(payload.payload or {})) > 60_000:
        raise HTTPException(status_code=400, detail="Signal too large")
    to = call["client_id"] if user.user_id == call["coach_id"] else call["coach_id"]
    if payload.type == "offer":
        # a fresh offer supersedes anything the peer hasn't read yet from an older attempt
        await db.call_signals.delete_many({"call_id": call_id, "to": to})
    await db.call_signals.insert_one({"id": str(uuid.uuid4()), "call_id": call_id, "from": user.user_id, "to": to,
                                      "type": payload.type, "payload": payload.payload or {}, "created_at": _now_iso()})
    return {"ok": True}


@api_router.get("/calls/{call_id}/signals")
async def poll_signals(call_id: str, user: User = Depends(get_current_user)):
    """Heartbeat + mailbox: marks me present and returns (and removes) messages addressed to me."""
    call = await _call_for(call_id, user)
    peer_id = call["client_id"] if user.user_id == call["coach_id"] else call["coach_id"]
    update = {f"present.{user.user_id}": _now_iso()}
    peer_here = _is_fresh((call.get("present") or {}).get(peer_id))
    if peer_here and call["status"] != "active":
        update.update({"status": "active", "started_at": call.get("started_at") or _now_iso(), "ended_at": None})
    await db.calls.update_one({"id": call_id}, {"$set": update})
    docs = await db.call_signals.find({"call_id": call_id, "to": user.user_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    if docs:
        await db.call_signals.delete_many({"id": {"$in": [d["id"] for d in docs]}})
    status = update.get("status", call["status"])
    return {"signals": [{"type": d["type"], "payload": d["payload"]} for d in docs], "peer_present": peer_here, "status": status}


@api_router.post("/calls/{call_id}/leave")
async def leave_call(call_id: str, user: User = Depends(get_current_user)):
    call = await _call_for(call_id, user)
    peer_id = call["client_id"] if user.user_id == call["coach_id"] else call["coach_id"]
    update = {f"present.{user.user_id}": None}
    if call["status"] == "ringing" and call["kind"] == "instant":
        update["status"] = "missed"
        await push_notification(peer_id, f"Missed call from {user.name}", "Call them back from Messages or your dashboard.", "/dashboard" if user.role == "trainer" else f"/trainer/clients/{user.user_id}")
    elif call["status"] == "active" and not _is_fresh((call.get("present") or {}).get(peer_id)):
        update.update({"status": "ended", "ended_at": _now_iso()})
    await db.calls.update_one({"id": call_id}, {"$set": update})
    await db.call_signals.insert_one({"id": str(uuid.uuid4()), "call_id": call_id, "from": user.user_id, "to": peer_id,
                                      "type": "bye", "payload": {}, "created_at": _now_iso()})
    return {"ok": True}


@api_router.post("/calls/{call_id}/decline")
async def decline_call(call_id: str, user: User = Depends(get_current_user)):
    call = await _call_for(call_id, user)
    if call["status"] == "ringing" and user.user_id != call["created_by"]:
        await db.calls.update_one({"id": call_id}, {"$set": {"status": "declined", "ended_at": _now_iso()}})
        await db.call_signals.insert_one({"id": str(uuid.uuid4()), "call_id": call_id, "from": user.user_id, "to": call["created_by"],
                                          "type": "bye", "payload": {"reason": "declined"}, "created_at": _now_iso()})
    return {"ok": True}


@api_router.get("/calls-live")
async def calls_live(user: User = Depends(get_current_user)):
    """What the app shell polls: an incoming call to ring for, and booked sessions starting soon."""
    incoming = []
    recent = (datetime.now(timezone.utc) - RING_TIMEOUT).isoformat()
    async for c in db.calls.find({"status": "ringing", "kind": "instant", "created_at": {"$gt": recent},
                                  "$or": [{"client_id": user.user_id}, {"coach_id": user.user_id}]}, {"_id": 0}):
        if c["created_by"] != user.user_id and _is_fresh((c.get("present") or {}).get(c["created_by"])):
            incoming.append(_call_out(c, user))
    soon = []
    now = datetime.now(timezone.utc)
    window_start, window_end = (now - timedelta(minutes=60)).isoformat(), (now + timedelta(minutes=15)).isoformat()
    async for b in db.bookings.find({"$or": [{"user_id": user.user_id}, {"trainer_id": user.user_id}],
                                     "starts_at": {"$gte": window_start, "$lte": window_end}}, {"_id": 0}):
        starts = _parse_dt(b["starts_at"])
        mins = int((starts - now).total_seconds() // 60)
        mine_is_client = b["user_id"] == user.user_id
        soon.append({"booking_id": b["id"], "with": b.get("trainer_name") if mine_is_client else b.get("client_name"),
                     "date": b["date"], "time": b["time"], "minutes": mins})
    soon.sort(key=lambda x: x["minutes"])
    return {"incoming": incoming, "starting_soon": soon}


async def send_session_alerts():
    """In-app reminders to both sides about an hour and 10 minutes before each booked session."""
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(minutes=10)).isoformat()
    hour = (now + timedelta(minutes=60)).isoformat()
    async for b in db.bookings.find({"starts_at": {"$gt": now.isoformat(), "$lte": hour}}, {"_id": 0}):
        if b["starts_at"] <= soon and not b.get("alert_10_sent"):
            label, flags = "in 10 minutes", {"alert_10_sent": True, "alert_60_sent": True}
        elif not b.get("alert_60_sent"):
            label, flags = "in about an hour", {"alert_60_sent": True}
        else:
            continue
        await db.bookings.update_one({"id": b["id"]}, {"$set": flags})
        for uid, other in ((b["user_id"], b.get("trainer_name")), (b["trainer_id"], b.get("client_name"))):
            await push_notification(uid, f"Session {label}", f"Video session with {other} at {b['time']}. Join from the app.", f"/call/{b['id']}")

class PaymentOrderRequest(BaseModel):
    type: str  # "plan" or "session"
    plan_id: Optional[str] = None
    booking_id: Optional[str] = None


class PaymentVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def _razorpay_client():
    import razorpay
    return razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


@api_router.get("/payments/config")
async def payments_config(user: User = Depends(get_current_user)):
    return {
        "enabled": PAYMENTS_ENABLED,
        "key_id": RAZORPAY_KEY_ID if PAYMENTS_ENABLED else None,
        "plans": MEMBERSHIP_PLANS,
        "session_price_inr": SESSION_PRICE_INR,
        "currency": "INR",
    }


@api_router.post("/payments/order")
async def create_payment_order(payload: PaymentOrderRequest, user: User = Depends(get_current_user)):
    if not PAYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Payments are not configured yet. Add Razorpay keys to enable checkout.")

    if payload.type == "plan":
        plan = next((p for p in MEMBERSHIP_PLANS if p["id"] == payload.plan_id), None)
        if not plan:
            raise HTTPException(status_code=400, detail="Invalid plan")
        amount_inr = plan["price_inr"]
        ref = {"plan_id": plan["id"], "plan_name": plan["name"]}
    elif payload.type == "session":
        booking = await db.bookings.find_one({"id": payload.booking_id, "user_id": user.user_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=400, detail="Booking not found")
        if booking.get("paid"):
            raise HTTPException(status_code=409, detail="This session is already paid")
        amount_inr = SESSION_PRICE_INR
        ref = {"booking_id": payload.booking_id}
    else:
        raise HTTPException(status_code=400, detail="Invalid payment type")

    amount_paise = amount_inr * 100
    receipt = f"fc_{uuid.uuid4().hex[:16]}"
    order = None
    try:
        order = _razorpay_client().order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "payment_capture": 1,
        })
    except Exception as e:
        logger.exception("razorpay order failed")
        raise HTTPException(status_code=502, detail=f"Could not create payment order: {e}")

    await db.transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "order_id": order["id"],
        "type": payload.type,
        "ref": ref,
        "amount_inr": amount_inr,
        "status": "created",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return {"order_id": order["id"], "amount": amount_paise, "currency": "INR", "key_id": RAZORPAY_KEY_ID, "receipt": receipt}


@api_router.post("/payments/verify")
async def verify_payment(payload: PaymentVerifyRequest, user: User = Depends(get_current_user)):
    if not PAYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Payments are not configured")

    txn = await db.transactions.find_one({"order_id": payload.razorpay_order_id, "user_id": user.user_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    try:
        _razorpay_client().utility.verify_payment_signature({
            "razorpay_order_id": payload.razorpay_order_id,
            "razorpay_payment_id": payload.razorpay_payment_id,
            "razorpay_signature": payload.razorpay_signature,
        })
    except Exception:
        await db.transactions.update_one({"order_id": payload.razorpay_order_id}, {"$set": {"status": "failed"}})
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    await db.transactions.update_one(
        {"order_id": payload.razorpay_order_id},
        {"$set": {"status": "paid", "payment_id": payload.razorpay_payment_id, "paid_at": datetime.now(timezone.utc).isoformat()}},
    )

    if txn["type"] == "plan":
        plan = next((p for p in MEMBERSHIP_PLANS if p["id"] == txn["ref"].get("plan_id")), None)
        if plan:
            expires = datetime.now(timezone.utc) + timedelta(days=plan["days"])
            await db.users.update_one(
                {"user_id": user.user_id},
                {"$set": {"membership_plan": plan["id"], "membership_expires_at": expires.isoformat()}},
            )
    elif txn["type"] == "session":
        await db.bookings.update_one(
            {"id": txn["ref"].get("booking_id"), "user_id": user.user_id},
            {"$set": {"paid": True}},
        )

    return {"status": "success"}


@api_router.get("/payments/history")
async def payment_history(user: User = Depends(get_current_user)):
    docs = await db.transactions.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


@api_router.get("/admin/email/status")
async def admin_email_status(user: User = Depends(require_role("admin"))):
    return {
        "enabled": email_configured(),
        "from_address": GMAIL_ADDRESS if email_configured() else None,
        "smtp_host": SMTP_HOST,
        "reminder_hours_before": REMINDER_HOURS_BEFORE,
    }


class EmailTestRequest(BaseModel):
    to: EmailStr


@api_router.post("/admin/email/test")
async def admin_email_test(payload: EmailTestRequest, user: User = Depends(require_role("admin"))):
    if not email_configured():
        raise HTTPException(status_code=503, detail="Email is not configured. Add GMAIL_ADDRESS and GMAIL_APP_PASSWORD.")
    ok = await send_email(
        [payload.to], "FitCoach test email",
        "This is a test email from FitCoach. Email delivery is working.",
        _email_shell("Email is working", ["This is a test email from FitCoach.", "Your Gmail integration is set up correctly."]),
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send. Check the Gmail address and App Password.")
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "FitCoach API"}


@app.get("/")
async def app_root():
    return {"status": "ok", "service": "fitcoach-backend"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


app.include_router(api_router)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def create_indexes():
    try:
        await db.users.create_index("email", unique=True)
        await db.login_attempts.create_index("identifier", unique=True)
        await db.plans.create_index([("client_id", 1), ("type", 1), ("status", 1)])
        await db.messages.create_index([("client_id", 1), ("coach_id", 1), ("created_at", 1)])
        await db.pose_checks.create_index([("client_id", 1), ("created_at", -1)])
        await db.calls.create_index("id", unique=True)
        await db.call_signals.create_index([("call_id", 1), ("to", 1)])
    except Exception as e:
        logger.warning(f"Index creation skipped: {e}")
    await seed_roles()
    await migrate_v2()
    _start_scheduler()
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")




_scheduler = None


def _start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(send_due_reminders, "interval", minutes=5, id="reminders", replace_existing=True)
        _scheduler.add_job(send_session_alerts, "interval", minutes=1, id="session_alerts", replace_existing=True)
        _scheduler.start()
        logger.info("Reminder scheduler started (email_configured=%s)", email_configured())
    except Exception:
        logger.exception("Could not start reminder scheduler")


async def seed_roles():
      # Idempotent admin seeding
    admin = await db.users.find_one({"email": ADMIN_EMAIL})
    if not admin:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": ADMIN_EMAIL, "name": "Administrator",
            "role": "admin", "picture": None, "focus": None,
            "password_hash": hash_password(ADMIN_PASSWORD), "created_at": datetime.now(timezone.utc).isoformat(),
        })
    elif not verify_password(ADMIN_PASSWORD, admin.get("password_hash", "")):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin"}})


    # Demo trainers so booking works out of the box
    demo_trainers = [
        {"email": "sarah.trainer@fitcoach.com", "name": "Sarah Johnson", "specialty": "Strength & Conditioning", "coach_type": "fitness"},
        {"email": "mike.trainer@fitcoach.com", "name": "Mike Chen", "specialty": "Muscle Building & Fat Loss", "coach_type": "fitness"},
        {"email": "priya.trainer@fitcoach.com", "name": "Priya Sharma", "specialty": "Yoga & Flexibility", "coach_type": "yoga"},
    ]
    for t in demo_trainers:
        if not await db.users.find_one({"email": t["email"]}):
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": t["email"], "name": t["name"],
                "role": "trainer", "specialty": t["specialty"], "coach_type": t["coach_type"], "bio": f"Certified coach specialising in {t['specialty']}.",
                "available_days": list(DEFAULT_DAYS), "available_times": list(DEFAULT_TIMES), "picture": None, "focus": None,
                "password_hash": hash_password("Trainer@123"), "created_at": datetime.now(timezone.utc).isoformat(),
            })


async def migrate_v2():
    """Idempotent: map v1 programmes to v2 goals and give every trainer a coach type."""
    for old, new in LEGACY_FOCUS.items():
        await db.users.update_many({"focus": old}, {"$set": {"focus": new}})
    async for t in db.users.find({"role": "trainer", "coach_type": {"$in": [None, ""]}}, {"_id": 0}):
        ctype = "yoga" if "yoga" in (t.get("specialty") or "").lower() else "fitness"
        await db.users.update_one({"user_id": t["user_id"]}, {"$set": {"coach_type": ctype}})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
