# Build Android app from external PowerShell (outside Cursor sandbox)
# This avoids Windows 260-character path limit issues
# Usage: npm run dev:android:external
# Or run directly: .\scripts\build-android-external.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Android Build (External Terminal)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# CRITICAL: Check if running in Cursor sandbox
$currentPath = (Get-Location).Path
if ($currentPath -match "cursor-sandbox-cache") {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "ERROR: Running in Cursor sandbox!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Current path: $currentPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This script MUST be run from external PowerShell, not Cursor terminal!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Steps to fix:" -ForegroundColor Cyan
    Write-Host "1. Close this terminal" -ForegroundColor White
    Write-Host "2. Open Windows PowerShell (external, not Cursor)" -ForegroundColor White
    Write-Host "3. Navigate to: $projectRoot" -ForegroundColor White
    Write-Host "4. Run: npm run dev:android:external" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "Project root: $projectRoot" -ForegroundColor Gray
Write-Host "Current directory: $currentPath" -ForegroundColor Gray
Write-Host ""

# Step 1: Set environment variables to avoid Cursor sandbox paths
Write-Host "Step 1: Setting environment variables..." -ForegroundColor Yellow

# Use shorter Gradle cache paths (JVM options only - no -P properties here)
$env:GRADLE_USER_HOME = "C:\g"
$env:GRADLE_OPTS = "-Dorg.gradle.user.home=C:\g"

# Set Android architecture to x86_64 ONLY (for emulator, avoids arm64 path issues)
# CRITICAL: These must be set BEFORE Expo CLI runs to prevent default architectures
$env:EXPO_ANDROID_ARCHITECTURES = "x86_64"
$env:REACT_NATIVE_ARCHITECTURES = "x86_64"

# Gradle project property: ORG_GRADLE_PROJECT_<name> sets -P<name>=<value>
# -P properties are NOT JVM options; GRADLE_OPTS is wrong for them
$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = "x86_64"

# Ensure we're using real project path, not sandbox
$env:PROJECT_ROOT = $projectRoot

# Verify node executable path (should not be in sandbox)
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodePath -and $nodePath -match "cursor-sandbox") {
    Write-Host "  [WARN] Node path contains sandbox: $nodePath" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] Node path: $nodePath" -ForegroundColor Gray
}

Write-Host "  [OK] GRADLE_USER_HOME = $env:GRADLE_USER_HOME" -ForegroundColor Green
Write-Host "  [OK] EXPO_ANDROID_ARCHITECTURES = $env:EXPO_ANDROID_ARCHITECTURES" -ForegroundColor Green
Write-Host "  [OK] REACT_NATIVE_ARCHITECTURES = $env:REACT_NATIVE_ARCHITECTURES" -ForegroundColor Green
Write-Host "  [OK] ORG_GRADLE_PROJECT_reactNativeArchitectures = $env:ORG_GRADLE_PROJECT_reactNativeArchitectures" -ForegroundColor Green
Write-Host ""

# Step 2: Create cache directory if it doesn't exist
Write-Host "Step 2: Creating cache directory..." -ForegroundColor Yellow
$cacheDirs = @("C:\g", "C:\t")
foreach ($dir in $cacheDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  [OK] Created: $dir" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Exists: $dir" -ForegroundColor Gray
    }
}
Write-Host ""

# Step 3: Clean build artifacts (optional - uncomment if needed)
# Write-Host "Step 3: Cleaning build artifacts..." -ForegroundColor Yellow
# $cleanPaths = @(
#     "android\app\build",
#     "android\.gradle",
#     "android\app\.cxx",
#     "node_modules\react-native-screens\android\.cxx"
# )
# foreach ($path in $cleanPaths) {
#     $fullPath = Join-Path $projectRoot $path
#     if (Test-Path $fullPath) {
#         Remove-Item -Recurse -Force $fullPath -ErrorAction SilentlyContinue
#         Write-Host "  [OK] Cleaned: $path" -ForegroundColor Gray
#     }
# }
# Write-Host ""

# Step 4: Verify architecture settings before build
Write-Host "Step 4: Verifying architecture configuration..." -ForegroundColor Yellow

# Read gradle.properties to verify reactNativeArchitectures
$gradlePropsPath = Join-Path $projectRoot "android\gradle.properties"
if (Test-Path $gradlePropsPath) {
    $gradleProps = Get-Content $gradlePropsPath -Raw
    if ($gradleProps -match "reactNativeArchitectures\s*=\s*([^\r\n]+)") {
        $archValue = $matches[1].Trim()
        Write-Host "  [OK] gradle.properties: reactNativeArchitectures=$archValue" -ForegroundColor Green
        if ($archValue -ne "x86_64") {
            Write-Host "  [WARN] Expected x86_64, found: $archValue" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [WARN] reactNativeArchitectures not found in gradle.properties" -ForegroundColor Yellow
    }
}

# Verify app/build.gradle has ndk.abiFilters
$appBuildGradlePath = Join-Path $projectRoot "android\app\build.gradle"
if (Test-Path $appBuildGradlePath) {
    $appBuildGradle = Get-Content $appBuildGradlePath -Raw
    if ($appBuildGradle -match 'abiFilters\s+"x86_64"') {
        Write-Host "  [OK] app/build.gradle: ndk.abiFilters includes x86_64" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] app/build.gradle: ndk.abiFilters not found or incorrect" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Step 5: Environment variables (printed before build):" -ForegroundColor Yellow
Write-Host "  EXPO_ANDROID_ARCHITECTURES = $env:EXPO_ANDROID_ARCHITECTURES" -ForegroundColor Gray
Write-Host "  REACT_NATIVE_ARCHITECTURES = $env:REACT_NATIVE_ARCHITECTURES" -ForegroundColor Gray
Write-Host "  ORG_GRADLE_PROJECT_reactNativeArchitectures = $env:ORG_GRADLE_PROJECT_reactNativeArchitectures" -ForegroundColor Gray
Write-Host ""
Write-Host "Step 6: Building Android app..." -ForegroundColor Yellow
Write-Host "  Command: npx expo run:android --all-arch" -ForegroundColor Gray
Write-Host "  --all-arch = use gradle.properties (x86_64 only), avoids arm64 path limit" -ForegroundColor Gray
Write-Host ""

# Capture build output for arm64 verification (fail-fast)
$buildLogPath = Join-Path $env:TEMP "expo-android-build-$(Get-Date -Format 'yyyyMMddHHmmss').log"
npx expo run:android --all-arch 2>&1 | Tee-Object -FilePath $buildLogPath
$buildExitCode = $LASTEXITCODE

# Hard verification: FAIL FAST if arm64 appears in build output
$buildOutput = Get-Content $buildLogPath -Raw -ErrorAction SilentlyContinue
$arm64Patterns = @("arm64-v8a", "x86_64,arm64-v8a", "buildCMakeDebug[arm64-v8a]")
$arm64Detected = $false
$detectedPattern = ""

foreach ($pattern in $arm64Patterns) {
    if ($buildOutput -match [regex]::Escape($pattern)) {
        $arm64Detected = $true
        $detectedPattern = $pattern
        break
    }
}

if ($arm64Detected) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "FAIL: arm64-v8a detected in build output!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Detected pattern: $detectedPattern" -ForegroundColor Red
    Write-Host "  Build log: $buildLogPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Expected: x86_64 ONLY. arm64-v8a causes Windows MAX_PATH errors." -ForegroundColor Yellow
    Write-Host "Verify: gradle.properties, app/build.gradle ndk.abiFilters, env vars." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host ""

if ($buildExitCode -eq 0) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Build completed successfully!" -ForegroundColor Green
    Write-Host "  Architecture: x86_64 only (verified)" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    exit 0
} else {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Build failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Exit code: $buildExitCode" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Ensure Android emulator is running" -ForegroundColor White
    Write-Host "2. Try: npm run clean:android" -ForegroundColor White
    Write-Host "3. Verify EXPO_ANDROID_ARCHITECTURES=x86_64" -ForegroundColor White
    Write-Host "4. Run from external PowerShell only (not Cursor terminal)" -ForegroundColor White
    Write-Host ""
    exit 1
}
