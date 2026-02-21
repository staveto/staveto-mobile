# Problems / Defects Feature – Implementation Summary

## Overview

New "Problems" (Defects/Issues) reporting per project. Team members can create, view, assign, and track problems. Works for all project types: BUILD, MANAGEMENT, RESIDENTIAL, TRADE, MAINTENANCE.

**UI labels by project type:**
- BUILD + MANAGEMENT: "Problems" / "Problémy" / "Defekty"
- RESIDENTIAL: "Problémy"
- TRADE: "Reklamácie" (SK only)
- MAINTENANCE: "Poruchy" (SK only)

---

## Files Changed

### Firestore & Storage Rules
- `firestore.rules` – Added explicit `problems` subcollection rules (read: owner/member; create: owner/editor; update: owner/creator/assignee; delete: owner only)
- `storage.rules` – Added `projects/{projectId}/problems/{problemId}/{filename}` (read: owner/member; write: owner/editor; max 15MB)

### Services
- `src/services/problems.ts` – CRUD, list, count, categories by project type
- `src/services/problemPhotos.ts` – `uploadProblemPhoto`, `getProblemPhotoURL`
- `src/lib/firestorePaths.ts` – `projectProblems`, `projectProblem` paths

### Screens
- `src/screens/ProblemsListScreen.tsx` – List with status/priority filters, FAB to create
- `src/screens/ProblemDetailScreen.tsx` – Detail view, status workflow, photos
- `src/screens/CreateProblemScreen.tsx` – Create form (category, priority, description, assignee, due date, photos)

### Project Overview
- `src/screens/ProjectOverviewScreen.tsx` – Problems tile between Diary and Documents, badge count (open + in_progress)

### Navigation
- `src/navigation/RootNavigator.tsx` – `ProblemsList`, `ProblemDetail`, `CreateProblem` screens

### Notifications
- `src/services/notifications.ts` – `PROBLEM_ASSIGNED` type, entityType `problem`
- `src/screens/NotificationsScreen.tsx` – Icon, title, deep link to ProblemDetail

### Cloud Functions
- `functions/src/index.ts` – `onProblemCreated`, `onProblemUpdated` (create notification for assignee)

### Translations
- `src/i18n/translations.ts` – `problems.*`, `notifications.problemAssigned` for en, sk, de, cs, es, it, pl

---

## Data Model

**Collection:** `projects/{projectId}/problems/{problemId}`

| Field | Type | Description |
|-------|------|-------------|
| projectId | string | Project ID |
| projectType | string | BUILD, MANAGEMENT, etc. |
| category | string | safety, quality, incomplete_work, damage, material_logistics, documentation, other |
| priority | string | low, medium, high |
| status | string | open, in_progress, fixed, verified, rejected |
| shortDescription | string | Required |
| assigneeUid | string | Required |
| assigneeName | string | Optional cache |
| createdByUid | string | Creator UID |
| createdByName | string | Optional cache |
| createdAt | timestamp | Server timestamp |
| updatedAt | timestamp | Server timestamp |
| dueDate | timestamp \| null | Optional |
| photos | array | { path, downloadURL?, width?, height? } |
| locationHint | string \| null | Optional |
| audit | object | { lastStatusByUid, lastStatusAt } |

**Storage path:** `projects/{projectId}/problems/{problemId}/{filename}`

---

## Permissions

- **Read:** Project owner OR project member
- **Create:** Owner OR member with `permissionLevel == 'editor'`
- **Update:** Owner OR `createdByUid == uid` OR `assigneeUid == uid`
- **Delete:** Owner only

---

## Manual Test Plan

1. **Project Overview**
   - Open a project (any type).
   - Confirm "Problems" / "Poruchy" / "Reklamácie" tile appears between Diary and Documents.
   - Confirm badge shows count of open + in_progress problems (or 0).

2. **Create Problem**
   - Tap Problems tile → Problems list.
   - Tap FAB "+".
   - Fill: category, priority, description, assignee (required), optional due date, optional photos.
   - Save → success toast, return to list.
   - Confirm problem appears in list.

3. **Problem Detail**
   - Tap a problem.
   - Confirm all fields and photos are shown.
   - As creator/assignee/owner: change status (Open → In progress → Fixed → Verified, or Rejected).
   - Confirm status updates.

4. **Notifications**
   - Create problem with assignee ≠ creator.
   - Confirm assignee receives PROBLEM_ASSIGNED notification.
   - Tap notification → navigate to ProblemDetail.

5. **Permissions**
   - As viewer: can view problems, cannot create or edit.
   - As editor: can create and edit (if creator/assignee).
   - As owner: can delete.

6. **Photos**
   - Create problem with 1+ photos.
   - Confirm photos upload and display in detail.
   - Confirm Storage rules (15MB limit).

7. **Filters**
   - In Problems list, filter by status and priority.
   - Confirm list updates correctly.

---

## Deploy Steps

```bash
# From repo root (staveto-app_v2)
firebase deploy --only firestore:rules
firebase deploy --only storage
firebase deploy --only functions:onProblemCreated,functions:onProblemUpdated
```

---

## Firestore Indexes

Single-field indexes are auto-created. If composite indexes are needed (e.g. for filtered list queries), Firestore Console will show a link when the query runs.
