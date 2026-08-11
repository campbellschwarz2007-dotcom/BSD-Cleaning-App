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

# ----------------------------- Helpers -----------------------------

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def clean(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


async def get_actor(x_user_id: Optional[str], x_user_role: Optional[str]):
    if not x_user_id:
        return None
    user = await db.users.find_one({"id": x_user_id})
    return clean(user)


# ----------------------------- Models -----------------------------

class SignInInput(BaseModel):
    role: str
    name: Optional[str] = None
    password: Optional[str] = None


class Building(BaseModel):
    name: str
    blueprint_image: Optional[str] = None


class RoomInput(BaseModel):
    building_id: str
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
        return clean(user)

    if role == "boss":
        if not inp.name or not inp.password:
            raise HTTPException(status_code=400, detail="Name and password required")
        user = await db.users.find_one({"role": "boss", "name": inp.name.strip()})
        if not user:
            raise HTTPException(status_code=401, detail="No boss found with that name")
        if user.get("password") != inp.password:
            raise HTTPException(status_code=401, detail="Incorrect password")
        return clean(user)

    if role in ("cleaner", "teacher"):
        if not inp.name or not inp.name.strip():
            raise HTTPException(status_code=400, detail="Name required")
        name = inp.name.strip()
        user = await db.users.find_one({"role": role, "name": name})
        if not user:
            user = {"id": new_id(), "name": name, "role": role,
                    "password": None, "created_at": now_iso()}
            await db.users.insert_one(dict(user))
            if role == "cleaner":
                await db.conversations.update_one(
                    {"type": "all"}, {"$addToSet": {"participants": user["id"]}})
        return clean(user)

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
    await db.rooms.delete_many({"building_id": building_id})
    return {"deleted": True}


# ----------------------------- Rooms -----------------------------

@api_router.get("/rooms")
async def list_rooms(building_id: Optional[str] = None):
    q = {}
    if building_id:
        q["building_id"] = building_id
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
    doc = {"id": new_id(), **inp.dict(), "photos": [], "created_at": now_iso()}
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


# ----------------------------- Teacher visits -----------------------------

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
    if delta < 0:
        raise HTTPException(400, "Cannot mark a past day")
    if delta > 3:
        raise HTTPException(400, "You can only mark days up to 3 days in advance")
    existing = await db.visits.find_one(
        {"room_id": room_id, "teacher_id": actor["id"], "date": inp.date})
    if existing:
        await db.visits.delete_one({"id": existing["id"]})
        return {"toggled": "removed"}
    doc = {"id": new_id(), "room_id": room_id, "teacher_id": actor["id"],
           "teacher_name": actor["name"], "date": inp.date, "created_at": now_iso()}
    await db.visits.insert_one(dict(doc))
    return {"toggled": "added", **clean(doc)}


# ----------------------------- Tasks -----------------------------

async def _system_message(conversation_id, text, task_id=None):
    doc = {"id": new_id(), "conversation_id": conversation_id,
           "sender_id": "system", "sender_name": "Boss", "text": text,
           "task_id": task_id, "created_at": now_iso()}
    await db.messages.insert_one(dict(doc))


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
        await _system_message(convo["id"], f"New task: {inp.title}", task_id=doc["id"])
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
            convo["id"], f"Please redo this task: {t['title']}", task_id=task_id)
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
            "password": "boss123", "created_at": now_iso()}
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

    def mk_room(bid, name, typ, x, y, w, h, status):
        return {"id": new_id(), "building_id": bid, "name": name, "type": typ,
                "x": x, "y": y, "width": w, "height": h, "status": status,
                "photos": [], "created_at": now_iso()}

    rooms_b1 = [
        mk_room(b1["id"], "Room 101", "room", 8, 12, 90, 46, "completed"),
        mk_room(b1["id"], "Room 102", "room", 8, 66, 90, 46, "in_progress"),
        mk_room(b1["id"], "Room 103", "room", 8, 120, 90, 46, "untouched"),
        mk_room(b1["id"], "Room 104", "room", 62, 12, 90, 46, "teacher_in"),
        mk_room(b1["id"], "Room 105", "room", 62, 66, 90, 46, "untouched"),
        mk_room(b1["id"], "North Stairs", "stairs", 62, 120, 90, 46, "untouched"),
        mk_room(b1["id"], "Main Hallway", "hallway", 8, 180, 144, 40, "in_progress"),
        mk_room(b1["id"], "Front Entry", "entryway", 8, 234, 90, 44, "completed"),
    ]
    rooms_b2 = [
        mk_room(b2["id"], "Lab A", "room", 8, 12, 90, 46, "untouched"),
        mk_room(b2["id"], "Lab B", "room", 62, 12, 90, 46, "completed"),
        mk_room(b2["id"], "West Stairs", "stairs", 8, 66, 90, 46, "untouched"),
        mk_room(b2["id"], "Atrium", "entryway", 62, 66, 90, 46, "in_progress"),
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
         "room_id": rooms_b1[6]["id"], "room_name": "Main Hallway",
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


@app.on_event("startup")
async def on_startup():
    await seed()


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
