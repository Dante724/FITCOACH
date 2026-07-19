from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie, Header, BackgroundTasks
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

import bcrypt
import jwt
import httpx
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

DEFAULT_DAYS = [0, 1, 2, 3, 4]
DEFAULT_TIMES = ["07:00", "08:00", "09:00", "17:00", "18:00", "19:00"]

GMAIL_ADDRESS = os.environ.get('GMAIL_ADDRESS', '').strip()
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '').replace(' ', '').strip()
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '465'))
EMAIL_ENABLED = os.environ.get('EMAIL_ENABLED', 'true').lower() == 'true'
REMINDER_HOURS_BEFORE = int(os.environ.get('REMINDER_HOURS_BEFORE', '24'))

MEMBERSHIP_PLANS = [
    {"id": "monthly", "name": "Monthly", "price_inr": 10000, "days": 30, "blurb": "Full access, billed monthly"},
    {"id": "quarterly", "name": "Quarterly", "price_inr": 30000, "days": 90, "blurb": "Save with a 3-month commitment"},
    {"id": "annual", "name": "Annual", "price_inr": 50000, "days": 365, "blurb": "Best value — a full year of training"},
]
SESSION_PRICE_INR = 1000

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

VALID_FOCUS = {"strength", "nutrition", "yoga", "muscle_fat"}


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
    created_at: Optional[str] = None


class FocusUpdate(BaseModel):
    focus: str


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


class BodyScanRequest(BaseModel):
    image_base64: str


class WorkoutSessionCreate(BaseModel):
    name: str
    exercises: List[dict] = []
    duration_min: Optional[int] = None
    notes: Optional[str] = None


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
            session_dt = datetime.strptime(f"{b['date']} {b['time']}", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
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
    if payload.focus not in VALID_FOCUS:
        raise HTTPException(status_code=400, detail="Invalid focus")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"focus": payload.focus}})
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return User(**user_doc)


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
    }


def _room_for(booking_id: str) -> str:
    return "FitCoach-" + booking_id.replace("-", "")


@api_router.get("/trainers")
async def get_trainers(user: User = Depends(get_current_user)):
    docs = await db.users.find({"role": "trainer"}, {"_id": 0}).to_list(200)
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


@api_router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, request: Request, background: BackgroundTasks, user: User = Depends(get_current_user)):
    trainer = await db.users.find_one({"user_id": payload.trainer_id, "role": "trainer"}, {"_id": 0})
    if not trainer:
        raise HTTPException(status_code=400, detail="Invalid trainer")
    try:
        session_dt = datetime.strptime(f"{payload.date} {payload.time}", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    weekday = session_dt.weekday()
    days = trainer.get("available_days") or DEFAULT_DAYS
    times = trainer.get("available_times") or DEFAULT_TIMES
    if weekday not in days or payload.time not in times:
        raise HTTPException(status_code=409, detail="Trainer is not available at this time")
    # Prevent double booking across ALL clients for this trainer/date/time
    clash = await db.bookings.find_one({"trainer_id": payload.trainer_id, "date": payload.date, "time": payload.time})
    if clash:
        raise HTTPException(status_code=409, detail="This slot is already booked")

    booking = Booking(
        user_id=user.user_id, client_name=user.name, client_email=user.email,
        trainer_id=trainer["user_id"], trainer_name=trainer.get("name"), trainer_email=trainer.get("email", ""),
        specialty=trainer.get("specialty") or "Personal Trainer", date=payload.date, time=payload.time,
    )
    booking.room = _room_for(booking.id)
    booking.reminder_at = (session_dt - timedelta(hours=REMINDER_HOURS_BEFORE)).isoformat()
    await db.bookings.insert_one(booking.model_dump())
    await push_notification(user.user_id, "Session booked",
                            f"With {booking.trainer_name} on {booking.date} at {booking.time}.", "/booking")
    await push_notification(trainer["user_id"], "New booking",
                            f"{user.name} booked {booking.date} at {booking.time}.", "/trainer")
    origin = str(request.base_url).rstrip("/")
    background.add_task(send_booking_emails, booking.model_dump(), origin)
    return booking


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
@api_router.get("/admin/stats")
async def admin_stats(user: User = Depends(require_role("admin"))):
    return {
        "clients": await db.users.count_documents({"role": "client"}),
        "trainers": await db.users.count_documents({"role": "trainer"}),
        "bookings": await db.bookings.count_documents({}),
        "active_members": await db.users.count_documents({"membership_expires_at": {"$gt": datetime.now(timezone.utc).isoformat()}}),
    }


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

    reminders = []
    bookings = await db.bookings.find(
        {"$or": [{"user_id": user.user_id}, {"trainer_id": user.user_id}]}, {"_id": 0}
    ).to_list(300)
    for b in bookings:
        try:
            dt = datetime.strptime(f"{b['date']} {b['time']}", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (ValueError, KeyError):
            continue
        delta = dt - datetime.now(timezone.utc)
        if timedelta(minutes=-30) <= delta <= timedelta(hours=48):
            who = b.get("trainer_name") if b.get("user_id") == user.user_id else (b.get("client_name") or "your client")
            reminders.append({
                "id": f"rem-{b['id']}", "title": "Upcoming session",
                "body": f"With {who} — {_humanize_until(dt)} ({b['date']} at {b['time']})",
                "link": f"/call/{b['id']}", "kind": "reminder",
            })
    reminders.sort(key=lambda r: r["body"])
    unread = sum(1 for n in stored if not n.get("read"))
    return {"notifications": stored, "reminders": reminders, "unread": unread, "badge": unread + len(reminders)}


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
    except Exception as e:
        logger.warning(f"Index creation skipped: {e}")
    await seed_roles()
    _start_scheduler()


_scheduler = None


def _start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(send_due_reminders, "interval", minutes=5, id="reminders", replace_existing=True)
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
        {"email": "sarah.trainer@fitcoach.com", "name": "Sarah Johnson", "specialty": "Strength & Conditioning"},
        {"email": "mike.trainer@fitcoach.com", "name": "Mike Chen", "specialty": "Muscle Building & Fat Loss"},
        {"email": "priya.trainer@fitcoach.com", "name": "Priya Sharma", "specialty": "Yoga & Flexibility"},
    ]
    for t in demo_trainers:
        if not await db.users.find_one({"email": t["email"]}):
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": t["email"], "name": t["name"],
                "role": "trainer", "specialty": t["specialty"], "bio": f"Certified coach specialising in {t['specialty']}.",
                "available_days": list(DEFAULT_DAYS), "available_times": list(DEFAULT_TIMES), "picture": None, "focus": None,
                "password_hash": hash_password("Trainer@123"), "created_at": datetime.now(timezone.utc).isoformat(),
            })


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
