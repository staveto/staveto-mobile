# Release checklist

Use before tagging a release, cutting an EAS build, or publishing an OTA update.  
**Base:** `origin/rescue/mobile-latest`

---

## 1. Git and repository state

- [ ] `git fetch origin` completed
- [ ] Working tree **clean** (`git status --short` empty)
- [ ] Local HEAD = `origin/rescue/mobile-latest` (or explicit release tag on that line)
- [ ] `.\scripts\pre-change-audit.ps1` exits 0
- [ ] Release commit identified: `git rev-parse HEAD` recorded
- [ ] Optional: `.\scripts\release-snapshot.ps1` run and archive stored outside repo

---

## 2. Version and build metadata

Record in release notes / `CHANGELOG_MANUAL.md`:

| Field | Value (fill in) |
|-------|-----------------|
| Git commit | |
| Git tag | |
| App version (`expo.version` / `package.json`) | |
| Android `versionCode` | |
| iOS `buildNumber` | |
| EAS build ID (Android) | |
| EAS build ID (iOS) | |
| EAS profile | |
| `expo-updates` branch / runtime version | |
| OTA update group ID (if OTA) | |

---

## 3. Backend deploy status

| Component | Deployed? | Date / operator | Notes |
|-----------|-----------|-----------------|-------|
| Firestore rules | ☐ | | `firebase deploy --only firestore:rules` |
| Storage rules | ☐ | | `firebase deploy --only storage` |
| Cloud Functions | ☐ | | build + deploy |
| Remote config / env (EAS secrets) | ☐ | | `EXPO_PUBLIC_*`, admin emails, etc. |

**Rule:** If the app expects new rules or functions, do not release the client until backend is deployed (or feature-flagged off).

---

## 4. Delivery path (check one primary path)

- [ ] **Dev client only** — Metro + development build; no store release
- [ ] **EAS Update (OTA)** — JS-only; runtime compatible; channel documented
- [ ] **Store build** — new binary; versionCode/buildNumber bumped

---

## 5. Smoke test checklist

Test on a build that matches the release commit (not an old binary + new OTA by mistake).

### Auth and onboarding

- [ ] Login (email)
- [ ] Login (Google) / Sign in with Apple if enabled
- [ ] Logout
- [ ] Onboarding: language selection shows translated text (no raw i18n keys)
- [ ] Onboarding: solo vs join company flow
- [ ] No stuck spinner on first Home load

### Home and navigation

- [ ] Home dashboard loads
- [ ] Drawer opens; **Business** entry visible for signed-in user (per product rules)
- [ ] Calendar
- [ ] Projects list / open project
- [ ] Equipment tab
- [ ] Notifications

### Business (B2B)

- [ ] Business landing / plan selection UI readable (contrast, selection state)
- [ ] Business dashboard loads
- [ ] Pay online / activation banner when applicable
- [ ] Invite member flow
- [ ] Manage team — translated labels (no `business.team.*` keys)
- [ ] Team role screen
- [ ] Business inbox / chat
- [ ] Chat: gallery, camera, document, voice (if in scope for this release)

### Documents and media

- [ ] Documents / photos open **in app** where expected
- [ ] PDF preview works
- [ ] No unwanted automatic open in external browser

### Roles (see `TEST_MATRIX.md`)

- [ ] Spot-check Owner, Admin, Worker, Solo user paths relevant to this release

---

## 6. Do not release if

Block release until fixed or explicitly accepted with documented risk:

- Raw **translation keys** visible in UI (`onboarding.*`, `business.team.*`, etc.)
- **External browser** opens documents automatically when in-app preview is required
- **Home spinner** stuck / infinite loading
- **Business** drawer entry missing for signed-in users (unless feature-flagged off)
- **Onboarding** broken or blocking new users
- **Dirty working tree** or unknown local patches on release machine
- Firestore/Storage rules changed in repo but **not deployed**
- OTA published against **wrong runtime** / old binary
- `auth-export.json`, secrets, or debug logs committed

---

## 7. Post-release

- [ ] Update `docs/CHANGELOG_MANUAL.md`
- [ ] Tag commit (if using tags)
- [ ] Notify testers: dev reload vs OTA vs new install required
- [ ] Monitor crash/analytics for 24–48h

---

## Quick commands

```powershell
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/rescue/mobile-latest
.\scripts\pre-change-audit.ps1
.\scripts\release-snapshot.ps1
```
