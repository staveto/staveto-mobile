@echo off
REM Spusti Android build mimo Cursor - obchadza limit 260 znakov (cursor-sandbox-cache)
REM Spust: dvojklikom alebo z CMD okna
set GRADLE_USER_HOME=C:\g
cd /d "%~dp0\.."
call npx expo run:android --all-arch
pause
