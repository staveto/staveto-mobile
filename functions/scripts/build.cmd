@echo off
cd /d "%~dp0.."
"C:\Users\Marek\AppData\Local\nvm\v20.19.4\node.exe" "./node_modules/typescript/bin/tsc"
exit /b %ERRORLEVEL%
