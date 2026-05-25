# Manual changelog

Human-maintained log of meaningful mobile changes.  
Complements git history; focus on **what shipped**, **how to test**, and **delivery type**.

**Base branch:** `rescue/mobile-latest`

---

## How to add an entry

Copy the template below after each merged PR or release.

---

### Template

```markdown
## YYYY-MM-DD — short title

| Field | Value |
|-------|-------|
| Branch | `feature/...` |
| PR | #NNN |
| Commit | `abcdef1` |

**What changed**  
- Bullet points

**How to test**  
1. Steps

**Needs**  
- [ ] Dev reload only  
- [ ] EAS Update (OTA) — channel: ___  
- [ ] New EAS build (Android/iOS)  
- [ ] Firestore rules deploy  
- [ ] Storage rules deploy  
- [ ] Functions deploy  

**Known risk**  
- Optional
```

---

## Entries

<!-- Add new entries below this line, newest first -->

## 2026-05-23 — Release safety workflow (docs + scripts)

| Field | Value |
|-------|-------|
| Branch | `chore/release-safety-workflow` |
| PR | _(fill after merge)_ |
| Commit | _(fill after merge)_ |

**What changed**  
- Added `docs/CURSOR_RULES.md`, `RELEASE_CHECKLIST.md`, `TEST_MATRIX.md`, this file  
- Added `scripts/pre-change-audit.ps1`, `scripts/release-snapshot.ps1`  
- Extended `.gitignore` for local backups and debug artefacts  

**How to test**  
1. Run `.\scripts\pre-change-audit.ps1` on clean tree → exit 0  
2. Run `.\scripts\release-snapshot.ps1` → `backups/` folder created  
3. No app code changes; no runtime test required  

**Needs**  
- [x] Dev reload only (N/A — no app change)  
- [ ] EAS Update  
- [ ] New build  
- [ ] Rules / Functions deploy  

**Known risk**  
- None (documentation only)
