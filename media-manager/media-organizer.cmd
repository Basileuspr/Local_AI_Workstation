@echo off
rem Launcher for the Media Organizer prototype.  Usage: media-organizer <command> [options]
setlocal
set "PYTHONPATH=%~dp0;%PYTHONPATH%"
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m media_organizer %*
) else (
  py -3 -m media_organizer %*
)
exit /b %ERRORLEVEL%
