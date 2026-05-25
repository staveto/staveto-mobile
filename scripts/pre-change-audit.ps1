# pre-change-audit.ps1 — read-only git / workspace audit before making changes.
# Does not delete, stash, or commit anything.
# Exit 0 = clean tree; Exit 1 = dirty tree or warnings require attention.

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$baseRef = "origin/rescue/mobile-latest"
$exitCode = 0

Write-Host ""
Write-Host "=== Staveto pre-change audit ===" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"
Write-Host "Time (UTC): $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss'))"
Write-Host ""

function Write-Section($title) {
    Write-Host "--- $title ---" -ForegroundColor Yellow
}

Write-Section "Branch"
try {
    $branch = git branch --show-current 2>&1
    Write-Host "Current branch: $branch"
} catch {
    Write-Host "Could not read branch: $_" -ForegroundColor Red
    $exitCode = 1
}

Write-Section "HEAD"
try {
    $head = git rev-parse HEAD 2>&1
    Write-Host "HEAD: $head"
} catch {
    Write-Host "Could not read HEAD" -ForegroundColor Red
    $exitCode = 1
}

Write-Section "Base ($baseRef)"
git fetch origin 2>&1 | Out-Host
try {
    $baseHead = git rev-parse $baseRef 2>&1
    Write-Host "$baseRef : $baseHead"
    $behind = git rev-list --count "HEAD..$baseRef" 2>&1
    $ahead = git rev-list --count "$baseRef..HEAD" 2>&1
    Write-Host "Commits behind $baseRef : $behind"
    Write-Host "Commits ahead of $baseRef  : $ahead"
} catch {
    Write-Host "Could not resolve $baseRef (fetch origin?)" -ForegroundColor Red
    $exitCode = 1
}

Write-Section "Status (short)"
$status = git status --short 2>&1
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "(clean)" -ForegroundColor Green
} else {
    Write-Host $status
    Write-Host ""
    Write-Host "WARNING: Working tree is DIRTY. Stop and commit, stash, or discard before starting a new task." -ForegroundColor Red
    $exitCode = 1
}

Write-Section "Recent commits (10)"
git log --oneline -10 2>&1 | Out-Host

Write-Section "Worktrees"
git worktree list 2>&1 | Out-Host

Write-Section "Stashes"
$stashes = git stash list 2>&1
if ([string]::IsNullOrWhiteSpace($stashes)) {
    Write-Host "(none)"
} else {
    Write-Host $stashes
    Write-Host ""
    Write-Host "NOTE: Before 'git stash pop', run: git stash show -p stash@{0}" -ForegroundColor DarkYellow
}

Write-Section "Sensitive / local artefacts (must not commit)"
$watchPatterns = @(
    "auth-export.json",
    "firebase-debug.log",
    ".tmp"
)
$found = @()
foreach ($pattern in $watchPatterns) {
    Get-ChildItem -Path $repoRoot -Filter $pattern -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' } |
        ForEach-Object { $found += $_.FullName }
}
Get-ChildItem -Path $repoRoot -Filter "*.log" -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\.eas-build-' -and
        $_.Name -ne "yarn-error.log"
    } |
    ForEach-Object { $found += $_.FullName }

if ($found.Count -eq 0) {
    Write-Host "(none detected in repo tree)"
} else {
    $found | Select-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
    Write-Host ""
    Write-Host "WARNING: Ensure these are in .gitignore and not staged." -ForegroundColor DarkYellow
}

Write-Section "Untracked files (first 30)"
git ls-files --others --exclude-standard 2>&1 | Select-Object -First 30 | ForEach-Object { Write-Host $_ }

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "=== Audit PASSED (clean tree) ===" -ForegroundColor Green
} else {
    Write-Host "=== Audit FAILED - resolve issues before changing code ===" -ForegroundColor Red
}

Write-Host ""
exit $exitCode
