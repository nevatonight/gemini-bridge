@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Auth-GeminiBridge.ps1"
set EC=%ERRORLEVEL%
exit /b %EC%
