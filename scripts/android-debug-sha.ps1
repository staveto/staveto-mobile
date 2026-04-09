# Prints SHA-1 / SHA-256 for keystores used to sign local Android debug builds.
# Add these in Firebase Console -> Project settings -> Your Android app -> SHA certificate fingerprints.
#
# IMPORTANT: Expo / React Native templates often sign debug APKs with android/app/debug.keystore
# (in the repo), NOT ~/.android/debug.keystore. Google Sign-In (DEVELOPER_ERROR / code 10) requires
# the fingerprint of the keystore that *actually* signs the installed APK.

$ErrorActionPreference = "Stop"

function Find-Keytool {
    $cmd = Get-Command keytool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:JAVA_HOME\bin\keytool.exe"
        "${env:ProgramFiles}\Android\Android Studio\jbr\bin\keytool.exe"
        "${env:ProgramFiles(x86)}\Android\android-studio\jbr\bin\keytool.exe"
        "${env:ProgramFiles}\Eclipse Adoptium\jdk-*\bin\keytool.exe"
    )
    foreach ($p in $candidates) {
        $resolved = Get-Item $p -ErrorAction SilentlyContinue
        if ($resolved -and $resolved.PSIsContainer -eq $false -and (Test-Path $resolved.FullName)) {
            return $resolved.FullName
        }
    }
    return $null
}

$kt = Find-Keytool
if (-not $kt) {
    Write-Host "keytool not found. Install JDK or Android Studio, or set JAVA_HOME." -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$projectDebugKs = Join-Path $projectRoot "android\app\debug.keystore"
$defaultDebugKs = Join-Path $env:USERPROFILE ".android\debug.keystore"

function Print-Keystore($label, $path) {
    Write-Host ""
    Write-Host "=== $label ===" -ForegroundColor Cyan
    Write-Host "Path: $path"
    Write-Host "Alias: androiddebugkey (default password: android)"
    Write-Host ""
    & $kt -list -v -keystore $path -alias androiddebugkey -storepass android -keypass android
}

if (Test-Path $projectDebugKs) {
    Print-Keystore "PROJECT debug keystore (usually signs expo run:android / Gradle debug)" $projectDebugKs
    Write-Host ""
    Write-Host ">>> Add the SHA-1 (and SHA-256) above to Firebase for com.staveto.app if you use local debug builds." -ForegroundColor Yellow
} else {
    Write-Host "No project keystore at: $projectDebugKs" -ForegroundColor DarkGray
}

if (Test-Path $defaultDebugKs) {
    Print-Keystore "Default user debug keystore (~/.android)" $defaultDebugKs
} else {
    Write-Host ""
    Write-Host "Default debug keystore not found: $defaultDebugKs" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Cyan
Write-Host "1. Firebase Console -> Project settings -> Your apps -> Android (com.staveto.app)"
Write-Host "2. Add fingerprint -> paste SHA-1 (and recommended: SHA-256) for the keystore that signs YOUR APK"
Write-Host "3. Re-download google-services.json after adding fingerprints, then rebuild the app"
Write-Host "4. EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = Web client ID (*.apps.googleusercontent.com)"
Write-Host ""
