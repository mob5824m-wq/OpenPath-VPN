@echo off
REM OpenPath VPN — one-command server setup (Windows)
REM   git clone https://github.com/mob5824m-wq/OpenPath-VPN
REM   cd OpenPath-VPN
REM   setup.bat
REM No secrets needed — auto-installs, builds, generates PSK, starts server.
REM Requires Node.js 18+ and npm (https://nodejs.org)
setlocal enabledelayedexpansion

set ROOT=%~dp0
set SERVER=%ROOT%server
set PORT=4433
set HOST=0.0.0.0
set DEMO_PSK_DEFAULT=demo-student-key-do-not-use-prod

REM args: --port=XXXX --psk=XXX --docker --no-build --open
set CUSTOM_PSK=
set CUSTOM_PORT=
set USE_DOCKER=
set NO_BUILD=
set OPEN_BROWSER=
for %%a in (%*) do (
  echo %%a | findstr /b "--port=" >nul && set CUSTOM_PORT=%%a & set CUSTOM_PORT=!CUSTOM_PORT:--port=!
  echo %%a | findstr /b "--psk=" >nul && set CUSTOM_PSK=%%a & set CUSTOM_PSK=!CUSTOM_PSK:--psk=!
  if "%%a"=="--docker" set USE_DOCKER=1
  if "%%a"=="--no-build" set NO_BUILD=1
  if "%%a"=="--open" set OPEN_BROWSER=1
  if "%%a"=="--help" goto :help
  if "%%a"=="-h" goto :help
)
if not "%CUSTOM_PORT%"=="" set PORT=%CUSTOM_PORT%

echo.
echo   ___                    ____        _   _     __   ____  _   _
echo  / _ \  _ __    ___  _  ^|  _ \  __ _^| ^|_^| ^|__  \ \ / / _ \^| \ ^| ^|
echo ^| ^| ^| ^|^| '_ \  / _ \^| '_^|^| ^|_) ^|/ _` ^| __^| '_ \  \ V / ^| ^| ^|  \^| ^|
echo ^| ^|_^| ^|^| ^|_) ^|^|  __/^| ^|  ^|  __/^| (_^| ^| ^|_^| ^| ^| ^|  ^| ^|  ^|_^| ^| ^|\  ^|
echo  \___/ ^| .__/  \___^|^|_^|  ^|_^|    \__,_^|\__^|_^| ^|_^|  ^|_^| \___/^|_^| \_^|
echo        ^|_^|      GhostPath stealth VPN -- git clone ^& go
echo.
echo  Root: %ROOT%
echo  Platform: Windows %OS%

REM docker shortcut
if defined USE_DOCKER (
  where docker >nul 2>&1
  if !errorlevel! equ 0 (
    echo [docker] docker compose up -d --build
    pushd "%ROOT%"
    docker compose up -d --build
    popd
    echo  Up! Health: http://localhost:4433/health
    goto :eof
  ) else (
    echo docker not found, falling back to node
  )
)

echo.
echo [1/5] Checking Node.js + npm ...
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  Node.js not found. Install from https://nodejs.org ^(v18+^)
  echo  After installing, re-run: setup.bat
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_V=%%v
for /f "tokens=*" %%v in ('npm -v') do set NPM_V=%%v
echo  Found Node %NODE_V% + npm %NPM_V%

if defined NO_BUILD goto :skip_build
echo.
echo [2/5] Installing server dependencies ...
pushd "%SERVER%"
call npm install
if %errorlevel% neq 0 echo  npm install failed & popd & exit /b 1
echo.
echo [3/5] Building server ^(TypeScript -^> dist^) ...
call npm run build
if %errorlevel% neq 0 (
  echo  npm run build failed, trying npx tsc ...
  call npx tsc --outDir dist
)
popd
goto :after_build
:skip_build
echo [skip] --no-build, using existing server\dist
:after_build

REM 4. PSK
if not "%CUSTOM_PSK%"=="" (
  set PSK=%CUSTOM_PSK%
  echo.
  echo [4/5] Using provided PSK: %PSK%
) else (
  for /f "delims=" %%p in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"') do set PSK=%%p
  if "!PSK!"=="" set PSK=%DEMO_PSK_DEFAULT%
  echo.
  echo [4/5] Generated fresh PSK: !PSK!
  echo  ^(demo PSK also works: %DEMO_PSK_DEFAULT%^)
)
REM save to .psk (gitignored)
echo !PSK! > "%ROOT%.psk" 2>nul

REM local IP (best effort)
set LOCAL_IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=*" %%b in ("%%a") do set LOCAL_IP=%%b & goto :gotip
)
:gotip
REM trim leading space
for /f "tokens=*" %%i in ("%LOCAL_IP%") do set LOCAL_IP=%%i

set WS_URL=wss://%LOCAL_IP%:%PORT%/ops?psk=!PSK!^&user=demo
set URI=openpath://%LOCAL_IP%:%PORT%/ops?psk=!PSK!^&user=demo#demo

echo.
echo ==============================================================
echo   OpenPath VPN Server is ready!  ^(no secrets needed^)
echo ==============================================================
echo   Health:  http://localhost:%PORT%/health
echo   Decoy:   http://localhost:%PORT%/  ^(portfolio^)
echo   Stats:   http://localhost:%PORT%/api/stats
echo   Provision: POST http://localhost:%PORT%/api/provision {"user":"demo"}
echo.
echo   PSK ^(share with clients^): !PSK!
echo   WSS URL: !WS_URL!
echo   URI:     !URI!
echo.
echo   Clients:
echo     openpath connect --server wss://localhost:%PORT%/ops --psk !PSK!
echo     or use URI above in any OpenPath client
echo.
echo   LAN ^(phones^): http://%LOCAL_IP%:%PORT%/  wss://%LOCAL_IP%:%PORT%/ops
echo   Docker alt: docker compose up -d
echo   DuckDNS:  see docs\DUCKDNS.md
echo ==============================================================
echo.

if not exist "%SERVER%\dist\index.js" (
  echo  server\dist\index.js missing -- build may have failed
)

echo [5/5] Starting server on %HOST%:%PORT%  ^(Ctrl+C to stop^)
echo.
echo   Demo users: demo / student  ^(PSK above^)
echo   Health: curl http://localhost:%PORT%/health
echo.

if defined OPEN_BROWSER start http://localhost:%PORT%/ 2>nul

REM start server (blocking)
set PORT=%PORT%
set HOST=%HOST%
set DEMO_PSK=!PSK!
set OPS_PATH=/ops
set DECOY_TITLE=Alex Rivera -- Photography Portfolio
pushd "%SERVER%"
node dist\index.js
popd
goto :eof

:help
echo Usage: setup.bat [--port=4433] [--psk=XXX] [--docker] [--no-build] [--open]
exit /b 0
