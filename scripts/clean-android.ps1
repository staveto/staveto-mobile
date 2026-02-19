# Clean Android build artifacts and caches
# Usage: npm run clean:android

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleaning Android Build Artifacts" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$cleanPaths = @(
    "android\.cxx",
    "android\app\build",
    "android\app\.cxx",
    "android\build",
    "android\.gradle",
    "node_modules\react-native-screens\android\.cxx",
    "node_modules\react-native-reanimated\android\.cxx"
)

$cleaned = 0
foreach ($path in $cleanPaths) {
    $fullPath = Join-Path $projectRoot $path
    if (Test-Path $fullPath) {
        Write-Host "Removing: $path" -ForegroundColor Yellow
        Remove-Item -Recurse -Force $fullPath -ErrorAction SilentlyContinue
        if (-not (Test-Path $fullPath)) {
            Write-Host "  [OK] Cleaned" -ForegroundColor Green
            $cleaned++
        } else {
            Write-Host "  [WARN] Still exists (may be in use)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Cleaned $cleaned path(s)" -ForegroundColor Green
Write-Host ""
Write-Host "Note: Gradle cache at C:\gradle-cache is preserved" -ForegroundColor Gray
Write-Host "To clean Gradle cache, manually delete: C:\gradle-cache" -ForegroundColor Gray
