@echo off
title Nasdaq Trading Terminal
echo ===================================================
echo   Nasdaq Trading Terminal - Quick Starter
echo ===================================================
echo.

:: Kill any existing processes running on port 8080 or 5173
echo [0/3] Terminating any existing processes on ports 8080 and 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do taskkill /f /pid %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173') do taskkill /f /pid %%a 2>nul
timeout /t 1 /nobreak >nul

:: Start the Node.js backend server on port 8080
echo [1/3] Starting backend server (Node.js) on port 8080...
start /b cmd /c "node server.js"

:: Wait 2 seconds for backend initialization
timeout /t 2 /nobreak >nul

:: Start the frontend dev server (Vite) on port 5173
echo [2/3] Starting frontend server (Vite) on port 5173...
start /b cmd /c "npm run dev --prefix frontend"

:: Wait 3 seconds for Vite dev server to boot
timeout /t 3 /nobreak >nul

:: Open default browser to the terminal
echo [3/3] Launching terminal in default browser...
start http://localhost:5173/

echo.
echo ===================================================
echo   System running. Close this window to stop it.
echo ===================================================
echo.

pause
