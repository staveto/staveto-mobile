# Diagnostic script to identify Android build issues
# Run this to see what's wrong before applying the fix

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Android Build Diagnostic" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$issues = @()
$warnings = @()

# Check 1: Android folder exists
Write-Host "Checking Android folder..." -ForegroundColor Yellow
if (Test-Path "android") {
    Write-Host "  ✓ android/ folder exists" -ForegroundColor Green
} else {
    Write-Host "  ✗ android/ folder missing!" -ForegroundColor Red
    $issues += "android/ folder does not exist"
}

# Check 2: settings.gradle exists
Write-Host "`nChecking settings.gradle..." -ForegroundColor Yellow
if (Test-Path "android\settings.gradle") {
    Write-Host "  ✓ settings.gradle exists" -ForegroundColor Green
    
    # Check for absolute paths
    $content = Get-Content "android\settings.gradle" -Raw
    if ($content -match "C:\\\\(Users|src|Program)") {
        Write-Host "  ✗ Found hardcoded absolute paths!" -ForegroundColor Red
        $matches = [regex]::Matches($content, "C:\\\\(Users|src|Program)[^\s\)\`"]+")
        foreach ($match in $matches) {
            Write-Host "    - $($match.Value)" -ForegroundColor Red
            $issues += "Hardcoded path: $($match.Value)"
        }
    } else {
        Write-Host "  ✓ No hardcoded absolute paths found" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ settings.gradle missing!" -ForegroundColor Red
    $issues += "settings.gradle does not exist"
}

# Check 3: google-services.json
Write-Host "`nChecking Firebase config..." -ForegroundColor Yellow
if (Test-Path "android\app\google-services.json") {
    Write-Host "  ✓ google-services.json exists" -ForegroundColor Green
} else {
    Write-Host "  ⚠ google-services.json missing (will need to restore)" -ForegroundColor Yellow
    $warnings += "google-services.json missing"
}

# Check 4: Node modules
Write-Host "`nChecking React Native modules..." -ForegroundColor Yellow
$requiredModules = @(
    "react-native",
    "@react-native/gradle-plugin",
    "expo",
    "expo-modules-autolinking",
    "react-native-screens",
    "react-native-gesture-handler",
    "react-native-reanimated"
)

foreach ($module in $requiredModules) {
    $modulePath = "node_modules\$module"
    if (Test-Path $modulePath) {
        Write-Host "  ✓ $module" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $module missing!" -ForegroundColor Red
        $issues += "Module missing: $module"
    }
}

# Check 5: React Native Android folder
Write-Host "`nChecking React Native Android build files..." -ForegroundColor Yellow
$rnAndroidPath = "node_modules\react-native\android"
if (Test-Path $rnAndroidPath) {
    Write-Host "  ✓ react-native/android exists" -ForegroundColor Green
    
    if (Test-Path "$rnAndroidPath\build.gradle") {
        Write-Host "  ✓ react-native/android/build.gradle exists" -ForegroundColor Green
    } else {
        Write-Host "  ✗ react-native/android/build.gradle missing!" -ForegroundColor Red
        $issues += "react-native/android/build.gradle missing"
    }
} else {
    Write-Host "  ✗ react-native/android missing!" -ForegroundColor Red
    $issues += "react-native/android folder missing"
}

# Check 6: Gradle cache
Write-Host "`nChecking Gradle cache..." -ForegroundColor Yellow
if (Test-Path "android\.gradle") {
    Write-Host "  ⚠ Gradle cache exists (may contain stale paths)" -ForegroundColor Yellow
    $warnings += "Gradle cache may need cleaning"
} else {
    Write-Host "  ✓ No local Gradle cache" -ForegroundColor Green
}

# Check 7: Project location consistency
Write-Host "`nChecking project structure..." -ForegroundColor Yellow
$currentDir = (Get-Location).Path
Write-Host "  Current directory: $currentDir" -ForegroundColor Gray

if ($currentDir -match "C:\\src") {
    Write-Host "  ⚠ Project is in C:\src (temporary location?)" -ForegroundColor Yellow
    $warnings += "Project in temporary location"
} elseif ($currentDir -match "C:\\Users\\Marek") {
    Write-Host "  ✓ Project is in user directory" -ForegroundColor Green
}

# Check 8: Package.json location
Write-Host "`nChecking package.json..." -ForegroundColor Yellow
if (Test-Path "package.json") {
    Write-Host "  ✓ package.json exists" -ForegroundColor Green
    $pkg = Get-Content "package.json" | ConvertFrom-Json
    Write-Host "  Project name: $($pkg.name)" -ForegroundColor Gray
} else {
    Write-Host "  ✗ package.json missing!" -ForegroundColor Red
    $issues += "package.json missing"
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "✓ No issues found!" -ForegroundColor Green
    Write-Host "`nIf you're still getting build errors, try:" -ForegroundColor Yellow
    Write-Host "1. Clean Gradle cache: Remove android\.gradle" -ForegroundColor White
    Write-Host "2. Regenerate: npx expo prebuild --platform android --clean" -ForegroundColor White
} else {
    if ($issues.Count -gt 0) {
        Write-Host "`n✗ Issues found ($($issues.Count)):" -ForegroundColor Red
        foreach ($issue in $issues) {
            Write-Host "  - $issue" -ForegroundColor Red
        }
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "`n⚠ Warnings ($($warnings.Count)):" -ForegroundColor Yellow
        foreach ($warning in $warnings) {
            Write-Host "  - $warning" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`nRecommended fix:" -ForegroundColor Yellow
    Write-Host "  Run: .\fix-android-build.ps1" -ForegroundColor White
    Write-Host "  Or follow manual steps in ANDROID-BUILD-FIX.md" -ForegroundColor White
}

Write-Host ""
