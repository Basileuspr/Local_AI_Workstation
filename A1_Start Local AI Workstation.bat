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

if not exist "node_modules\electron\dist\electron.exe" (
    echo Dependencies are missing. Run this command in PowerShell from this folder:
    echo powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
    popd
    pause
    exit /b 1
)

if not exist "dist\index.html" (
    echo Building the desktop view...
    call npm.cmd run build
    if errorlevel 1 (
        echo Build failed. Run scripts\setup-windows.ps1 and review its errors.
        popd
        pause
        exit /b 1
    )
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
