# Firebase Cloud Functions

## User doc creation (createUserDoc)

- **Trigger**: `beforeUserCreated` (Auth blocking function) – creates Firestore `users/{uid}` before the Auth user is created.
- **Deploy**: `firebase deploy --only functions:createUserDoc`
- **Blocking functions**: After first deploy, register in Firebase Console: Authentication → Settings → Blocking functions → Add `createUserDoc` to "Before creating a user".

## Backfill existing Auth users

For Auth users that already exist without a Firestore doc, run the backfill script:

```bash
cd functions
set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json   # Windows
export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json # Linux/Mac
node scripts/backfillUsers.mjs
```

## Changelog

### Project clone feature

- **Endpoint**: `cloneProjectStructure` (onCall)
- **Behavior**: Clones project structure (phases, tasks) for allowed types (BUILD, RESIDENTIAL, TRADE, MANAGEMENT). Owner-only.
- **Sync path**: For projects with estimated writes ≤ 400, clones synchronously and returns `{ status: "done", newProjectId, phasesCount, tasksCount }`.
- **Async path**: For larger projects, returns `{ jobQueued: true, jobId }` and creates `cloneJobs/{jobId}` doc (async worker not implemented in MVP).
- **Tests**: `npm test` runs unit tests in `test/cloneProject.test.ts`.
