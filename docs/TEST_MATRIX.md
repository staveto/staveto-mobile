# Test matrix — Staveto mobile

Use for release smoke tests and PR verification.  
**Base:** `origin/rescue/mobile-latest`

Legend: ✅ expected pass · ⚠️ limited · ❌ blocked · N/A not applicable

---

## Feature matrix

| Feature | Owner | Admin | Manager | Worker | Viewer | Solo user | Expected result |
|---------|-------|-------|---------|--------|--------|-----------|-----------------|
| Drawer: Business visible | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Signed-in user sees Business entry (drawer); opens Business stack |
| Business dashboard | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | N/A | Org member with `businessEnabled` + active org sees dashboard |
| Pay online / activation | ✅ | ✅ | N/A | N/A | N/A | N/A | `pending_payment` / trial shows pay CTA when billing configured |
| Invite member | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | Owner/Admin can create invite code |
| Manage team | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | Team list, summary, pending requests |
| Team role edit | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | Navigate to member role; save role |
| Approve pending member | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | Approve button for pending invites |
| Business inbox / chat | ✅ | ✅ | ✅ | ✅ | ⚠️ | N/A | Viewer: read per `useOrgAccess`; write for worker+ |
| Chat: text | ✅ | ✅ | ✅ | ✅ | ⚠️ | N/A | Messages send and appear |
| Chat: photo / camera / doc / voice | ✅ | ✅ | ✅ | ✅ | ⚠️ | N/A | Attach menu + mic; rules deployed |
| Business plan selection | ✅ | ✅ | N/A | N/A | N/A | N/A | Registration flow; selected plan highlighted |
| Project list (personal) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Solo: personal projects; B2B: per org rules |
| Documents preview in app | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PDF/image opens in app, not forced external browser |
| Calendar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Loads events / empty state |
| Home dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Loads without infinite spinner |
| Notifications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | List opens |
| Equipment tab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | List / navigation works |
| Onboarding i18n | N/A | N/A | N/A | N/A | N/A | ✅ | New user: no raw keys on usage mode / language steps |
| Join company (invite code) | N/A | N/A | N/A | N/A | N/A | ✅ | Employee onboarding with code |

---

## PR-scoped testing

For a single PR, test only rows touched by the change plus regression on:

1. Login → Home load  
2. Drawer → Business entry  
3. One Business screen in the PR scope  

---

## Environment notes

| Environment | Use for |
|-------------|---------|
| Metro dev + dev client | Fast JS iteration; may not match store binary |
| EAS internal APK/IPA | Pre-release smoke |
| TestFlight / Play internal | Store-like binaries |
| OTA on production channel | JS-only fixes; **must** match runtime version |

Document in PR: **dev reload** | **OTA** | **new build** | **rules/functions deploy**.

---

## Related

- `docs/RELEASE_CHECKLIST.md` — full release gate  
- `docs/CURSOR_RULES.md` — agent/human workflow  
- `docs/CHANGELOG_MANUAL.md` — what shipped when  
