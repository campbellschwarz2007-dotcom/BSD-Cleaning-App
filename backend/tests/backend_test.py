"""
Go Big Red backend API tests - Iteration 2.
Covers: password-only boss auth, floors CRUD + blueprint, floor-scoped
rooms, migration, teacher >=3-day booking rule (turns room red / toggles
back to untouched), plus regression coverage of buildings/rooms/memos/
photos/tasks/chat/contest/settings/numbers.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ------------------------------ Auth ------------------------------

@pytest.fixture(scope="session")
def actors(s):
    r = s.post(f"{API}/auth/signin", json={"role": "cleaner", "name": "Sam Carter"})
    assert r.status_code == 200, r.text
    cleaner = r.json()
    r = s.post(f"{API}/auth/signin", json={"role": "teacher", "name": "Ms. Nguyen"})
    assert r.status_code == 200, r.text
    teacher = r.json()
    # NEW: boss password-only, no name
    r = s.post(f"{API}/auth/signin", json={"role": "boss", "password": "Scharf"})
    assert r.status_code == 200, r.text
    boss = r.json()
    r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": "GOBIGRED"})
    assert r.status_code == 200, r.text
    admin = r.json()
    return {"cleaner": cleaner, "teacher": teacher, "boss": boss, "admin": admin}


class TestAuth:
    # --- new boss password-only rules ---
    @pytest.mark.parametrize("pw", ["scharf", "Scharf", "SCHARF", "ScHaRf"])
    def test_boss_password_only_case_insensitive(self, s, pw):
        r = s.post(f"{API}/auth/signin", json={"role": "boss", "password": pw})
        assert r.status_code == 200, f"{pw} -> {r.status_code} {r.text}"
        u = r.json()
        assert u["role"] == "boss" and "id" in u

    def test_boss_no_name_required(self, s):
        # explicit: no name field at all
        r = s.post(f"{API}/auth/signin", json={"role": "boss", "password": "Scharf"})
        assert r.status_code == 200

    def test_boss_wrong_password(self, s):
        r = s.post(f"{API}/auth/signin",
                   json={"role": "boss", "password": "wrongpw"})
        assert r.status_code == 401

    def test_boss_missing_password(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "boss"})
        assert r.status_code == 401

    # --- admin regression ---
    def test_admin_case_insensitive(self, s):
        for pw in ("gobigred", "GoBigRed", "GOBIGRED"):
            r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": pw})
            assert r.status_code == 200, pw

    def test_admin_wrong_password(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "admin", "password": "nope"})
        assert r.status_code == 401

    def test_cleaner_autocreate(self, s):
        name = f"TEST_Cleaner_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/auth/signin", json={"role": "cleaner", "name": name})
        assert r.status_code == 200
        assert r.json()["role"] == "cleaner"

    def test_teacher_autocreate(self, s):
        name = f"TEST_Teacher_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/auth/signin", json={"role": "teacher", "name": name})
        assert r.status_code == 200
        assert r.json()["role"] == "teacher"

    def test_invalid_role(self, s):
        r = s.post(f"{API}/auth/signin", json={"role": "ghost"})
        assert r.status_code == 400


# ------------------------------ Floors (NEW) ------------------------------

class TestFloors:
    def test_migration_seeded_buildings_have_floor(self, s):
        buildings = s.get(f"{API}/buildings").json()
        assert len(buildings) >= 2
        for b in buildings:
            floors = s.get(f"{API}/floors", params={"building_id": b["id"]}).json()
            assert len(floors) >= 1, f"Building {b['name']} missing floor"

    def test_migration_rooms_have_floor_id(self, s):
        buildings = s.get(f"{API}/buildings").json()
        for b in buildings:
            rooms = s.get(f"{API}/rooms", params={"building_id": b["id"]}).json()
            for rm in rooms:
                assert rm.get("floor_id"), f"Room {rm['name']} missing floor_id"

    def test_rooms_scoped_by_floor(self, s):
        buildings = s.get(f"{API}/buildings").json()
        b = next(x for x in buildings if x["name"] == "Memorial Hall")
        floors = s.get(f"{API}/floors", params={"building_id": b["id"]}).json()
        assert len(floors) >= 1
        # Each floor's rooms match its floor_id
        for f in floors:
            rooms = s.get(f"{API}/rooms", params={"floor_id": f["id"]}).json()
            assert all(r["floor_id"] == f["id"] for r in rooms)
            assert all(r["building_id"] == b["id"] for r in rooms)

    def test_floor_crud_and_blueprint(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        # create
        r = s.post(f"{API}/floors",
                   json={"building_id": b["id"], "name": "TEST_Floor"})
        assert r.status_code == 200
        floor = r.json()
        assert floor["name"] == "TEST_Floor" and floor["building_id"] == b["id"]
        # rename
        r = s.put(f"{API}/floors/{floor['id']}", json={"name": "TEST_Floor_Renamed"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Floor_Renamed"
        # blueprint image
        img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        r = s.put(f"{API}/floors/{floor['id']}", json={"blueprint_image": img})
        assert r.status_code == 200
        assert r.json()["blueprint_image"] == img
        assert r.json()["name"] == "TEST_Floor_Renamed"  # unchanged
        # create a room on this floor
        rr = s.post(f"{API}/rooms", json={
            "building_id": b["id"], "floor_id": floor["id"],
            "name": "TEST_FloorRoom", "type": "room",
            "x": 5, "y": 5, "width": 90, "height": 44,
        })
        assert rr.status_code == 200
        room_id = rr.json()["id"]
        assert rr.json()["floor_id"] == floor["id"]
        # delete floor -> rooms on it are removed
        r = s.delete(f"{API}/floors/{floor['id']}")
        assert r.status_code == 200
        assert s.get(f"{API}/rooms/{room_id}").status_code == 404

    def test_delete_building_cascades_floors_and_rooms(self, s):
        # create isolated building
        rb = s.post(f"{API}/buildings", json={"name": "TEST_Bldg_Cascade"})
        assert rb.status_code == 200
        b = rb.json()
        rf = s.post(f"{API}/floors",
                    json={"building_id": b["id"], "name": "TEST_Floor_C"})
        f = rf.json()
        rr = s.post(f"{API}/rooms", json={
            "building_id": b["id"], "floor_id": f["id"],
            "name": "TEST_CascadeRoom", "type": "room",
        })
        room_id = rr.json()["id"]
        # delete building
        r = s.delete(f"{API}/buildings/{b['id']}")
        assert r.status_code == 200
        # floors of building gone
        floors_after = s.get(f"{API}/floors", params={"building_id": b["id"]}).json()
        assert floors_after == []
        # room gone
        assert s.get(f"{API}/rooms/{room_id}").status_code == 404

    def test_building_rename(self, s):
        rb = s.post(f"{API}/buildings", json={"name": "TEST_Bldg_Rename"})
        b = rb.json()
        r = s.put(f"{API}/buildings/{b['id']}",
                  json={"name": "TEST_Bldg_Renamed"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Bldg_Renamed"
        # cleanup
        s.delete(f"{API}/buildings/{b['id']}")


# ------------------------------ Buildings/Rooms regression ---------------

class TestBuildingsRooms:
    def test_list_buildings(self, s):
        bs = s.get(f"{API}/buildings").json()
        assert any(b["name"] == "Memorial Hall" for b in bs)

    def test_room_status_update(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        rooms = s.get(f"{API}/rooms", params={"building_id": b["id"]}).json()
        rm = rooms[0]
        orig = rm["status"]
        r = s.post(f"{API}/rooms/{rm['id']}/status", json={"status": "in_progress"})
        assert r.status_code == 200 and r.json()["status"] == "in_progress"
        s.post(f"{API}/rooms/{rm['id']}/status", json={"status": orig})

    def test_room_crud(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        f = s.get(f"{API}/floors", params={"building_id": b["id"]}).json()[0]
        r = s.post(f"{API}/rooms", json={
            "building_id": b["id"], "floor_id": f["id"],
            "name": "TEST_Room", "type": "room",
        })
        assert r.status_code == 200
        room = r.json()
        assert room["floor_id"] == f["id"]
        r = s.put(f"{API}/rooms/{room['id']}",
                  json={"name": "TEST_Room2", "x": 30})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Room2"
        r = s.delete(f"{API}/rooms/{room['id']}")
        assert r.status_code == 200
        assert s.get(f"{API}/rooms/{room['id']}").status_code == 404


# ------------------------------ Memos / Photos ---------------------------

class TestMemosPhotos:
    def test_memos_require_auth(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        rid = s.get(f"{API}/rooms", params={"building_id": b["id"]}).json()[0]["id"]
        r = requests.post(f"{API}/rooms/{rid}/memos", json={"text": "no auth"})
        assert r.status_code == 401

    def test_memos_create(self, s, actors):
        b = s.get(f"{API}/buildings").json()[0]
        rid = s.get(f"{API}/rooms", params={"building_id": b["id"]}).json()[0]["id"]
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        r = requests.post(f"{API}/rooms/{rid}/memos",
                          json={"text": "TEST_memo"}, headers=h)
        assert r.status_code == 200 and r.json()["author_role"] == "teacher"
        s.delete(f"{API}/memos/{r.json()['id']}")

    def test_room_photo_add_delete(self, s):
        b = s.get(f"{API}/buildings").json()[0]
        rid = s.get(f"{API}/rooms", params={"building_id": b["id"]}).json()[0]["id"]
        b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        before = len(s.get(f"{API}/rooms/{rid}").json().get("photos", []))
        r = s.post(f"{API}/rooms/{rid}/photos", json={"image": b64})
        assert r.status_code == 200
        assert len(r.json()["photos"]) == before + 1
        r = s.delete(f"{API}/rooms/{rid}/photos/{before}")
        assert r.status_code == 200 and len(r.json()["photos"]) == before


# ------------------------------ Teacher visits (NEW 3-day rule) ---------

class TestVisits:
    def _fresh_room_id(self, s):
        """Create a fresh room in untouched state so we can assert red-flip."""
        b = s.get(f"{API}/buildings").json()[0]
        f = s.get(f"{API}/floors", params={"building_id": b["id"]}).json()[0]
        r = s.post(f"{API}/rooms", json={
            "building_id": b["id"], "floor_id": f["id"],
            "name": f"TEST_VisitRoom_{uuid.uuid4().hex[:5]}",
            "type": "room", "status": "untouched",
        })
        return r.json()["id"]

    def test_visit_today_rejected(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        today = datetime.now(timezone.utc).date().isoformat()
        rid = self._fresh_room_id(s)
        r = requests.post(f"{API}/rooms/{rid}/visit",
                          json={"date": today}, headers=h)
        assert r.status_code == 400
        s.delete(f"{API}/rooms/{rid}")

    @pytest.mark.parametrize("offset", [1, 2])
    def test_visit_less_than_3_days_rejected(self, s, actors, offset):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        d = (datetime.now(timezone.utc).date() + timedelta(days=offset)).isoformat()
        rid = self._fresh_room_id(s)
        r = requests.post(f"{API}/rooms/{rid}/visit",
                          json={"date": d}, headers=h)
        assert r.status_code == 400
        assert "3 days" in r.text or "3" in r.text
        s.delete(f"{API}/rooms/{rid}")

    def test_visit_3_days_ahead_accepted_turns_room_red(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        d = (datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat()
        rid = self._fresh_room_id(s)
        assert s.get(f"{API}/rooms/{rid}").json()["status"] == "untouched"
        r = requests.post(f"{API}/rooms/{rid}/visit",
                          json={"date": d}, headers=h)
        assert r.status_code == 200 and r.json()["toggled"] == "added"
        assert s.get(f"{API}/rooms/{rid}").json()["status"] == "teacher_in"
        # toggle off -> reverts to untouched
        r = requests.post(f"{API}/rooms/{rid}/visit",
                          json={"date": d}, headers=h)
        assert r.status_code == 200 and r.json()["toggled"] == "removed"
        assert s.get(f"{API}/rooms/{rid}").json()["status"] == "untouched"
        s.delete(f"{API}/rooms/{rid}")

    def test_visit_far_future_accepted(self, s, actors):
        h = {"x-user-id": actors["teacher"]["id"], "x-user-role": "teacher"}
        d = (datetime.now(timezone.utc).date() + timedelta(days=10)).isoformat()
        rid = self._fresh_room_id(s)
        r = requests.post(f"{API}/rooms/{rid}/visit",
                          json={"date": d}, headers=h)
        assert r.status_code == 200 and r.json()["toggled"] == "added"
        # cleanup: toggle off and delete
        requests.post(f"{API}/rooms/{rid}/visit", json={"date": d}, headers=h)
        s.delete(f"{API}/rooms/{rid}")


# ------------------------------ Tasks ---------------------------------

class TestTasks:
    def test_task_permission(self, s, actors):
        h = {"x-user-id": actors["cleaner"]["id"], "x-user-role": "cleaner"}
        r = requests.post(f"{API}/tasks",
                          json={"title": "T", "assigned_to": [actors["cleaner"]["id"]]},
                          headers=h)
        assert r.status_code == 403

    def test_task_full_flow(self, s, actors):
        h_boss = {"x-user-id": actors["boss"]["id"], "x-user-role": "boss"}
        cid = actors["cleaner"]["id"]
        r = requests.post(f"{API}/tasks",
                          json={"title": "TEST_task", "assigned_to": [cid]},
                          headers=h_boss)
        assert r.status_code == 200
        t = r.json()
        h_c = {"x-user-id": cid, "x-user-role": "cleaner"}
        r = requests.post(f"{API}/tasks/{t['id']}/complete", headers=h_c)
        assert r.status_code == 200 and r.json()["status"] == "completed"
        r = requests.post(f"{API}/tasks/{t['id']}/redo", headers=h_boss)
        assert r.status_code == 200 and r.json()["status"] == "redo"


# ------------------------------ Chat ----------------------------------

class TestChat:
    def test_dm_dedupe(self, s, actors):
        h = {"x-user-id": actors["boss"]["id"]}
        payload = {"type": "dm",
                   "participants": [actors["boss"]["id"], actors["cleaner"]["id"]]}
        r1 = requests.post(f"{API}/conversations", json=payload, headers=h)
        r2 = requests.post(f"{API}/conversations", json=payload, headers=h)
        assert r1.json()["id"] == r2.json()["id"]

    def test_send_message_unauth(self, s, actors):
        convos = s.get(f"{API}/conversations",
                       params={"user_id": actors["cleaner"]["id"]}).json()
        all_c = next(c for c in convos if c["type"] == "all")
        r = requests.post(f"{API}/conversations/{all_c['id']}/messages",
                          json={"text": "x"})
        assert r.status_code == 401


# ------------------------------ Numbers -------------------------------

class TestNumbers:
    def test_numbers_shape(self, s):
        d = s.get(f"{API}/numbers").json()
        assert "countdown_weekdays" in d and "buildings" in d
        assert len(d["buildings"]) >= 2
        b = d["buildings"][0]
        for k in ("rooms", "hallways", "stairs", "entryways", "overall"):
            assert k in b
            for kk in ("total", "completed", "percent"):
                assert kk in b[k]
