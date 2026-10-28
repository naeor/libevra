@echo off
setlocal
title Libevra dev server (this computer only)
cd /d "%~dp0"

rem ==========================================================================
rem  DAILY ENTRY for this computer only (Vite binds 127.0.0.1).
rem  Page: http://localhost:5173    API: http://127.0.0.1:3000
rem  Pure ASCII on purpose; see start-dev-lan.cmd header.
rem ==========================================================================

set "WEB_URL=http://localhost:5173"
set "API_HEALTH=http://127.0.0.1:5173/api/v1/health"

netstat -an | findstr /r /c:"TCP .*:5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Port 5173 is already in use - not starting a second server.
  echo.
  powershell -NoProfile -Command "try { $h = Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 3; '   Running version: ' + $h.version + '   database: ' + $h.database } catch { '   It did not answer /api/v1/health - probably an old or unrelated process.' }" 2>nul
  echo.
  echo   If that is NOT the version you expected, close the OLD server window
  echo   first, then run this file again.
  echo.
  start "" "%WEB_URL%"
  echo   Opened %WEB_URL%
  pause
  exit /b 0
)

netstat -an | findstr /r /c:"TCP .*:3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   WARNING: port 3000 is already in use. The API may fail to start.
  echo.
)

echo.
echo   ================================================================
echo     Libevra - local development server (this computer only)
echo   ================================================================
echo.
echo     Web    %WEB_URL%
echo     API    http://127.0.0.1:3000/api/v1/health
echo.
echo     The browser opens automatically once the API answers.
echo     Keep THIS window open. Closing it (or Ctrl+C) stops the server.
echo     Startup errors stay visible here; the window will not vanish.
echo   ================================================================
echo.

start "" /min powershell -NoProfile -Command "for ($i=0; $i -lt 90; $i++) { try { $h = Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 2; if ($h.ok) { Start-Process '%WEB_URL%'; break } } catch {} ; Start-Sleep -Seconds 1 }"

call pnpm.cmd dev
set "EXITCODE=%ERRORLEVEL%"

echo.
echo   Dev server stopped. Exit code: %EXITCODE%
echo   Run this file again to restart it, or close this window.
pause
