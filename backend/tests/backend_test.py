"""
Go Big Red backend API tests.
Covers auth, buildings/rooms, memos, photos, visits, tasks, chat,
contest, settings, numbers.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://facility-task-hub.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ------------------------------ Auth ------------------------------

@pytest.fixture(scope="session")
def actors(s):
    # cleaner (seeded)
    r = s.post(f"{API}/auth/signin", json={"role": "cleaner", "name": "Sam Carter"})
    assert r.status_code == 200, r.text
    cleaner = r.json()
    # teacher (seeded)
    r = s.post(f"{API}/auth/signin", json={"role": "teacher", "name": "Ms. Nguyen"})
    assert r.status_code == 200, r.text
    teacher = r.json()
    # boss
    r = s.post(f"{API}/auth/signin",
               json={"role": "boss", "name": "Coach Riley", "password": "boss123"})
    assert r.status_code == 200, r.text
    boss = r.json()
    # admin
    r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": "GOBIGRED"})
    assert r.status_code == 200, r.text
    admin = r.json()
    return {"cleaner": cleaner, "teacher": teacher, "boss": boss, "admin": admin}


class TestAuth:
    def test_boss_wrong_password(self, s):
        r = s.post(f"{API}/auth/signin",
                   json={"role": "boss", "name": "Coach Riley", "password": "wrong"})
        assert r.status_code == 401

    def test_admin_wrong_password(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": "nope"})
        assert r.status_code == 401

    def test_admin_case_insensitive(self, s):
        for pw in ("gobigred", "GoBigRed", "GOBIGRED"):
            r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": pw})
            assert r.status_code == 200, pw

    def test_cleaner_autocreate(self, s):
        name = f"TEST_Cleaner_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/auth/signin", json={"role": "cleaner", "name": name})
        assert r.status_code == 200
        u = r.json()
        assert u["role"] == "cleaner" and u["name"] == name and u["id"]

    def test_teacher_autocreate(self, s):
        name = f"TEST_Teacher_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/auth/signin", json={"role": "teacher", "name": name})
        assert r.status_code == 200
        assert r.json()["role"] == "teacher"

    def test_boss_missing_name(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "boss", "password": "boss123"})
        assert r.status_code == 400

    def test_invalid_role(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "ghost"})
        assert r.status_code == 400


# ------------------------------ Buildings/Rooms ------------------------------

class TestBuildingsRooms:
    def test_list_buildings(self, s):
        r = s.get(f"{API}/buildings")
        assert r.status_code == 200
        bs = r.json()
        assert isinstance(bs, list) and len(bs) >= 2
        names = {b["name"] for b in bs}
        assert "Memorial Hall" in names

    def test_list_rooms_by_building(self, s):
        buildings = s.get(f"{API}/buildings").json()
        b = buildings[0]
        r = s.get(f"{API}/rooms", params={"building_id": b["id"]})
        assert r.status_code == 200
        rooms = r.json()
        assert len(rooms) > 0
        assert all(x["building_id"] == b["id"] for x in rooms)
        # room shape
        rm = rooms[0]
        for k in ("id", "name", "type", "x", "y", "width", "height", "status"):
            assert k in rm
        # verify GET single
        r2 = s.get(f"{API}/rooms/{rm['id']}")
        assert r2.status_code == 200
        assert r2.json()["id"] == rm["id"]

    def test_room_status_update(self, s):
        buildings = s.get(f"{API}/buildings").json()
        rooms = s.get(f"{API}/rooms", params={"building_id": buildings[0]["id"]}).json()
        rm = rooms[0]
        orig = rm["status"]
        r = s.post(f"{API}/rooms/{rm['id']}/status", json={"status": "in_progress"})
        assert r.status_code == 200 and r.json()["status"] == "in_progress"
        # verify persisted
        assert s.get(f"{API}/rooms/{rm['id']}").json()["status"] == "in_progress"
        # restore
        s.post(f"{API}/rooms/{rm['id']}/status", json={"status": orig})

    def test_room_crud_admin_edits(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        r = s.post(f"{API}/rooms", json={
            "building_id": b["id"], "name": "TEST_Room",
            "type": "room", "x": 10, "y": 20, "width": 80, "height": 40,
        })
        assert r.status_code == 200
        room = r.json()
        # update
        r = s.put(f"{API}/rooms/{room['id']}",
                  json={"name": "TEST_Room_Renamed", "x": 30, "width": 100})
        assert r.status_code == 200
        got = r.json()
        assert got["name"] == "TEST_Room_Renamed" and got["x"] == 30 and got["width"] == 100
        # verify
        got2 = s.get(f"{API}/rooms/{room['id']}").json()
        assert got2["name"] == "TEST_Room_Renamed"
        # delete
        r = s.delete(f"{API}/rooms/{room['id']}")
        assert r.status_code == 200
        assert s.get(f"{API}/rooms/{room['id']}").status_code == 404


# ------------------------------ Memos / Photos ------------------------------

class TestMemosPhotos:
    def test_memos_require_auth(self, s):
        buildings = s.get(f"{API}/buildings").json()
        rooms = s.get(f"{API}/rooms", params={"building_id": buildings[0]["id"]}).json()
        rid = rooms[0]["id"]
        r = requests.post(f"{API}/rooms/{rid}/memos", json={"text": "no auth"})
        assert r.status_code == 401

    def test_memos_create_and_list(self, s, actors):
        rooms = s.get(f"{API}/rooms", params={
            "building_id": s.get(f"{API}/buildings").json()[0]["id"]}).json()
        rid = rooms[0]["id"]
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        r = requests.post(f"{API}/rooms/{rid}/memos",
                          json={"text": "TEST_memo"}, headers=h)
        assert r.status_code == 200
        m = r.json()
        assert m["text"] == "TEST_memo" and m["author_role"] == "teacher"
        # list
        lst = s.get(f"{API}/rooms/{rid}/memos").json()
        assert any(x["id"] == m["id"] for x in lst)
        # cleanup
        s.delete(f"{API}/memos/{m['id']}")

    def test_room_photo_add_delete(self, s):
        rooms = s.get(f"{API}/rooms", params={
            "building_id": s.get(f"{API}/buildings").json()[0]["id"]}).json()
        rid = rooms[0]["id"]
        b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        before = len(s.get(f"{API}/rooms/{rid}").json().get("photos", []))
        r = s.post(f"{API}/rooms/{rid}/photos", json={"image": b64})
        assert r.status_code == 200
        after = len(r.json()["photos"])
        assert after == before + 1
        # delete
        r = s.delete(f"{API}/rooms/{rid}/photos/{after - 1}")
        assert r.status_code == 200
        assert len(r.json()["photos"]) == before


# ------------------------------ Visits ------------------------------

class TestVisits:
    def _rid(self, s):
        return s.get(f"{API}/rooms", params={
            "building_id": s.get(f"{API}/buildings").json()[0]["id"]}).json()[0]["id"]

    def test_visit_past_rejected(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        past = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        r = requests.post(f"{API}/rooms/{self._rid(s)}/visit",
                          json={"date": past}, headers=h)
        assert r.status_code == 400

    def test_visit_more_than_3_days_rejected(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        far = (datetime.now(timezone.utc).date() + timedelta(days=5)).isoformat()
        r = requests.post(f"{API}/rooms/{self._rid(s)}/visit",
                          json={"date": far}, headers=h)
        assert r.status_code == 400

    def test_visit_toggle(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        d = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
        rid = self._rid(s)
        r = requests.post(f"{API}/rooms/{rid}/visit", json={"date": d}, headers=h)
        assert r.status_code == 200 and r.json()["toggled"] == "added"
        r2 = requests.post(f"{API}/rooms/{rid}/visit", json={"date": d}, headers=h)
        assert r2.status_code == 200 and r2.json()["toggled"] == "removed"


# ------------------------------ Tasks ------------------------------

class TestTasks:
    def test_task_permission(self, s, actors):
        h = {"x-user-id": actors["cleaner"]["id"], "x-user-role": "cleaner"}
        r = requests.post(f"{API}/tasks",
                          json={"title": "T", "assigned_to": [actors["cleaner"]["id"]]},
                          headers=h)
        assert r.status_code == 403

    def test_task_full_flow(self, s, actors):
        h_boss = {"x-user-id": actors["boss"]["id"], "x-user-role": "boss"}
        cleaner_id = actors["cleaner"]["id"]
        r = requests.post(f"{API}/tasks",
                          json={"title": "TEST_task", "description": "d",
                                "assigned_to": [cleaner_id]},
                          headers=h_boss)
        assert r.status_code == 200
        t = r.json()
        assert t["status"] == "pending" and cleaner_id in t["assigned_to"]

        # Task should appear as system message in DM b/w boss and cleaner
        convos = s.get(f"{API}/conversations", params={"user_id": cleaner_id}).json()
        dm = next((c for c in convos
                   if c["type"] == "dm" and actors["boss"]["id"] in c["participants"]), None)
        assert dm, "DM conversation not created"
        msgs = s.get(f"{API}/conversations/{dm['id']}/messages").json()
        task_msg = next((m for m in msgs if m.get("task_id") == t["id"]), None)
        assert task_msg and task_msg.get("task") and task_msg["task"]["id"] == t["id"]

        # complete
        h_c = {"x-user-id": cleaner_id, "x-user-role": "cleaner"}
        r = requests.post(f"{API}/tasks/{t['id']}/complete", headers=h_c)
        assert r.status_code == 200 and r.json()["status"] == "completed"
        assert r.json()["completed_by"] == cleaner_id

        # redo (boss)
        r = requests.post(f"{API}/tasks/{t['id']}/redo", headers=h_boss)
        assert r.status_code == 200 and r.json()["status"] == "redo"

        # cleaner can't redo
        r = requests.post(f"{API}/tasks/{t['id']}/redo", headers=h_c)
        assert r.status_code == 403

    def test_task_summary(self, s):
        r = s.get(f"{API}/tasks/summary")
        assert r.status_code == 200
        d = r.json()
        assert "totals" in d and "completed_today" in d
        for k in ("total", "completed", "pending", "redo"):
            assert k in d["totals"]


# ------------------------------ Chat ------------------------------

class TestChat:
    def test_all_chatroom_visible(self, s, actors):
        convos = s.get(f"{API}/conversations",
                       params={"user_id": actors["cleaner"]["id"]}).json()
        assert any(c["type"] == "all" for c in convos)

    def test_dm_dedupe(self, s, actors):
        h = {"x-user-id": actors["boss"]["id"]}
        payload = {"type": "dm",
                   "participants": [actors["boss"]["id"], actors["cleaner"]["id"]]}
        r1 = requests.post(f"{API}/conversations", json=payload, headers=h)
        r2 = requests.post(f"{API}/conversations", json=payload, headers=h)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]

    def test_send_and_list_messages(self, s, actors):
        convos = s.get(f"{API}/conversations",
                       params={"user_id": actors["cleaner"]["id"]}).json()
        all_c = next(c for c in convos if c["type"] == "all")
        h = {"x-user-id": actors["cleaner"]["id"]}
        r = requests.post(f"{API}/conversations/{all_c['id']}/messages",
                          json={"text": "TEST_hello"}, headers=h)
        assert r.status_code == 200
        msgs = s.get(f"{API}/conversations/{all_c['id']}/messages").json()
        assert any(m["text"] == "TEST_hello" for m in msgs)

    def test_send_message_unauth(self, s, actors):
        convos = s.get(f"{API}/conversations",
                       params={"user_id": actors["cleaner"]["id"]}).json()
        all_c = next(c for c in convos if c["type"] == "all")
        r = requests.post(f"{API}/conversations/{all_c['id']}/messages",
                          json={"text": "x"})
        assert r.status_code == 401


# ------------------------------ Contest ------------------------------

class TestContest:
    def test_teacher_cannot_submit(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        r = requests.post(f"{API}/contest/submit",
                          json={"image": "data:image/png;base64,AAA", "caption": "t"},
                          headers=h)
        assert r.status_code == 403

    def test_admin_cannot_submit(self, s, actors):
        h = {"x-user-id": actors["admin"]["id"], "x-user-role": "admin"}
        r = requests.post(f"{API}/contest/submit",
                          json={"image": "data:image/png;base64,AAA"},
                          headers=h)
        assert r.status_code == 403

    def test_cleaner_submit_and_vote(self, s, actors):
        h = {"x-user-id": actors["cleaner"]["id"], "x-user-role": "cleaner"}
        r = requests.post(f"{API}/contest/submit",
                          json={"image": "data:image/png;base64,AAA",
                                "caption": "TEST_caption"},
                          headers=h)
        assert r.status_code == 200
        sub = r.json()
        assert sub["vote_count"] == 0 and sub["has_voted"] is False

        # teacher votes (any role)
        vh = {"x-user-id": actors["teacher"]["id"]}
        r = requests.post(f"{API}/submissions/{sub['id']}/vote", headers=vh)
        assert r.status_code == 200 and r.json() == {"vote_count": 1, "has_voted": True}
        # toggle off
        r = requests.post(f"{API}/submissions/{sub['id']}/vote", headers=vh)
        assert r.status_code == 200 and r.json() == {"vote_count": 0, "has_voted": False}

        # current for teacher shows has_voted correctness
        got = s.get(f"{API}/contest/current",
                    params={"user_id": actors["teacher"]["id"]}).json()
        assert got["contest"] is not None
        found = next((x for x in got["submissions"] if x["id"] == sub["id"]), None)
        assert found and "vote_count" in found and "has_voted" in found


# ------------------------------ Settings & Numbers ------------------------------

class TestSettingsNumbers:
    def test_get_settings(self, s):
        r = s.get(f"{API}/settings")
        assert r.status_code == 200

    def test_non_admin_cannot_update_settings(self, s, actors):
        h = {"x-user-id": actors["boss"]["id"], "x-user-role": "boss"}
        r = requests.put(f"{API}/settings",
                         json={"school_start_date": "2026-09-01"}, headers=h)
        assert r.status_code == 403

    def test_admin_updates_settings(self, s, actors):
        h = {"x-user-id": actors["admin"]["id"], "x-user-role": "admin"}
        target = (datetime.now(timezone.utc).date() + timedelta(days=14)).isoformat()
        r = requests.put(f"{API}/settings",
                         json={"school_start_date": target}, headers=h)
        assert r.status_code == 200
        assert r.json()["school_start_date"] == target
        # verify
        assert s.get(f"{API}/settings").json()["school_start_date"] == target

    def test_numbers_shape(self, s):
        r = s.get(f"{API}/numbers")
        assert r.status_code == 200
        d = r.json()
        assert "countdown_weekdays" in d and "buildings" in d
        assert isinstance(d["buildings"], list) and len(d["buildings"]) >= 2
        b = d["buildings"][0]
        for k in ("rooms", "hallways", "stairs", "entryways", "overall"):
            assert k in b
            for kk in ("total", "completed", "percent"):
                assert kk in b[k]
