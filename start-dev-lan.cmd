@echo off
setlocal
title Libevra dev server (LAN, HTTP)
cd /d "%~dp0"

rem ==========================================================================
rem  DAILY ENTRY. Binds Vite to every interface so a phone on the same Wi-Fi
rem  can open the app. The API stays on loopback; Vite proxies /api locally.
rem
rem  The page is HTTP on purpose:  http://localhost:5173
rem  Phone secure-context features (recording/offline) need the separate
rem  start-dev-lan-https.cmd.
rem
rem  This file is deliberately pure ASCII. Chinese text inside a .cmd file
rem  gets mangled by cmd.exe code pages and can break parsing.
rem ==========================================================================

set "LIBELLUM_LAN=1"
set "WEB_URL=http://localhost:5173"
set "API_HEALTH=http://127.0.0.1:5173/api/v1/health"
set "LANIP="

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*Radmin*' } | Select-Object -First 1).IPAddress"`) do set "LANIP=%%i"
if not defined LANIP set "LANIP=<LAN-IP>"

rem Double-clicking twice is an easy mistake. Never start a second server:
rem it would either fail (strict port) or, worse, leave the browser on an old
rem instance. Say what is running, open the right address, keep the window open.
netstat -an | findstr /r /c:"TCP .*:5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Port 5173 is already in use - not starting a second server.
  echo.
  powershell -NoProfile -Command "try { $h = Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 3; '   Running version: ' + $h.version + '   database: ' + $h.database } catch { '   It did not answer /api/v1/health - probably an old or unrelated process.' }" 2>nul
  echo.
  echo   If that is NOT the version you expected, close the OLD server window
  echo   first, then run this file again. This window stays open on purpose.
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
  echo   Close the old server window if the page shows stale data.
  echo.
)

echo.
echo   ================================================================
echo     Libevra - daily dev server (LAN, HTTP)
echo   ================================================================
echo.
echo     This computer:  %WEB_URL%
echo     Phone:          http://%LANIP%:5173
echo     API:            http://127.0.0.1:3000/api/v1/health
echo.
echo     The browser opens automatically once the API answers.
echo     Keep THIS window open. Closing it (or Ctrl+C) stops the server.
echo     If startup fails, the error stays on screen - this window will
echo     not disappear on you.
echo   ================================================================
echo.

rem Open the browser only after the API answers, instead of guessing "15s".
start "" /min powershell -NoProfile -Command "for ($i=0; $i -lt 90; $i++) { try { $h = Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 2; if ($h.ok) { Start-Process '%WEB_URL%'; break } } catch {} ; Start-Sleep -Seconds 1 }"

call pnpm.cmd dev
set "EXITCODE=%ERRORLEVEL%"

echo.
echo   Dev server stopped. Exit code: %EXITCODE%
echo   If an error is shown above, fix it and run this file again.
echo   Otherwise you can close this window.
pause
