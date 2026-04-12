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

# Port 8081 must match adb reverse above; Expo otherwise prompts (blocks CI / scripts).
$listen = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) {
    $owningPid = $listen.OwningProcess
    $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match '^(node|expo)$') {
        Write-Host "[start-emulator] Stopping $($proc.ProcessName) PID $owningPid on port 8081 (old packager)." -ForegroundColor Yellow
        Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 900
    } else {
        Write-Host "[start-emulator] Port 8081 is in use by PID $owningPid ($($proc.ProcessName)). Free it or change adb reverse + port." -ForegroundColor Yellow
    }
}

# -c clears Metro cache so JS changes (e.g. OCR) are always picked up
npx expo start --dev-client --port 8081 --clear
