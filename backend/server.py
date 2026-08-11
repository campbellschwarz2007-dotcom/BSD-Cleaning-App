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
    status: str = "untouched"


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
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
        u.pop("password", None)
        u.pop("pin_hash", None)
        out.append(u)
    return out


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
    return [clean(r) for r in items]


@api_router.get("/rooms/{room_id}")
async def get_room(room_id: str):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    return clean(r)


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
    await db.rooms.update_one({"id": room_id}, {"$set": {"checklist": checklist}})
    r = await db.rooms.find_one({"id": room_id})
    return clean(r)


@api_router.post("/rooms/{room_id}/checklist")
async def add_checklist_item(room_id: str, inp: ChecklistAdd):
    item = {"id": new_id(), "text": inp.text, "done": False}
    await db.rooms.update_one({"id": room_id}, {"$push": {"checklist": item}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    return clean(r)


@api_router.delete("/rooms/{room_id}/checklist/{item_id}")
async def delete_checklist_item(room_id: str, item_id: str):
    await db.rooms.update_one({"id": room_id}, {"$pull": {"checklist": {"id": item_id}}})
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
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
        await db.visits.delete_one({"id": existing["id"]})
        remaining = await db.visits.find_one({"room_id": room_id})
        if not remaining:
            room = await db.rooms.find_one({"id": room_id})
            if room and room.get("status") == "teacher_in":
                await db.rooms.update_one({"id": room_id}, {"$set": {"status": "untouched"}})
        return {"toggled": "removed"}
    room = await db.rooms.find_one({"id": room_id})
    doc = {"id": new_id(), "room_id": room_id, "teacher_id": actor["id"],
           "teacher_name": actor["name"], "room_name": room["name"] if room else None,
           "date": inp.date, "created_at": now_iso()}
    await db.visits.insert_one(dict(doc))
    # marking a room turns it red ("teacher in")
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": "teacher_in"}})
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
           "room_id": inp.room_id, "room_name": room_name,
           "assigned_to": inp.assigned_to, "created_by": actor["id"],
           "created_by_name": actor["name"], "status": "pending",
           "completed_by": None, "completed_by_name": None,
           "completed_at": None, "created_at": now_iso()}
    await db.tasks.insert_one(dict(doc))
    for uid in inp.assigned_to:
        convo = await _dm_conversation(actor["id"], uid)
        await _system_message(convo["id"], f"New task: {inp.title}",
                              task_id=doc["id"], exclude_id=actor["id"])
    return clean(doc)


@api_router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str,
                        x_user_id: Optional[str] = Header(None),
                        x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor:
        raise HTTPException(401, "Not authenticated")
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "status": "completed", "completed_by": actor["id"],
        "completed_by_name": actor["name"], "completed_at": now_iso()}})
    t = await db.tasks.find_one({"id": task_id})
    if not t:
        raise HTTPException(404, "Task not found")
    return clean(t)


@api_router.post("/tasks/{task_id}/redo")
async def redo_task(task_id: str,
                    x_user_id: Optional[str] = Header(None),
                    x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor or actor["role"] not in ("boss", "admin"):
        raise HTTPException(403, "Only boss or admin can request a redo")
    t = await db.tasks.find_one({"id": task_id})
    if not t:
        raise HTTPException(404, "Task not found")
    completed_by = t.get("completed_by")
    completed_by_name = t.get("completed_by_name")
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "status": "redo", "completed_by": None, "completed_at": None}})
    if completed_by:
        convo = await _dm_conversation(actor["id"], completed_by)
        await _system_message(
            convo["id"], f"Please redo this task: {t['title']}",
            task_id=task_id, exclude_id=actor["id"])
    t = await db.tasks.find_one({"id": task_id})
    return clean(t)


@api_router.get("/tasks/summary")
async def task_summary(date: Optional[str] = None):
    day = date or datetime.now(timezone.utc).date().isoformat()
    all_tasks = await db.tasks.find().to_list(2000)
    completed_today = []
    for t in all_tasks:
        ca = t.get("completed_at")
        if t.get("status") == "completed" and ca and ca[:10] == day:
            completed_today.append(clean(t))
    total = len(all_tasks)
    completed = len([t for t in all_tasks if t.get("status") == "completed"])
    pending = len([t for t in all_tasks if t.get("status") == "pending"])
    redo = len([t for t in all_tasks if t.get("status") == "redo"])
    return {"date": day, "completed_today": completed_today,
            "totals": {"total": total, "completed": completed,
                       "pending": pending, "redo": redo}}


# ----------------------------- Conversations & messages -----------------------------

@api_router.get("/conversations")
async def list_conversations(user_id: str):
    convos = await db.conversations.find(
        {"$or": [{"type": "all"}, {"participants": user_id}]}
    ).to_list(500)
    users = await db.users.find().to_list(500)
    umap = {u["id"]: u["name"] for u in users}
    out = []
    for c in convos:
        c = clean(c)
        last = await db.messages.find({"conversation_id": c["id"]}).sort("created_at", -1).to_list(1)
        c["last_message"] = clean(last[0]) if last else None
        if c["type"] == "all":
            c["display_name"] = "All Chatroom"
        elif c["type"] == "group":
            c["display_name"] = c.get("name") or "Group"
        else:
            others = [p for p in c["participants"] if p != user_id]
            c["display_name"] = umap.get(others[0], "Direct Message") if others else "Direct Message"
        out.append(c)
    out.sort(key=lambda c: (c["last_message"]["created_at"] if c["last_message"] else c["created_at"]), reverse=True)
    return out


@api_router.post("/conversations")
async def create_conversation(inp: ConversationInput,
                              x_user_id: Optional[str] = Header(None)):
    if inp.type == "dm" and x_user_id:
        others = [p for p in inp.participants if p != x_user_id]
        if others:
            return await _dm_conversation(x_user_id, others[0])
    participants = list(set(inp.participants + ([x_user_id] if x_user_id else [])))
    doc = {"id": new_id(), "type": inp.type, "name": inp.name,
           "participants": participants, "created_at": now_iso()}
    await db.conversations.insert_one(dict(doc))
    return clean(doc)


@api_router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: str):
    items = await db.messages.find(
        {"conversation_id": conversation_id}).sort("created_at", 1).to_list(2000)
    out = []
    for m in items:
        m = clean(m)
        if m.get("task_id"):
            t = await db.tasks.find_one({"id": m["task_id"]})
            m["task"] = clean(t) if t else None
        out.append(m)
    return out


@api_router.post("/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, inp: MessageInput,
                       x_user_id: Optional[str] = Header(None)):
    if not x_user_id:
        raise HTTPException(401, "Not authenticated")
    user = await db.users.find_one({"id": x_user_id})
    if not user:
        raise HTTPException(401, "Not authenticated")
    doc = {"id": new_id(), "conversation_id": conversation_id,
           "sender_id": x_user_id, "sender_name": user["name"],
           "text": inp.text, "task_id": None, "created_at": now_iso()}
    await db.messages.insert_one(dict(doc))
    await _notify_conversation(conversation_id, x_user_id, user["name"], inp.text)
    return clean(doc)


# ----------------------------- Contest -----------------------------

@api_router.get("/contest/current")
async def current_contest(user_id: Optional[str] = None):
    contest = await db.contests.find_one({"active": True})
    if not contest:
        return {"contest": None, "submissions": []}
    contest = clean(contest)
    subs = await db.submissions.find({"contest_id": contest["id"]}).to_list(500)
    out = []
    for s in subs:
        s = clean(s)
        votes = s.get("votes", [])
        s["vote_count"] = len(votes)
        s["has_voted"] = user_id in votes if user_id else False
        s.pop("votes", None)
        out.append(s)
    out.sort(key=lambda s: s["vote_count"], reverse=True)
    return {"contest": contest, "submissions": out}


@api_router.post("/contest/submit")
async def submit_contest(inp: ContestSubmitInput,
                         x_user_id: Optional[str] = Header(None),
                         x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor or actor["role"] not in ("cleaner", "boss"):
        raise HTTPException(403, "Only cleaners and boss can submit")
    contest = await db.contests.find_one({"active": True})
    if not contest:
        raise HTTPException(400, "No active contest")
    doc = {"id": new_id(), "contest_id": contest["id"], "user_id": actor["id"],
           "user_name": actor["name"], "image": inp.image,
           "caption": inp.caption, "votes": [], "created_at": now_iso()}
    await db.submissions.insert_one(dict(doc))
    d = clean(doc)
    d["vote_count"] = 0
    d["has_voted"] = False
    d.pop("votes", None)
    return d


@api_router.post("/submissions/{submission_id}/vote")
async def vote_submission(submission_id: str,
                          x_user_id: Optional[str] = Header(None)):
    if not x_user_id:
        raise HTTPException(401, "Not authenticated")
    s = await db.submissions.find_one({"id": submission_id})
    if not s:
        raise HTTPException(404, "Submission not found")
    votes = s.get("votes", [])
    if x_user_id in votes:
        votes.remove(x_user_id)
        voted = False
    else:
        votes.append(x_user_id)
        voted = True
    await db.submissions.update_one({"id": submission_id}, {"$set": {"votes": votes}})
    return {"vote_count": len(votes), "has_voted": voted}


# ----------------------------- Settings -----------------------------

@api_router.get("/settings")
async def get_settings():
    s = await db.settings.find_one({"id": "singleton"})
    if not s:
        s = {"id": "singleton", "school_start_date": None,
             "contest_theme": "This Week's Best Clean"}
        await db.settings.insert_one(dict(s))
    return clean(s)


@api_router.put("/settings")
async def update_settings(inp: SettingsUpdate,
                          x_user_id: Optional[str] = Header(None),
                          x_user_role: Optional[str] = Header(None)):
    actor = await get_actor(x_user_id, x_user_role)
    if not actor or actor["role"] != "admin":
        raise HTTPException(403, "Only admin can update settings")
    update = {k: v for k, v in inp.dict().items() if v is not None}
    await db.settings.update_one({"id": "singleton"}, {"$set": update}, upsert=True)
    s = await db.settings.find_one({"id": "singleton"})
    return clean(s)


# ----------------------------- Numbers -----------------------------

def weekdays_between(start_date, end_date):
    days = 0
    cur = start_date
    while cur < end_date:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


@api_router.get("/numbers")
async def numbers():
    s = await db.settings.find_one({"id": "singleton"})
    school_start = s.get("school_start_date") if s else None
    countdown = None
    if school_start:
        try:
            start = datetime.fromisoformat(school_start).date()
            today = datetime.now(timezone.utc).date()
            countdown = max(0, weekdays_between(today, start))
        except ValueError:
            countdown = None

    buildings = await db.buildings.find().to_list(200)
    building_stats = []
    for b in buildings:
        rooms = await db.rooms.find({"building_id": b["id"]}).to_list(1000)

        def bucket(types):
            subset = [r for r in rooms if r.get("type") in types]
            total = len(subset)
            completed = len([r for r in subset if r.get("status") == "completed"])
            return {"total": total, "completed": completed,
                    "percent": round(completed / total * 100) if total else 0}

        building_stats.append({
            "id": b["id"], "name": b["name"],
            "rooms": bucket(["room"]),
            "hallways": bucket(["hallway"]),
            "stairs": bucket(["stairs"]),
            "entryways": bucket(["entryway"]),
            "overall": bucket(["room", "hallway", "stairs", "entryway"]),
        })
    return {"countdown_weekdays": countdown, "school_start_date": school_start,
            "buildings": building_stats}


# ----------------------------- Seed -----------------------------

async def seed():
    if await db.users.find_one({}):
        return
    logger.info("Seeding demo data...")

    boss = {"id": new_id(), "name": "Coach Riley", "role": "boss",
            "password": "Scharf", "created_at": now_iso()}
    cleaner_names = ["Sam Carter", "Jordan Lee", "Alex Kim"]
    cleaners = [{"id": new_id(), "name": n, "role": "cleaner",
                 "password": None, "created_at": now_iso()} for n in cleaner_names]
    teacher = {"id": new_id(), "name": "Ms. Nguyen", "role": "teacher",
               "password": None, "created_at": now_iso()}
    await db.users.insert_many([boss, teacher, *cleaners])

    b1 = {"id": new_id(), "name": "Memorial Hall",
          "blueprint_image": None, "created_at": now_iso()}
    b2 = {"id": new_id(), "name": "Science Center",
          "blueprint_image": None, "created_at": now_iso()}
    await db.buildings.insert_many([b1, b2])

    f1a = {"id": new_id(), "building_id": b1["id"], "name": "1st Floor",
           "blueprint_image": None, "created_at": now_iso()}
    f1b = {"id": new_id(), "building_id": b1["id"], "name": "2nd Floor",
           "blueprint_image": None, "created_at": now_iso()}
    f2a = {"id": new_id(), "building_id": b2["id"], "name": "Ground Floor",
           "blueprint_image": None, "created_at": now_iso()}
    await db.floors.insert_many([f1a, f1b, f2a])

    def mk_room(bid, fid, name, typ, x, y, w, h, status):
        return {"id": new_id(), "building_id": bid, "floor_id": fid, "name": name,
                "type": typ, "x": x, "y": y, "width": w, "height": h,
                "status": status, "photos": [], "created_at": now_iso()}

    rooms_b1 = [
        mk_room(b1["id"], f1a["id"], "Room 101", "room", 8, 12, 90, 46, "completed"),
        mk_room(b1["id"], f1a["id"], "Room 102", "room", 8, 66, 90, 46, "in_progress"),
        mk_room(b1["id"], f1a["id"], "Room 103", "room", 8, 120, 90, 46, "untouched"),
        mk_room(b1["id"], f1a["id"], "North Stairs", "stairs", 62, 120, 90, 46, "untouched"),
        mk_room(b1["id"], f1a["id"], "Main Hallway", "hallway", 8, 180, 144, 40, "in_progress"),
        mk_room(b1["id"], f1a["id"], "Front Entry", "entryway", 8, 234, 90, 44, "completed"),
        mk_room(b1["id"], f1b["id"], "Room 201", "room", 8, 12, 90, 46, "teacher_in"),
        mk_room(b1["id"], f1b["id"], "Room 202", "room", 62, 12, 90, 46, "untouched"),
    ]
    rooms_b2 = [
        mk_room(b2["id"], f2a["id"], "Lab A", "room", 8, 12, 90, 46, "untouched"),
        mk_room(b2["id"], f2a["id"], "Lab B", "room", 62, 12, 90, 46, "completed"),
        mk_room(b2["id"], f2a["id"], "West Stairs", "stairs", 8, 66, 90, 46, "untouched"),
        mk_room(b2["id"], f2a["id"], "Atrium", "entryway", 62, 66, 90, 46, "in_progress"),
    ]
    await db.rooms.insert_many(rooms_b1 + rooms_b2)

    all_participants = [boss["id"]] + [c["id"] for c in cleaners]
    all_convo = {"id": new_id(), "type": "all", "name": "All Chatroom",
                 "participants": all_participants, "created_at": now_iso()}
    await db.conversations.insert_one(dict(all_convo))
    await db.messages.insert_many([
        {"id": new_id(), "conversation_id": all_convo["id"], "sender_id": boss["id"],
         "sender_name": boss["name"],
         "text": "Welcome team! Let's make this the cleanest year yet. Go Big Red!",
         "task_id": None, "created_at": now_iso()},
        {"id": new_id(), "conversation_id": all_convo["id"], "sender_id": cleaners[0]["id"],
         "sender_name": cleaners[0]["name"], "text": "On it! Starting Memorial Hall now.",
         "task_id": None, "created_at": now_iso()},
    ])

    await db.tasks.insert_many([
        {"id": new_id(), "title": "Deep clean Room 101", "description": "Windows and floors",
         "room_id": rooms_b1[0]["id"], "room_name": "Room 101",
         "assigned_to": [cleaners[0]["id"]], "created_by": boss["id"],
         "created_by_name": boss["name"], "status": "completed",
         "completed_by": cleaners[0]["id"], "completed_by_name": cleaners[0]["name"],
         "completed_at": now_iso(), "created_at": now_iso()},
        {"id": new_id(), "title": "Mop Main Hallway", "description": "",
         "room_id": rooms_b1[4]["id"], "room_name": "Main Hallway",
         "assigned_to": [cleaners[1]["id"]], "created_by": boss["id"],
         "created_by_name": boss["name"], "status": "pending",
         "completed_by": None, "completed_by_name": None,
         "completed_at": None, "created_at": now_iso()},
    ])

    await db.memos.insert_one({
        "id": new_id(), "room_id": rooms_b1[3]["id"], "author_id": teacher["id"],
        "author_name": teacher["name"], "author_role": "teacher",
        "text": "Please don't move the science posters on the back wall - thanks!",
        "created_at": now_iso()})

    contest = {"id": new_id(), "week": datetime.now(timezone.utc).strftime("%Y-W%W"),
               "theme": "This Week's Best Clean", "active": True, "created_at": now_iso()}
    await db.contests.insert_one(dict(contest))

    start = (datetime.now(timezone.utc).date() + timedelta(days=30)).isoformat()
    await db.settings.insert_one({"id": "singleton", "school_start_date": start,
                                  "contest_theme": "This Week's Best Clean"})
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


@app.on_event("startup")
async def on_startup():
    await seed()
    await migrate_floors()
    await migrate_checklists()


@api_router.get("/")
async def root():
    return {"message": "Gobigred API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
