Project Type: MAINTENANCE - Functional Export
=============================================

Purpose
-------
This document explains how MAINTENANCE projects work in the app and summarizes the
Firebase infrastructure, so you can safely extend functionality.

1) MAINTENANCE Project Behavior
-------------------------------

Project type definition
- `mobile/src/lib/types.ts` defines `ProjectType` and includes `MAINTENANCE`.

How projectType is set
- `mobile/src/services/projectFactory.ts` sets `projectType` when creating projects
  (used by `ProjectsScreen.tsx`).
- MAINTENANCE is currently not exposed as a direct UI option in `ProjectsScreen.tsx`,
  so it is likely set programmatically or via templates.

UI/logic differences (ProjectOverview)
- File: `mobile/src/screens/ProjectOverviewScreen.tsx`
- MAINTENANCE is grouped with TRADE/RESIDENTIAL in logic:
  - No phases are loaded.
  - Tasks are shown in a flat list (no phase grouping).
  - Tasks do not use `phaseId`.
  - Task creation allows text OR voice (not just text).

Key logic flags
- `isTradeOrMaintenance = projectType === "TRADE" || "RESIDENTIAL" || "MAINTENANCE"`
- `isBuildProject` is used to decide if phases exist.

Task behavior for MAINTENANCE
- `phaseId` is always `null`.
- Task ordering is global (not per phase).
- File: `mobile/src/services/tasks.ts`
  - If `phaseId` is missing, ordering uses a global max order for that project.

Role mapping
- `mobile/src/helpers/role.ts`
  - MAINTENANCE maps to ADMIN role.

Visuals
- `mobile/src/components/ProjectTypeChip.tsx`: MAINTENANCE uses `settings-outline` icon.
- `mobile/src/screens/HomeScreen.tsx`: same icon/label mapping for MAINTENANCE.

2) Firebase Infrastructure Summary
----------------------------------

Config files
- `firebase.json` (repo root):
  - Functions source: `functions/`, runtime: nodejs20
  - Firestore rules/indexes: `mobile/firestore.rules`, `mobile/firestore.indexes.json`
  - Storage rules: `mobile/storage.rules`

Firestore rules highlights
- `mobile/firestore.rules`
  - `users/{userId}`: only the user can read/update their doc.
  - `projects/{projectId}`: owner-only read/write.
  - `users/{userId}/ocrCache/{hash}`: owner-only.
  - `users/{userId}/contractors/{contractorId}`: owner-only.
  - `billingEvents`: read-only for owner.
  - `catalogTemplates`: read-only for signed-in users.
  - `notifications`: user-only access (read/readAt update).

Firestore indexes
- `mobile/firestore.indexes.json`
  - Tasks: assignedTo+status+updatedAt
  - Tasks: assignedTrade+status
  - Tasks: phaseId+order (ASC/DESC)
  - Notifications: userId+createdAt
  - Suppliers: phoneE164+status

Storage rules
- `mobile/storage.rules`
  - Attachments stored at:
    `projects/{projectId}/attachments/{attachmentId}/{fileName}`
  - Owner-only access, 50MB limit.
  - Deprecated path kept for backward compatibility.
  - User profile photos under `users/{userId}/profile/{fileName}`

Firebase SDK setup
- `mobile/src/firebase.ts` initializes:
  - auth, firestore, storage, functions

Cloud Functions
- `functions/src/index.ts`
  - `extractInvoiceData` (OCR, callable)
  - `inboundWebhook` (WhatsApp webhook export)
- `functions/src/whatsapp/` contains webhook logic.

3) Where to Extend
-----------------

To add MAINTENANCE-specific features:
- UI:
  - `mobile/src/screens/ProjectOverviewScreen.tsx`
  - `mobile/src/screens/ProjectsScreen.tsx` (project creation UI)
  - `mobile/src/screens/TasksScreen.tsx` (if you add global task views)
- Data/services:
  - `mobile/src/services/projects.ts` (project fields)
  - `mobile/src/services/tasks.ts` (task behavior)
  - `mobile/src/lib/types.ts` (types)
  - `mobile/src/lib/firestorePaths.ts` (paths)

To add backend features:
- `functions/src/index.ts` for new HTTPS/callable functions.
- `functions/src/whatsapp/` for inbound message processing.

4) Practical Notes
------------------
- MAINTENANCE currently has no phases; tasks are flat list.
- Any new feature should respect `projectType` checks.
- For new Firestore fields, update both:
  - Types (`mobile/src/lib/types.ts`)
  - Create/update payloads in services.

If you want, I can generate a second document that maps all screens and services
that a MAINTENANCE project touches.
