# Script to fix Android build errors after project move
# Run this from the mobile directory: .\fix-android-build.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Fixing Android Build Configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = "android.bak.$timestamp"

# Step 1: Backup android folder
Write-Host "Step 1: Backing up android folder to $backupDir..." -ForegroundColor Yellow
if (Test-Path "android") {
    Copy-Item -Path "android" -Destination $backupDir -Recurse -Force
    Write-Host "  ✓ Backup created" -ForegroundColor Green
} else {
    Write-Host "  ⚠ android folder not found, skipping backup" -ForegroundColor Yellow
}

# Step 2: Backup important files
Write-Host "`nStep 2: Backing up important files..." -ForegroundColor Yellow
$importantFiles = @{
    "google-services.json" = "android\app\google-services.json"
}

$backupFiles = @{}
foreach ($name in $importantFiles.Keys) {
    $path = $importantFiles[$name]
    if (Test-Path $path) {
        $backupPath = "$name.backup"
        Copy-Item -Path $path -Destination $backupPath -Force
        $backupFiles[$name] = $backupPath
        Write-Host "  ✓ Backed up $name" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $name not found, skipping" -ForegroundColor Yellow
    }
}

# Step 3: Clean Gradle cache
Write-Host "`nStep 3: Cleaning Gradle cache..." -ForegroundColor Yellow
if (Test-Path "android\.gradle") {
    Remove-Item -Path "android\.gradle" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Cleaned .gradle cache" -ForegroundColor Green
}
if (Test-Path "android\app\build") {
    Remove-Item -Path "android\app\build" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Cleaned app/build" -ForegroundColor Green
}
if (Test-Path "$env:USERPROFILE\.gradle\caches") {
    Write-Host "  ℹ Global Gradle cache location: $env:USERPROFILE\.gradle\caches" -ForegroundColor Gray
    Write-Host "    (You may want to clean this manually if issues persist)" -ForegroundColor Gray
}

# Step 4: Regenerate Android folder
Write-Host "`nStep 4: Regenerating Android folder with Expo prebuild..." -ForegroundColor Yellow
Write-Host "  Running: npx expo prebuild --platform android --clean" -ForegroundColor Gray
Write-Host "  (This may take a few minutes...)" -ForegroundColor Gray
Write-Host ""

try {
    npx expo prebuild --platform android --clean
    Write-Host "  ✓ Android folder regenerated" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Error during prebuild: $_" -ForegroundColor Red
    Write-Host "`nAttempting to restore backup..." -ForegroundColor Yellow
    if (Test-Path $backupDir) {
        Remove-Item -Path "android" -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -Path $backupDir -Destination "android" -Recurse -Force
        Write-Host "  ✓ Backup restored" -ForegroundColor Green
    }
    exit 1
}

# Step 5: Restore important files
Write-Host "`nStep 5: Restoring important files..." -ForegroundColor Yellow
foreach ($name in $backupFiles.Keys) {
    $backupPath = $backupFiles[$name]
    $targetPath = $importantFiles[$name]
    if (Test-Path $backupPath) {
        $targetDir = Split-Path $targetPath -Parent
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -Path $backupPath -Destination $targetPath -Force
        Write-Host "  ✓ Restored $name" -ForegroundColor Green
    }
}

# Step 6: Verify google-services.json
Write-Host "`nStep 6: Verifying google-services.json..." -ForegroundColor Yellow
$googleServicesPath = "android\app\google-services.json"
if (Test-Path $googleServicesPath) {
    Write-Host "  ✓ google-services.json exists" -ForegroundColor Green
} else {
    Write-Host "  ⚠ WARNING: google-services.json not found!" -ForegroundColor Red
    Write-Host "    You need to copy it from the backup or download from Firebase Console" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Fix Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run: npm install" -ForegroundColor White
Write-Host "2. Run: npx expo run:android" -ForegroundColor White
Write-Host ""
Write-Host "If issues persist:" -ForegroundColor Yellow
Write-Host "- Check that google-services.json is in android/app/" -ForegroundColor White
Write-Host "- Clean Gradle cache: Remove android/.gradle and android/app/build" -ForegroundColor White
$restoreMsg = "- Restore from backup: Copy android.bak.$timestamp back to android"
Write-Host $restoreMsg -ForegroundColor White
