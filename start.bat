@echo off
REM ---------------------------------------------------------------------------
REM Watchlog launcher for Windows.
REM Double-click this file to start the server and open it in your browser.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies, this only happens once...
  call npm install --omit=dev
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000
echo Starting Watchlog on http://localhost:%PORT%
start "" "http://localhost:%PORT%"
node server\server.js

pause
