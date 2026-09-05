@echo off
setlocal
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Launch-Dashboard.ps1"
set EC=%ERRORLEVEL%
exit /b %EC%
