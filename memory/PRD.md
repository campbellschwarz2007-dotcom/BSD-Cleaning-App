# PRD — Go Big Red (School Facility Cleaning Management App)

## Original Problem Statement
Multi-role mobile app for a school cleaning crew. Roles: Cleaner, Teacher, Boss, Admin.
- Cleaner: sign in by name; All chatroom + DMs + group chats; submit & vote weekly photo contest; complete tasks; see teacher notes.
- Teacher: sign in by name; floor plan + numbers; mark days coming in (max 3 days ahead); add room notes visible to cleaners/boss/admin.
- Boss: sign in by name + password; see all chats + DM anyone; assign tasks to cleaners/groups (appear as task cards in messages); daily summary of completed tasks; mark task "redo" which DMs the completer.
- Admin: sign in by password "gobigred" (case-insensitive); edit floor plan, rooms, stairs, hallways, entryways, numbers page.
- Floor plan: pick building by dropdown; tap room → memos + photos + task list; stairs/hallways = task list only; admin can rename/move/resize/delete pins & add rooms; background blueprint. Status colors gray/red/yellow/green.
- Numbers: weekday countdown to school start (admin-set) + per-building progress bars (rooms/hallways/stairs/entryways).
- Contest: only cleaner/boss submit; ALL roles vote.

## User Choices
- Near real-time chat via polling (Expo Go friendly).
- PIN sign-in deferred; name-based profiles for now.
- Photos stored as base64 in MongoDB (S3 migration available when AWS keys provided).
- Seeded demo data. Design: agent's choice — Husker-red iOS-native clean theme.

## Architecture
- Frontend: Expo Router (React Native, SDK 54), role-based bottom tabs, expo-image, expo-linear-gradient, expo-image-picker, expo-haptics.
- Backend: FastAPI + Motor (MongoDB), all routes under /api. Lightweight header-based identity (x-user-id / x-user-role).
- DB collections: users, buildings, rooms, memos, visits, tasks, conversations, messages, contests, submissions, settings.

## Personas
- Cleaner (field worker), Teacher (classroom occupant), Boss (supervisor), Admin (config owner).

## Implemented (2026-08-11)
- Role-based sign-in (auth.tsx) incl. admin password "gobigred", boss name+password.
- Interactive floor plan with colored status pins, building dropdown, room detail sheet (status, photos, memos, teacher visits, tasks), admin edit mode (rename/type/nudge/delete + add room).
- Numbers dashboard: weekday countdown hero + per-building progress bars; admin can set school start date.
- Chat: list + All Chatroom + DMs/groups, polling refresh, message bubbles, in-chat task cards (complete/redo).
- Task assignment from room sheet (boss/admin) delivered as DM task cards.
- Photo contest: feed with vote toggle (all roles), submit (cleaner/boss) via image picker, leader badge.
- Seeded demo data (2 buildings, rooms, cleaners, teacher, boss, tasks, memo, active contest, school start date).
- Backend fully tested: 31/31 pytest pass. Frontend flows verified via Playwright.

## Backlog
- P1: Migrate photo storage to S3 (playbook ready) once AWS credentials provided.
- P1: Optional PIN for cleaner/teacher sign-in.
- P2: Boss daily-summary dedicated screen (endpoint exists: /api/tasks/summary).
- P2: Admin building creation + blueprint image upload UI (backend ready).
- P2: Push notifications (native build only) — on request.
- P3: Enter-to-send on web; migrate deprecated shadow* props to boxShadow.

## Next Tasks
- Await user feedback; wire up S3 if keys shared; build boss daily-summary screen.

## Iteration 2 (2026-08-11)
- Boss now signs in with password only ("Scharf", case-insensitive) — no name required.
- Floors: each building has multiple floors; floor plan scoped by building + floor. New /api/floors CRUD; rooms carry floor_id; migration backfills existing data.
- Admin "Manage building" sheet: rename/add/delete building, add/rename/delete floors, upload a blueprint photo per floor (shown behind the room pins).
- Teacher "Teacher In" calendar: 3-week grid; booking allowed only >= 3 days in advance; booking a day turns the room red (teacher_in); un-booking reverts to untouched when no visits remain.
- Bug fix: signing out now redirects to the auth/role-picker screen.
- Verified: backend 34/34 pytest pass; all iteration-2 frontend flows pass.
