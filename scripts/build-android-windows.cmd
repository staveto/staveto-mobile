@echo off
REM Staveto Android dev install — spusti tento .cmd z Explorera alebo z "cmd.exe" / Windows Terminal (NIE z integrovaného terminálu Cursor),
REM inak Gradle môže používať cursor-sandbox-cache a build spadne na MAX_PATH (260 znakov).
setlocal EnableExtensions
set "GRADLE_USER_HOME=C:\g"
set "TMP=C:\g"
set "TEMP=C:\g"
set "TMPDIR=C:\g"
REM Force Gradle user home via both env + JVM system property (some wrappers ignore GRADLE_USER_HOME).
set "JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=C:/g/jtmp -Dgradle.user.home=C:/g"
set "GRADLE_OPTS=-Dgradle.user.home=C:/g -Djava.io.tmpdir=C:/g/jtmp"
set "CI=1"
if not exist "C:\g" mkdir "C:\g" 2>nul
if not exist "C:\g\jtmp" mkdir "C:\g\jtmp" 2>nul

cd /d "%~dp0..\android"
call gradlew.bat --stop 2>nul
cd /d "%~dp0.."

if "%EXPO_METRO_PORT%"=="" set "EXPO_METRO_PORT=8083"
echo [staveto] GRADLE_USER_HOME=%GRADLE_USER_HOME%
echo [staveto] TEMP=%TEMP%
echo [staveto] JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS%
call npx expo run:android --port %EXPO_METRO_PORT% --no-build-cache
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
