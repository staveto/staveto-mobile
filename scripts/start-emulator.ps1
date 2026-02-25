# Start Metro for Android emulator - uses localhost + adb reverse for reliable connection
# Usage: npm run start:emulator  or  powershell -ExecutionPolicy Bypass -File ./scripts/start-emulator.ps1

$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-Location }
Set-Location $projectRoot

# adb reverse so emulator's localhost:8081 -> host's 8081
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    & $adb reverse tcp:8081 tcp:8081
    Write-Host "[start-emulator] adb reverse tcp:8081 tcp:8081" -ForegroundColor Gray
} else {
    Write-Host "[start-emulator] ADB not found - emulator may not connect. Install Android SDK." -ForegroundColor Yellow
}

# Force localhost so app connects via adb reverse (emulator can't always reach LAN IP)
$env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"
$env:EXPO_PACKAGER_HOSTNAME = "127.0.0.1"

Write-Host "[start-emulator] REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 (emulator uses adb reverse)" -ForegroundColor Gray
Write-Host ""

npx expo start --dev-client --port 8081 -c
