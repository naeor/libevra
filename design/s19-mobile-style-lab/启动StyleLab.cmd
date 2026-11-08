@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:5190/
node serve.mjs 5190
pause
