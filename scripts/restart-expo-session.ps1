# Restart ADB + free Metro port 8081 + Expo with logs (same idea as start-emulator, plus adb recycle)
$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-Location }
Set-Location $projectRoot

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    Write-Host "[restart-expo] adb kill-server / start-server" -ForegroundColor Cyan
    & $adb kill-server 2>$null
    Start-Sleep -Milliseconds 800
    & $adb start-server
    Start-Sleep -Milliseconds 500
    & $adb devices
    & $adb reverse tcp:8081 tcp:8081 2>$null
    Write-Host "[restart-expo] adb reverse tcp:8081 tcp:8081" -ForegroundColor Gray
} else {
    Write-Host "[restart-expo] adb not found at $adb" -ForegroundColor Yellow
}

$listen = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) {
    $owningPid = $listen.OwningProcess
    $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
    Write-Host "[restart-expo] Stopping PID $owningPid ($($proc.ProcessName)) on 8081" -ForegroundColor Yellow
    Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 900
}

$env:REACT_NATIVE_PACKAGER_HOSTNAME = "127.0.0.1"
$env:EXPO_PACKAGER_HOSTNAME = "127.0.0.1"
Write-Host "[restart-expo] Starting Metro (logs below)..." -ForegroundColor Green
npx expo start --dev-client --port 8081 --clear
