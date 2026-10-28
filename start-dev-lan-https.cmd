@echo off
setlocal
title Libevra dev server (LAN, HTTPS for phone recording/offline)
cd /d "%~dp0"

rem ==========================================================================
rem  OPTIONAL LAN HTTPS entry.
rem
rem  Use this ONLY when testing phone features that need a secure context:
rem  speech recording, service workers / offline mode, crypto.randomUUID.
rem  The daily desktop entry stays start-dev-lan.cmd (plain HTTP).
rem
rem  The certificate is self-signed (pnpm dev:cert) and must be trusted once
rem  on the phone. First visit shows a certificate warning - that is expected.
rem  Pure ASCII on purpose.
rem ==========================================================================

set "LIBELLUM_LAN=1"
set "LIBELLUM_HTTPS=1"
set "WEB_URL=https://localhost:5173"
set "API_HEALTH=https://127.0.0.1:5173/api/v1/health"
set "LANIP="

if not exist "apps\web\.certs\dev-cert.pem" goto :nocert
if not exist "apps\web\.certs\dev-key.pem" goto :nocert

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*Radmin*' } | Select-Object -First 1).IPAddress"`) do set "LANIP=%%i"
if not defined LANIP set "LANIP=<LAN-IP>"

netstat -an | findstr /r /c:"TCP .*:5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Port 5173 is already in use - not starting a second server.
  echo   An HTTP server may be running there; close it before using HTTPS.
  echo.
  start "" "%WEB_URL%"
  pause
  exit /b 0
)

echo.
echo   ================================================================
echo     Libevra - LAN HTTPS (phone recording / offline testing)
echo   ================================================================
echo.
echo     This computer:  %WEB_URL%
echo     Phone:          https://%LANIP%:5173
echo.
echo     First visit shows a self-signed certificate warning. Trust it once
echo     on the phone; afterwards recording and offline mode work there.
echo.
echo     Keep THIS window open. Closing it (or Ctrl+C) stops the server.
echo   ================================================================
echo.

start "" /min powershell -NoProfile -Command "for ($i=0; $i -lt 90; $i++) { try { $h = Invoke-RestMethod -Uri '%API_HEALTH%' -TimeoutSec 2; if ($h.ok) { Start-Process '%WEB_URL%'; break } } catch {} ; Start-Sleep -Seconds 1 }"

call pnpm.cmd dev
set "EXITCODE=%ERRORLEVEL%"

echo.
echo   Dev server stopped. Exit code: %EXITCODE%
echo   If an error is shown above, fix it and run this file again.
pause
exit /b %EXITCODE%

:nocert
echo.
echo   ================================================================
echo     NO DEVELOPMENT CERTIFICATE
echo   ================================================================
echo.
echo     HTTPS mode needs apps\web\.certs\dev-cert.pem and dev-key.pem.
echo.
echo     Run this once, then start this file again:
echo.
echo         pnpm dev:cert
echo.
echo     Use start-dev-lan.cmd (plain HTTP) if you do not need phone
echo     recording/offline features.
echo   ================================================================
echo.
pause
exit /b 1
