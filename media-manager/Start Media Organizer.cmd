@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m media_organizer.ui_server %*
) else (
  py -3 -m media_organizer.ui_server %*
)
if errorlevel 1 pause
