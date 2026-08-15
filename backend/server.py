from fastapi import FastAPI, APIRouter, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional
import uuid
import httpx
import re
import bcrypt
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()

#------------------------CORS SETUP-----------------------------
app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

ADMIN_PASSWORD = "gobigred"
BOSS_PASSWORD = "scharf"

# ----------------------------- Push (Emergent managed relay) -----------------------------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)

# ----------------------------- Helpers -----------------------------

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def clean(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


PIN_RE = re.compile(r"^\d{4}$")


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), (stored_hash or "").encode("utf-8"))
    except Exception:
        return False


def pub(user: dict) -> dict:
    """Public-safe user projection (never leak pin_hash / password)."""
    return {"id": user["id"], "name": user["name"], "role": user["role"]}


DEFAULT_CHECKLISTS = {
    "room": ["Empty all trash", "Wipe desks & tables", "Sweep & mop floor",
             "Clean windows & sills", "Sanitize high-touch surfaces"],
    "hallway": ["Sweep & mop floor", "Empty trash bins", "Wipe lockers",
                "Spot-clean walls & doors"],
    "stairs": ["Sweep every step", "Mop steps", "Wipe handrails", "Empty landing trash"],
    "entryway": ["Sweep & mop", "Clean glass doors", "Vacuum entry mats", "Empty trash"],
}


def make_checklist(room_type):
    items = DEFAULT_CHECKLISTS.get(room_type, DEFAULT_CHECKLISTS["room"])
    return [{"id": new_id(), "text": t, "done": False} for t in items]


def status_from_checklist(checklist):
    """Derive a room's cleaning status from how much of its checklist is done."""
    items = checklist or []
    total = len(items)
    done = len([i for i in items if i.get("done")])
    if total == 0 or done == 0:
        return "untouched"
    if done >= total:
        return "completed"
    return "in_progress"


def today_iso():
    return datetime.now(timezone.utc).date().isoformat()


async def get_actor(x_user_id: Optional[str], x_user_role: Optional[str]):
    if not x_user_id:
        return None
    user = await db.users.find_one({"id": x_user_id})
    return clean(user)


# ----------------------------- Push helpers -----------------------------

class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def send_push(recipients, data, idempotency_key=None):
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload = {"recipients": recipients[:100], "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    resp.raise_for_status()


async def _notify_conversation(conversation_id, sender_id, sender_name, text):
    try:
        convo = await db.conversations.find_one({"id": conversation_id})
        if not convo:
            return
        recipients = [p for p in convo.get("participants", [])
                      if p and p != sender_id and p != "system"]
        if not recipients:
            return
        is_all = convo.get("type") == "all"
        title = "All Chatroom" if is_all else sender_name
        body = f"{sender_name}: {text}" if is_all else text
        await send_push(recipients, {"title": title, "message": body,
                                     "action_url": f"/chat/{conversation_id}"})
    except Exception as e:
        logger.warning(f"Push failed (non-blocking): {e}")


# ----------------------------- Models -----------------------------

class SignInInput(BaseModel):
    role: str
    name: Optional[str] = None
    password: Optional[str] = None
    pin: Optional[str] = None


class PinStatusInput(BaseModel):
    role: str
    name: str


class Building(BaseModel):
    name: str
    blueprint_image: Optional[str] = None


class FloorInput(BaseModel):
    building_id: str
    name: str
    blueprint_image: Optional[str] = None


class FloorUpdate(BaseModel):
    name: Optional[str] = None
    blueprint_image: Optional[str] = None


class RoomInput(BaseModel):
    building_id: str
    floor_id: Optional[str] = None
    name: str
    type: str = "room"
    x: float = 50
    y: float = 50
    width: float = 90
    height: float = 44
    rotation: float = 0
    font_size: int = 12
    status: str = "untouched"


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    rotation: Optional[float] = None
    font_size: Optional[int] = None
    status: Optional[str] = None


class StatusInput(BaseModel):
    status: str


class MemoInput(BaseModel):
    text: str


class PhotoInput(BaseModel):
    image: str


class ChecklistAdd(BaseModel):
    text: str


class ChecklistToggle(BaseModel):
    item_id: str


class TaskInput(BaseModel):
    title: str
    description: Optional[str] = ""
    room_id: Optional[str] = None
    assigned_to: List[str] = []


class ConversationInput(BaseModel):
    type: str
    name: Optional[str] = None
    participants: List[str] = []


class MessageInput(BaseModel):
    text: str


class ContestSubmitInput(BaseModel):
    image: str
    caption: Optional[str] = ""


class SettingsUpdate(BaseModel):
    school_start_date: Optional[str] = None
    contest_theme: Optional[str] = None


class VisitInput(BaseModel):
    date: str


# ----------------------------- Auth -----------------------------

@api_router.post("/auth/pin-status")
async def pin_status(inp: PinStatusInput):
    role = inp.role.lower()
    if role not in ("cleaner", "teacher"):
        raise HTTPException(status_code=400, detail="Invalid role")
    name = (inp.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    user = await db.users.find_one({"role": role, "name": name})
    return {"exists": bool(user), "has_pin": bool(user and user.get("pin_hash"))}


@api_router.post("/auth/signin")
async def signin(inp: SignInInput):
    role = inp.role.lower()

    if role == "admin":
        if not inp.password or inp.password.strip().lower() != ADMIN_PASSWORD:
            raise HTTPException(status_code=401, detail="Incorrect admin password")
        user = await db.users.find_one({"role": "admin"})
        if not user:
            user = {"id": new_id(), "name": "Admin", "role": "admin",
                    "password": None, "created_at": now_iso()}
            await db.users.insert_one(dict(user))
        return pub(user)

    if role == "boss":
        if not inp.password or inp.password.strip().lower() != BOSS_PASSWORD:
            raise HTTPException(status_code=401, detail="Incorrect password")
        user = await db.users.find_one({"role": "boss"})
        if not user:
            user = {"id": new_id(), "name": "Boss", "role": "boss",
                    "password": None, "created_at": now_iso()}
            await db.users.insert_one(dict(user))
            await db.conversations.update_one(
                {"type": "all"}, {"$addToSet": {"participants": user["id"]}})
        return pub(user)

    if role in ("cleaner", "teacher"):
        if not inp.name or not inp.name.strip():
            raise HTTPException(status_code=400, detail="Name required")
        name = inp.name.strip()
        pin = (inp.pin or "").strip()
        user = await db.users.find_one({"role": role, "name": name})

        if not user:
            # First sign-in for this name: they must set a 4-digit PIN.
            if not PIN_RE.fullmatch(pin):
                raise HTTPException(status_code=400, detail="Please set a 4-digit PIN")
            user = {"id": new_id(), "name": name, "role": role, "password": None,
                    "pin_hash": hash_pin(pin), "created_at": now_iso()}
            await db.users.insert_one(dict(user))
            if role == "cleaner":
                await db.conversations.update_one(
                    {"type": "all"}, {"$addToSet": {"participants": user["id"]}})
            return pub(user)

        if user.get("pin_hash"):
            if not verify_pin(pin, user["pin_hash"]):
                raise HTTPException(status_code=401, detail="Incorrect PIN")
            return pub(user)

        # Existing (legacy/seeded) user without a PIN -> let them set one now.
        if not PIN_RE.fullmatch(pin):
            raise HTTPException(status_code=400, detail="Please set a 4-digit PIN")
        await db.users.update_one({"id": user["id"]}, {"$set": {"pin_hash": hash_pin(pin)}})
        return pub(user)

    raise HTTPException(status_code=400, detail="Invalid role")


# ----------------------------- Users -----------------------------

@api_router.get("/users")
async def list_users(role: Optional[str] = None):
    q = {}
    if role:
        q["role"] = role
    users = await db.users.find(q).to_list(500)
    out = []
    for u in users:
        u = clean(u)
        u["has_pin"] = bool(u.get("pin_hash"))
        u.pop("password", None)
        u.pop("pin_hash", None)
        out.append(u)
    return out


async def _require_admin(x_user_role: Optional[str]):
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


@api_router.post("/users/{user_id}/reset-pin")
async def reset_pin(user_id: str, x_user_role: Optional[str] = Header(None)):
    await _require_admin(x_user_role)
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] not in ("cleaner", "teacher"):
        raise HTTPException(status_code=400, detail="Only cleaners and teachers use a PIN")
    await db.users.update_one({"id": user_id}, {"$unset": {"pin_hash": ""}})
    return {"status": "reset", "id": user_id}


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, x_user_role: Optional[str] = Header(None)):
    await _require_admin(x_user_role)
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="Cannot remove the admin account")
    await db.users.delete_one({"id": user_id})
    # remove from any conversation participant lists (e.g. All Chatroom, groups)
    await db.conversations.update_many({}, {"$pull": {"participants": user_id}})
    return {"status": "removed", "id": user_id}



# ----------------------------- Buildings -----------------------------

@api_router.get("/buildings")
async def list_buildings():
    items = await db.buildings.find().to_list(200)
    return [clean(b) for b in items]


@api_router.post("/buildings")
async def create_building(inp: Building):
    doc = {"id": new_id(), "name": inp.name,
           "blueprint_image": inp.blueprint_image, "created_at": now_iso()}
    await db.buildings.insert_one(dict(doc))
    return clean(doc)


@api_router.put("/buildings/{building_id}")
async def update_building(building_id: str, inp: Building):
    update = {"name": inp.name}
    if inp.blueprint_image is not None:
        update["blueprint_image"] = inp.blueprint_image
    await db.buildings.update_one({"id": building_id}, {"$set": update})
    b = await db.buildings.find_one({"id": building_id})
    if not b:
        raise HTTPException(404, "Building not found")
    return clean(b)


@api_router.delete("/buildings/{building_id}")
async def delete_building(building_id: str):
    await db.buildings.delete_one({"id": building_id})
    await db.floors.delete_many({"building_id": building_id})
    await db.rooms.delete_many({"building_id": building_id})
    return {"deleted": True}


# ----------------------------- Floors -----------------------------

@api_router.get("/floors")
async def list_floors(building_id: Optional[str] = None):
    q = {}
    if building_id:
        q["building_id"] = building_id
    items = await db.floors.find(q).sort("created_at", 1).to_list(200)
    return [clean(f) for f in items]


@api_router.post("/floors")
async def create_floor(inp: FloorInput):
    doc = {"id": new_id(), "building_id": inp.building_id, "name": inp.name,
           "blueprint_image": inp.blueprint_image, "created_at": now_iso()}
    await db.floors.insert_one(dict(doc))
    return clean(doc)


@api_router.put("/floors/{floor_id}")
async def update_floor(floor_id: str, inp: FloorUpdate):
    update = {k: v for k, v in inp.dict().items() if v is not None}
    if update:
        await db.floors.update_one({"id": floor_id}, {"$set": update})
    f = await db.floors.find_one({"id": floor_id})
    if not f:
        raise HTTPException(404, "Floor not found")
    return clean(f)


@api_router.delete("/floors/{floor_id}")
async def delete_floor(floor_id: str):
    await db.floors.delete_one({"id": floor_id})
    await db.rooms.delete_many({"floor_id": floor_id})
    return {"deleted": True}


# ----------------------------- Rooms -----------------------------

@api_router.get("/rooms")
async def list_rooms(building_id: Optional[str] = None, floor_id: Optional[str] = None):
    q = {}
    if building_id:
        q["building_id"] = building_id
    if floor_id:
        q["floor_id"] = floor_id
    items = await db.rooms.find(q).to_list(1000)
    room_ids = [r["id"] for r in items]
    today = today_iso()
    visits_today = await db.visits.find(
        {"room_id": {"$in": room_ids}, "date": today}).to_list(2000)
    today_set = {v["room_id"] for v in visits_today}
    out = []
    for r in items:
        r = clean(r)
        r["teacher_today"] = r["id"] in today_set
        out.append(r)
    return out


@api_router.get("/rooms/{room_id}")
async def get_room(room_id: str):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    r = clean(r)
    r["teacher_today"] = bool(
        await db.visits.find_one({"room_id": room_id, "date": today_iso()}))
    return r


@api_router.post("/rooms")
async def create_room(inp: RoomInput):
    doc = {"id": new_id(), **inp.dict(), "photos": [],
           "checklist": make_checklist(inp.type), "created_at": now_iso()}
    await db.rooms.insert_one(dict(doc))
    return clean(doc)


@api_router.put("/rooms/{room_id}")
async def update_room(room_id: str, inp: RoomUpdate):
    update = {k: v for k, v in inp.dict().items() if v is not None}
    if update:
        await db.rooms.update_one({"id": room_id}, {"$set": update})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    return clean(r)


@api_router.post("/rooms/{room_id}/status")
async def set_room_status(room_id: str, inp: StatusInput):
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": inp.status}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    return clean(r)


@api_router.delete("/rooms/{room_id}")
async def delete_room(room_id: str):
    await db.rooms.delete_one({"id": room_id})
    return {"deleted": True}


# ----------------------------- Memos -----------------------------

@api_router.get("/rooms/{room_id}/memos")
async def list_memos(room_id: str):
    items = await db.memos.find({"room_id": room_id}).sort("created_at", -1).to_list(200)
    return [clean(m) for m in items]


@api_router.post("/rooms/{room_id}/memos")
async def add_memo(room_id: str, inp: MemoInput,
                   x_user_id: Optional[str] = Header(None),
                   x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor:
        raise HTTPException(401, "Not authenticated")
    doc = {"id": new_id(), "room_id": room_id, "author_id": actor["id"],
           "author_name": actor["name"], "author_role": actor["role"],
           "text": inp.text, "created_at": now_iso()}
    await db.memos.insert_one(dict(doc))
    return clean(doc)


@api_router.delete("/memos/{memo_id}")
async def delete_memo(memo_id: str):
    await db.memos.delete_one({"id": memo_id})
    return {"deleted": True}


# ----------------------------- Room photos -----------------------------

@api_router.post("/rooms/{room_id}/photos")
async def add_room_photo(room_id: str, inp: PhotoInput):
    await db.rooms.update_one({"id": room_id}, {"$push": {"photos": inp.image}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    return clean(r)


@api_router.delete("/rooms/{room_id}/photos/{index}")
async def delete_room_photo(room_id: str, index: int):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    photos = r.get("photos", [])
    if 0 <= index < len(photos):
        photos.pop(index)
        await db.rooms.update_one({"id": room_id}, {"$set": {"photos": photos}})
    r = await db.rooms.find_one({"id": room_id})
    return clean(r)


# ----------------------------- Room checklist -----------------------------

@api_router.post("/rooms/{room_id}/checklist/toggle")
async def toggle_checklist(room_id: str, inp: ChecklistToggle):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    checklist = r.get("checklist", [])
    for item in checklist:
        if item["id"] == inp.item_id:
            item["done"] = not item.get("done", False)
    await db.rooms.update_one(
        {"id": room_id},
        {"$set": {"checklist": checklist, "status": status_from_checklist(checklist)}})
    r = await db.rooms.find_one({"id": room_id})
    return clean(r)


@api_router.post("/rooms/{room_id}/checklist")
async def add_checklist_item(room_id: str, inp: ChecklistAdd):
    item = {"id": new_id(), "text": inp.text, "done": False}
    await db.rooms.update_one({"id": room_id}, {"$push": {"checklist": item}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    await db.rooms.update_one(
        {"id": room_id}, {"$set": {"status": status_from_checklist(r.get("checklist", []))}})
    r = await db.rooms.find_one({"id": room_id})
    return clean(r)


@api_router.delete("/rooms/{room_id}/checklist/{item_id}")
async def delete_checklist_item(room_id: str, item_id: str):
    await db.rooms.update_one({"id": room_id}, {"$pull": {"checklist": {"id": item_id}}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    await db.rooms.update_one(
        {"id": room_id}, {"$set": {"status": status_from_checklist(r.get("checklist", []))}})
    r = await db.rooms.find_one({"id": room_id})
    return clean(r)

@api_router.get("/visits")
async def list_visits(room_id: Optional[str] = None, teacher_id: Optional[str] = None):
    q = {}
    if room_id:
        q["room_id"] = room_id
    if teacher_id:
        q["teacher_id"] = teacher_id
    items = await db.visits.find(q).to_list(500)
    return [clean(v) for v in items]


@api_router.post("/rooms/{room_id}/visit")
async def add_visit(room_id: str, inp: VisitInput,
                    x_user_id: Optional[str] = Header(None),
                    x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor:
        raise HTTPException(401, "Not authenticated")
    try:
        visit_date = datetime.fromisoformat(inp.date).date()
    except ValueError:
        raise HTTPException(400, "Invalid date")
    today = datetime.now(timezone.utc).date()
    delta = (visit_date - today).days
    if delta < 3:
        raise HTTPException(400, "Teachers must book a room at least 3 days in advance")
    existing = await db.visits.find_one(
        {"room_id": room_id, "teacher_id": actor["id"], "date": inp.date})
    if existing:
        # Removing a booking never touches the room's cleaning status.
        await db.visits.delete_one({"id": existing["id"]})
        return {"toggled": "removed"}
    room = await db.rooms.find_one({"id": room_id})
    if not room:
        raise HTTPException(404, "Room not found")
    # Teachers may only book rooms that are gray (untouched) or yellow (in progress).
    if room.get("status") == "completed":
        raise HTTPException(400, "This room is already fully cleaned — no need to book it")
    doc = {"id": new_id(), "room_id": room_id, "teacher_id": actor["id"],
           "teacher_name": actor["name"], "room_name": room["name"],
           "date": inp.date, "created_at": now_iso()}
    await db.visits.insert_one(dict(doc))
    # NOTE: the room shows red on the floor plan only on the actual visit date
    # (computed via teacher_today); we no longer flip a persistent status.
    return {"toggled": "added", **clean(doc)}


# ----------------------------- Tasks -----------------------------

async def _system_message(conversation_id, text, task_id=None, exclude_id="system"):
    doc = {"id": new_id(), "conversation_id": conversation_id,
           "sender_id": "system", "sender_name": "Boss", "text": text,
           "task_id": task_id, "created_at": now_iso()}
    await db.messages.insert_one(dict(doc))
    await _notify_conversation(conversation_id, exclude_id, "Boss", text)


async def _dm_conversation(user_a, user_b):
    convo = await db.conversations.find_one(
        {"type": "dm", "participants": {"$all": [user_a, user_b], "$size": 2}})
    if convo:
        return clean(convo)
    doc = {"id": new_id(), "type": "dm", "name": None,
           "participants": [user_a, user_b], "created_at": now_iso()}
    await db.conversations.insert_one(dict(doc))
    return clean(doc)


@api_router.get("/tasks")
async def list_tasks(assigned_to: Optional[str] = None, room_id: Optional[str] = None):
    q = {}
    if assigned_to:
        q["assigned_to"] = assigned_to
    if room_id:
        q["room_id"] = room_id
    items = await db.tasks.find(q).sort("created_at", -1).to_list(1000)
    return [clean(t) for t in items]


@api_router.post("/tasks")
async def create_task(inp: TaskInput,
                      x_user_id: Optional[str] = Header(None),
                      x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor or actor["role"] not in ("boss", "admin"):
        raise HTTPException(403, "Only boss or admin can assign tasks")
    room_name = None
    if inp.room_id:
        room = await db.rooms.find_one({"id": inp.room_id})
        room_name = room["name"] if room else None
    doc = {"id": new_id(), "title": inp.title, "description": inp.description,
doc = {"id": new_id(), "title": inp.title, "description": inp.description,
           "room_id": inp.room_id, "room_name": room_name,
           "assigned_to": inp.assigned_to, "created_by": actor["id"],
           "created_by_name": actor["name"], "status": "pending",
           "completed_by": None, "completed_by_name": None,
           "completed_at": None, "created_at": now_iso()}
    await db.tasks.insert_one(dict(doc))
    return clean(doc)


# ----------------------------- Seed & Migrations -----------------------------

async def seed():
    # Keep your database seed intact
    seeded = await db.settings.find_one({"id": "_seeded"})
    if seeded and seeded.get("done"):
        return
    
    logger.info("Seeding initial database contents...")
    # Add any specific users or rooms your app defaults to here
    await db.settings.update_one({"id": "_seeded"}, {"$set": {"done": True}}, upsert=True)
    logger.info("Seed complete.")


async def migrate_floors():
    """Ensure every building has at least one floor and every room a floor_id."""
    buildings = await db.buildings.find().to_list(200)
    for b in buildings:
        floor = await db.floors.find_one({"building_id": b["id"]})
        if not floor:
            floor = {"id": new_id(), "building_id": b["id"], "name": "1st Floor",
                     "blueprint_image": b.get("blueprint_image"), "created_at": now_iso()}
            await db.floors.insert_one(dict(floor))
        await db.rooms.update_many(
            {"building_id": b["id"], "floor_id": {"$in": [None, ""]}},
            {"$set": {"floor_id": floor["id"]}})
        await db.rooms.update_many(
            {"building_id": b["id"], "floor_id": {"$exists": False}},
            {"$set": {"floor_id": floor["id"]}})


async def migrate_checklists():
    """Give any room missing a checklist a default one based on its type."""
    rooms = await db.rooms.find({"checklist": {"$exists": False}}).to_list(2000)
    for r in rooms:
        await db.rooms.update_one(
            {"id": r["id"]}, {"$set": {"checklist": make_checklist(r.get("type", "room"))}})


# ----------------------------- Lifecycle & Routes -----------------------------

@app.on_event("startup")
async def on_startup():
    await seed()
    await migrate_floors()
    await migrate_checklists()


@api_router.get("/")
async def root():
    return {"message": "Gobigred API"}


# Mount the API router to the app
app.include_router(api_router)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
