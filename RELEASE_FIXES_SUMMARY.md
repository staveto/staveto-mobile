# Release Fixes Summary

## What Changed

### A) Storage Rules for Attachments
- **File:** `storage.rules`
- **Change:** Added `isProjectMember`, `canReadAttachments`, `canWriteAttachments` helpers.
- **Read:** Owner OR member with `sharedItems.tasks` OR `sharedItems.expenses` OR `sharedItems.documents` (matches Firestore).
- **Write:** Owner OR member with `permissionLevel == 'editor'` (matches Firestore `canWriteAsEditor`).
- **Why:** Invited members could read attachment metadata in Firestore but got permission-denied when downloading from Storage.

### B) Client Attachments
- **File:** `src/services/attachments.ts`
- **Change:** Removed owner-only upload restriction. Storage rules now enforce write permission (owner or editor).
- **Change:** Improved error handling: `permission-denied` / `storage/unauthorized` rethrown with consistent code for UI.
- **Change:** `getAttachmentURL` logs and rethrows `permission-denied` on Storage errors.
- **Why:** Editors can now upload attachments; members with read permission can download.

### C) Account Label / Subprocessors
- **File:** `src/screens/AccountScreen.tsx`
- **Change:** Row that opens `/subprocessors` now uses `t("account.subprocessors")` instead of `t("account.contractors")`.
- **File:** `src/i18n/translations.ts`
- **Change:** Added `account.subprocessors` for SK: "Zadavatelé". (EN, DE, CS, ES, IT, PL already had it.)
- **Why:** "Contractors" label was wrong for the Subprocessors link.

### D) Project Invite UX
- **File:** `src/screens/ProjectMembersScreen.tsx`
- **Change:** Success message uses `projectMembers.inviteSuccess` (already states in-app only, no email).
- **Change:** Added "Copy invite message" button in success Alert. Uses `expo-clipboard`.
- **Change:** Message includes: inviter name (if available), project name, and instruction to sign in with email.
- **File:** `src/i18n/translations.ts`
- **Change:** Added `projectMembers.inviteCopied`, `projectMembers.copyFailed` in all locales.
- **Why:** Clarify in-app-only delivery; allow user to share invite text manually.

### E) Promo Gating (Single Source of Truth)
- **File:** `functions/src/billing.ts`
- **Change:** Fixed `computeBillingStatus` (removed duplicate/broken variable declarations).
- **Change:** Merge rule: if `subscription.source === "promo"` and `currentPeriodEnd` in future → `isPro = true`.
- **Why:** Promo users were not getting PRO in `getBillingStatus`; `user.billing.isPro` is used for UI gating.
- **Note:** `computeEntitlement` (checkEntitlement CF) already reads `subscription`; `getUserTier` in subscription.ts already handles promo expiry. RevenueCat remains for paid flow; Firestore subscription is source for promo.

### F) Logging & Error Handling
- **Files:** `attachments.ts`, `subscription.ts`, `AuthContext.tsx`, `billing.ts` (CF)
- **Change:** Logs for attachment upload/download errors (code, path, uid).
- **Change:** Logs for promo tier resolution in `getUserTier` and `computeBillingStatus`.
- **Change:** Rethrow `permission-denied` for consistent UI handling.

---

## Tier Gating Mapping (Audit)

| Location | Source | Purpose |
|----------|--------|---------|
| `AuthContext` | `getBillingStatus` (CF) | `user.billing.isPro`, `user.billing.status` for UI |
| `paywallTrigger.ts` | `billing.isPro` | When to show paywall |
| `freeTrial.ts` | `billing.isPro` | Trial / Pro checks |
| `AccountScreen` | `user.billing.isPro` | Subscription badge |
| `SubscriptionScreen` | `billing?.isPro` | Show/hide Pro features |
| `projects.ts`, `tasks.ts`, `expenses.ts` | `getUserTier` (Firestore) | Limit checks (max projects, tasks, expenses) |
| `checkEntitlement` (CF) | Firestore `subscription` | OCR, usage limits |
| `getEntitlement` (client) | RevenueCat → CF fallback | PaywallScreen, SubscriptionScreen usage display |

**Merge rule:** `getBillingStatus` (CF) reads `subscription.source === "promo"` and sets `isPro` until `currentPeriodEnd`. Paid users use top-level `isPro`/`currentPeriodEndAt` from RevenueCat webhook.

---

## Manual Test Plan

1. **Attachments – member read**
   - Owner invites member A (editor) to project with tasks/expenses shared.
   - A signs in, opens project, opens task/expense with attachment.
   - A can view/download attachment. No permission-denied.

2. **Attachments – member write**
   - As editor A, add attachment to task or expense.
   - Upload succeeds. No permission-denied.

3. **Attachments – viewer**
   - Invite member B as viewer (no editor).
   - B can view/download attachments.
   - B cannot upload (UI may hide or Storage rules deny).

4. **Promo code**
   - Redeem valid promo code.
   - `user.billing.isPro` is true; PRO features unlocked.
   - After `currentPeriodEnd`, `isPro` becomes false.

5. **Account Subprocessors**
   - Open Account → App section.
   - Row labeled "Subprocessors" (or localized) opens https://www.staveto.com/subprocessors.

6. **Invite UX**
   - Invite member to project.
   - Success message states in-app only, no email.
   - Tap "Copy invite message" → message in clipboard.
   - Paste: contains project name, inviter, and sign-in instruction.

---

## Files Changed

- `mobile/storage.rules`
- `mobile/src/services/attachments.ts`
- `mobile/src/screens/AccountScreen.tsx`
- `mobile/src/screens/ProjectMembersScreen.tsx`
- `mobile/src/i18n/translations.ts`
- `mobile/src/services/subscription.ts`
- `mobile/src/context/AuthContext.tsx`
- `functions/src/billing.ts`

---

## Deploy

1. **Firebase Storage rules:** `firebase deploy --only storage`
2. **Firebase Functions:** `firebase deploy --only functions:getBillingStatus` (if billing.ts changed)
3. **App:** Rebuild with EAS or `expo run:ios` / `expo run:android`
