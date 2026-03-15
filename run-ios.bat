@echo off
REM iOS - Metro s tunelom pre development build na iPhone
REM Dolezite: Expo Go NEFUNGUJE - potrebujes development build (pozri docs\IOS_DEVICE_SETUP.md)
setlocal
set "PROJECT_ROOT=%~dp0"
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"
cd /d "%PROJECT_ROOT%"

echo.
echo [iOS] Spustam Metro s tunelom pre iPhone...
echo [iOS] Na iPhone otvor STAVETO development app (nie Expo Go!) a naskenuj QR kod.
echo [iOS] Ak nemas dev build: eas build --profile development --platform ios
echo.

call npx expo start --tunnel --dev-client
exit /b %ERRORLEVEL%
