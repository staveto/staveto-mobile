# release-snapshot.ps1 — local backup before risky changes or release.
# Creates backups/ under repo root. Does not commit or delete anything.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot "backups"
$snapshotDir = Join-Path $backupRoot "snapshot-$timestamp"
$baseRef = "origin/rescue/mobile-latest"

New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

Write-Host ""
Write-Host "=== Staveto release snapshot ===" -ForegroundColor Cyan
Write-Host "Output: $snapshotDir"
Write-Host ""

# --- Git metadata text snapshot ---
$snapshotFile = Join-Path $snapshotDir "git-snapshot.txt"
$lines = @(
    "Staveto mobile - git snapshot",
    "Created (local): $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "Repository: $repoRoot",
    "",
    "=== branch ===",
    (git branch --show-current 2>&1),
    "",
    "=== HEAD ===",
    (git rev-parse HEAD 2>&1),
    "",
    "=== $baseRef ==="
)
git fetch origin 2>&1 | Out-Null
$lines += (git rev-parse $baseRef 2>&1)
$lines += @(
    "",
    "=== status --short ===",
    (git status --short 2>&1),
    "",
    "=== log (30) ==="
)
$lines += (git log --oneline -30 2>&1)
$lines += @(
    "",
    "=== worktrees ==="
)
$lines += (git worktree list 2>&1)
$lines += @(
    "",
    "=== stashes ==="
)
$stashList = git stash list 2>&1
if ([string]::IsNullOrWhiteSpace($stashList)) { $lines += "(none)" } else { $lines += $stashList }

$lines | Set-Content -Path $snapshotFile -Encoding UTF8
Write-Host "Wrote $snapshotFile"

# --- Patch of current diff (working tree + index vs HEAD) ---
$patchFile = Join-Path $snapshotDir "working-tree.patch"
$diff = git diff HEAD 2>&1
if ([string]::IsNullOrWhiteSpace($diff)) {
    Write-Host "No working-tree diff (patch skipped)"
} else {
    $diff | Set-Content -Path $patchFile -Encoding UTF8
    Write-Host "Wrote $patchFile"
}

# --- Patch vs base branch (committed diff on branch) ---
$branchPatch = Join-Path $snapshotDir "branch-vs-rescue-mobile-latest.patch"
try {
    $branchDiff = git diff "$baseRef...HEAD" 2>&1
    if (-not [string]::IsNullOrWhiteSpace($branchDiff)) {
        $branchDiff | Set-Content -Path $branchPatch -Encoding UTF8
        Write-Host "Wrote $branchPatch"
    }
} catch {
    Write-Host "Could not write branch patch: $_" -ForegroundColor DarkYellow
}

# --- Zip archive (exclude heavy / sensitive paths) ---
$zipPath = Join-Path $backupRoot "staveto-mobile-$timestamp.zip"
$excludeDirNames = @(
    "node_modules",
    ".git",
    ".expo",
    "dist",
    "build",
    "coverage",
    "backups",
    "android",
    "ios"
)
$excludeFileNames = @(
    "auth-export.json",
    "firebase-debug.log"
)

$tempStage = Join-Path $env:TEMP "staveto-snapshot-stage-$timestamp"
if (Test-Path $tempStage) { Remove-Item -Recurse -Force $tempStage }
New-Item -ItemType Directory -Path $tempStage -Force | Out-Null

Write-Host "Staging files for zip (this may take a minute)..."

Get-ChildItem -Path $repoRoot -Force | ForEach-Object {
    $name = $_.Name
    if ($excludeDirNames -contains $name) { return }
    if ($name -like ".tmp*") { return }

    $dest = Join-Path $tempStage $name
    if ($_.PSIsContainer) {
        Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        if ($excludeFileNames -contains $name) { return }
        if ($name -like "*.log") { return }
        if ($name -like "*service-account*") { return }
        Copy-Item -Path $_.FullName -Destination $dest -Force -ErrorAction SilentlyContinue
    }
}

# Prune excluded nested folders from stage
foreach ($dirName in $excludeDirNames) {
    Get-ChildItem -Path $tempStage -Directory -Recurse -Filter $dirName -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

# Copy snapshot metadata into zip root
Copy-Item -Path $snapshotDir -Destination (Join-Path $tempStage "_snapshot-meta") -Recurse -Force

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $tempStage "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $tempStage

Write-Host "Wrote $zipPath"
Write-Host ""
Write-Host "=== Snapshot complete (nothing committed) ===" -ForegroundColor Green
Write-Host "Keep backups/ local only - directory is gitignored."
Write-Host ""
