@echo off
REM Android build - x86_64 only (avoids 260-char path), Gradle directly
setlocal

echo.
echo ========================================
echo   Staveto - Android emulator
echo ========================================
echo.
echo Pred spustenim:
echo   1. Spusti Android emulator (Android Studio - Device Manager - klikni na Play)
echo   2. Pockaj kym sa emulator nabootuje
echo.
echo Tento skript:
echo   - Zostavi APK (prvy build ~2-5 min)
echo   - Nainstaluje na emulator
echo   - Spusti Metro a aplikaciu
echo.
echo Ak sa app zasekne na "Nacitavam...": stlac Ctrl+M v emulatore - Reload
echo.
echo ========================================
echo.
set "PROJECT_ROOT=%~dp0"
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

if not exist C:\g mkdir C:\g
set GRADLE_USER_HOME=C:\g
set TMP=C:\g
set TEMP=C:\g

cd /d "%PROJECT_ROOT%\android"

REM Gradle directly with x86_64 only (Expo CLI adds arm64 -> path error)
call gradlew.bat --stop 2>nul
call gradlew.bat app:assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 -PreactNativeDevServerPort=8083
if %ERRORLEVEL% NEQ 0 goto :fail
call gradlew.bat installDebug -PreactNativeArchitectures=x86_64
if %ERRORLEVEL% NEQ 0 goto :fail

cd /d "%PROJECT_ROOT%"
REM adb reverse - device/emulator can reach Metro + Cursor debug ingest on host
where adb >nul 2>&1 && (adb reverse tcp:8081 tcp:8081 & adb reverse tcp:8083 tcp:8083 & adb reverse tcp:7281 tcp:7281)
REM 10.0.2.2 = emulator's way to reach host
set REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2
set EXPO_PACKAGER_HOSTNAME=10.0.2.2
REM Start Metro + launch app (port 8083 if 8081 is busy)
call npx expo start --dev-client --android --port 8083
set "EXIT_CODE=%ERRORLEVEL%"
goto :done

:fail
set "EXIT_CODE=%ERRORLEVEL%"

:done
endlocal
exit /b %EXIT_CODE%
