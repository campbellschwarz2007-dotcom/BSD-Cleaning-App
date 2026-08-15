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

## Iteration 3 (2026-08-11)
- Floor plan rebuilt as a pinch-to-zoom / pan / double-tap-to-zoom canvas (react-native-gesture-handler + reanimated) available to every role.
- Background blueprint is now full-bleed (edge-to-edge), not inside a rounded card.
- Admin editing is now Canva/Drawings-style: drag a room box to move it and pull its bottom-right corner handle to resize; positions & sizes persist to the backend. Removed the old X/Y/W/H nudge buttons.
- Verified drag-to-move + resize persist via API; full-bleed render and zoom hint confirmed on device viewport.

## Iteration 4 (2026-08-11)
- Boss Daily Digest: Numbers page now shows a "Today's Digest" card for Boss/Admin — Done-today / Pending / Redo counts plus a list of every task completed today (room, who, time). Uses /api/tasks/summary.
- Contest Winner: Contest feed shows a celebratory "This Week's Winner" gradient banner (crown, name, votes, thumbnail) for the top-voted submission — visible to every role.
- Floor plan panning: fixed so you can freely scroll/pan around the map while zoomed in (clamped to image bounds); removed a gesture-blocking bug that stopped view-mode panning.
- Added accessible on-screen zoom +/- buttons on the floor plan (in addition to pinch / double-tap) so anyone can zoom without gestures.

## Iteration 5 (2026-06 fork)
- PIN sign-in: Cleaners & Teachers now sign in in two steps — enter name, then PIN. First sign-in for a name CREATES a 4-digit PIN (bcrypt-hashed server-side); subsequent sign-ins require it. New endpoint POST /api/auth/pin-status returns {exists, has_pin} so the UI shows "Create a PIN" vs "Enter your PIN". Legacy/seeded names have no PIN and set one on next sign-in. Signin responses now sanitized via pub() (never leak pin_hash/password). Boss/Admin password login unchanged.
- Local notifications (replaces push): messages now trigger on-device pop-up alerts while the app is open. Global MessageNotifier polls conversations every 8s and fires expo-notifications local notifications for new messages from others. No Firebase/native build required (foreground alerts). Web = no-op.
- Teachers: cleaning Checklist and Photos sections are now hidden in the room sheet for the teacher role (they still see status, memos/notes, and the booking calendar).

## Iteration 6 (2026-06 fork)
- Room rename sync fix: admin room/hallway name editing is now a controlled input + Save button (was uncontrolled onEndEditing that failed to persist on web). Name updates everywhere immediately.
- Rotate boxes: admin edit sheet has ↺/↻ buttons (15° steps) — rooms.rotation persisted; FloorCanvas applies rotation to the pin and repositions the resize handle to the rotated corner.
- Label font size: admin A−/A+ buttons (rooms.font_size, 6–24px). Minimum resize box lowered to 20x16 so boxes can be much smaller.
- Auto status from tasks: room status is now derived from checklist completion (none=gray untouched, some=yellow in_progress, all=green completed). Recomputed server-side on checklist toggle/add/delete. Manual status buttons are ADMIN-ONLY (override); removed for cleaner/teacher/boss. 'teacher_in' removed from manual choices.
- Teacher-in = per day: booking a room no longer sets a persistent red status. Instead GET /rooms returns teacher_today (true if a visit dated today exists); the floor plan shows red ONLY on the actual visit day, otherwise the normal cleaning color. Un-booking never touches cleaning status.
- Teacher booking gating: teachers can only book gray/yellow rooms (untouched/in_progress) and at least 3 days ahead; completed (green) rooms are blocked (backend 400 + UI message + locked days).
- Web zoom: computer/web now shows + / − zoom buttons in the floor canvas (pinch stays for phone). Hint text adapts per platform.
