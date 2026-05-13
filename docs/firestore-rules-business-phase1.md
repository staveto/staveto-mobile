# Firestore rules & indexes — Staveto Business Phase 1 proposal

**Status:** Proposal only — not deployed, not applied to `firestore.rules` /
`firestore.indexes.json`. After human review, the diff below should be
applied as a separate commit and then deployed via
`firebase deploy --only firestore:rules,firestore:indexes`.

**Scope:** Tighten existing `organizations/{orgId}` rules so that server-only
licence/seat fields can never be mutated by the client, even by org admins.
Add (optional) composite index for `userId + status` collection-group
queries that Phase 2 may want.

**Out of scope (deferred to later phases):** invite-code claim flow, member
write paths, billing webhooks, admin custom claim machinery.

---

## 1. Background: current rules

The repo already contains `match /organizations/{orgId}` and
`match /organizations/{orgId}/members/{memberId}` in `firestore.rules`
(committed before Phase 0). The relevant block today is:

```firestore-rules
match /organizations/{orgId} {
  allow read: if signedIn() && isOrgMemberActive(orgId);
  allow create: if signedIn() && request.resource.data.ownerUid == uid();
  allow update, delete: if signedIn()
    && (isOrgAdmin(orgId, uid())
        || get(/databases/$(database)/documents/organizations/$(orgId)).data.ownerUid == uid());

  match /members/{memberId} { /* … */ }
}
```

`isOrgMember` / `isOrgMemberActive` / `isOrgAdmin` helpers already exist near
the top of the file and are correct.

---

## 2. Identified gap

The current `update` rule lets `owner` OR `admin` change **any** field of an
organization document, including:

| Field | Why it must be server-only |
|---|---|
| `status` | Drives Business gate (`active` / `pending_payment` / `suspended` / …). A client that flips this trivially escapes paywalls. |
| `businessEnabled` | Master switch for the Business surface. Same risk. |
| `seatsLimit` | Maximum number of active members. Client write = unlimited seats. |
| `seatsUsed` | Denormalised counter maintained by Cloud Functions. Client write desyncs it. |
| `businessActivatedAt` | Audit timestamp. |
| `businessActivatedBy` | Audit uid of the activating admin. |

Owner/admin clients SHOULD still be able to edit display/profile metadata:
`name`, `profile.*`, `updatedAt`.

---

## 3. Proposed rules diff (firestore.rules)

Replace the existing `match /organizations/{orgId}` block with the version
below. Helpers above (`isOrgAdmin`, `isOrgMemberActive`, …) stay unchanged.

```firestore-rules
match /organizations/{orgId} {

  // ─── helpers local to this block ─────────────────────────────────────────
  // Fields the client must NEVER change. Cloud Functions (admin SDK) bypass
  // these rules, so server-side licence/seat mutations still work.
  function orgServerOnlyFields() {
    return [
      'status',
      'businessEnabled',
      'seatsLimit',
      'seatsUsed',
      'businessActivatedAt',
      'businessActivatedBy'
    ];
  }
  // ownerUid must remain stable once the org exists. Same for createdAt.
  function orgImmutableFields() {
    return ['ownerUid', 'createdAt'];
  }

  // ─── read ────────────────────────────────────────────────────────────────
  allow read: if signedIn() && isOrgMemberActive(orgId);

  // ─── create ──────────────────────────────────────────────────────────────
  // Unchanged: the creating user becomes the owner. Server-only fields MUST
  // start in the safe defaults (status=pending_payment, businessEnabled=false,
  // seatsLimit=0, seatsUsed=0). A separate Cloud Function flips them later.
  allow create: if signedIn()
    && request.resource.data.ownerUid == uid()
    && request.resource.data.status == 'pending_payment'
    && request.resource.data.businessEnabled == false
    && (
      !('seatsLimit' in request.resource.data)
      || request.resource.data.seatsLimit == 0
    )
    && (
      !('seatsUsed' in request.resource.data)
      || request.resource.data.seatsUsed == 0
    );

  // ─── update ──────────────────────────────────────────────────────────────
  // Owner/admin may patch profile / display fields. NEVER server-only fields.
  // We use diff().affectedKeys() to reject any payload that even mentions
  // a server-only key, even if the value is unchanged (cleaner audit trail).
  allow update: if signedIn()
    && (
      isOrgAdmin(orgId, uid())
      || resource.data.ownerUid == uid()
    )
    && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(orgServerOnlyFields())
    && !request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(orgImmutableFields());

  // ─── delete ──────────────────────────────────────────────────────────────
  // Owner only. Admins cannot dissolve the org. Practically we expect this
  // to be replaced with `status = 'cancelled'` from a CF in a later phase,
  // but for now we keep the door open for the owner.
  allow delete: if signedIn() && resource.data.ownerUid == uid();

  // ─── members subcollection (unchanged) ───────────────────────────────────
  match /members/{memberId} {
    allow create: if signedIn()
      && (isOrgAdmin(orgId, uid())
          || (memberId == uid()
              && get(/databases/$(database)/documents/organizations/$(orgId)).data.ownerUid == uid()
              && request.resource.data.role == 'admin'
              && request.resource.data.status == 'active'));
    allow read: if signedIn() && (uid() == memberId || isOrgMemberActive(orgId));
    allow update, delete: if signedIn() && isOrgAdmin(orgId, uid());
  }
}
```

### Notes on the diff

1. **`create`** now hard-codes `status == 'pending_payment'` and
   `businessEnabled == false`. A client that tries to bootstrap an
   already-active org gets denied. Activation flows only through a CF.
2. **`update`** uses `request.resource.data.diff(resource.data)
   .affectedKeys().hasAny([...])` — the same pattern the repo already uses
   for `users/{userId}.subscriptionStatus` (line ~152 of `firestore.rules`).
3. We also block changes to `ownerUid` and `createdAt`. Owner transfer, if
   ever needed, will be a Cloud Function with audit trail.
4. **`delete`** is restricted to the original owner. Admins can manage seats
   and members but not dissolve the org without owner consent.
5. The `members` subcollection block is **unchanged** from the current rules
   — Phase 1 does not need write-side member rules yet.

---

## 4. Proposed indexes diff (firestore.indexes.json)

**Phase 1 verdict: no new index is strictly required.**

The current `listMyMemberships(userId)` implementation uses
`collectionGroup('members').where('userId', '==', uid)` only — Firestore
auto-indexes single-field equality queries on collection groups, so this
works out of the box.

However, Phase 2 (BusinessContext) may want to further filter to active
memberships only, e.g.
`where('userId','==',uid).where('status','==','active')`. That **does**
require a composite collection-group index. The existing entry

```json
{
  "collectionGroup": "members",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "emailLower", "order": "ASCENDING" },
    { "fieldPath": "status",     "order": "ASCENDING" },
    { "fieldPath": "userId",     "order": "ASCENDING" }
  ]
}
```

does **not** cover `(userId, status)` because composite indexes are
prefix-based and the leading field there is `emailLower`. So if/when we add
the `status` filter, we should also add:

```json
{
  "collectionGroup": "members",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

Decision: **do not add this in Phase 1.** We add it together with the Phase 2
query change so the deploy of indexes is co-located with the code change
that actually relies on them. (Firestore takes a few minutes to build a new
index, so deploying it ahead of time and then not using it is fine; deploying
the code change first while the index is still building causes
`failed-precondition` errors at runtime.)

---

## 5. Deployment checklist (do NOT run as part of Phase 1)

When you decide to apply the rules diff:

1. Apply the diff above to `firestore.rules` (`mobile/firestore.rules`).
2. Verify locally with the emulator if convenient
   (`firebase emulators:start --only firestore`).
3. Commit on a dedicated branch — keep code and rules changes separate so a
   bad rule deploy can be reverted independently.
4. Deploy from the `mobile/` directory:
   ```bash
   firebase deploy --only firestore:rules
   ```
5. Smoke-test in a staging project before pointing prod traffic at it.
6. If anything regresses, roll back from the Firebase Console
   (Project → Firestore → Rules → History → "Restore").

When Phase 2 adds the `(userId, status)` index, run instead:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
…and wait for the indexes panel to report "Enabled" before merging the code
that depends on the new query shape.

---

## 6. Non-goals (explicitly out of scope)

The following must remain unchanged in Phase 1:

- `AuthContext.orgId` — solo namespace, do not touch.
- Existing `projects/*`, `timeEntries/*`, `absences/*`, `notifications/*`,
  `users/*` rules — all B2C-facing surfaces.
- Storage rules.
- Cloud Functions code.
- All client UI / navigation.

Any of the above will be handled in their own phases with their own reviews.
