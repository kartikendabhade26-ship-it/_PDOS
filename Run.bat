@echo off
title Nasdaq Trading Terminal
cls
echo ===================================================
echo   Nasdaq Trading Terminal Launcher
echo ===================================================
echo   1. Start Developer Mode (Vite Dev Server + API)
echo   2. Start Production Mode (Single Port 8080)
echo   3. Exit
echo ===================================================
echo.

set /p choice="Enter choice (1-3): "

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto prod
if "%choice%"=="3" exit
goto start

:dev
echo.
echo [1/3] Starting backend server (Node.js) on port 8080...
start /b cmd /c "node server.js"
timeout /t 2 /nobreak >nul
echo [2/3] Starting frontend server (Vite) on port 5173...
start /b cmd /c "npm run dev --prefix frontend"
timeout /t 3 /nobreak >nul
echo [3/3] Launching terminal in browser...
start http://localhost:5173/
goto running

:prod
echo.
echo [1/3] Rebuilding frontend assets for production...
cd frontend
call npm run build
cd ..
echo [2/3] Starting backend server on port 8080 (Single Port Mode)...
start /b cmd /c "node server.js"
timeout /t 3 /nobreak >nul
echo [3/3] Launching terminal in browser...
start http://localhost:8080/
goto running

:running
echo.
echo ===================================================
echo   System running. Close this window to stop it.
echo ===================================================
echo.
pause
