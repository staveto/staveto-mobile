# Problems Feature – Implementation Summary

## Overview

End-to-end implementation of the Problems/Defects feature per spec: Firestore CRUD, UI (list/create/detail), storage upload, notifications, and rules.

## Files Changed

### Firestore & Storage Rules
- **firestore.rules** – Added `admin` to `canWriteAsEditor` (editor OR admin)
- **storage.rules** – Added `admin` to `canWriteAttachments` for consistency

### Services
- **src/services/problems.ts** – `createProblemAssignedNotification` on create; notification on assignee change in `updateProblem`
- **src/services/notifications.ts** – `createProblemAssignedNotification`, `problemId` in `NotificationDoc` and `toDoc`
- **src/services/problemPhotos.ts** – Already present; uses `projects/{projectId}/problems/{problemId}/{filename}`

### Screens
- **src/screens/ProjectOverviewScreen.tsx** – Project-type labels for Problems tile (Defekty/Problémy, Problémy, Reklamácie, Poruchy)
- **src/screens/ProblemsListScreen.tsx** – Same project-type labels for screen title
- **src/screens/ProblemDetailScreen.tsx** – Location, detail, audio player (Play/Pause) when `audioUrl` exists
- **src/screens/NotificationsScreen.tsx** – Uses `notification.problemId` for PROBLEM_ASSIGNED deep link
- **src/screens/CreateProblemScreen.tsx** – No changes (already implemented)

### Navigation
- **src/navigation/RootNavigator.tsx** – ProblemsListScreen, ProblemDetailScreen, CreateProblemScreen already wired

### Translations
- **src/i18n/translations.ts** – Added `problems.titleDefekty`, `problems.titleProblemy` for EN, DE, SK, CS, ES, IT, PL

## Permissions Model

| Action | Who |
|--------|-----|
| Read | Owner OR member (`isMember`) |
| Create | Owner OR member with `permissionLevel == 'editor'` OR `'admin'` |
| Update | Owner OR `createdByUid == uid` OR `assigneeUid == uid` |
| Delete | Owner only |

## Project Type Labels

| Project Type | SK | EN | DE |
|--------------|----|----|-----|
| BUILD, MANAGEMENT | Defekty/Problémy | Problems | Mängel/Probleme |
| RESIDENTIAL | Problémy | Problems | Probleme |
| TRADE | Reklamácie | Problems | Reklamationen |
| MAINTENANCE | Poruchy | Problems | Störungen |

## Storage Path

`projects/{projectId}/problems/{problemId}/{filename}` – read: owner or member; write: owner or editor/admin; max 15MB per file.

## Notifications

- **PROBLEM_ASSIGNED** – On problem create and on assignee change
- Deep link: `ProblemDetail` with `projectId`, `problemId`
- NotificationsScreen navigates to ProblemDetail on tap

## Manual Test Plan

1. **Create problem**
   - ProjectOverview → Problems tile → + → fill form → Save
   - Check: problem in list, assignee gets notification

2. **List & filter**
   - ProblemsListScreen: filters by status and priority
   - Empty state and FAB

3. **Detail**
   - Open problem → status flow, photos, location, detail, voice note (if present)
   - Audio: Play/Pause for voice note

4. **Permissions**
   - Viewer: can read, cannot create
   - Editor: can create, update (if creator/assignee)
   - Owner: can delete

5. **Notifications**
   - Create problem with assignee ≠ self → assignee gets notification
   - Change assignee → new assignee gets notification
   - Tap notification → navigates to ProblemDetail

6. **Project types**
   - BUILD/MANAGEMENT: "Defekty/Problémy"
   - RESIDENTIAL: "Problémy"
   - TRADE: "Reklamácie"
   - MAINTENANCE: "Poruchy"

## Firestore Indexes

If `countOpenProblems` fails with an index error, add:

```json
{
  "collectionGroup": "problems",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

Console: https://console.firebase.google.com/project/_/firestore/indexes
