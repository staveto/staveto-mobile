@echo off
REM Run Android build for emulator - use .\run-android-emulator.bat in PowerShell
REM Avoids "path longer than 260 chars" by using Gradle directly with x86_64 only
set GRADLE_USER_HOME=C:\gc
set TMP=C:\gc
set TEMP=C:\gc

if not exist C:\gc mkdir C:\gc

cd /d "%~dp0"
call android\gradlew.bat --stop 2>nul

REM Build with x86_64 ONLY (Expo CLI adds arm64 which causes path error)
cd android
call gradlew.bat app:assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 -PreactNativeDevServerPort=8081

if %ERRORLEVEL% NEQ 0 (cd .. & exit /b %ERRORLEVEL%)

REM Install APK on connected emulator
call gradlew.bat installDebug -PreactNativeArchitectures=x86_64

if %ERRORLEVEL% NEQ 0 (cd .. & exit /b %ERRORLEVEL%)
cd ..

if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

REM Start Metro for JS bundle (run in separate terminal: npm start)
echo Build OK. Start Metro with: npm start
echo Then open the app on the emulator.
