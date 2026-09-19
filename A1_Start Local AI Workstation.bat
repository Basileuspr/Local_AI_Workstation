@echo off
setlocal
title Local AI Workstation

pushd "%~dp0"
if errorlevel 1 (
    echo Could not open the Local AI Workstation folder.
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js and npm could not be found. Install Node.js or check your PATH.
    popd
    pause
    exit /b 1
)

call npm.cmd start
set "launchExitCode=%errorlevel%"
popd

if not "%launchExitCode%"=="0" (
    echo.
    echo The app exited with error code %launchExitCode%.
    pause
)

exit /b %launchExitCode%
