@echo off
setlocal
set "TMPPS=%TEMP%\GeminiBridge-Uninstall-%RANDOM%.ps1"
copy /y "%~dp0Uninstall.ps1" "%TMPPS%" >nul
if errorlevel 1 exit /b %ERRORLEVEL%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%"
set EC=%ERRORLEVEL%
del /q "%TMPPS%" >nul 2>&1
if not "%EC%"=="0" pause
exit /b %EC%
