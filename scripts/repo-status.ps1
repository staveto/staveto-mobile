# Repo status check - PowerShell compatible (no &&)
# Run: powershell -ExecutionPolicy Bypass -File ./scripts/repo-status.ps1
$repo = if ($PSScriptRoot) { Join-Path $PSScriptRoot ".." } else { "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile" }
Set-Location $repo

Write-Host "=== Git status ===" -ForegroundColor Cyan
git status

Write-Host "`n=== Last 5 commits ===" -ForegroundColor Cyan
git log -5 --oneline

Write-Host "`n=== Branch + upstream ===" -ForegroundColor Cyan
git status -sb
$upstream = git rev-parse --abbrev-ref @{upstream} 2>$null
if ($upstream) {
    git log $upstream..HEAD --oneline
}

Write-Host "`n=== Diff vs upstream (stat) ===" -ForegroundColor Cyan
if ($upstream) { git diff $upstream --stat } else { Write-Host "No upstream set" }
