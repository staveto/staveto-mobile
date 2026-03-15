# Firestore Security Rules – Deploy & Test

## Deploy Rules

Deploy to the Staveto Firebase project:

```bash
firebase deploy --only firestore:rules --project staveto-mvp-5f251
```

From the repo root (`staveto-app_v2`).

**If you see "credentials are no longer valid":** run `firebase login --reauth` first.

## Rules Overview

- **users**: Read/write own doc only; subscription fields server-only
- **organizations**: Read for org members; create for self-owner; update/delete for org admin
- **organizations/{orgId}/members**: Create by org admin (or owner self); read for self or org members; update/delete by admin
- **invites**: Create by org admin; read for admin or invitee (by email); update for admin (revoke) or invitee (accept status); delete by admin
- **projects**: Personal (ownerId) or team (orgId); create/read/update/delete by owner or org members/admins
- **projects/{id}/* subcollections**: Same access as project (tasks, phases, expenses, etc.)

## Important: Accept Invite Flow

**Client cannot create `organizations/{orgId}/members/{uid}`** – only org admins can. Accepting an invite must go through a **Cloud Function** that:

1. Validates the invite token and invitee
2. Creates `organizations/{orgId}/members/{inviteeUid}`
3. Updates `invites/{inviteId}` to `status: "accepted"`

The current `acceptInvite` in `staveto-office/src/lib/organizations.ts` runs client-side and will be **DENIED** by these rules. Implement `acceptInvite` as a callable Cloud Function.

## Run QA Tests (Emulator)

**Prerequisites:** Java 21+ (Firebase emulator), Node.js.

1. Install deps (from repo root):

```bash
cd firestore-rules-test
npm install
cd ..
```

2. Run tests with emulator:

```bash
firebase emulators:exec --only firestore --project demo-staveto "node firestore-rules-test/run-tests.mjs"
```

The emulator loads rules from `mobile/firestore.rules` and runs the QA suite. Expected: all tests pass.

## QA Test Cases

| Action | Expected | Reason |
|--------|----------|--------|
| Admin creates organization (ownerUid=admin) | ALLOW | create: ownerUid == uid |
| Admin creates self as first org member | ALLOW | owner can create self with role admin, status active |
| Admin creates invite for invitee | ALLOW | isOrgAdmin |
| Admin creates project in org workspace | ALLOW | isOrgMember(orgId) |
| Invitee reads invite (email matches) | ALLOW | resource.data.emailLower == token.email |
| Invitee creates org member (accept) | **DENIED** | Only isOrgAdmin can create; use CF |
| Invitee reads project before membership | DENIED | Not org member |
| Invitee reads project after org membership | ALLOW | isOrgMember |
| User reads own user doc | ALLOW | uid == userId |
| User reads another user doc | DENIED | uid != userId |
| Owner creates personal project | ALLOW | ownerId == uid |
| User creates project with wrong ownerId | DENIED | ownerId != uid |
