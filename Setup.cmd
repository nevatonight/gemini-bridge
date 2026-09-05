@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
set EC=%ERRORLEVEL%
if not "%EC%"=="0" pause
exit /b %EC%
