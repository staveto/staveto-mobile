@echo off
REM Android build - x86_64 only (avoids 260-char path), Gradle directly
setlocal
set "PROJECT_ROOT=%~dp0"
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

if not exist C:\g mkdir C:\g
set GRADLE_USER_HOME=C:\g
set TMP=C:\g
set TEMP=C:\g

cd /d "%PROJECT_ROOT%\android"

REM Gradle directly with x86_64 only (Expo CLI adds arm64 -> path error)
call gradlew.bat --stop 2>nul
call gradlew.bat app:assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 -PreactNativeDevServerPort=8081
if %ERRORLEVEL% NEQ 0 goto :fail
call gradlew.bat installDebug -PreactNativeArchitectures=x86_64
if %ERRORLEVEL% NEQ 0 goto :fail

cd /d "%PROJECT_ROOT%"
REM Start Metro + launch app
call npx expo start --dev-client --android
set "EXIT_CODE=%ERRORLEVEL%"
goto :done

:fail
set "EXIT_CODE=%ERRORLEVEL%"

:done
endlocal
exit /b %EXIT_CODE%
