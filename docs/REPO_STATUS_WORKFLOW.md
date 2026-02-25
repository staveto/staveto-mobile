# Repo Status & Check Workflow

PowerShell does **not** support `&&` as a statement separator. Use `;` instead, or run commands separately.

**Quick run:** `npm run repo-status` or `powershell -ExecutionPolicy Bypass -File ./scripts/repo-status.ps1`

---

## A) PowerShell (recommended)

```powershell
# 1. Navigate to repo (works with paths containing spaces)
Set-Location "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"

# 2. Git status
git status

# 3. Last 5 commits
git log -5 --oneline

# 4. Current branch + upstream sync
git status -sb
git log origin/rescue/mobile-latest..HEAD --oneline

# 5. Diff vs upstream (if any)
git diff origin/rescue/mobile-latest
```

**One-liner (all checks):**
```powershell
Set-Location "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"; git status; git log -5 --oneline; git status -sb; git log origin/rescue/mobile-latest..HEAD --oneline; git diff origin/rescue/mobile-latest --stat
```

---

## B) CMD alternative

```cmd
cd /d "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
git status
git log -5 --oneline
git status -sb
git log origin/rescue/mobile-latest..HEAD --oneline
git diff origin/rescue/mobile-latest
```

**One-liner (all checks):**
```cmd
cd /d "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile" && git status && git log -5 --oneline && git status -sb && git log origin/rescue/mobile-latest..HEAD --oneline && git diff origin/rescue/mobile-latest --stat
```

---

## Optional: Safety tag before changes

### PowerShell

```powershell
Set-Location "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
git tag backup-2026-02-25-prechanges
git push origin backup-2026-02-25-prechanges
```

**One-liner:**
```powershell
Set-Location "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"; git tag backup-2026-02-25-prechanges; git push origin backup-2026-02-25-prechanges
```

### CMD

```cmd
cd /d "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
git tag backup-2026-02-25-prechanges
git push origin backup-2026-02-25-prechanges
```

**One-liner:**
```cmd
cd /d "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile" && git tag backup-2026-02-25-prechanges && git push origin backup-2026-02-25-prechanges
```

---

## Quick reference

| Shell       | Chain separator | Example                          |
|------------|-----------------|----------------------------------|
| PowerShell | `;`             | `cd "path"; git status`          |
| CMD        | `&&`            | `cd /d "path" && git status`      |

**Note:** Replace `origin/rescue/mobile-latest` with your actual upstream branch if different.
