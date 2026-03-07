@echo off
REM Android build - short paths to avoid Windows 260-char limit
REM Run from File Explorer (double-click) or CMD - NOT from Cursor terminal
setlocal
set "PROJECT_ROOT=%~dp0"
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

if not exist C:\g mkdir C:\g
set GRADLE_USER_HOME=C:\g
set TMP=C:\g
set TEMP=C:\g
set REACT_NATIVE_ARCHITECTURES=x86_64

cd /d "%PROJECT_ROOT%"
call npx expo run:android %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal
exit /b %EXIT_CODE%
