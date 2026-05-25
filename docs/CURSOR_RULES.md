# Cursor rules — release safety workflow

**Base branch:** `origin/rescue/mobile-latest`  
**Goal:** One source of truth, no lost changes, clear dev vs OTA vs build vs deploy.

---

## Before every change (mandatory audit)

Run these commands and read the output **before** editing anything:

```powershell
git fetch origin
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/rescue/mobile-latest
git log --oneline -10
```

Or run the script:

```powershell
.\scripts\pre-change-audit.ps1
```

### STOP conditions (do not implement)

| Condition | Action |
|-----------|--------|
| Working tree is dirty (uncommitted changes) | **STOP.** Stash, commit, or discard intentionally first. |
| Current branch is not based on latest `origin/rescue/mobile-latest` | **STOP.** Rebase or create a new branch from base. |
| Task mixes unrelated topics | **STOP.** Split into separate branches/PRs. |

---

## Branch and PR discipline

1. **Each task** = new branch from `origin/rescue/mobile-latest`:
   ```powershell
   git fetch origin
   git checkout -B feature/your-topic origin/rescue/mobile-latest
   ```
2. **One PR = one topic.** No large combined PRs (drawer + i18n + chat + rules in one PR).
3. **Allowed scope** must match the PR description. If the PR is “docs only”, `git diff --name-only origin/rescue/mobile-latest...HEAD` must not include `src/`, `functions/`, rules, or app config unless explicitly approved.

---

## Forbidden git operations (without human confirmation)

- `git stash pop` without first running `git stash show -p stash@{0}` (or the target stash).
- `git reset --hard` (except documented post-merge sync below, and only when tree is intentionally clean).
- `git push --force` to `main`, `master`, or `rescue/mobile-latest`.
- Committing secrets or local artefacts (see list below).

---

## Never commit

- `auth-export.json`
- `firebase-debug.log`
- `.tmp*` / `*.log` (except intentionally versioned docs)
- `.env`, `.env.local`, credentials, `*service-account*.json`
- `backups/` (local snapshots)
- `node_modules/`, `.expo/`, build outputs

---

## Workflow per task

### 1. Audit (before)

```powershell
.\scripts\pre-change-audit.ps1
```

### 2. Optional backup (before risky work)

```powershell
.\scripts\release-snapshot.ps1
```

### 3. Implement on a focused branch

- Stay within the agreed file list for the PR.
- Document in `docs/CHANGELOG_MANUAL.md` when the change is user-visible.

### 4. Verify diff scope (after)

```powershell
git diff --name-only origin/rescue/mobile-latest...HEAD
```

Only files that belong to the PR topic should appear.

### 5. Commit and PR

- Clear commit message (why, not only what).
- Open PR into `rescue/mobile-latest`.
- CI/review as required by team.

### 6. After merge (local sync)

```powershell
git fetch origin
git checkout rescue/mobile-latest   # or your local tracking branch
git reset --hard origin/rescue/mobile-latest
git log --oneline -5
```

Confirm HEAD matches remote. Re-run smoke tests from `docs/RELEASE_CHECKLIST.md`.

---

## Delivery type — always report

After every fix or feature, state explicitly what is required:

| Type | When | What the user does |
|------|------|-------------------|
| **Dev reload** | JS/TS/React only, no native/config change | Metro `r` or restart bundler |
| **EAS Update (OTA)** | JS bundle change, compatible runtime | `eas update` to the correct branch/channel |
| **New native build** | `app.json`, native modules, permissions, versionCode/buildNumber | `eas build` + install new binary |
| **Firestore rules deploy** | `firestore.rules` changed | `firebase deploy --only firestore:rules` |
| **Storage rules deploy** | `storage.rules` changed | `firebase deploy --only storage` |
| **Functions deploy** | `functions/` changed | Build + deploy functions |

If unsure, assume **new build** for native-facing changes and **OTA** only when runtime version matches and change is JS-only.

---

## Why changes “disappear”

Common causes this workflow prevents:

1. **Dirty tree / wrong branch** — code never committed or committed on another branch.
2. **Stash forgotten** — `stash pop` overwrote work or was never applied.
3. **OTA vs dev client mismatch** — testing old binary with new JS or vice versa.
4. **Rules/functions not deployed** — app updated but backend rules unchanged.
5. **Merged PR partial** — large PR; only part of files merged.
6. **Local ≠ `origin/rescue/mobile-latest`** — testing build from wrong commit.

---

## Related docs

- `docs/RELEASE_CHECKLIST.md` — pre-release and smoke tests
- `docs/TEST_MATRIX.md` — role-based expectations
- `docs/CHANGELOG_MANUAL.md` — manual log of what shipped and how to verify
- `scripts/pre-change-audit.ps1` — automated pre-flight
- `scripts/release-snapshot.ps1` — backup before risky changes
