# Firestore Rules Diff – B2B Mobile-Safe Update

## Summary

**Added:** B2B rules for `organizations`, `organizations/{orgId}/members`, and `invites` (org invites).

**Unchanged:** All mobile collections (users, projects, timeEntries, notifications, catalogTemplates, feedback, etc.).

---

## What Was Added

### Helper Functions

| Function | Purpose |
|----------|---------|
| `signedIn()` | `request.auth != null` (already existed) |
| `isOrgMemberActive(orgId)` | Convenience: `isOrgMember(orgId, uid())` – requester is active org member |
| `isOrgAdmin(orgId)` | Uses `isOrgMember` + `role == 'admin'` (already existed as `isOrgAdmin(orgId, u)`) |

### Match Blocks (B2B Only)

#### `organizations/{orgId}`

| Operation | Rule |
|-----------|------|
| read | `signedIn() && isOrgMemberActive(orgId)` |
| create | `signedIn() && request.resource.data.ownerUid == uid()` |
| update, delete | `signedIn() && (isOrgAdmin(orgId, uid()) \|\| get(org).data.ownerUid == uid())` |

#### `organizations/{orgId}/members/{memberId}`

| Operation | Rule |
|-----------|------|
| read | `signedIn() && (uid() == memberId \|\| isOrgMemberActive(orgId))` |
| create | `isOrgAdmin` OR (owner creating self as first member: `memberId == uid()`, `ownerUid == uid()`, `role == 'admin'`, `status == 'active'`) |
| update, delete | `signedIn() && isOrgAdmin(orgId, uid())` |

#### `invites/{inviteId}` (org invites)

| Operation | Rule |
|-----------|------|
| create | `signedIn() && isOrgAdmin(request.resource.data.orgId, uid())` |
| read | `signedIn() && (isOrgAdmin(resource.data.orgId, uid()) \|\| emailLower == token.email)` |
| update, delete | `signedIn() && isOrgAdmin(resource.data.orgId, uid())` |

---

## Why It Is Mobile-Safe

Based on the Firestore audit of the mobile app:

| Mobile Collection | Touched? | Reason |
|-------------------|----------|--------|
| `users` | No | Rules unchanged |
| `users/{uid}/projectRefs` | No | Rules unchanged |
| `users/{uid}/contractors` | No | Rules unchanged |
| `users/{uid}/devices` | No | Rules unchanged |
| `users/{uid}/projectState` | No | Rules unchanged |
| `projects` | No | Rules unchanged (mobile uses `ownerId`, not `orgId`) |
| `projects/{id}/members` | No | Project members, not org members |
| `projects/{id}/tasks` | No | Rules unchanged |
| `projects/{id}/expenses` | No | Rules unchanged |
| `projects/{id}/attachments` | No | Rules unchanged |
| `timeEntries` | No | Rules unchanged |
| `notifications` | No | Rules unchanged |
| `catalogTemplates` | No | Rules unchanged |
| `feedback` | No | Rules unchanged |

**Mobile does not use:** `organizations`, `organizations/{orgId}/members`, or `invites` (org invites). Mobile project invites go through Cloud Functions (`claimProjectInvites`, `acceptProjectInvite`), not direct Firestore access to org collections.

---

## Web Flows That Need Cloud Function

| Flow | Current | Required |
|------|---------|----------|
| **Accept org invite** | Client would write `organizations/{orgId}/members/{uid}` and update `invites/{inviteId}` | **Cloud Function** – client cannot create org members; only org admin can. Implement `acceptOrgInvite` callable that validates token, creates member doc, updates invite status. |
| **Revoke invite** | Org admin can `update` or `delete` invite | Allowed by rules |
| **Create org** | Owner creates org + self as first member | Allowed by rules |
| **List org members** | Org members can read | Allowed by rules |
| **List org invites** | Org admin can read (query `invites` where `orgId`) | Allowed by rules |

---

## Manual Test Checklist

### Web (staveto-office)

- [ ] **Admin creates org** – create organization with `ownerUid == auth.uid` → ALLOW
- [ ] **Admin creates invite** – add invite for invitee email → ALLOW
- [ ] **Admin lists org members** – read `organizations/{orgId}/members` → ALLOW
- [ ] **Admin lists org invites** – query `invites` where `orgId` → ALLOW
- [ ] **Invitee reads invite** – read invite where `emailLower == token.email` → ALLOW
- [ ] **Invitee accepts invite (client)** – create `organizations/{orgId}/members/{uid}` → DENIED (expected; use CF)
- [ ] **Non-member reads org** – read `organizations/{orgId}` → DENIED
- [ ] **Non-member reads org members** – read `organizations/{orgId}/members` → DENIED

### Mobile (smoke test – no permission denied)

- [ ] **List projects** – projects screen loads
- [ ] **Create task** – add task to project
- [ ] **Add expense** – add expense to project
- [ ] **Upload attachment** – upload file to project
- [ ] **View notifications** – notifications screen loads
- [ ] **User profile** – read/update own user doc

---

## Deployment

**Do not deploy yet.** After manual tests pass:

```bash
firebase deploy --only firestore:rules --project staveto-mvp-5f251
```
