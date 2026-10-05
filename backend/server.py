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
import hashlib
import gzip
import binascii
import base64
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import bcrypt
import jwt
import httpx
import engine
from pydantic import BaseModel, Field, ConfigDict, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# AI (Google Gemini API, called directly). Without a key, AI features fall back gracefully.
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '').strip()
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash').strip()
# Google Sign-In (OAuth client ID from Google Cloud Console). Leave empty to hide the Google button.
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
# Comma-separated frontend origins allowed to call the API (e.g. https://fitcoach.onrender.com).
CORS_ORIGINS = [o.strip().rstrip('/') for o in os.environ.get('CORS_ORIGINS', '').split(',') if o.strip()]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_DAYS = 7
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', '').strip()
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '').strip()
PAYMENTS_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

# The admin account comes only from these settings (nothing is created when they're unset).
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', '').strip().lower()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
# Demo trainers with a known password — for local development and tests only.
SEED_DEMO_DATA = os.environ.get('SEED_DEMO_DATA', 'false').lower() == 'true'


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
# Web Push (notifications when the app is closed). Keys are generated and stored in MongoDB automatically;
# set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (PEM) only if you want to manage them yourself.
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', '').strip()
# Optional TURN relay for calls on restrictive networks (STUN alone works for most home/mobile networks).
TURN_URLS = [u.strip() for u in os.environ.get('TURN_URLS', '').split(',') if u.strip()]
TURN_USERNAME = os.environ.get('TURN_USERNAME', '')
TURN_CREDENTIAL = os.environ.get('TURN_CREDENTIAL', '')
# Or a managed relay that issues short-lived credentials (both have free tiers):
METERED_DOMAIN = os.environ.get('METERED_DOMAIN', '').strip()            # e.g. yourapp.metered.live
METERED_API_KEY = os.environ.get('METERED_API_KEY', '').strip()
CLOUDFLARE_TURN_KEY_ID = os.environ.get('CLOUDFLARE_TURN_KEY_ID', '').strip()
CLOUDFLARE_TURN_API_TOKEN = os.environ.get('CLOUDFLARE_TURN_API_TOKEN', '').strip()


def booking_dt(date: str, time: str) -> datetime:
    """A booking's start as an aware datetime (raises ValueError on bad input)."""
    return datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M").replace(tzinfo=APP_TZ)

# Membership plans, prices and session packs live in MongoDB (Admin → Billing); defaults in DEFAULT_PLANS.

# ───────────────────────────── File storage (inside MongoDB) ─────────────────────────────
# Photos are small (≤5 MB), so each is kept as one binary document — no external bucket needed.
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
IMAGE_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


# ── File storage: S3-compatible object storage (Cloudflare R2, Backblaze B2, AWS S3) when configured,
# otherwise inside MongoDB. Object storage keeps the database small; files are still served through the API so
# the same access rules apply.
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "").strip()           # e.g. https://<account>.r2.cloudflarestorage.com
S3_BUCKET = os.environ.get("S3_BUCKET", "").strip()
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "").strip()
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "").strip()
S3_REGION = os.environ.get("S3_REGION", "auto").strip() or "auto"
_s3_client = None


def object_storage_enabled() -> bool:
    return bool(S3_BUCKET and S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY)


def _s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config
        _s3_client = boto3.client("s3", endpoint_url=S3_ENDPOINT or None, aws_access_key_id=S3_ACCESS_KEY_ID,
                                  aws_secret_access_key=S3_SECRET_ACCESS_KEY, region_name=S3_REGION,
                                  config=Config(signature_version="s3v4", retries={"max_attempts": 3}))
    return _s3_client


async def blob_put(path: str, data: bytes, content_type: str) -> str:
    """Save file bytes; returns where they went ("s3" or "db")."""
    if object_storage_enabled():
        await asyncio.to_thread(_s3().put_object, Bucket=S3_BUCKET, Key=path, Body=data, ContentType=content_type)
        return "s3"
    await db.file_blobs.insert_one({"storage_path": path, "data": data})
    return "db"


async def blob_get(path: str, store: Optional[str]) -> Optional[bytes]:
    if store == "s3":
        try:
            obj = await asyncio.to_thread(_s3().get_object, Bucket=S3_BUCKET, Key=path)
            return await asyncio.to_thread(obj["Body"].read)
        except Exception:
            logger.exception("Could not read %s from object storage", path)
            return None
    blob = await db.file_blobs.find_one({"storage_path": path})
    return bytes(blob["data"]) if blob else None


async def blob_delete(records: List[dict]):
    """Delete the bytes for these file records, wherever they're stored."""
    in_db = [r["storage_path"] for r in records if r.get("store", "db") != "s3"]
    in_s3 = [r["storage_path"] for r in records if r.get("store") == "s3"]
    if in_db:
        await db.file_blobs.delete_many({"storage_path": {"$in": in_db}})
    for i in range(0, len(in_s3), 1000):
        chunk = in_s3[i:i + 1000]
        try:
            await asyncio.to_thread(_s3().delete_objects, Bucket=S3_BUCKET, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})
        except Exception:
            logger.exception("Could not delete %s files from object storage", len(chunk))


async def store_image(file: "UploadFile", owner_id: str, kind: str) -> dict:
    """Validate an uploaded image and save it. Returns the files-registry record."""
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP or GIF images are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 5MB or smaller")
    path = f"{kind}/{owner_id}/{uuid.uuid4().hex}.{ext}"
    content_type = IMAGE_MIME.get(ext, "application/octet-stream")
    record = {
        "id": str(uuid.uuid4()), "storage_path": path, "owner_id": owner_id, "original_filename": file.filename,
        "content_type": content_type, "size": len(data), "kind": kind, "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    record["store"] = await blob_put(path, data, content_type)
    await db.files.insert_one(dict(record))
    record.pop("_id", None)
    return record


AUDIO_MIME = {"webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp4": "audio/mp4", "mp3": "audio/mpeg", "aac": "audio/aac", "wav": "audio/wav"}
MAX_VOICE_BYTES = 3 * 1024 * 1024
MAX_VOICE_SECONDS = 180


async def store_voice(file: "UploadFile", owner_id: str, allowed: List[str]) -> dict:
    """Save a chat voice note. Only the users in `allowed` (the two people in the thread) and admins can play it."""
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = next((e for e, m in AUDIO_MIME.items() if m == ctype), None)
    if not ext and "." in (file.filename or ""):
        ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in AUDIO_MIME:
        raise HTTPException(status_code=400, detail="Unsupported audio format")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty recording")
    if len(data) > MAX_VOICE_BYTES:
        raise HTTPException(status_code=400, detail="Voice notes can be up to 3 minutes")
    path = f"voice/{owner_id}/{uuid.uuid4().hex}.{ext}"
    record = {
        "id": str(uuid.uuid4()), "storage_path": path, "owner_id": owner_id, "original_filename": file.filename,
        "content_type": AUDIO_MIME[ext], "size": len(data), "kind": "voice", "allowed": allowed, "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    record["store"] = await blob_put(path, data, AUDIO_MIME[ext])
    await db.files.insert_one(dict(record))
    record.pop("_id", None)
    return record


def file_url(path: str) -> str:
    # Relative URL; the frontend prefixes the API host and adds the viewer's token.
    return f"/api/files/{path}"


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
        "iat": int(datetime.now(timezone.utc).timestamp()),
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
    session_credits: Optional[int] = None
    subscription_status: Optional[str] = None
    referral_code: Optional[str] = None
    consents: Optional[dict] = None
    must_change_password: Optional[bool] = None
    created_at: Optional[str] = None


class AuthResponse(User):
    access_token: Optional[str] = None


class GoogleLoginRequest(BaseModel):
    credential: str
    referral_code: Optional[str] = None
    consent: bool = False          # health-data consent ticked on the sign-up form
    photo_consent: bool = False
    marketing: bool = False


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
    referral_code: Optional[str] = None
    consent: bool = False
    photo_consent: bool = False
    marketing: bool = False


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
    force: bool = False  # assign even if the coach is at their client limit


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
    status: str = "confirmed"   # "requested" = a trial client's intro session waiting for the coach
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
    client_ref: Optional[str] = None   # set by the app so a meal logged offline is only saved once when it syncs
    logged_at: Optional[str] = None    # when it was eaten/logged on the device (offline logs sync later)


class MyFoodIn(BaseModel):
    id: Optional[str] = None           # the app may create the id offline
    name: str
    aliases: List[str] = []
    unit: Optional[str] = None
    grams: Optional[float] = None
    kcal: float
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


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
async def _user_from_jwt(token: str) -> Optional[User]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    user_doc = await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})
    if not user_doc:
        return None
    changed = _parse_dt(user_doc.get("password_changed_at"))
    if changed and int(payload.get("iat") or 0) < int(changed.timestamp()):
        return None  # signed in before a password reset — sign in again
    return User(**user_doc)


def _cookie_ok(request: Request) -> bool:
    """Only trust the login cookie on requests from our own site (blocks cross-site request forgery)."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin:
        return origin in CORS_ORIGINS or origin == str(request.base_url).rstrip("/")
    return request.headers.get("sec-fetch-site", "same-origin") in ("same-origin", "same-site", "none")


async def get_current_user(
    request: Request,
    access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> User:
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization.split(" ", 1)[1]
    # The app sends a Bearer token (works across separate frontend/backend domains);
    # the httpOnly cookie is a fallback for same-site use only, so another website can't act as a signed-in user.
    for candidate in (bearer, access_token if _cookie_ok(request) else None):
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


# ───────────────────────────── Billing: plans, memberships, packs, referrals, payouts ─────────────────────────────
DEFAULT_PLANS = [
    {"id": "monthly", "name": "Monthly", "price_inr": 15000, "days": 30, "period": "monthly", "interval": 1,
     "included_sessions": 4, "unlimited_sessions": False, "featured": False, "active": True, "sort": 1,
     "blurb": "Full access, billed monthly",
     "features": ["Your own assigned coach", "Coach-approved training & nutrition", "4 video sessions a month", "Progress tracking"]},
    {"id": "quarterly", "name": "Quarterly", "price_inr": 30000, "days": 90, "period": "monthly", "interval": 3,
     "included_sessions": 24, "unlimited_sessions": False, "featured": True, "active": True, "sort": 2,
     "blurb": "Save with a 3-month commitment",
     "features": ["Everything in Monthly", "2 video sessions a week", "Priority booking", "Pose checks reviewed by your coach"]},
    {"id": "annual", "name": "Annual", "price_inr": 85000, "days": 365, "period": "yearly", "interval": 1,
     "included_sessions": 0, "unlimited_sessions": True, "featured": False, "active": True, "sort": 3,
     "blurb": "Best value — a full year of coaching",
     "features": ["Everything in Quarterly", "Unlimited video sessions", "Quarterly assessments", "Best value"]},
]
DEFAULT_BILLING = {
    "session_price_inr": 1000, "trial_days": 7, "grace_days": 3,
    "referral_reward_days": 7, "referee_bonus_days": 7,
    "payout_per_client_inr": 0, "payout_per_session_inr": 0,
    "trial_features": ["workouts", "messages", "food"], "trial_session_credits": 1, "trial_intro_approval": True,
    "packs": [
        {"id": "pack5", "name": "5 sessions", "sessions": 5, "price_inr": 4500, "active": True},
        {"id": "pack10", "name": "10 sessions", "sessions": 10, "price_inr": 8500, "active": True},
    ],
}
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
PERIODS = {"weekly", "monthly", "yearly"}
MEMBERSHIP_REQUIRED = "Your membership has ended — renew to keep working with your coach."
TRIAL_LOCKED = "This isn't part of the free trial — choose a plan to unlock it."
# What a free-trial client can use; the admin picks which of these the trial includes.
TRIAL_FEATURES = {
    "workouts": "Training & yoga plans", "messages": "Chat with your coach", "food": "Food tracking",
    "meal_plans": "Nutrition plans", "pose_check": "Yoga pose checks", "calls": "Instant video calls",
}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:40] or uuid.uuid4().hex[:8]


async def billing_settings() -> dict:
    doc = await db.app_settings.find_one({"_id": "billing"}, {"_id": 0}) or {}
    return {**DEFAULT_BILLING, **doc}


async def list_plans(include_inactive: bool = False) -> List[dict]:
    q = {} if include_inactive else {"active": True}
    return await db.membership_plans.find(q, {"_id": 0}).sort("sort", 1).to_list(50)


async def get_plan(plan_id: str) -> Optional[dict]:
    return await db.membership_plans.find_one({"id": plan_id}, {"_id": 0})


async def seed_billing():
    if not await db.membership_plans.count_documents({}):
        for p in DEFAULT_PLANS:
            await db.membership_plans.insert_one(dict(p))


def membership_status(u: dict, settings: dict) -> dict:
    now = datetime.now(timezone.utc)
    exp = _parse_dt(u.get("membership_expires_at"))
    active = bool(exp and exp > now)
    grace_until = exp + timedelta(days=int(settings.get("grace_days") or 0)) if exp else None
    in_grace = bool(not active and grace_until and now < grace_until)
    unlimited = _parse_dt(u.get("unlimited_sessions_until"))
    return {
        "plan": u.get("membership_plan"), "expires_at": u.get("membership_expires_at"),
        "active": active, "in_grace": in_grace, "has_access": active or in_grace or u.get("role") != "client",
        "is_trial": u.get("membership_plan") == "trial",
        "days_left": max(0, int((exp - now).total_seconds() // 86400) + 1) if active else 0,
        "grace_until": grace_until.isoformat() if grace_until else None,
        "credits": int(u.get("session_credits") or 0),
        "unlimited_sessions": bool(unlimited and unlimited > now),
        "auto_renew": u.get("subscription_status") == "active",
        "subscription_status": u.get("subscription_status"),
        "trial_features": list(settings.get("trial_features") or []) if u.get("membership_plan") == "trial" else None,
    }


async def require_member(user: User = Depends(get_current_user)) -> User:
    """Clients need an active membership (or grace period) for coaching features. Coaches/admins pass through."""
    if user.role == "client":
        doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
        if not membership_status(doc, await billing_settings())["has_access"]:
            raise HTTPException(status_code=402, detail=MEMBERSHIP_REQUIRED)
    return user


async def check_feature(user: User, feature: str):
    """Membership gate plus the free-trial feature list (clients only)."""
    if user.role != "client":
        return
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    settings = await billing_settings()
    st = membership_status(doc, settings)
    if not st["has_access"]:
        raise HTTPException(status_code=402, detail=MEMBERSHIP_REQUIRED)
    if st["is_trial"] and feature not in (settings.get("trial_features") or []):
        raise HTTPException(status_code=402, detail=TRIAL_LOCKED)


def require_feature(feature: str):
    async def dep(user: User = Depends(get_current_user)) -> User:
        await check_feature(user, feature)
        return user
    return dep


async def activate_membership(user_id: str, plan: dict, source: str, ref: Optional[str] = None, notify: bool = True) -> str:
    """Add a plan's duration on top of any remaining time; grant included sessions. Returns the new expiry."""
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc)
    current = _parse_dt(u.get("membership_expires_at"))
    start = current if current and current > now else now
    new_exp = start + timedelta(days=int(plan["days"]))
    update = {"$set": {"membership_plan": plan["id"], "membership_expires_at": new_exp.isoformat()}}
    if plan.get("unlimited_sessions"):
        update["$set"]["unlimited_sessions_until"] = new_exp.isoformat()
    elif plan.get("included_sessions"):
        update["$inc"] = {"session_credits": int(plan["included_sessions"])}
    await db.users.update_one({"user_id": user_id}, update)
    await db.membership_events.insert_one({"id": str(uuid.uuid4()), "user_id": user_id, "plan_id": plan["id"], "source": source,
                                           "ref": ref, "days": plan["days"], "expires_at": new_exp.isoformat(), "created_at": _now_iso()})
    if notify and plan["id"] != "trial":
        await push_notification(user_id, "Membership active", f"{plan['name']} — active until {new_exp.astimezone(APP_TZ).strftime('%d %b %Y')}.", "/membership")
    return new_exp.isoformat()


async def start_trial(user_id: str, bonus_days: int = 0):
    s = await billing_settings()
    days = int(s.get("trial_days") or 0) + int(bonus_days or 0)
    if days > 0:
        await activate_membership(user_id, {"id": "trial", "name": "Free trial", "days": days}, "trial", notify=False)
        intro = int(s.get("trial_session_credits") or 0)
        if intro > 0:
            await db.users.update_one({"user_id": user_id}, {"$inc": {"session_credits": intro}})
    await db.users.update_one({"user_id": user_id}, {"$set": {"trial_granted": True}})


async def ensure_referral_code(user_id: str) -> str:
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "referral_code": 1}) or {}
    if u.get("referral_code"):
        return u["referral_code"]
    for _ in range(5):
        code = secrets.token_hex(3).upper()
        if not await db.users.find_one({"referral_code": code}):
            await db.users.update_one({"user_id": user_id}, {"$set": {"referral_code": code}})
            return code
    raise HTTPException(status_code=500, detail="Could not create a referral code")


async def apply_referral_on_signup(user_id: str, code: Optional[str]) -> int:
    """Link a new client to their referrer. Returns bonus trial days for the new client."""
    code = (code or "").strip().upper()
    if not code:
        return 0
    referrer = await db.users.find_one({"referral_code": code}, {"_id": 0, "user_id": 1})
    if not referrer or referrer["user_id"] == user_id:
        return 0
    await db.users.update_one({"user_id": user_id}, {"$set": {"referred_by": referrer["user_id"]}})
    await db.referrals.insert_one({"id": str(uuid.uuid4()), "referrer_id": referrer["user_id"], "referee_id": user_id,
                                   "code": code, "status": "signed_up", "created_at": _now_iso()})
    return int((await billing_settings()).get("referee_bonus_days") or 0)


async def reward_referrer_on_first_payment(user_id: str):
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}
    if not u.get("referred_by") or u.get("referral_rewarded"):
        return
    await db.users.update_one({"user_id": user_id}, {"$set": {"referral_rewarded": True}})
    days = int((await billing_settings()).get("referral_reward_days") or 0)
    referrer = await db.users.find_one({"user_id": u["referred_by"]}, {"_id": 0})
    if referrer and days > 0 and referrer.get("role") == "client":
        await activate_membership(referrer["user_id"], {"id": referrer.get("membership_plan") or "referral",
                                                        "name": "Referral reward", "days": days}, "referral", ref=user_id, notify=False)
        await push_notification(referrer["user_id"], "You earned a free week", f"{u.get('name')} joined with your code — {days} days added to your membership.", "/membership")
    await db.referrals.update_one({"referee_id": user_id}, {"$set": {"status": "rewarded", "rewarded_at": _now_iso()}})


async def record_payment_effects(txn: dict):
    """Apply what a successful payment buys. Idempotent per transaction."""
    claimed = await db.transactions.update_one({"id": txn["id"], "applied": {"$ne": True}}, {"$set": {"applied": True}})
    if not claimed.modified_count:
        return
    ref = txn.get("ref") or {}
    if txn["type"] in ("plan", "subscription"):
        plan = await get_plan(ref.get("plan_id"))
        if plan:
            await activate_membership(txn["user_id"], plan, txn["type"], ref=txn.get("payment_id"))
    elif txn["type"] == "pack":
        await db.users.update_one({"user_id": txn["user_id"]}, {"$inc": {"session_credits": int(ref.get("sessions") or 0)}})
        await push_notification(txn["user_id"], "Sessions added", f"{ref.get('sessions')} session credits are ready to book.", "/booking")
    elif txn["type"] == "session":
        await db.bookings.update_one({"id": ref.get("booking_id"), "user_id": txn["user_id"]}, {"$set": {"paid": True, "paid_via": "payment"}})
    if txn["type"] in ("plan", "subscription", "pack"):
        await reward_referrer_on_first_payment(txn["user_id"])


async def pay_for_booking_from_balance(client_doc: dict, booking_doc: dict) -> Optional[str]:
    """Cover a new booking with an unlimited membership or a session credit. Returns how it was paid, if at all."""
    unlimited = _parse_dt(client_doc.get("unlimited_sessions_until"))
    starts = _parse_dt(booking_doc.get("starts_at"))
    if unlimited and starts and unlimited >= starts:
        return "membership"
    res = await db.users.update_one({"user_id": client_doc["user_id"], "session_credits": {"$gte": 1}}, {"$inc": {"session_credits": -1}})
    return "credit" if res.modified_count else None



_bg_tasks: set = set()  # keep references so background pushes aren't garbage-collected mid-flight


async def push_notification(user_id: str, title: str, body: str, link: str = "", push: Optional[dict] = None):
    """Store an in-app notification and also deliver it as a Web Push to the user's devices."""
    if not user_id:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "title": title, "body": body,
        "link": link, "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    payload = {"title": title, "body": body, "url": link or "/", "tag": (push or {}).get("tag") or link or title, **(push or {})}
    task = asyncio.create_task(send_web_push(user_id, payload))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


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


def app_url(request: Optional[Request] = None) -> str:
    """The website's address for links in emails: APP_URL, else the first CORS origin, else the caller's origin."""
    url = os.environ.get("APP_URL", "").strip() or os.environ.get("APP_ORIGIN", "").strip()
    if not url and CORS_ORIGINS:
        url = CORS_ORIGINS[0]
    if not url and request is not None:
        url = request.headers.get("origin") or str(request.base_url)
    return url.rstrip("/")


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
    cursor = db.bookings.find({"reminder_email_sent": {"$ne": True}, "reminder_at": {"$lte": now_iso, "$ne": ""}, "status": {"$ne": "requested"}})
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


# Who runs the service — shown on the legal and contact pages. Consumer protection (e-commerce) rules
# expect the seller's name, address, contact details and grievance officer to be published.
LEGAL_INFO = {
    "business_name": os.environ.get("BUSINESS_NAME", "").strip(),          # your full legal name (or business name)
    "business_address": os.environ.get("BUSINESS_ADDRESS", "").strip(),    # correspondence address
    "contact_phone": os.environ.get("CONTACT_PHONE", "").strip(),
    "grievance_officer": os.environ.get("GRIEVANCE_OFFICER", "").strip(),  # name of the person handling complaints
    "jurisdiction_city": os.environ.get("JURISDICTION_CITY", "").strip(),  # city whose courts handle disputes
    "gstin": os.environ.get("GSTIN", "").strip(),                          # leave empty if not GST-registered
    # Exact certifications your coaches actually hold, e.g. "ACE CPT · ISSA Nutritionist · YCB Level 2" —
    # shown on the sign-in page. Only list ones you can show proof of.
    "coach_credentials": os.environ.get("COACH_CREDENTIALS", "").strip(),
}
LEGAL_REQUIRED = ("business_name", "business_address", "grievance_officer", "jurisdiction_city")


@api_router.get("/legal")
async def legal_info():
    contact = PRIVACY_CONTACT_EMAIL or ADMIN_EMAIL or ""
    return {**LEGAL_INFO, "contact_email": contact, "ai_enabled": bool(GEMINI_API_KEY),
            "missing": [k for k in LEGAL_REQUIRED if not LEGAL_INFO[k]] + ([] if contact else ["contact_email"])}


@api_router.get("/auth/config")
async def auth_config():
    """Public settings the login page needs at runtime."""
    return {"google_client_id": GOOGLE_CLIENT_ID or None, "privacy_contact": PRIVACY_CONTACT_EMAIL or ADMIN_EMAIL or None,
            "consent_version": CONSENT_VERSION}


@api_router.post("/auth/google", response_model=AuthResponse)
async def google_login(payload: GoogleLoginRequest, response: Response):
    """Sign in with a Google ID token from Google Identity Services (no third-party auth broker)."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": payload.credential})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Couldn't reach Google. Please try again.")
    info = r.json() if r.status_code == 200 else {}
    if (info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
            or str(info.get("email_verified")).lower() != "true" or not info.get("email")):
        raise HTTPException(status_code=401, detail="Google sign-in failed")
    email = info["email"].lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        update = {"google_sub": info.get("sub")}
        if not existing.get("picture") and info.get("picture"):
            update["picture"] = info["picture"]
        await db.users.update_one({"user_id": user_id}, {"$set": update})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": info.get("name") or email, "role": "client",
            "picture": info.get("picture"), "focus": None, "google_sub": info.get("sub"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await start_trial(user_id, bonus_days=await apply_referral_on_signup(user_id, payload.referral_code))
        await on_client_signup(user_id, email)
    if payload.consent:
        await record_consent(user_id, health=True, photos=payload.photo_consent, marketing=payload.marketing, only_if_missing=True)
    token = create_access_token(user_id, email)
    set_access_cookie(response, token)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return AuthResponse(**user_doc, access_token=token)


@api_router.get("/auth/me", response_model=User)
async def auth_me(user: User = Depends(get_current_user)):
    return user


@api_router.post("/auth/register", response_model=AuthResponse)
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
    await start_trial(user_id, bonus_days=await apply_referral_on_signup(user_id, payload.referral_code))
    await on_client_signup(user_id, email)
    if payload.consent:
        await record_consent(user_id, health=True, photos=payload.photo_consent, marketing=payload.marketing)
    token = create_access_token(user_id, email)
    set_access_cookie(response, token)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return AuthResponse(**user_doc, access_token=token)


@api_router.post("/auth/login", response_model=AuthResponse)
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
    return AuthResponse(**user_doc, access_token=token)


@api_router.post("/auth/logout")
async def logout(response: Response):
    # Tokens are stateless JWTs; the app also forgets its stored token.
    response.delete_cookie("access_token", path="/", secure=True, samesite="none")
    return {"ok": True}


# ───────────────────────────── Password reset ─────────────────────────────
RESET_TTL = timedelta(hours=1)


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_reset_link(user: dict, request: Optional[Request], created_by: str, ip_key: Optional[str] = None) -> str:
    """One-time link valid for an hour. Only a hash of the token is stored."""
    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({"id": str(uuid.uuid4()), "user_id": user["user_id"], "token_hash": _hash_token(token),
                                         "created_by": created_by, "ip_key": ip_key, "used": False, "created_at": _now_iso(),
                                         "expires_at": (datetime.now(timezone.utc) + RESET_TTL).isoformat()})
    return f"{app_url(request)}/reset-password?token={token}"


@api_router.post("/auth/forgot")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    """Email a reset link. Always answers the same way so nobody can test which emails have accounts."""
    email = (payload.email or "").strip().lower()
    ok = {"ok": True, "email_enabled": email_configured()}
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return ok
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    ip_key = f"reset:{hashlib.sha256(get_client_ip(request).encode()).hexdigest()[:16]}"
    if await db.password_resets.count_documents({"ip_key": ip_key, "created_at": {"$gte": hour_ago}}) >= 10:
        return ok
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        await db.password_resets.insert_one({"id": str(uuid.uuid4()), "ip_key": ip_key, "created_at": _now_iso(), "used": True})
        return ok
    if await db.password_resets.count_documents({"user_id": user["user_id"], "created_at": {"$gte": hour_ago}}) >= 3:
        return ok
    link = await create_reset_link(user, request, "self", ip_key)
    first = (user.get("name") or "there").split(" ")[0]
    await send_email([email], "Reset your FitCoach password",
                     f"Hi {first}, use this link within an hour to choose a new password: {link}\n\nIf you didn't ask for this, ignore this email.",
                     _email_shell("Reset your password", [f"Hi {first},", "Someone (hopefully you) asked to reset your FitCoach password. "
                                  "The link works once, for the next hour.", "If you didn't ask for this, you can ignore this email — your password won't change."],
                                  "Choose a new password", link))
    return ok


@api_router.post("/auth/reset")
async def reset_password(payload: ResetPasswordRequest):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    rec = await db.password_resets.find_one({"token_hash": _hash_token(payload.token or ""), "used": False}, {"_id": 0})
    expires = _parse_dt(rec.get("expires_at")) if rec else None
    if not rec or not expires or expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired or was already used. Ask for a new one.")
    user = await db.users.find_one({"user_id": rec["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is no longer valid.")
    await db.password_resets.update_many({"user_id": user["user_id"]}, {"$set": {"used": True}})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": hash_password(payload.password),
                                                                     "password_changed_at": _now_iso()}})
    await db.login_attempts.delete_many({"identifier": {"$regex": f":{re.escape(user['email'])}$"}})
    await push_notification(user["user_id"], "Password changed", "Your FitCoach password was just changed. If this wasn't you, contact us.", "/profile")
    return {"ok": True, "email": user["email"]}


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = None
    new_password: str


@api_router.get("/auth/password")
async def password_status(user: User = Depends(get_current_user)):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "password_hash": 1, "google_sub": 1}) or {}
    return {"has_password": bool(doc.get("password_hash")), "google": bool(doc.get("google_sub")),
            "is_main_admin": user.role == "admin" and user.email == ADMIN_EMAIL}


@api_router.put("/auth/password")
async def change_password(payload: ChangePasswordRequest, response: Response, user: User = Depends(get_current_user)):
    """Change your password while signed in (or add one if you joined with Google). Other devices are signed out."""
    min_len = 10 if user.role == "admin" else 8
    if len(payload.new_password) < min_len:
        raise HTTPException(status_code=400, detail=f"New password must be at least {min_len} characters")
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "password_hash": 1}) or {}
    if doc.get("password_hash") and not verify_password(payload.current_password or "", doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Your current password isn't right")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"password_hash": hash_password(payload.new_password),
                                                                  "password_changed_at": _now_iso(), "must_change_password": False}})
    await db.password_resets.update_many({"user_id": user.user_id}, {"$set": {"used": True}})
    await db.audit_log.insert_one({"id": str(uuid.uuid4()), "action": "password_changed", "user_id": user.user_id, "by": user.user_id, "at": _now_iso()})
    token = create_access_token(user.user_id, user.email)  # keep this device signed in
    set_access_cookie(response, token)
    return {"ok": True, "access_token": token}


class AdminSetPassword(BaseModel):
    new_password: str


@api_router.post("/admin/users/{target_id}/password")
async def admin_set_password(target_id: str, payload: AdminSetPassword, user: User = Depends(require_role("admin"))):
    """Give someone a temporary password (e.g. a coach without email). They're signed out everywhere and must
    choose their own password the next time they sign in."""
    if target_id == user.user_id:
        raise HTTPException(status_code=400, detail="Change your own password from the Password card instead")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin" and target.get("email") == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="The main admin changes their own password")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Temporary password must be at least 8 characters")
    await db.users.update_one({"user_id": target_id}, {"$set": {"password_hash": hash_password(payload.new_password),
                                                                "password_changed_at": _now_iso(), "must_change_password": True}})
    await db.password_resets.update_many({"user_id": target_id}, {"$set": {"used": True}})
    await db.login_attempts.delete_many({"identifier": {"$regex": f":{re.escape(target.get('email') or '')}$"}})
    await db.audit_log.insert_one({"id": str(uuid.uuid4()), "action": "temporary_password_set", "user_id": target_id, "by": user.user_id, "at": _now_iso()})
    await push_notification(target_id, "Your password was reset", f"{user.name} set a temporary password for you. You'll choose a new one when you sign in.", "/profile")
    return {"ok": True}


@api_router.post("/admin/users/{target_id}/reset-link")
async def admin_reset_link(target_id: str, request: Request, user: User = Depends(require_role("admin"))):
    """For when email isn't set up: the admin copies the link and sends it to the person directly."""
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["user_id"] == user.user_id:
        raise HTTPException(status_code=400, detail="Change your own admin password with ADMIN_PASSWORD on the server")
    return {"link": await create_reset_link(target, request, f"admin:{user.user_id}"), "expires_in_minutes": int(RESET_TTL.total_seconds() // 60)}


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
        entry = ProgressEntry(user_id=user.user_id, date=datetime.now(APP_TZ).date().isoformat(), weight=payload.weight_kg)
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
    record = await store_image(file, user.user_id, "avatar")
    picture_url = file_url(record["storage_path"])
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"picture": picture_url}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


@api_router.get("/files/{path:path}")
async def serve_file(path: str,
                     access_token: Optional[str] = Cookie(None),
                     authorization: Optional[str] = Header(None),
                     auth: Optional[str] = Query(None)):
    # <img> tags can't send headers, so the app appends ?auth=<token>; Bearer and cookie also work.
    viewer = None
    bearer = authorization.split(" ", 1)[1] if authorization and authorization.startswith("Bearer ") else None
    for cand in (auth, bearer, access_token):
        if cand and (viewer := await _user_from_jwt(cand)):
            break
    if not viewer:
        raise HTTPException(status_code=401, detail="Not authenticated")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    owner = record.get("owner_id")
    if record.get("allowed") is not None:
        if viewer.role != "admin" and viewer.user_id not in record["allowed"]:
            raise HTTPException(status_code=404, detail="File not found")
    elif record.get("kind") != "avatar" and viewer.role != "admin" and viewer.user_id != owner:
        owner_doc = await db.users.find_one({"user_id": owner}, {"_id": 0, "fitness_coach_id": 1, "yoga_coach_id": 1}) or {}
        if viewer.user_id not in (owner_doc.get("fitness_coach_id"), owner_doc.get("yoga_coach_id")):
            raise HTTPException(status_code=404, detail="File not found")
    data = await blob_get(path, record.get("store"))
    if data is None:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=record.get("content_type", "application/octet-stream"),
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
    soon = datetime.now(timezone.utc) + timedelta(minutes=15)  # don't offer times that have passed or start in a moment

    def upcoming(t: str) -> bool:
        try:
            return booking_dt(date, t) > soon
        except ValueError:
            return False
    return {"slots": [t for t in times if t not in taken and upcoming(t)]}


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
    fresh_client = await db.users.find_one({"user_id": client_doc["user_id"]}, {"_id": 0}) or client_doc
    paid_via = await pay_for_booking_from_balance(fresh_client, doc)
    if paid_via:
        doc.update({"paid": True, "paid_via": paid_via})
        booking.paid = True
    settings = await billing_settings()
    needs_ok = (not scheduled_by and fresh_client.get("membership_plan") == "trial" and settings.get("trial_intro_approval", True))
    doc["status"] = booking.status = "requested" if needs_ok else "confirmed"
    await db.bookings.insert_one(doc)
    when = f"{date} at {time}"
    if needs_ok:
        await push_notification(client_doc["user_id"], "Intro session requested", f"{trainer.get('name')} will confirm {when} shortly.", "/booking")
        await push_notification(trainer["user_id"], "Intro session request", f"{client_doc.get('name')} (free trial) asked for {when}. Confirm or decline.", "/trainer")
        return booking
    if scheduled_by:
        await push_notification(client_doc["user_id"], "Session scheduled", f"{trainer.get('name')} scheduled a video session on {when}.", "/booking")
    else:
        await push_notification(client_doc["user_id"], "Session booked", f"With {booking.trainer_name} on {when}.", "/booking")
        await push_notification(trainer["user_id"], "New booking", f"{client_doc.get('name')} booked {when}.", "/trainer")
    origin = app_url(request)
    background.add_task(send_booking_emails, booking.model_dump(), origin)
    return booking


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, request: Request, background: BackgroundTasks, user: User = Depends(get_current_user)):
    trainer = await db.users.find_one({"user_id": payload.trainer_id, "role": "trainer"}, {"_id": 0})
    if not trainer:
        raise HTTPException(status_code=400, detail="Invalid trainer")
    if user.role == "client" and payload.trainer_id not in _my_coach_ids(user):
        raise HTTPException(status_code=403, detail="You can only book sessions with your own coach")
    if user.role == "client":
        me = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
        st = membership_status(me, await billing_settings())
        if not st["has_access"] and st["credits"] < 1:
            raise HTTPException(status_code=402, detail=MEMBERSHIP_REQUIRED)
        if st["is_trial"] and st["credits"] < 1 and not st["unlimited_sessions"]:
            raise HTTPException(status_code=402, detail="You've used your free intro session — get a session pack or choose a plan to book more.")
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
    booking = await db.bookings.find_one({"id": booking_id, "user_id": user.user_id}, {"_id": 0})
    if not booking:
        return {"ok": True}
    await db.bookings.delete_one({"id": booking_id, "user_id": user.user_id})
    starts = _parse_dt(booking.get("starts_at"))
    refunded = booking.get("paid_via") == "credit" and starts and starts > datetime.now(timezone.utc)
    if refunded:
        await db.users.update_one({"user_id": user.user_id}, {"$inc": {"session_credits": 1}})
    return {"ok": True, "credit_refunded": bool(refunded)}


class BookingDecision(BaseModel):
    approve: bool
    note: Optional[str] = None


@api_router.post("/bookings/{booking_id}/decision")
async def decide_booking(booking_id: str, payload: BookingDecision, user: User = Depends(require_role("trainer", "admin"))):
    """Coach confirms or declines a trial client's intro session. Declining returns their free session credit."""
    booking = await db.bookings.find_one({"id": booking_id, "status": "requested"}, {"_id": 0})
    if not booking or (user.role == "trainer" and booking["trainer_id"] != user.user_id):
        raise HTTPException(status_code=404, detail="No pending request found")
    note = _txt(payload.note, 200)
    when = f"{booking['date']} at {booking['time']}"
    if payload.approve:
        await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "confirmed", "confirmed_at": _now_iso()}})
        await push_notification(booking["user_id"], "Intro session confirmed", f"{booking['trainer_name']} will see you on {when}." + (f" “{note}”" if note else ""), "/booking")
        return {"ok": True, "status": "confirmed"}
    await db.bookings.delete_one({"id": booking_id})
    if booking.get("paid_via") == "credit":
        await db.users.update_one({"user_id": booking["user_id"]}, {"$inc": {"session_credits": 1}})
    await push_notification(booking["user_id"], "Please pick another time", f"{booking['trainer_name']} can't do {when}. Your free session is back — book another slot."
                            + (f" “{note}”" if note else ""), "/booking")
    return {"ok": True, "status": "declined"}


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
    update, notices = {}, []
    for field, ctype in (("fitness_coach_id", "fitness"), ("yoga_coach_id", "yoga")):
        if field not in payload.model_fields_set:
            continue
        coach_id = getattr(payload, field) or None
        if coach_id:
            coach = await db.users.find_one({"user_id": coach_id, "role": "trainer"}, {"_id": 0})
            if not coach or (coach.get("coach_type") or "fitness") != ctype:
                raise HTTPException(status_code=400, detail=f"Pick a {ctype} coach")
            if client_doc.get(field) != coach_id:
                limit = int(coach.get("max_clients") or 30)
                load = await db.users.count_documents({"role": "client", "$or": [{"fitness_coach_id": coach_id}, {"yoga_coach_id": coach_id}]})
                if load >= limit and not payload.force:
                    raise HTTPException(status_code=409, detail=f"{coach.get('name')} already has {load} of {limit} clients. "
                                                                f"Assign anyway, raise their limit, or pick another coach.")
                notices.append((coach, ctype))
        update[field] = coach_id
    for coach, ctype in notices:  # only notify once everything checked out
        await push_notification(coach["user_id"], "New client assigned", f"{client_doc.get('name')} is now your client.", f"/trainer/clients/{target_id}")
        await push_notification(target_id, "Your coach is here", f"{coach.get('name')} is now your {ctype} coach.", "/dashboard")
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
        await db.users.update_one({"user_id": target_id}, {"$set": {"membership_plan": None, "membership_expires_at": None, "unlimited_sessions_until": None}})
        await push_notification(target_id, "Membership updated", "Your membership was cancelled by an administrator.", "/membership")
        return {"ok": True, "membership_plan": None}
    plan = await get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan")
    expires = await activate_membership(target_id, plan, "admin", ref=user.user_id)
    return {"ok": True, "membership_plan": plan["id"], "membership_expires_at": expires}


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
        user_id=user.user_id, date=datetime.now(APP_TZ).date().isoformat(),
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
    await require_photo_consent(user)
    record = await store_image(file, user.user_id, "progress")
    stored_path = record["storage_path"]
    url = file_url(stored_path)
    weight_val = None
    try:
        if weight not in (None, ""):
            weight_val = float(weight)
    except ValueError:
        weight_val = None
    doc = {
        "id": str(uuid.uuid4()), "user_id": user.user_id, "url": url, "storage_path": stored_path,
        "date": (date or datetime.now(APP_TZ).date().isoformat())[:10],
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
        rec = await db.files.find_one({"storage_path": photo["storage_path"]}, {"_id": 0, "storage_path": 1, "store": 1})
        await db.files.update_one({"storage_path": photo["storage_path"]}, {"$set": {"is_deleted": True}})
        if rec:
            await blob_delete([rec])
    return {"ok": True}


# ───────────────────────────── Workouts ─────────────────────────────
@api_router.get("/workouts/plan")
async def workout_plan(type: str = "workout", user: User = Depends(require_member)):
    await check_feature(user, "meal_plans" if type == "meal" else "workouts")
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
async def analyze_food(payload: FoodAnalyzeRequest, user: User = Depends(require_feature("food"))):
    description = payload.description.strip()
    if not (2 <= len(description) <= 1000):
        raise HTTPException(status_code=400, detail="Describe your meal in a few words (up to 1000 characters)")
    client_ref = _txt(payload.client_ref, 64) or None
    if client_ref:
        existing = await db.food_logs.find_one({"user_id": user.user_id, "client_ref": client_ref}, {"_id": 0})
        if existing:
            return existing  # already synced
    now = datetime.now(timezone.utc)
    logged = _parse_dt(payload.logged_at) if payload.logged_at else None
    created = logged if logged and now - timedelta(days=14) <= logged <= now + timedelta(minutes=5) else now
    result = None
    if GEMINI_API_KEY:  # optional AI estimate; the food table below needs no key
        system = (
            "You are a nutrition analysis engine. Given a meal description, estimate nutrition. "
            "Respond ONLY with strict JSON, no prose, using this schema: "
            '{"meal_name": string, "items": [string], "calories": number, "protein_g": number, '
            '"carbs_g": number, "fat_g": number, "health_score": number (0-100), "notes": string}'
        )
        try:
            result = await _ai_json(system, f"Meal: {description}", f"food-{user.user_id}")
        except Exception:
            logger.warning("AI food estimate failed; using the food table", exc_info=True)
    if result is None:
        my_foods = await db.user_foods.find({"user_id": user.user_id}, {"_id": 0}).to_list(500)
        result = engine.analyze_meal(description, my_foods)
        if not result:
            raise HTTPException(status_code=400, detail="We couldn't recognise those foods. Try simple names with amounts, "
                                                        "like “2 roti, 1 katori dal, 1 bowl sabzi”.")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "description": description,
        "result": result,
        "client_ref": client_ref,
        "created_at": created.isoformat(),
    }
    await db.food_logs.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/me/foods")
async def my_foods(user: User = Depends(get_current_user)):
    return await db.user_foods.find({"user_id": user.user_id}, {"_id": 0, "user_id": 0}).sort("name", 1).to_list(500)


@api_router.post("/me/foods")
async def save_my_food(payload: MyFoodIn, user: User = Depends(get_current_user)):
    """Teach the food estimator a dish it doesn't know (e.g. a family recipe). Used for this person only."""
    name = _txt(payload.name, 60)
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Give the food a name")
    if not (0 <= payload.kcal <= 3000) or any(not (0 <= v <= 300) for v in (payload.protein_g, payload.carbs_g, payload.fat_g)):
        raise HTTPException(status_code=400, detail="Check the numbers — calories up to 3000, macros up to 300 g per serving")
    food_id = re.sub(r"[^a-zA-Z0-9-]", "", payload.id or "")[:40] or str(uuid.uuid4())
    existing = await db.user_foods.find_one({"id": food_id}, {"_id": 0, "user_id": 1})
    if existing and existing["user_id"] != user.user_id:
        raise HTTPException(status_code=409, detail="Try again")
    if not existing and await db.user_foods.count_documents({"user_id": user.user_id}) >= 200:
        raise HTTPException(status_code=400, detail="You can save up to 200 foods")
    aliases = [a for a in (re.sub(r"[^a-z ]", "", _txt(x, 40).lower()).strip() for x in [name] + payload.aliases[:6]) if len(a) >= 2]
    doc = {"id": food_id, "user_id": user.user_id, "name": name, "aliases": list(dict.fromkeys(aliases)),
           "unit": _txt(payload.unit, 30) or "serving", "grams": _num(payload.grams, 2000) or None,
           "kcal": round(payload.kcal), "protein_g": round(payload.protein_g, 1), "carbs_g": round(payload.carbs_g, 1),
           "fat_g": round(payload.fat_g, 1), "updated_at": _now_iso()}
    await db.user_foods.update_one({"id": food_id}, {"$set": doc, "$setOnInsert": {"created_at": _now_iso()}}, upsert=True)
    doc.pop("user_id")
    return doc


@api_router.delete("/me/foods/{food_id}")
async def delete_my_food(food_id: str, user: User = Depends(get_current_user)):
    await db.user_foods.delete_one({"id": food_id, "user_id": user.user_id})
    return {"ok": True}


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
    week_start = (datetime.now(APP_TZ).date() - timedelta(days=6)).isoformat()
    daily = await db.daily_logs.find({"user_id": cid, "date": {"$gte": week_start}}, {"_id": 0}).to_list(14)
    checkins = [d["checkin"] for d in daily if d.get("checkin")]

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
    stamps += [_parse_dt(d.get("updated_at")) for d in daily]
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

    def avg(key):
        vals = [c[key] for c in checkins if isinstance(c.get(key), (int, float))]
        return round(sum(vals) / len(vals), 1) if vals else None
    wellbeing = {k: avg(k) for k in CHECKIN_FIELDS}
    if len(checkins) >= 3:
        if wellbeing["sleep"] is not None and wellbeing["sleep"] <= 2.2:
            flags.append({"kind": "poor_sleep", "text": "Sleeping poorly this week"})
        if wellbeing["energy"] is not None and wellbeing["energy"] <= 2.2:
            flags.append({"kind": "low_energy", "text": "Low energy this week"})
        if wellbeing["soreness"] is not None and wellbeing["soreness"] >= 4:
            flags.append({"kind": "sore", "text": "Very sore most days"})
        if wellbeing["mood"] is not None and wellbeing["mood"] <= 2.2:
            flags.append({"kind": "low_mood", "text": "Mood has been low"})
    targets = client.get("daily_targets") or []
    target_days = [d for d in daily if d.get("targets")]
    hits = sum(1 for d in daily for t in targets if (d.get("targets") or {}).get(t["id"]))
    targets_pct = round(100 * hits / (len(targets) * 7)) if targets else None

    parts = []
    if weight_now is not None:
        parts.append(f"{weight_now} kg" + (f" ({'+' if weight_change_7d > 0 else ''}{weight_change_7d} this week)" if weight_change_7d not in (None, 0) else ""))
    parts.append(f"{len(sessions_7d)} workout{'s' if len(sessions_7d) != 1 else ''}")
    if focus in FITNESS_FOCUS and fitness_view:
        parts.append(f"{len(foods_7d)} meals logged" + (f", ~{avg_kcal} kcal/day" if avg_kcal else ""))

    if checkins:
        parts.append(f"{len(checkins)}/7 check-ins")
    if targets_pct is not None:
        parts.append(f"{targets_pct}% of targets hit")

    kinds = {f["kind"] for f in flags}
    if "inactive" in kinds:
        suggestion = "Send a check-in message — they've gone quiet."
    elif kinds & {"poor_sleep", "low_energy", "sore"}:
        suggestion = "Recovery looks low — consider a lighter week and ask how they're sleeping."
    elif "low_mood" in kinds:
        suggestion = "Their mood has dipped — a personal voice note can help."
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
        "checkins_7d": len(checkins), "wellbeing": wellbeing, "targets_pct": targets_pct, "targets_hit": hits, "target_days": len(target_days),
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
    """Ask Gemini for a JSON answer. Raises if AI isn't configured or the reply isn't valid JSON."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(url, json=body, headers={"x-goog-api-key": GEMINI_API_KEY})
    if r.status_code != 200:
        raise RuntimeError(f"Gemini error {r.status_code} ({tag}): {r.text[:200]}")
    parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts") or []
    return _extract_json("".join(p.get("text", "") for p in parts))


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

    content, ai_generated, source = None, False, "engine"
    if GEMINI_API_KEY:  # optional: only used when you've added a key
        prompt = f"Client profile:\n{_profile_text(client_doc, latest)}\n"
        if active:
            prompt += f"\nCurrent approved plan (revise it rather than starting over):\n{json.dumps(active['content'])[:4000]}\n"
        if notes:
            prompt += f"\nCoach instructions: {notes}\n"
        try:
            content, ai_generated, source = await _ai_json(_ai_system(payload.type), prompt, f"plan-{payload.type}"), True, "ai"
        except Exception as e:
            logger.warning("AI draft unavailable, using the built-in plan engine: %s", e)
    if content is None:
        # built-in engine: free, no API key; a fresh variation each time the coach re-drafts
        seed = int(hashlib.sha256(client_id.encode()).hexdigest()[:8], 16) + await db.plans.count_documents({"client_id": client_id, "type": payload.type})
        content = engine.build_plan(payload.type, client_doc, latest.get("weight"), notes, seed, active["content"] if active else None)
    ai_note = ("Drafted by the built-in plan builder from the client's intake" + (" and your note" if notes else "")
               + (" — progressed from the current plan" if active and payload.type != "meal" and not notes else "")
               + ". Check it fits them, then approve.") if source == "engine" else ""

    doc = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": client_doc.get("name"),
        "coach_id": user.user_id, "coach_name": user.name, "type": payload.type, "status": "draft",
        "content": _clean_plan(payload.type, content), "reason": notes or None, "ai_generated": ai_generated, "source": source,
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
async def my_plans(user: User = Depends(require_member)):
    docs = await db.plans.find({"client_id": user.user_id, "status": "active"}, {"_id": 0}).to_list(10)
    me = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    if me.get("membership_plan") == "trial":  # plans outside the trial stay hidden until they join
        allowed = (await billing_settings()).get("trial_features") or []
        docs = [d for d in docs if ("meal_plans" if d["type"] == "meal" else "workouts") in allowed]
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
    since = (datetime.now(APP_TZ).date() - timedelta(days=13)).isoformat()
    daily = await db.daily_logs.find({"user_id": client_id, "date": {"$gte": since}}, {"_id": 0}).sort("date", 1).to_list(20)
    return {"client": c, "tracks": tracks, "coaches": coaches, "daily": daily, "today": _today(), "targets": c.get("daily_targets") or [], "brief": await _client_brief(c, _fitness_view(user, c)), "progress": progress, "pose_checks": pose_checks,
            "upcoming_sessions": upcoming,
            "photos": photos, "sessions": sessions, "food": foods, "plans": plans}


@api_router.get("/coach/attention")
async def coach_attention(user: User = Depends(require_role("trainer", "admin"))):
    """The coach's to-do list across all their clients, most urgent first."""
    items = []
    today = datetime.now(APP_TZ).date().isoformat()
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
    requests_ = await db.bookings.find({"trainer_id": user.user_id, "status": "requested"}, {"_id": 0}).to_list(50)
    for b in requests_:
        items.append({"id": f"request-{b['id']}", "kind": "session_request", "priority": 0, "client_id": b.get("user_id"),
                      "client_name": b.get("client_name"), "text": f"Intro session request · {b['date']} at {b['time']}", "booking_id": b["id"]})
    sessions = await db.bookings.find({"trainer_id": user.user_id, "date": today, "status": {"$ne": "requested"}}, {"_id": 0}).to_list(50)
    for b in sessions:
        items.append({"id": f"session-{b['id']}", "kind": "session", "priority": 0, "client_id": b.get("user_id"),
                      "client_name": b.get("client_name"), "text": f"Session today at {b['time']}", "booking_id": b["id"]})
    items.sort(key=lambda i: (i["priority"], i.get("client_name") or ""))
    return items


# ───────────────────────────── Daily check-ins & targets ─────────────────────────────
CHECKIN_FIELDS = ("sleep", "energy", "soreness", "mood")
MAX_TARGETS = 8


class CheckinIn(BaseModel):
    sleep: int = Field(ge=1, le=5)
    energy: int = Field(ge=1, le=5)
    soreness: int = Field(ge=1, le=5)
    mood: int = Field(ge=1, le=5)
    note: Optional[str] = None


class TargetTick(BaseModel):
    done: bool = True
    value: Optional[float] = None


class TargetItem(BaseModel):
    id: Optional[str] = None
    label: str
    goal: Optional[float] = None
    unit: Optional[str] = None


class TargetsIn(BaseModel):
    targets: List[TargetItem]


def _today() -> str:
    return datetime.now(APP_TZ).date().isoformat()


async def _streak(user_id: str) -> int:
    """Consecutive days with a check-in, ending today (or yesterday if today isn't done yet)."""
    docs = await db.daily_logs.find({"user_id": user_id, "checkin": {"$ne": None}}, {"_id": 0, "date": 1}).to_list(400)
    dates = {d["date"] for d in docs}
    day = datetime.now(APP_TZ).date()
    if day.isoformat() not in dates:
        day -= timedelta(days=1)
    n = 0
    while day.isoformat() in dates:
        n += 1
        day -= timedelta(days=1)
    return n


async def _today_out(user_id: str) -> dict:
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "daily_targets": 1}) or {}
    log = await db.daily_logs.find_one({"user_id": user_id, "date": _today()}, {"_id": 0}) or {}
    return {"date": _today(), "checkin": log.get("checkin"), "targets": u.get("daily_targets") or [],
            "done": log.get("targets") or {}, "streak": await _streak(user_id)}


@api_router.get("/today")
async def get_today(user: User = Depends(require_role("client"))):
    return await _today_out(user.user_id)


@api_router.put("/today/checkin")
async def save_checkin(payload: CheckinIn, user: User = Depends(require_role("client"))):
    now = _now_iso()
    checkin = {**{k: getattr(payload, k) for k in CHECKIN_FIELDS}, "note": _txt(payload.note, 280) or None, "at": now}
    first = not await db.daily_logs.find_one({"user_id": user.user_id, "date": _today(), "checkin": {"$ne": None}})
    await db.daily_logs.update_one({"user_id": user.user_id, "date": _today()},
                                   {"$set": {"checkin": checkin, "updated_at": now}}, upsert=True)
    if first and (payload.energy == 1 or payload.mood == 1 or payload.soreness == 5 or payload.sleep == 1):
        low = [label for key, label, bad in (("sleep", "slept badly", 1), ("energy", "very low energy", 1),
                                             ("soreness", "very sore", 5), ("mood", "low mood", 1)) if getattr(payload, key) == bad]
        for coach_id in _my_coach_ids(user):
            await push_notification(coach_id, f"{user.name} checked in", f"Today: {', '.join(low)}." +
                                    (f" “{checkin['note']}”" if checkin["note"] else ""), f"/trainer/clients/{user.user_id}")
    return await _today_out(user.user_id)


@api_router.put("/today/targets/{target_id}")
async def tick_target(target_id: str, payload: TargetTick, user: User = Depends(require_role("client"))):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "daily_targets": 1}) or {}
    if not any(t["id"] == target_id for t in doc.get("daily_targets") or []):
        raise HTTPException(status_code=404, detail="Target not found")
    op = {"$set": {f"targets.{target_id}": payload.value if payload.value is not None else True, "updated_at": _now_iso()}} if payload.done \
        else {"$unset": {f"targets.{target_id}": ""}, "$set": {"updated_at": _now_iso()}}
    await db.daily_logs.update_one({"user_id": user.user_id, "date": _today()}, op, upsert=True)
    return await _today_out(user.user_id)


@api_router.put("/coach/clients/{client_id}/targets")
async def set_targets(client_id: str, payload: TargetsIn, user: User = Depends(require_role("trainer", "admin"))):
    await _client_access(user, client_id)
    if len(payload.targets) > MAX_TARGETS:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_TARGETS} daily targets")
    targets = []
    for t in payload.targets:
        label = _txt(t.label, 40)
        if not label:
            continue
        targets.append({"id": _txt(t.id, 40) or uuid.uuid4().hex[:10], "label": label,
                        "goal": _num(t.goal) if t.goal not in (None, "") else None, "unit": _txt(t.unit, 12) or None,
                        "set_by": user.name})
    await db.users.update_one({"user_id": client_id}, {"$set": {"daily_targets": targets}})
    if targets:
        await push_notification(client_id, "New daily targets", f"{user.name} set your daily targets: " +
                                ", ".join(t["label"] for t in targets[:3]) + ("…" if len(targets) > 3 else ""), "/dashboard")
    return {"targets": targets}


@api_router.get("/me/week")
async def my_week(user: User = Depends(require_role("client"))):
    """Numbers for the shareable weekly progress card."""
    doc = await db.users.find_one({"user_id": user.user_id}, CLIENT_PUBLIC)
    brief = await _client_brief(doc)
    coach = None
    for f in ("fitness_coach_id", "yoga_coach_id"):
        if doc.get(f):
            coach = (await db.users.find_one({"user_id": doc[f]}, {"_id": 0, "name": 1}) or {}).get("name")
            break
    today = datetime.now(APP_TZ).date()
    return {"name": doc.get("name"), "focus": doc.get("focus"), "coach": coach, "streak": await _streak(user.user_id),
            "from": (today - timedelta(days=6)).isoformat(), "to": today.isoformat(),
            "workouts": brief["workouts_7d"], "checkins": brief["checkins_7d"], "targets_pct": brief["targets_pct"], "targets_hit": brief["targets_hit"],
            "weight": brief["weight"], "weight_change": brief["weight_change_7d"], "meals": brief["meals_7d"],
            "pose_checks": await db.pose_checks.count_documents({"client_id": user.user_id, "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}})}


# ───────────────────────────── Coach tools: templates, quick replies, AI summary ─────────────────────────────
class TemplateIn(BaseModel):
    name: str
    type: str
    plan_id: Optional[str] = None
    content: Optional[dict] = None


class PlanCopyIn(BaseModel):
    type: str
    template_id: Optional[str] = None
    plan_id: Optional[str] = None


class QuickRepliesIn(BaseModel):
    replies: List[str]


DEFAULT_QUICK_REPLIES = [
    "Great work today, {name}! Keep it up 💪",
    "How are you feeling after the last session?",
    "Please log today's meals so I can review your nutrition.",
    "Don't forget to drink enough water today.",
    "I've updated your plan — have a look and tell me how it feels.",
    "Rest well tonight — recovery is part of the plan.",
]


@api_router.get("/coach/plan-sources")
async def plan_sources(type: str, user: User = Depends(require_role("trainer", "admin"))):
    """Saved templates and other clients' live plans the coach can start a new draft from."""
    if type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid plan type")
    templates = await db.plan_templates.find({"coach_id": user.user_id, "type": type}, {"_id": 0}).sort("created_at", -1).to_list(100)
    client_plans = []
    for c in await _my_clients(user):
        if not _sees_plan_type(user, c, type):
            continue
        p = await db.plans.find_one({"client_id": c["user_id"], "type": type, "status": "active"}, {"_id": 0})
        if p:
            client_plans.append({"plan_id": p["id"], "client_id": c["user_id"], "client_name": c.get("name"),
                                 "title": p["content"].get("title"), "approved_at": p.get("approved_at")})
    return {"templates": templates, "client_plans": client_plans}


@api_router.post("/coach/templates")
async def save_template(payload: TemplateIn, user: User = Depends(require_role("trainer", "admin"))):
    if payload.type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid plan type")
    name = _txt(payload.name, 60)
    if not name:
        raise HTTPException(status_code=400, detail="Give the template a name")
    if payload.plan_id:
        plan = await _editable_plan(payload.plan_id, user)
        if plan["type"] != payload.type:
            raise HTTPException(status_code=400, detail="Plan type mismatch")
        content = plan["content"]
    elif payload.content:
        content = payload.content
    else:
        raise HTTPException(status_code=400, detail="Nothing to save")
    if await db.plan_templates.count_documents({"coach_id": user.user_id}) >= 100:
        raise HTTPException(status_code=400, detail="You can keep up to 100 templates — delete some first")
    doc = {"id": str(uuid.uuid4()), "coach_id": user.user_id, "name": name, "type": payload.type,
           "content": _clean_plan(payload.type, content), "created_at": _now_iso()}
    await db.plan_templates.insert_one(dict(doc))
    return doc


@api_router.delete("/coach/templates/{template_id}")
async def delete_template(template_id: str, user: User = Depends(require_role("trainer", "admin"))):
    res = await db.plan_templates.delete_one({"id": template_id, "coach_id": user.user_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


@api_router.post("/coach/clients/{client_id}/plans/copy")
async def copy_plan(client_id: str, payload: PlanCopyIn, user: User = Depends(require_role("trainer", "admin"))):
    """Start a draft for this client from a saved template or another client's plan. The coach still reviews and approves it."""
    if payload.type not in PLAN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid plan type")
    client_doc = await _client_access(user, client_id, PLAN_TYPES[payload.type])
    if payload.template_id:
        src = await db.plan_templates.find_one({"id": payload.template_id, "coach_id": user.user_id}, {"_id": 0})
        if not src:
            raise HTTPException(status_code=404, detail="Template not found")
        note = f"Started from your template “{src['name']}” — personalise it before approving."
    elif payload.plan_id:
        src = await _editable_plan(payload.plan_id, user)
        if src["client_id"] == client_id and src["status"] == "draft":
            raise HTTPException(status_code=400, detail="That is already this client's draft")
        note = f"Copied from {src.get('client_name') or 'another client'}'s plan — check portions, injuries and diet before approving."
    else:
        raise HTTPException(status_code=400, detail="Choose a template or a plan to copy")
    if src["type"] != payload.type:
        raise HTTPException(status_code=400, detail="Plan type mismatch")
    active = await db.plans.find_one({"client_id": client_id, "type": payload.type, "status": "active"}, {"_id": 0})
    await db.plans.delete_many({"client_id": client_id, "type": payload.type, "status": "draft"})
    doc = {
        "id": str(uuid.uuid4()), "client_id": client_id, "client_name": client_doc.get("name"),
        "coach_id": user.user_id, "coach_name": user.name, "type": payload.type, "status": "draft",
        "content": _clean_plan(payload.type, src["content"]), "reason": None, "ai_generated": False,
        "ai_note": note, "coach_note": None, "revises": active["id"] if active else None,
        "created_at": _now_iso(), "approved_at": None,
    }
    await db.plans.insert_one(dict(doc))
    return _plan_out(doc)


@api_router.get("/coach/quick-replies")
async def get_quick_replies(user: User = Depends(require_role("trainer"))):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "quick_replies": 1}) or {}
    replies = doc.get("quick_replies")
    return {"replies": DEFAULT_QUICK_REPLIES if replies is None else replies}


@api_router.put("/coach/quick-replies")
async def put_quick_replies(payload: QuickRepliesIn, user: User = Depends(require_role("trainer"))):
    replies = [r for r in (_txt(x, 500) for x in payload.replies) if r][:30]
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"quick_replies": replies}})
    return {"replies": replies}


def _week_key() -> str:
    today = datetime.now(APP_TZ).date()
    return (today - timedelta(days=today.weekday())).isoformat()


def _fallback_summary(client: dict, brief: dict) -> dict:
    first = (client.get("name") or "there").split(" ")[0]
    kinds = {f["kind"] for f in brief["flags"]}
    wins = []
    if brief["workouts_7d"] >= 3:
        wins.append(f"{brief['workouts_7d']} workouts logged")
    if brief.get("checkins_7d", 0) >= 5:
        wins.append("Checked in almost every day")
    if (brief.get("targets_pct") or 0) >= 70:
        wins.append(f"Hit {brief['targets_pct']}% of daily targets")
    if brief["weight_change_7d"] and ((client.get("focus") == "fat_loss" and brief["weight_change_7d"] < 0) or
                                      (client.get("focus") == "muscle_gain" and brief["weight_change_7d"] > 0)):
        wins.append(f"Weight moving the right way ({brief['weight_change_7d']:+} kg)")
    if "inactive" in kinds:
        msg = f"Hi {first}, haven't heard from you in a few days — how are things going? Even a quick check-in helps."
    elif kinds & {"poor_sleep", "low_energy", "sore", "low_mood"}:
        msg = f"Hi {first}, I noticed recovery has been tough this week. Let's go a bit lighter for a few days — how are you sleeping?"
    elif kinds:
        msg = f"Hi {first}, I've looked at your week. A couple of things to tweak — let's chat about them today."
    else:
        msg = f"Great week, {first}! You're on track — keep the momentum going."
    w = brief["workouts_7d"]
    text = f"{first} logged {w} workout{'s' if w != 1 else ''}"
    if brief.get("meals_7d") is not None and client.get("focus") in FITNESS_FOCUS:
        text += f" and {brief['meals_7d']} meal{'s' if brief['meals_7d'] != 1 else ''}"
    text += f", and checked in on {brief.get('checkins_7d', 0)} of the last 7 days."
    if brief["weight_change_7d"]:
        text += f" Weight is {brief['weight']} kg ({brief['weight_change_7d']:+} kg this week)."
    if brief.get("targets_pct") is not None:
        text += f" Daily targets: {brief['targets_pct']}% done."
    if brief["inactive_days"] and brief["inactive_days"] >= 3:
        text += f" Last activity was {brief['inactive_days']} days ago."
    return {"summary": text, "wins": wins[:3], "concerns": [f["text"] for f in brief["flags"]][:3],
            "next_step": brief["suggestion"], "message": msg}


@api_router.get("/coach/clients/{client_id}/summary")
async def client_summary(client_id: str, refresh: bool = False, user: User = Depends(require_role("trainer", "admin"))):
    """AI-written weekly summary for the coach, cached for the week. Falls back to a rule-based summary without AI."""
    client_doc = await _client_access(user, client_id)
    week = _week_key()
    key = {"client_id": client_id, "viewer_id": user.user_id, "week": week}
    if not refresh:
        cached = await db.ai_summaries.find_one(key, {"_id": 0})
        if cached:
            return cached
    fitness_view = _fitness_view(user, client_doc)
    brief = await _client_brief(client_doc, fitness_view)
    since = (datetime.now(APP_TZ).date() - timedelta(days=13)).isoformat()
    daily = await db.daily_logs.find({"user_id": client_id, "date": {"$gte": since}}, {"_id": 0, "user_id": 0}).sort("date", 1).to_list(20)
    progress = await db.progress.find({"user_id": client_id, "date": {"$gte": (datetime.now(APP_TZ).date() - timedelta(days=28)).isoformat()}},
                                      {"_id": 0, "date": 1, "weight": 1, "waist": 1}).to_list(60)
    sessions = await db.workout_sessions.find({"user_id": client_id, "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}},
                                              {"_id": 0, "name": 1, "created_at": 1, "notes": 1}).to_list(30)
    plans = await db.plans.find({"client_id": client_id, "status": "active"}, {"_id": 0, "type": 1, "content.title": 1, "content.total_calories": 1}).to_list(5)
    plans = [p for p in plans if _sees_plan_type(user, client_doc, p["type"])]
    latest = await db.progress.find_one({"user_id": client_id, "weight": {"$ne": None}}, {"_id": 0}, sort=[("date", -1)]) or {}
    data = {
        "this_week": {k: brief[k] for k in ("headline", "weight", "weight_change_7d", "workouts_7d", "meals_7d", "avg_kcal",
                                            "inactive_days", "plateau", "checkins_7d", "wellbeing", "targets_pct")},
        "flags": [f["text"] for f in brief["flags"]],
        "daily_checkins_1to5": [{"date": d["date"], **(d.get("checkin") or {})} for d in daily if d.get("checkin")],
        "daily_targets": client_doc.get("daily_targets") or [], "targets_done_by_day": {d["date"]: d.get("targets") or {} for d in daily},
        "measurements_4_weeks": progress, "workouts_logged": sessions, "live_plans": plans,
    }
    if not fitness_view:
        for k in ("weight", "weight_change_7d", "meals_7d", "avg_kcal"):
            data["this_week"].pop(k, None)
        data.pop("measurements_4_weeks")
    system = ("You help an online fitness/yoga coach in India review one client's week. Be specific, warm and brief; use the numbers given, "
              "never invent data, and don't give medical advice. Check-in scales are 1-5 (sleep quality, energy, mood: 5 is best; soreness: 5 is most sore). "
              'Respond ONLY with JSON: {"summary": 2-3 sentences for the coach, "wins": [up to 3 short strings], "concerns": [up to 3 short strings], '
              '"next_step": one concrete action for the coach, "message": a short friendly message (max 50 words) the coach could send the client, '
              "written in the coach's voice, addressing the client by first name}.")
    prompt = f"Client profile:\n{_profile_text(client_doc, latest)}\n\nData (JSON):\n{json.dumps(data, default=str)[:9000]}"
    try:
        out = await _ai_json(system, prompt, "weekly-summary")
        result = {"summary": _txt(out.get("summary"), 700), "wins": [_txt(x, 140) for x in (out.get("wins") or [])][:3],
                  "concerns": [_txt(x, 140) for x in (out.get("concerns") or [])][:3], "next_step": _txt(out.get("next_step"), 240),
                  "message": _txt(out.get("message"), 400)}
        if not result["summary"]:
            raise ValueError("empty summary")
        ai = True
    except Exception as e:
        logger.info("AI weekly summary unavailable, using rule-based: %s", e)
        result, ai = _fallback_summary(client_doc, brief), False
    doc = {**key, **result, "ai": ai, "flags": brief["flags"], "generated_at": _now_iso()}
    await db.ai_summaries.replace_one(key, dict(doc), upsert=True)
    return doc


# ───────────────────────────── Yoga pose checks ─────────────────────────────
MAX_SNAPSHOT_CHARS = 450_000  # ~330 KB image


def _pose_out(doc: dict, viewer: User) -> dict:
    doc.pop("_id", None)
    if viewer.role == "client" and doc.get("status") != "reviewed":
        # the client sees the automatic result as provisional until their coach confirms it
        doc["provisional"] = True
    return doc


@api_router.post("/pose-checks")
async def create_pose_check(payload: PoseCheckCreate, user: User = Depends(require_role("client")), _m: User = Depends(require_feature("pose_check"))):
    await require_photo_consent(user)
    if user.focus not in YOGA_FOCUS or not user.yoga_coach_id:
        raise HTTPException(status_code=400, detail="Pose checks are reviewed by your yoga coach — one hasn't been assigned yet")
    snap = payload.snapshot
    if not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", snap or ""):
        raise HTTPException(status_code=400, detail="Invalid snapshot")
    if len(snap) > MAX_SNAPSHOT_CHARS:
        raise HTTPException(status_code=400, detail="Snapshot is too large")
    # Keep the image as a file (object storage when configured) rather than inside the database record.
    mime, b64 = snap[5:].split(";base64,", 1)
    try:
        img = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid snapshot")
    snap_path = f"pose/{user.user_id}/{uuid.uuid4().hex}.{ {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[mime] }"
    store = await blob_put(snap_path, img, mime)
    await db.files.insert_one({"id": str(uuid.uuid4()), "storage_path": snap_path, "owner_id": user.user_id, "original_filename": "pose-snapshot",
                               "content_type": mime, "size": len(img), "kind": "pose", "store": store, "is_deleted": False,
                               "created_at": _now_iso()})
    checks = [{"id": _txt(c.get("id"), 40), "label": _txt(c.get("label"), 60), "ok": bool(c.get("ok")),
               "value": _num(c.get("value"), 1000), "unit": _txt(c.get("unit"), 4), "cue": _txt(c.get("cue"), 160) or None}
              for c in payload.checks[:12] if isinstance(c, dict)]
    doc = {
        "id": str(uuid.uuid4()), "client_id": user.user_id, "client_name": user.name, "coach_id": user.yoga_coach_id,
        "pose": _txt(payload.pose, 30), "pose_label": _txt(payload.pose_label, 60),
        "score": max(0, min(100, payload.score)), "checks": checks, "flags": [_txt(f, 160) for f in payload.flags[:8] if _txt(f, 160)],
        "snapshot": file_url(snap_path), "snapshot_path": snap_path, "frames": payload.frames, "plan_id": payload.plan_id, "status": "pending",
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


# ───────────────────────────── Web Push ─────────────────────────────
_vapid = {"public": None, "key": None}


def _b64url(raw: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def load_vapid_keys():
    """Use VAPID keys from the environment, else the pair stored in MongoDB, else generate and store one."""
    from py_vapid import Vapid
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    pem = os.environ.get("VAPID_PRIVATE_KEY", "").strip().replace("\\n", "\n")
    if not pem:
        doc = await db.app_settings.find_one({"_id": "vapid"})
        if not doc:
            v = Vapid()
            v.generate_keys()
            doc = {"_id": "vapid", "private_pem": v.private_pem().decode(), "created_at": datetime.now(timezone.utc).isoformat()}
            try:
                await db.app_settings.insert_one(dict(doc))
            except Exception:  # another worker won the race; use its key
                doc = await db.app_settings.find_one({"_id": "vapid"})
        pem = doc["private_pem"]
    key = Vapid.from_pem(pem.encode())
    _vapid["key"] = key
    _vapid["public"] = _b64url(key.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint))


def _send_one(sub: dict, payload: dict) -> Optional[int]:
    """Blocking send; returns an HTTP status when the push service rejected the subscription."""
    from pywebpush import webpush, WebPushException
    subject = VAPID_SUBJECT or f"mailto:{ADMIN_EMAIL or 'admin@fitcoach.app'}"
    try:
        webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]}, data=json.dumps(payload),
                vapid_private_key=_vapid["key"], vapid_claims={"sub": subject},
                ttl=int(payload.get("ttl") or 3600), headers={"Urgency": payload.get("urgency", "normal")}, timeout=10)
    except WebPushException as e:
        return e.response.status_code if e.response is not None else 0
    except Exception:
        logger.exception("web push failed")
    return None


async def send_web_push(user_id: str, payload: dict) -> int:
    if not _vapid["key"]:
        return 0
    subs = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(20)
    sent = 0
    for sub in subs:
        status = await asyncio.to_thread(_send_one, sub, payload)
        if status in (404, 410):  # the browser unsubscribed or the subscription expired
            await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
        elif status is None:
            sent += 1
    return sent


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict
    user_agent: Optional[str] = None


class PushUnsubscribe(BaseModel):
    endpoint: str


@api_router.get("/push/config")
async def push_config(user: User = Depends(get_current_user)):
    count = await db.push_subscriptions.count_documents({"user_id": user.user_id})
    return {"public_key": _vapid["public"], "enabled": bool(_vapid["public"]), "devices": count}


@api_router.post("/push/subscribe")
async def push_subscribe(payload: PushSubscription, user: User = Depends(get_current_user)):
    if not payload.endpoint.startswith("https://") or not {"p256dh", "auth"} <= set(payload.keys):
        raise HTTPException(status_code=400, detail="Invalid push subscription")
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {"$set": {"endpoint": payload.endpoint, "keys": {"p256dh": payload.keys["p256dh"], "auth": payload.keys["auth"]},
                  "user_id": user.user_id, "user_agent": _txt(payload.user_agent, 200), "updated_at": _now_iso()}},
        upsert=True)
    return {"ok": True}


@api_router.post("/push/unsubscribe")
async def push_unsubscribe(payload: PushUnsubscribe, user: User = Depends(get_current_user)):
    await db.push_subscriptions.delete_one({"endpoint": payload.endpoint, "user_id": user.user_id})
    return {"ok": True}


@api_router.post("/push/test")
async def push_test(user: User = Depends(get_current_user)):
    sent = await send_web_push(user.user_id, {"title": "Notifications are on", "body": "You'll hear from FitCoach even when the app is closed.",
                                              "url": "/", "tag": "push-test"})
    return {"sent": sent}


def call_decline_token(call_id: str, user_id: str) -> str:
    return jwt.encode({"sub": user_id, "call": call_id, "type": "call_decline",
                       "exp": datetime.now(timezone.utc) + timedelta(minutes=2)}, JWT_SECRET, algorithm=JWT_ALGORITHM)


@api_router.post("/calls/{call_id}/decline-push")
async def decline_from_notification(call_id: str, t: str = Query(...)):
    """The 'Decline' button on a call notification (the service worker has no login token, so it uses a signed link)."""
    try:
        claims = jwt.decode(t, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Link expired")
    if claims.get("type") != "call_decline" or claims.get("call") != call_id:
        raise HTTPException(status_code=401, detail="Invalid link")
    user_doc = await db.users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return await decline_call(call_id, User(**user_doc))


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
async def send_message(client_id: str, coach_id: str, payload: MessageCreate, user: User = Depends(require_feature("messages"))):
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


@api_router.post("/messages/{client_id}/{coach_id}/voice")
async def send_voice_note(client_id: str, coach_id: str, file: UploadFile = File(...), duration: float = Form(0),
                          user: User = Depends(require_feature("messages"))):
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Admins can read but not post in coaching chats")
    await _thread_access(user, client_id, coach_id)
    if duration > MAX_VOICE_SECONDS + 2:
        raise HTTPException(status_code=400, detail="Voice notes can be up to 3 minutes")
    record = await store_voice(file, client_id, [client_id, coach_id])
    doc = {"id": str(uuid.uuid4()), "client_id": client_id, "coach_id": coach_id, "sender_id": user.user_id,
           "sender_name": user.name, "sender_role": user.role, "body": "",
           "audio": {"url": file_url(record["storage_path"]), "duration": round(max(0.0, min(float(duration or 0), MAX_VOICE_SECONDS)), 1)},
           "context": None, "read_by": [user.user_id], "created_at": datetime.now(timezone.utc).isoformat()}
    await db.messages.insert_one(dict(doc))
    doc.pop("_id", None)
    recipient = coach_id if user.user_id == client_id else client_id
    link = f"/trainer/clients/{client_id}?tab=chat" if recipient == coach_id else f"/messages?coach={coach_id}"
    await db.notifications.delete_many({"user_id": recipient, "link": link, "read": False})
    await push_notification(recipient, f"Voice note from {user.name}", "Tap to listen", link)
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


_relay_cache: dict = {"at": None, "servers": []}


def _as_list(v) -> list:
    return v if isinstance(v, list) else [v] if isinstance(v, dict) else []


async def _relay_servers() -> List[dict]:
    """TURN relays let calls connect on networks that block direct connections (many mobile and office
    networks). Credentials from Metered/Cloudflare are short-lived, so they're cached for 30 minutes."""
    out: List[dict] = []
    if TURN_URLS:
        out.append({"urls": TURN_URLS, "username": TURN_USERNAME, "credential": TURN_CREDENTIAL})
    now = datetime.now(timezone.utc)
    if (METERED_API_KEY and METERED_DOMAIN) or (CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN):
        if _relay_cache["at"] and now - _relay_cache["at"] < timedelta(minutes=30):
            return out + _relay_cache["servers"]
        fetched: List[dict] = []
        try:
            async with httpx.AsyncClient(timeout=8) as http:
                if METERED_API_KEY and METERED_DOMAIN:
                    r = await http.get(f"https://{METERED_DOMAIN}/api/v1/turn/credentials", params={"apiKey": METERED_API_KEY})
                    if r.status_code == 200:
                        fetched += [x for x in _as_list(r.json()) if isinstance(x, dict) and x.get("urls")]
                if CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN:
                    r = await http.post(f"https://rtc.live.cloudflare.com/v1/turn/keys/{CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers",
                                        headers={"Authorization": f"Bearer {CLOUDFLARE_TURN_API_TOKEN}"}, json={"ttl": 86400})
                    if r.status_code in (200, 201):
                        fetched += [x for x in _as_list(r.json().get("iceServers")) if isinstance(x, dict) and x.get("urls")]
        except (httpx.HTTPError, ValueError):
            logger.warning("Could not fetch TURN relay credentials", exc_info=True)
        if fetched:
            _relay_cache.update(at=now, servers=fetched)
        else:
            fetched = _relay_cache["servers"]  # keep using the last good credentials
        out += fetched
    return out


@api_router.get("/calls/ice")
async def call_ice_servers(user: User = Depends(get_current_user)):
    servers = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
    relay = await _relay_servers()
    return {"iceServers": servers + relay, "relay": bool(relay)}


@api_router.post("/calls/instant")
async def start_instant_call(payload: InstantCallRequest, user: User = Depends(require_role("client", "trainer")), _m: User = Depends(require_feature("calls"))):
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
    if booking.get("status") == "requested":
        raise HTTPException(status_code=409, detail="This intro session is waiting for the coach to confirm it.")
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
        await push_notification(peer_id, f"Incoming call from {user.name}", "Video call · tap to answer", f"/call/live/{call_id}", push={
            "kind": "call", "tag": f"call-{call_id}", "requireInteraction": True, "urgency": "high", "ttl": 45,
            "actions": [{"action": "answer", "title": "Answer"}, {"action": "decline", "title": "Decline"}],
            "decline_url": f"/api/calls/{call_id}/decline-push?t={call_decline_token(call_id, peer_id)}"})
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
        await push_notification(peer_id, f"Missed call from {user.name}", "Call them back from Messages or your dashboard.",
                                "/dashboard" if user.role == "trainer" else f"/trainer/clients/{user.user_id}", push={"tag": f"call-{call_id}"})
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


def minutes_label_soon(label: str) -> bool:
    return "10 minutes" in label


async def send_session_alerts():
    """In-app reminders to both sides about an hour and 10 minutes before each booked session."""
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(minutes=10)).isoformat()
    hour = (now + timedelta(minutes=60)).isoformat()
    async for b in db.bookings.find({"starts_at": {"$gt": now.isoformat(), "$lte": hour}, "status": {"$ne": "requested"}}, {"_id": 0}):
        if b["starts_at"] <= soon and not b.get("alert_10_sent"):
            label, flags = "in 10 minutes", {"alert_10_sent": True, "alert_60_sent": True}
        elif not b.get("alert_60_sent"):
            label, flags = "in about an hour", {"alert_60_sent": True}
        else:
            continue
        await db.bookings.update_one({"id": b["id"]}, {"$set": flags})
        for uid, other in ((b["user_id"], b.get("trainer_name")), (b["trainer_id"], b.get("client_name"))):
            await push_notification(uid, f"Session {label}", f"Video session with {other} at {b['time']}. Join from the app.", f"/call/{b['id']}",
                                    push={"tag": f"session-{b['id']}", "urgency": "high" if minutes_label_soon(label) else "normal"})

# ── public + member endpoints ──
@api_router.get("/plans")
async def public_plans():
    s = await billing_settings()
    return {"plans": await list_plans(), "session_price_inr": s["session_price_inr"], "trial_days": s["trial_days"],
            "packs": [p for p in s["packs"] if p.get("active")], "referee_bonus_days": s["referee_bonus_days"],
            "currency": "INR", "payments_enabled": PAYMENTS_ENABLED}


@api_router.get("/me/membership")
async def my_membership(user: User = Depends(get_current_user)):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    s = await billing_settings()
    status = membership_status(doc, s)
    plan = await get_plan(doc.get("membership_plan")) if doc.get("membership_plan") not in (None, "trial") else None
    status["plan_name"] = "Free trial" if status["is_trial"] else (plan or {}).get("name")
    referral = None
    if user.role == "client":
        code = await ensure_referral_code(user.user_id)
        referral = {"code": code, "path": f"/r/{code}", "reward_days": s["referral_reward_days"], "friend_bonus_days": s["referee_bonus_days"],
                    "signed_up": await db.referrals.count_documents({"referrer_id": user.user_id}),
                    "rewarded": await db.referrals.count_documents({"referrer_id": user.user_id, "status": "rewarded"})}
    return {**status, "referral": referral}


# ── checkout (one-time orders: plan, pack, single session) ──
class PaymentOrderRequest(BaseModel):
    type: str                      # plan | pack | session
    plan_id: Optional[str] = None
    pack_id: Optional[str] = None
    booking_id: Optional[str] = None


class PaymentVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def _razorpay_client():
    import razorpay
    return razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


def _hmac_ok(message: str, signature: str, secret: str) -> bool:
    import hashlib
    import hmac
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return bool(signature) and hmac.compare_digest(digest, signature)


def _require_payments():
    if not PAYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Payments are not configured yet. Add Razorpay keys to enable checkout.")


@api_router.get("/payments/config")
async def payments_config(user: User = Depends(get_current_user)):
    s = await billing_settings()
    return {"enabled": PAYMENTS_ENABLED, "key_id": RAZORPAY_KEY_ID if PAYMENTS_ENABLED else None, "plans": await list_plans(),
            "session_price_inr": s["session_price_inr"], "packs": [p for p in s["packs"] if p.get("active")], "currency": "INR",
            "auto_renew": PAYMENTS_ENABLED}


@api_router.post("/payments/order")
async def create_payment_order(payload: PaymentOrderRequest, user: User = Depends(get_current_user)):
    _require_payments()
    s = await billing_settings()
    if payload.type == "plan":
        plan = await get_plan(payload.plan_id)
        if not plan or not plan.get("active"):
            raise HTTPException(status_code=400, detail="Invalid plan")
        amount_inr, ref = plan["price_inr"], {"plan_id": plan["id"], "plan_name": plan["name"]}
    elif payload.type == "pack":
        pack = next((p for p in s["packs"] if p["id"] == payload.pack_id and p.get("active")), None)
        if not pack:
            raise HTTPException(status_code=400, detail="Invalid session pack")
        amount_inr, ref = pack["price_inr"], {"pack_id": pack["id"], "sessions": pack["sessions"], "pack_name": pack["name"]}
    elif payload.type == "session":
        booking = await db.bookings.find_one({"id": payload.booking_id, "user_id": user.user_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=400, detail="Booking not found")
        if booking.get("paid"):
            raise HTTPException(status_code=409, detail="This session is already paid")
        amount_inr, ref = s["session_price_inr"], {"booking_id": payload.booking_id}
    else:
        raise HTTPException(status_code=400, detail="Invalid payment type")

    receipt = f"fc_{uuid.uuid4().hex[:16]}"
    try:
        order = await asyncio.to_thread(_razorpay_client().order.create,
                                        {"amount": int(amount_inr) * 100, "currency": "INR", "receipt": receipt, "payment_capture": 1,
                                         "notes": {"user_id": user.user_id, "type": payload.type}})
    except Exception:
        logger.exception("razorpay order failed")
        raise HTTPException(status_code=502, detail="Could not start the payment. Please try again.")
    await db.transactions.insert_one({"id": str(uuid.uuid4()), "user_id": user.user_id, "order_id": order["id"], "type": payload.type,
                                      "ref": ref, "amount_inr": amount_inr, "status": "created", "created_at": _now_iso()})
    return {"order_id": order["id"], "amount": int(amount_inr) * 100, "currency": "INR", "key_id": RAZORPAY_KEY_ID, "receipt": receipt}


@api_router.post("/payments/verify")
async def verify_payment(payload: PaymentVerifyRequest, user: User = Depends(get_current_user)):
    _require_payments()
    txn = await db.transactions.find_one({"order_id": payload.razorpay_order_id, "user_id": user.user_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if not _hmac_ok(f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}", payload.razorpay_signature, RAZORPAY_KEY_SECRET):
        await db.transactions.update_one({"id": txn["id"]}, {"$set": {"status": "failed"}})
        raise HTTPException(status_code=400, detail="Payment signature verification failed")
    await db.transactions.update_one({"id": txn["id"]}, {"$set": {"status": "paid", "payment_id": payload.razorpay_payment_id, "paid_at": _now_iso()}})
    await record_payment_effects({**txn, "payment_id": payload.razorpay_payment_id})
    return {"status": "success"}


# ── auto-renewing subscriptions ──
class SubscriptionRequest(BaseModel):
    plan_id: str


class SubscriptionVerifyRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_subscription_id: str
    razorpay_signature: str


async def _razorpay_plan_id(plan: dict) -> str:
    """Razorpay needs its own plan object per price; create one when the price/period changes."""
    if plan.get("rp_plan_id") and plan.get("rp_plan_price") == plan["price_inr"] and plan.get("rp_plan_period") == f"{plan['period']}x{plan['interval']}":
        return plan["rp_plan_id"]
    rp = await asyncio.to_thread(_razorpay_client().plan.create, {
        "period": plan["period"], "interval": int(plan["interval"]),
        "item": {"name": f"FitCoach {plan['name']}", "amount": int(plan["price_inr"]) * 100, "currency": "INR"}})
    await db.membership_plans.update_one({"id": plan["id"]}, {"$set": {"rp_plan_id": rp["id"], "rp_plan_price": plan["price_inr"],
                                                                        "rp_plan_period": f"{plan['period']}x{plan['interval']}"}})
    return rp["id"]


@api_router.post("/payments/subscription")
async def create_subscription(payload: SubscriptionRequest, user: User = Depends(require_role("client"))):
    _require_payments()
    plan = await get_plan(payload.plan_id)
    if not plan or not plan.get("active"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    if doc.get("subscription_status") == "active":
        raise HTTPException(status_code=409, detail="You already have an auto-renewing membership. Cancel it first to switch plans.")
    try:
        rp_plan = await _razorpay_plan_id(plan)
        cycles = {"weekly": 520, "monthly": 120, "yearly": 10}[plan["period"]] // int(plan["interval"] or 1)
        sub = await asyncio.to_thread(_razorpay_client().subscription.create, {
            "plan_id": rp_plan, "total_count": max(1, cycles), "customer_notify": 1,
            "notes": {"user_id": user.user_id, "plan_id": plan["id"]}})
    except Exception:
        logger.exception("razorpay subscription failed")
        raise HTTPException(status_code=502, detail="Could not start auto-renewal. Please try again.")
    await db.subscriptions.insert_one({"id": sub["id"], "user_id": user.user_id, "plan_id": plan["id"], "status": "created",
                                       "created_at": _now_iso()})
    return {"subscription_id": sub["id"], "key_id": RAZORPAY_KEY_ID, "plan_name": plan["name"], "amount": int(plan["price_inr"]) * 100}


async def _apply_subscription_charge(sub: dict, payment_id: str, amount_inr: Optional[int] = None):
    """One renewal = one transaction keyed by payment id, so the checkout callback and webhook can't double-count."""
    if await db.transactions.find_one({"payment_id": payment_id}):
        return
    plan = await get_plan(sub["plan_id"]) or {}
    txn = {"id": str(uuid.uuid4()), "user_id": sub["user_id"], "order_id": None, "subscription_id": sub["id"], "type": "subscription",
           "ref": {"plan_id": sub["plan_id"], "plan_name": plan.get("name")}, "amount_inr": amount_inr or plan.get("price_inr"),
           "status": "paid", "payment_id": payment_id, "paid_at": _now_iso(), "created_at": _now_iso()}
    try:
        await db.transactions.insert_one(dict(txn))
    except Exception:
        return  # unique payment_id: another request recorded it first
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"status": "active", "last_charged_at": _now_iso()}})
    await db.users.update_one({"user_id": sub["user_id"]}, {"$set": {"subscription_id": sub["id"], "subscription_status": "active"}})
    await record_payment_effects(txn)


@api_router.post("/payments/subscription/verify")
async def verify_subscription(payload: SubscriptionVerifyRequest, user: User = Depends(require_role("client"))):
    _require_payments()
    sub = await db.subscriptions.find_one({"id": payload.razorpay_subscription_id, "user_id": user.user_id}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not _hmac_ok(f"{payload.razorpay_payment_id}|{payload.razorpay_subscription_id}", payload.razorpay_signature, RAZORPAY_KEY_SECRET):
        raise HTTPException(status_code=400, detail="Payment signature verification failed")
    await _apply_subscription_charge(sub, payload.razorpay_payment_id)
    return {"status": "success"}


@api_router.post("/payments/subscription/cancel")
async def cancel_subscription(user: User = Depends(require_role("client"))):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    sub_id = doc.get("subscription_id")
    if not sub_id or doc.get("subscription_status") != "active":
        raise HTTPException(status_code=409, detail="No auto-renewing membership to cancel")
    if PAYMENTS_ENABLED:
        try:
            await asyncio.to_thread(_razorpay_client().subscription.cancel, sub_id, {"cancel_at_cycle_end": 1})
        except Exception:
            logger.exception("razorpay cancel failed")
            raise HTTPException(status_code=502, detail="Could not cancel right now. Please try again.")
    await db.subscriptions.update_one({"id": sub_id}, {"$set": {"status": "cancelled", "cancelled_at": _now_iso()}})
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"subscription_status": "cancelled"}})
    return {"ok": True, "access_until": doc.get("membership_expires_at")}


@api_router.post("/payments/webhook")
async def razorpay_webhook(request: Request):
    """Razorpay → us: renewals and subscription state changes. Configure in Razorpay Dashboard → Webhooks."""
    body = await request.body()
    if not RAZORPAY_WEBHOOK_SECRET or not _hmac_ok(body.decode(), request.headers.get("x-razorpay-signature", ""), RAZORPAY_WEBHOOK_SECRET):
        raise HTTPException(status_code=400, detail="Invalid signature")
    event = json.loads(body)
    kind = event.get("event", "")
    sub_entity = ((event.get("payload") or {}).get("subscription") or {}).get("entity") or {}
    sub = await db.subscriptions.find_one({"id": sub_entity.get("id")}, {"_id": 0}) if sub_entity.get("id") else None
    if not sub:
        return {"ok": True, "ignored": kind}
    if kind == "subscription.charged":
        pay = ((event["payload"].get("payment") or {}).get("entity")) or {}
        if pay.get("id"):
            await _apply_subscription_charge(sub, pay["id"], (pay.get("amount") or 0) // 100 or None)
    elif kind in ("subscription.halted", "subscription.cancelled", "subscription.completed", "subscription.paused"):
        status = kind.split(".", 1)[1]
        await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"status": status, "updated_at": _now_iso()}})
        await db.users.update_one({"user_id": sub["user_id"], "subscription_id": sub["id"]}, {"$set": {"subscription_status": status}})
        if status == "halted":
            await push_notification(sub["user_id"], "Payment didn't go through", "We couldn't renew your membership. Update your payment method to keep your coach.", "/membership")
    return {"ok": True}


@api_router.get("/payments/history")
async def payment_history(user: User = Depends(get_current_user)):
    docs = await db.transactions.find({"user_id": user.user_id}, {"_id": 0}).to_list(200)
    docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return docs


# ── admin: plans, settings, credits, payouts ──
class PlanIn(BaseModel):
    name: str
    price_inr: int
    days: int
    period: str = "monthly"
    interval: int = 1
    included_sessions: int = 0
    unlimited_sessions: bool = False
    blurb: str = ""
    features: List[str] = []
    featured: bool = False
    active: bool = True
    sort: int = 10


class PackIn(BaseModel):
    id: Optional[str] = None
    name: str
    sessions: int
    price_inr: int
    active: bool = True


class BillingSettingsIn(BaseModel):
    session_price_inr: int
    trial_days: int
    grace_days: int
    referral_reward_days: int
    referee_bonus_days: int
    payout_per_client_inr: int = 0
    payout_per_session_inr: int = 0
    packs: List[PackIn] = []
    trial_features: Optional[List[str]] = None
    trial_session_credits: Optional[int] = None
    trial_intro_approval: Optional[bool] = None


class CreditsIn(BaseModel):
    delta: int


def _clean_plan_in(p: PlanIn) -> dict:
    if not (1 <= len(p.name.strip()) <= 40) or p.price_inr < 0 or not (1 <= p.days <= 3660):
        raise HTTPException(status_code=400, detail="Check the plan name, price and duration")
    if p.period not in PERIODS or not (1 <= p.interval <= 12):
        raise HTTPException(status_code=400, detail="Billing period must be weekly, monthly or yearly")
    return {"name": p.name.strip(), "price_inr": int(p.price_inr), "days": int(p.days), "period": p.period, "interval": int(p.interval),
            "included_sessions": max(0, int(p.included_sessions)), "unlimited_sessions": bool(p.unlimited_sessions),
            "blurb": _txt(p.blurb, 120), "features": [_txt(f, 80) for f in p.features if _txt(f, 80)][:8],
            "featured": bool(p.featured), "active": bool(p.active), "sort": int(p.sort)}


@api_router.get("/admin/plans")
async def admin_list_plans(user: User = Depends(require_role("admin"))):
    plans = await list_plans(include_inactive=True)
    for p in plans:
        p["members"] = await db.users.count_documents({"membership_plan": p["id"], "membership_expires_at": {"$gt": _now_iso()}})
    return plans


@api_router.post("/admin/plans")
async def admin_create_plan(payload: PlanIn, user: User = Depends(require_role("admin"))):
    doc = _clean_plan_in(payload)
    doc["id"] = _slug(payload.name)
    if doc["id"] == "trial" or await get_plan(doc["id"]):
        doc["id"] = f"{doc['id']}-{uuid.uuid4().hex[:4]}"
    await db.membership_plans.insert_one(dict(doc))
    return doc


@api_router.put("/admin/plans/{plan_id}")
async def admin_update_plan(plan_id: str, payload: PlanIn, user: User = Depends(require_role("admin"))):
    if not await get_plan(plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    await db.membership_plans.update_one({"id": plan_id}, {"$set": _clean_plan_in(payload)})
    return await get_plan(plan_id)


@api_router.get("/admin/billing")
async def admin_get_billing(user: User = Depends(require_role("admin"))):
    return {**await billing_settings(), "trial_feature_options": TRIAL_FEATURES}


@api_router.put("/admin/billing")
async def admin_put_billing(payload: BillingSettingsIn, user: User = Depends(require_role("admin"))):
    nums = [payload.session_price_inr, payload.trial_days, payload.grace_days, payload.referral_reward_days,
            payload.referee_bonus_days, payload.payout_per_client_inr, payload.payout_per_session_inr]
    if any(n < 0 for n in nums) or payload.trial_days > 90 or payload.grace_days > 30:
        raise HTTPException(status_code=400, detail="Check the numbers (trial ≤ 90 days, grace ≤ 30 days, no negatives)")
    packs = []
    for p in payload.packs[:10]:
        if not p.name.strip() or p.sessions < 1 or p.price_inr < 0:
            raise HTTPException(status_code=400, detail="Each pack needs a name, at least 1 session and a price")
        packs.append({"id": p.id or _slug(p.name), "name": _txt(p.name, 40), "sessions": int(p.sessions), "price_inr": int(p.price_inr), "active": bool(p.active)})
    if payload.trial_features is not None and not set(payload.trial_features) <= set(TRIAL_FEATURES):
        raise HTTPException(status_code=400, detail="Unknown trial feature")
    if payload.trial_session_credits is not None and not 0 <= payload.trial_session_credits <= 10:
        raise HTTPException(status_code=400, detail="Free intro sessions must be between 0 and 10")
    doc = {**payload.model_dump(exclude={"packs"}, exclude_none=True), "packs": packs}
    await db.app_settings.update_one({"_id": "billing"}, {"$set": doc}, upsert=True)
    return await billing_settings()


@api_router.post("/admin/users/{target_id}/credits")
async def admin_adjust_credits(target_id: str, payload: CreditsIn, user: User = Depends(require_role("admin"))):
    doc = await db.users.find_one({"user_id": target_id, "role": "client"}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")
    new = max(0, int(doc.get("session_credits") or 0) + payload.delta)
    await db.users.update_one({"user_id": target_id}, {"$set": {"session_credits": new}})
    return {"session_credits": new}


async def _payout_report(month: str) -> dict:
    try:
        start = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=APP_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="Month must be YYYY-MM")
    end = (start + timedelta(days=32)).replace(day=1)
    s_iso, e_iso = start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()
    now_iso = _now_iso()
    rates = await billing_settings()
    rows = []
    for c in await db.users.find({"role": "trainer"}, {"_id": 0}).to_list(500):
        cid = c["user_id"]
        field = "yoga_coach_id" if c.get("coach_type") == "yoga" else "fitness_coach_id"
        # clients who were members at some point in the month
        active_clients = await db.users.count_documents({"role": "client", field: cid, "membership_expires_at": {"$gte": s_iso}})
        sessions = await db.bookings.count_documents({"trainer_id": cid, "starts_at": {"$gte": s_iso, "$lt": min(e_iso, now_iso)}})
        calls = await db.calls.count_documents({"coach_id": cid, "started_at": {"$gte": s_iso, "$lt": e_iso}})
        plans = await db.plans.count_documents({"approved_by": cid, "approved_at": {"$gte": s_iso, "$lt": e_iso}})
        reviews = await db.pose_checks.count_documents({"reviewed_by": cid, "reviewed_at": {"$gte": s_iso, "$lt": e_iso}})
        messages = await db.messages.count_documents({"sender_id": cid, "created_at": {"$gte": s_iso, "$lt": e_iso}})
        payout = active_clients * int(rates["payout_per_client_inr"]) + sessions * int(rates["payout_per_session_inr"])
        rows.append({"coach_id": cid, "name": c.get("name"), "email": c.get("email"), "coach_type": c.get("coach_type") or "fitness",
                     "active_clients": active_clients, "sessions": sessions, "calls": calls, "plans_approved": plans,
                     "pose_reviews": reviews, "messages": messages, "payout_inr": payout})
    rows.sort(key=lambda r: (-r["payout_inr"], -r["active_clients"], r["name"] or ""))
    revenue = 0
    async for t in db.transactions.find({"status": "paid", "paid_at": {"$gte": s_iso, "$lt": e_iso}}, {"_id": 0, "amount_inr": 1}):
        revenue += int(t.get("amount_inr") or 0)
    return {"month": month, "rates": {"per_client_inr": rates["payout_per_client_inr"], "per_session_inr": rates["payout_per_session_inr"]},
            "revenue_inr": revenue, "total_payout_inr": sum(r["payout_inr"] for r in rows), "coaches": rows}


@api_router.get("/admin/payouts")
async def admin_payouts(month: str = Query(...), user: User = Depends(require_role("admin"))):
    return await _payout_report(month)


@api_router.get("/admin/payouts.csv")
async def admin_payouts_csv(month: str = Query(...), user: User = Depends(require_role("admin"))):
    import csv
    import io
    rep = await _payout_report(month)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Month", "Coach", "Email", "Type", "Active clients", "Sessions", "Calls", "Plans approved", "Pose reviews", "Messages", "Payout (INR)"])
    for r in rep["coaches"]:
        w.writerow([month, r["name"], r["email"], r["coach_type"], r["active_clients"], r["sessions"], r["calls"],
                    r["plans_approved"], r["pose_reviews"], r["messages"], r["payout_inr"]])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="fitcoach-payouts-{month}.csv"'})


async def send_membership_reminders():
    """Tell clients 3 days before their membership ends (unless it auto-renews), and when it has ended."""
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(days=3)).isoformat()
    async for u in db.users.find({"role": "client", "membership_expires_at": {"$gt": now.isoformat(), "$lte": soon},
                                  "subscription_status": {"$ne": "active"}}, {"_id": 0}):
        if u.get("expiry_notice_for") != u["membership_expires_at"]:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"expiry_notice_for": u["membership_expires_at"]}})
            label = "Your free trial" if u.get("membership_plan") == "trial" else "Your membership"
            await push_notification(u["user_id"], f"{label} ends soon", "Renew now to keep your coach, plans and sessions.", "/membership")
    async for u in db.users.find({"role": "client", "membership_expires_at": {"$lte": now.isoformat(), "$gt": (now - timedelta(days=2)).isoformat()}}, {"_id": 0}):
        if u.get("expired_notice_for") != u["membership_expires_at"]:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"expired_notice_for": u["membership_expires_at"]}})
            await push_notification(u["user_id"], "Your membership has ended", "Renew to pick up where you left off with your coach.", "/membership")


# ───────────────────────────── Consent & privacy (DPDP Act) ─────────────────────────────
CONSENT_VERSION = "2026-10"
PRIVACY_CONTACT_EMAIL = os.environ.get("PRIVACY_CONTACT_EMAIL", "").strip()
PHOTO_CONSENT_REQUIRED = "Turn on photo storage in Privacy settings to upload photos."


class ConsentIn(BaseModel):
    health_data: bool
    photos: bool = False
    marketing: bool = False


class DeleteAccountIn(BaseModel):
    confirm: str


async def record_consent(user_id: str, health: Optional[bool] = None, photos: Optional[bool] = None,
                         marketing: Optional[bool] = None, only_if_missing: bool = False) -> dict:
    """Store what the person agreed to, with timestamps, and keep an audit trail of every change."""
    doc = (await db.users.find_one({"user_id": user_id}, {"_id": 0, "consents": 1}) or {}).get("consents") or {}
    if only_if_missing and doc.get("health_data"):
        return doc
    now = _now_iso()
    new = dict(doc)
    for key, val in (("health_data", health), ("photos", photos), ("marketing", marketing)):
        if val is True:
            new[key] = doc.get(key) or now
        elif val is False:
            new[key] = None
    new.update({"version": CONSENT_VERSION, "updated_at": now})
    await db.users.update_one({"user_id": user_id}, {"$set": {"consents": new}})
    changes = {k: bool(new.get(k)) for k in ("health_data", "photos", "marketing") if bool(new.get(k)) != bool(doc.get(k))}
    if changes:
        await db.consent_log.insert_one({"id": str(uuid.uuid4()), "user_id": user_id, "changes": changes,
                                         "version": CONSENT_VERSION, "at": now})
    return new


async def require_photo_consent(user: User):
    if user.role != "client":
        return
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "consents": 1}) or {}
    if not (doc.get("consents") or {}).get("photos"):
        raise HTTPException(status_code=403, detail=PHOTO_CONSENT_REQUIRED)


async def _delete_files(query: dict) -> int:
    files = await db.files.find(query, {"_id": 0, "storage_path": 1, "store": 1}).to_list(5000)
    if files:
        await blob_delete(files)
        await db.files.delete_many({"storage_path": {"$in": [f["storage_path"] for f in files]}})
    return len(files)


async def _erase_photos(user_id: str) -> int:
    n = await _delete_files({"owner_id": user_id, "kind": {"$in": ["progress", "pose"]}})
    await db.progress_photos.delete_many({"user_id": user_id})
    await db.pose_checks.update_many({"client_id": user_id, "snapshot": {"$ne": None}}, {"$set": {"snapshot": None, "snapshot_removed": True}})
    return n


@api_router.post("/me/consent", response_model=User)
async def set_consent(payload: ConsentIn, user: User = Depends(get_current_user)):
    if user.role == "client" and not payload.health_data:
        raise HTTPException(status_code=400, detail="Coaching needs your health data. If you'd rather not share it, you can delete your account.")
    before = (await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "consents": 1}) or {}).get("consents") or {}
    await record_consent(user.user_id, health=payload.health_data, photos=payload.photos, marketing=payload.marketing)
    if before.get("photos") and not payload.photos:
        await _erase_photos(user.user_id)  # withdrawing consent means we stop keeping the photos
    return User(**await db.users.find_one({"user_id": user.user_id}, {"_id": 0}))


EXPORT_COLLECTIONS = [  # (collection, field that holds the person's id)
    ("progress", "user_id"), ("progress_photos", "user_id"), ("daily_logs", "user_id"), ("food_logs", "user_id"),
    ("workout_sessions", "user_id"), ("plans", "client_id"), ("pose_checks", "client_id"), ("messages", "client_id"),
    ("bookings", "user_id"), ("transactions", "user_id"), ("membership_events", "user_id"), ("notifications", "user_id"),
    ("consent_log", "user_id"), ("referrals", "referee_id"), ("user_foods", "user_id"),
]


@api_router.get("/me/export")
async def export_my_data(user: User = Depends(get_current_user)):
    """Everything we hold about the signed-in person, as one JSON file (right to access)."""
    me = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "password_hash": 0, "google_sub": 0}) or {}
    out = {"exported_at": _now_iso(), "account": me}
    for coll, field in EXPORT_COLLECTIONS:
        out[coll] = await db[coll].find({field: user.user_id}, {"_id": 0}).to_list(10000)
    out["files"] = await db.files.find({"owner_id": user.user_id, "is_deleted": False}, {"_id": 0, "storage_path": 1, "kind": 1, "created_at": 1}).to_list(5000)
    for f in out["files"]:
        f["url"] = file_url(f.pop("storage_path"))
    body = json.dumps(out, default=str, ensure_ascii=False, indent=1)
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="fitcoach-data-{datetime.now(APP_TZ).date().isoformat()}.json"'})


async def erase_client(user_id: str, by: str):
    """Delete a client's account and personal data (right to erasure). Payment records are kept,
    without name or email, because tax law requires them."""
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("role") != "client":
        raise HTTPException(status_code=400, detail="Only client accounts can be deleted here — ask an admin to change the role first")
    if u.get("subscription_id") and u.get("subscription_status") == "active" and RAZORPAY_KEY_ID:
        try:
            await asyncio.to_thread(_razorpay_client().subscription.cancel, u["subscription_id"], {"cancel_at_cycle_end": 0})
        except Exception:
            logger.exception("Could not cancel subscription for deleted account")
    await _delete_files({"owner_id": user_id})
    for coll, field in [("progress", "user_id"), ("progress_photos", "user_id"), ("daily_logs", "user_id"), ("food_logs", "user_id"),
                        ("workout_sessions", "user_id"), ("plans", "client_id"), ("pose_checks", "client_id"), ("messages", "client_id"),
                        ("bookings", "user_id"), ("calls", "client_id"), ("notifications", "user_id"), ("dismissed_reminders", "user_id"),
                        ("push_subscriptions", "user_id"), ("ai_summaries", "client_id"), ("membership_events", "user_id"),
                        ("consent_log", "user_id"), ("subscriptions", "user_id"), ("user_foods", "user_id"), ("password_resets", "user_id"),
                        ("audit_log", "user_id"), ("referrals", "referee_id"), ("referrals", "referrer_id")]:
        await db[coll].delete_many({field: user_id})
    await db.leads.delete_many({"email": u.get("email")})
    await db.login_attempts.delete_many({"identifier": {"$regex": f":{re.escape(u.get('email') or '')}$"}})
    await db.transactions.update_many({"user_id": user_id}, {"$set": {"user_id": "deleted", "anonymized": True}})
    await db.users.delete_one({"user_id": user_id})
    await db.deletion_log.insert_one({"id": str(uuid.uuid4()), "by": by, "at": _now_iso()})


@api_router.delete("/me")
async def delete_my_account(payload: DeleteAccountIn, response: Response, user: User = Depends(get_current_user)):
    if payload.confirm.strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail='Type DELETE to confirm')
    if user.role != "client":
        raise HTTPException(status_code=400, detail="Coach and admin accounts are removed by an administrator")
    await erase_client(user.user_id, by="self")
    response.delete_cookie("access_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@api_router.delete("/admin/users/{target_id}")
async def admin_delete_client(target_id: str, user: User = Depends(require_role("admin"))):
    await erase_client(target_id, by=f"admin:{user.user_id}")
    return {"ok": True}


# ───────────────────────────── Consultation leads ─────────────────────────────
LEAD_STATUSES = ["new", "contacted", "scheduled", "converted", "lost"]
LEAD_SLOTS = {"morning": "Morning (9–12)", "afternoon": "Afternoon (12–4)", "evening": "Evening (4–8)"}
LEAD_RETENTION_DAYS = 180


class LeadIn(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    goal: Optional[str] = None
    preferred_date: Optional[str] = None
    preferred_slot: Optional[str] = None
    message: Optional[str] = None
    consent: bool = False
    website: Optional[str] = None  # honeypot — real people never fill this in


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


def _norm_phone(raw: str) -> Optional[str]:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return f"+91{digits}" if re.fullmatch(r"[6-9]\d{9}", digits) else None


async def on_client_signup(user_id: str, email: str):
    """If this person booked a consultation first, mark the lead as converted."""
    await db.leads.update_many({"email": email.lower(), "status": {"$ne": "converted"}},
                               {"$set": {"status": "converted", "user_id": user_id, "converted_at": _now_iso()}})


@api_router.post("/leads")
async def create_lead(payload: LeadIn, request: Request):
    """Public: someone books a free consultation call from the landing page."""
    if payload.website:
        return {"ok": True}
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Please agree to be contacted about your consultation")
    name = _txt(payload.name, 80)
    phone = _norm_phone(payload.phone)
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name")
    if not phone:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit Indian mobile number")
    email = (payload.email or "").strip().lower() or None
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="That email doesn't look right")
    today = datetime.now(APP_TZ).date()
    date = None
    if payload.preferred_date:
        try:
            d = datetime.fromisoformat(payload.preferred_date).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        if not today <= d <= today + timedelta(days=30):
            raise HTTPException(status_code=400, detail="Pick a day in the next 30 days")
        date = d.isoformat()
    slot = payload.preferred_slot if payload.preferred_slot in LEAD_SLOTS else None
    ip_hash = hashlib.sha256(f"{get_client_ip(request)}|{JWT_SECRET}".encode()).hexdigest()[:16]
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    if await db.leads.count_documents({"ip_hash": ip_hash, "created_at": {"$gte": hour_ago}}) >= 5:
        raise HTTPException(status_code=429, detail="Too many requests — please try again later")
    fields = {"name": name, "phone": phone, "email": email, "goal": payload.goal if payload.goal in VALID_FOCUS else None,
              "preferred_date": date, "preferred_slot": slot, "message": _txt(payload.message, 600) or None,
              "consent_at": _now_iso(), "updated_at": _now_iso()}
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    existing = await db.leads.find_one({"phone": phone, "status": {"$in": ["new", "contacted", "scheduled"]}, "created_at": {"$gte": week_ago}})
    if existing:
        await db.leads.update_one({"id": existing["id"]}, {"$set": fields})
        return {"ok": True}
    lead = {"id": str(uuid.uuid4()), **fields, "status": "new", "notes": [], "source": "landing", "ip_hash": ip_hash, "created_at": _now_iso()}
    await db.leads.insert_one(dict(lead))
    when = " · ".join(x for x in (date and datetime.fromisoformat(date).strftime("%d %b"), slot and LEAD_SLOTS[slot].split(" ")[0]) if x)
    async for admin in db.users.find({"role": "admin"}, {"_id": 0, "user_id": 1}):
        await push_notification(admin["user_id"], "New consultation request", f"{name}{' · ' + GOAL_TEXT.get(lead['goal'], '') if lead['goal'] else ''}{' · ' + when if when else ''}", "/admin/leads")
    return {"ok": True}


@api_router.get("/admin/leads")
async def admin_leads(status: Optional[str] = None, user: User = Depends(require_role("admin"))):
    q = {"status": status} if status in LEAD_STATUSES else {}
    leads = await db.leads.find(q, {"_id": 0, "ip_hash": 0}).sort("created_at", -1).to_list(500)
    counts = {s: await db.leads.count_documents({"status": s}) for s in LEAD_STATUSES}
    return {"leads": leads, "counts": counts, "slots": LEAD_SLOTS}


@api_router.put("/admin/leads/{lead_id}")
async def admin_update_lead(lead_id: str, payload: LeadUpdate, user: User = Depends(require_role("admin"))):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    update: dict = {"$set": {"updated_at": _now_iso()}}
    if payload.status is not None:
        if payload.status not in LEAD_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        update["$set"]["status"] = payload.status
    note = _txt(payload.note, 500)
    if note:
        update["$push"] = {"notes": {"text": note, "by": user.name, "at": _now_iso()}}
    await db.leads.update_one({"id": lead_id}, update)
    return await db.leads.find_one({"id": lead_id}, {"_id": 0, "ip_hash": 0})


@api_router.delete("/admin/leads/{lead_id}")
async def admin_delete_lead(lead_id: str, user: User = Depends(require_role("admin"))):
    await db.leads.delete_one({"id": lead_id})
    return {"ok": True}


async def purge_old_leads():
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LEAD_RETENTION_DAYS)).isoformat()
    res = await db.leads.delete_many({"created_at": {"$lt": cutoff}})
    if res.deleted_count:
        logger.info("Purged %s leads older than %s days", res.deleted_count, LEAD_RETENTION_DAYS)


# ───────────────────────────── Admin insights ─────────────────────────────
def _median(vals: List[float]) -> Optional[float]:
    if not vals:
        return None
    v = sorted(vals)
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2


async def coach_response_times(since: datetime) -> List[dict]:
    """Per coach: how quickly they answer client messages (minutes) and what's still waiting."""
    now = datetime.now(timezone.utc)
    coaches = await db.users.find({"role": "trainer"}, {"_id": 0, "user_id": 1, "name": 1, "coach_type": 1}).to_list(200)
    msgs = await db.messages.find({"created_at": {"$gte": since.isoformat()}}, {"_id": 0, "client_id": 1, "coach_id": 1, "sender_id": 1, "created_at": 1}).to_list(50000)
    threads: dict = {}
    for m in msgs:
        threads.setdefault((m["coach_id"], m["client_id"]), []).append(m)
    out = []
    for c in coaches:
        waits, waiting, overdue = [], 0, 0
        for (coach_id, client_id), items in threads.items():
            if coach_id != c["user_id"]:
                continue
            items.sort(key=lambda m: m["created_at"])
            pending = None
            for m in items:
                if m["sender_id"] == client_id:
                    pending = pending or _parse_dt(m["created_at"])
                elif m["sender_id"] == coach_id and pending:
                    waits.append((_parse_dt(m["created_at"]) - pending).total_seconds() / 60)
                    pending = None
            if pending:
                waiting += 1
                overdue += (now - pending) > timedelta(hours=24)
        clients = await db.users.count_documents({"role": "client", "$or": [{"fitness_coach_id": c["user_id"]}, {"yoga_coach_id": c["user_id"]}]})
        drafts = await db.plans.count_documents({"coach_id": c["user_id"], "status": "draft"})
        out.append({"coach_id": c["user_id"], "name": c.get("name"), "coach_type": c.get("coach_type") or "fitness", "clients": clients,
                    "replies": len(waits), "median_minutes": round(_median(waits)) if waits else None,
                    "within_24h_pct": round(100 * sum(w <= 1440 for w in waits) / len(waits)) if waits else None,
                    "waiting": waiting, "overdue": overdue, "open_drafts": drafts})
    out.sort(key=lambda r: (-(r["overdue"]), -(r["median_minutes"] or 0)))
    return out


@api_router.get("/admin/insights")
async def admin_insights(user: User = Depends(require_role("admin"))):
    now = datetime.now(timezone.utc)
    settings = await billing_settings()
    clients = await db.users.find({"role": "client"}, {"_id": 0, "user_id": 1, "name": 1, "created_at": 1, "membership_plan": 1,
                                                       "membership_expires_at": 1, "trial_granted": 1, "subscription_status": 1}).to_list(100000)
    paid = await db.transactions.find({"status": "paid"}, {"_id": 0, "user_id": 1, "type": 1, "amount_inr": 1, "paid_at": 1}).to_list(100000)
    plan_paid = sorted([t for t in paid if t["type"] in ("plan", "subscription")], key=lambda t: t.get("paid_at") or "")
    first_paid: dict = {}
    for t in plan_paid:
        first_paid.setdefault(t["user_id"], t.get("paid_at"))

    # sign-ups per week (Monday-start, India time), oldest first
    today = now.astimezone(APP_TZ).date()
    monday = today - timedelta(days=today.weekday())
    weeks = [monday - timedelta(weeks=i) for i in range(7, -1, -1)]
    signups = []
    for i, start in enumerate(weeks):
        end = weeks[i + 1] if i + 1 < len(weeks) else monday + timedelta(days=7)
        n = sum(1 for c in clients if (d := _parse_dt(c.get("created_at"))) and start <= d.astimezone(APP_TZ).date() < end)
        signups.append({"week": start.isoformat(), "count": n})

    status_counts = {"paid_active": 0, "trial": 0, "grace": 0, "lapsed": 0, "auto_renew": 0}
    trial_dropoffs, paid_dropoffs = [], []
    month_ago = now - timedelta(days=30)
    for c in clients:
        st = membership_status({**c, "role": "client"}, settings)
        exp = _parse_dt(c.get("membership_expires_at"))
        if st["active"]:
            status_counts["trial" if st["is_trial"] else "paid_active"] += 1
        elif st["in_grace"]:
            status_counts["grace"] += 1
        elif exp:
            status_counts["lapsed"] += 1
        if c.get("subscription_status") == "active":
            status_counts["auto_renew"] += 1
        if exp and month_ago <= exp <= now:
            row = {"user_id": c["user_id"], "name": c.get("name"), "plan": c.get("membership_plan"), "expired_at": exp.isoformat(), "in_grace": st["in_grace"]}
            (trial_dropoffs if st["is_trial"] else paid_dropoffs).append(row)

    recent = [c for c in clients if c.get("trial_granted") and (d := _parse_dt(c.get("created_at"))) and d >= now - timedelta(days=90)]
    converted = [c for c in recent if c["user_id"] in first_paid]
    trial_over = [c for c in recent if c["user_id"] not in first_paid and c.get("membership_plan") == "trial"
                  and (e := _parse_dt(c.get("membership_expires_at"))) and e <= now]

    renewals = new_paid = 0
    for t in plan_paid:
        at = _parse_dt(t.get("paid_at"))
        if at and at >= month_ago:
            if first_paid.get(t["user_id"]) == t.get("paid_at"):
                new_paid += 1
            else:
                renewals += 1
    renew_base = renewals + len(paid_dropoffs)

    def month_revenue(offset: int) -> int:
        first = today.replace(day=1)
        for _ in range(offset):
            first = (first - timedelta(days=1)).replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        return sum(int(t.get("amount_inr") or 0) for t in paid
                   if (d := _parse_dt(t.get("paid_at"))) and first <= d.astimezone(APP_TZ).date() < nxt)

    lead_counts = {s: await db.leads.count_documents({"status": s}) for s in LEAD_STATUSES}
    leads_30d = await db.leads.count_documents({"created_at": {"$gte": month_ago.isoformat()}})
    paid_dropoffs.sort(key=lambda r: r["expired_at"], reverse=True)
    trial_dropoffs.sort(key=lambda r: r["expired_at"], reverse=True)
    return {
        "generated_at": _now_iso(), "clients_total": len(clients), "signups": signups,
        "signups_30d": sum(1 for c in clients if (d := _parse_dt(c.get("created_at"))) and d >= month_ago),
        "status": status_counts,
        "trial_conversion": {"converted": len(converted), "ended_unpaid": len(trial_over),
                             "rate": round(100 * len(converted) / (len(converted) + len(trial_over))) if (converted or trial_over) else None},
        "renewals_30d": renewals, "new_paid_30d": new_paid,
        "renewal_rate": round(100 * renewals / renew_base) if renew_base else None,
        "dropoffs": {"paid": paid_dropoffs[:20], "trial": trial_dropoffs[:20], "paid_count": len(paid_dropoffs), "trial_count": len(trial_dropoffs)},
        "revenue": {"this_month": month_revenue(0), "last_month": month_revenue(1)},
        "leads": {"counts": lead_counts, "last_30d": leads_30d},
        "coaches": await coach_response_times(month_ago),
    }


# ───────────────────────────── Storage, backups ─────────────────────────────
DB_STORAGE_LIMIT_MB = int(os.environ.get("DB_STORAGE_LIMIT_MB", "512") or 512)  # MongoDB Atlas free tier = 512 MB
BACKUP_KEEP = 14
SKIP_IN_BACKUP = {"file_blobs", "call_signals"}  # file bytes are backed up separately; call signals are throwaway


async def storage_report() -> dict:
    """How full the database is, where files live, and the last automatic backup."""
    files = await db.files.find({"is_deleted": False}, {"_id": 0, "size": 1, "store": 1}).to_list(200000)
    in_db = [f for f in files if f.get("store", "db") != "s3"]
    in_s3 = [f for f in files if f.get("store") == "s3"]
    estimated = False
    try:
        st = await db.command("dbStats")
        used = int(st.get("dataSize", 0) + st.get("indexSize", 0))
    except Exception:  # some local/test databases don't support dbStats
        estimated = True
        used = sum(int(f.get("size") or 0) for f in in_db)
        for name in await db.list_collection_names():
            if name != "file_blobs":
                used += await db[name].count_documents({}) * 1024
    limit = DB_STORAGE_LIMIT_MB * 1024 * 1024
    backup = await db.app_settings.find_one({"_id": "backup_status"}, {"_id": 0}) or {}
    return {"used_bytes": used, "limit_bytes": limit, "pct": round(100 * used / limit, 1) if limit else None, "estimated": estimated,
            "files_in_db": len(in_db), "files_in_db_bytes": sum(int(f.get("size") or 0) for f in in_db),
            "files_in_storage": len(in_s3), "files_in_storage_bytes": sum(int(f.get("size") or 0) for f in in_s3),
            "object_storage": object_storage_enabled(), "backup": backup}


@api_router.get("/admin/storage")
async def admin_storage(user: User = Depends(require_role("admin"))):
    return await storage_report()


@api_router.post("/admin/storage/migrate")
async def admin_migrate_files(limit: int = 200, user: User = Depends(require_role("admin"))):
    """Move photos and voice notes out of the database into object storage, a batch at a time."""
    if not object_storage_enabled():
        raise HTTPException(status_code=400, detail="Set up object storage first (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)")
    moved = failed = 0
    for rec in await db.files.find({"store": {"$ne": "s3"}}, {"_id": 0}).to_list(max(1, min(limit, 500))):
        blob = await db.file_blobs.find_one({"storage_path": rec["storage_path"]})
        if not blob:
            await db.files.update_one({"storage_path": rec["storage_path"]}, {"$set": {"store": "missing"}})
            continue
        try:
            await asyncio.to_thread(_s3().put_object, Bucket=S3_BUCKET, Key=rec["storage_path"], Body=bytes(blob["data"]),
                                    ContentType=rec.get("content_type") or "application/octet-stream")
        except Exception:
            logger.exception("Could not move %s to object storage", rec["storage_path"])
            failed += 1
            continue
        await db.files.update_one({"storage_path": rec["storage_path"]}, {"$set": {"store": "s3"}})
        await db.file_blobs.delete_one({"storage_path": rec["storage_path"]})
        moved += 1
    remaining = await db.files.count_documents({"store": {"$nin": ["s3", "missing"]}})
    return {"moved": moved, "failed": failed, "remaining": remaining}


async def build_backup(include_files: bool = False) -> bytes:
    """Every collection as MongoDB Extended JSON, gzipped. Restore with backend/scripts/restore_backup.py."""
    from bson import json_util
    out = {"app": "fitcoach", "version": 1, "created_at": _now_iso(), "collections": {}}
    for name in sorted(await db.list_collection_names()):
        if name in SKIP_IN_BACKUP and not (include_files and name == "file_blobs"):
            continue
        out["collections"][name] = await db[name].find({}).to_list(None)
    return gzip.compress(json_util.dumps(out).encode("utf-8"))


@api_router.get("/admin/backup")
async def admin_download_backup(include_files: bool = False, user: User = Depends(require_role("admin"))):
    data = await build_backup(include_files)
    name = f"fitcoach-backup-{datetime.now(APP_TZ).strftime('%Y-%m-%d-%H%M')}{'-with-files' if include_files else ''}.json.gz"
    await db.app_settings.update_one({"_id": "backup_status"}, {"$set": {"last_download_at": _now_iso(), "last_download_by": user.name}}, upsert=True)
    return Response(content=data, media_type="application/gzip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def backup_to_storage() -> Optional[dict]:
    """Nightly: save a backup to object storage and keep the newest 14."""
    if not object_storage_enabled():
        return None
    status = {"last_attempt_at": _now_iso()}
    try:
        data = await build_backup()
        key = f"backups/fitcoach-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')}.json.gz"
        await asyncio.to_thread(_s3().put_object, Bucket=S3_BUCKET, Key=key, Body=data, ContentType="application/gzip")
        listing = await asyncio.to_thread(_s3().list_objects_v2, Bucket=S3_BUCKET, Prefix="backups/")
        keys = sorted(o["Key"] for o in listing.get("Contents", []))
        old = keys[:-BACKUP_KEEP]
        if old:
            await asyncio.to_thread(_s3().delete_objects, Bucket=S3_BUCKET, Delete={"Objects": [{"Key": k} for k in old], "Quiet": True})
        status.update({"last_backup_at": _now_iso(), "last_backup_key": key, "last_backup_bytes": len(data), "kept": min(len(keys), BACKUP_KEEP), "error": None})
    except Exception as e:
        logger.exception("Automatic backup failed")
        status["error"] = str(e)[:200]
    await db.app_settings.update_one({"_id": "backup_status"}, {"$set": status}, upsert=True)
    return status


@api_router.post("/admin/backup/run")
async def admin_run_backup(user: User = Depends(require_role("admin"))):
    if not object_storage_enabled():
        raise HTTPException(status_code=400, detail="Automatic backups need object storage (S3_BUCKET etc.). You can still download a backup.")
    return await backup_to_storage()


async def storage_watch():
    """Daily: warn admins before the database fills up."""
    rep_ = await storage_report()
    pct = rep_["pct"] or 0
    level = 95 if pct >= 95 else 80 if pct >= 80 else 0
    if not level:
        return
    today = datetime.now(APP_TZ).date().isoformat()
    mark = await db.app_settings.find_one({"_id": "storage_alert"}) or {}
    if mark.get("date") == today and mark.get("level") == level:
        return
    await db.app_settings.update_one({"_id": "storage_alert"}, {"$set": {"date": today, "level": level}}, upsert=True)
    tip = "Move files to object storage in Insights" if rep_["files_in_db"] else "Upgrade your MongoDB plan"
    async for admin in db.users.find({"role": "admin"}, {"_id": 0, "user_id": 1}):
        await push_notification(admin["user_id"], f"Database {pct:.0f}% full", f"{tip} before uploads start failing.", "/admin/insights")


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


# The app authenticates with a Bearer header, so cross-site requests never need cookies. Credentialed CORS is only
# allowed for the sites listed in CORS_ORIGINS; if that's unset, any site may call the API but without cookies.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=bool(CORS_ORIGINS),
    **({"allow_origins": CORS_ORIGINS} if CORS_ORIGINS else {"allow_origin_regex": ".*"}),
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
        await db.file_blobs.create_index("storage_path", unique=True)
        await db.push_subscriptions.create_index("endpoint", unique=True)
        await db.push_subscriptions.create_index("user_id")
        await db.transactions.create_index("payment_id", unique=True, partialFilterExpression={"payment_id": {"$type": "string"}})
        await db.users.create_index("referral_code", unique=True, partialFilterExpression={"referral_code": {"$type": "string"}})
        await db.membership_plans.create_index("id", unique=True)
        await db.leads.create_index([("status", 1), ("created_at", -1)])
        await db.food_logs.create_index([("user_id", 1), ("client_ref", 1)], unique=True, partialFilterExpression={"client_ref": {"$type": "string"}})
        await db.user_foods.create_index("id", unique=True)
        await db.password_resets.create_index("token_hash")
        await db.password_resets.create_index("expires_at")
        await db.leads.create_index("id", unique=True)
        await db.daily_logs.create_index([("user_id", 1), ("date", 1)], unique=True)
        await db.plan_templates.create_index([("coach_id", 1), ("type", 1)])
        await db.ai_summaries.create_index([("client_id", 1), ("viewer_id", 1), ("week", 1)], unique=True)
    except Exception as e:
        logger.warning(f"Index creation skipped: {e}")
    await seed_roles()
    await migrate_v2()
    await seed_billing()
    try:
        await load_vapid_keys()
    except Exception:
        logger.exception("Web Push disabled: could not load VAPID keys")
    _start_scheduler()
    logger.info("Plans & food estimates: %s, Google sign-in %s", "Gemini AI (built-in engine as fallback)" if GEMINI_API_KEY else "built-in engine (no AI key needed)",
                "on" if GOOGLE_CLIENT_ID else "off (set GOOGLE_CLIENT_ID)")




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
        _scheduler.add_job(send_membership_reminders, "interval", minutes=30, id="membership_reminders", replace_existing=True)
        _scheduler.add_job(purge_old_leads, "interval", hours=24, id="purge_leads", replace_existing=True)
        _scheduler.add_job(backup_to_storage, "cron", hour=21, minute=30, id="nightly_backup", replace_existing=True)  # 03:00 IST
        _scheduler.add_job(storage_watch, "interval", hours=12, id="storage_watch", replace_existing=True)
        _scheduler.start()
        logger.info("Reminder scheduler started (email_configured=%s)", email_configured())
    except Exception:
        logger.exception("Could not start reminder scheduler")


async def seed_roles():
    """Idempotent: ensure the configured admin exists (and demo trainers when SEED_DEMO_DATA=true)."""
    if not (ADMIN_EMAIL and ADMIN_PASSWORD):
        logger.warning("ADMIN_EMAIL/ADMIN_PASSWORD not set — no admin account was created or updated")
    elif len(ADMIN_PASSWORD) < 10 and not SEED_DEMO_DATA:
        logger.error("ADMIN_PASSWORD must be at least 10 characters — admin account not created")
    elif not (admin := await db.users.find_one({"email": ADMIN_EMAIL})):
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": ADMIN_EMAIL, "name": "Administrator",
            "role": "admin", "picture": None, "focus": None,
            "password_hash": hash_password(ADMIN_PASSWORD), "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.app_settings.update_one({"_id": "admin_env_password"}, {"$set": {
            "fingerprint": hashlib.sha256(f"{ADMIN_PASSWORD}|{JWT_SECRET}".encode()).hexdigest(), "at": _now_iso()}}, upsert=True)
    else:
        # ADMIN_PASSWORD is applied when it's first set or when you change it on the server (an emergency reset).
        # A password the admin changed in the app is kept across restarts otherwise.
        fingerprint = hashlib.sha256(f"{ADMIN_PASSWORD}|{JWT_SECRET}".encode()).hexdigest()
        applied = (await db.app_settings.find_one({"_id": "admin_env_password"}) or {}).get("fingerprint")
        if applied != fingerprint:
            if not verify_password(ADMIN_PASSWORD, admin.get("password_hash", "")):
                await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD), "role": "admin",
                                                                          "password_changed_at": _now_iso()}})
                logger.info("Admin password set from ADMIN_PASSWORD")
            await db.app_settings.update_one({"_id": "admin_env_password"}, {"$set": {"fingerprint": fingerprint, "at": _now_iso()}}, upsert=True)
        elif admin.get("role") != "admin":
            await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"role": "admin"}})

    if not SEED_DEMO_DATA:
        return
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
    """Idempotent: map v1 programmes to v2 goals, give every trainer a coach type, and give existing clients
    without a membership one free trial so nobody is locked out the moment billing goes live."""
    for old, new in LEGACY_FOCUS.items():
        await db.users.update_many({"focus": old}, {"$set": {"focus": new}})
    async for t in db.users.find({"role": "trainer", "coach_type": {"$in": [None, ""]}}, {"_id": 0}):
        ctype = "yoga" if "yoga" in (t.get("specialty") or "").lower() else "fitness"
        await db.users.update_one({"user_id": t["user_id"]}, {"$set": {"coach_type": ctype}})
    async for c in db.users.find({"role": "client", "membership_expires_at": {"$in": [None, ""]}, "trial_granted": {"$ne": True}}, {"_id": 0, "user_id": 1}):
        await start_trial(c["user_id"])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
