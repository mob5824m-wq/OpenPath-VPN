@echo off
REM OpenPath VPN — SUB HOST setup (Windows)
REM   setup-sub.bat --main http://MAIN_IP:4433 [--port 4434] [--psk SAME_AS_MAIN]
REM Sub registers with main, appears in GET /api/hosts
setlocal enabledelayedexpansion
set ROOT=%~dp0
set SERVER=%ROOT%server
set PORT=4434
set HOST=0.0.0.0
set DEMO_PSK_DEFAULT=demo-student-key-do-not-use-prod
set MAIN_URL=&set CUSTOM_PORT=&set CUSTOM_PSK=&set CUSTOM_NAME=&set CUSTOM_REGION=&set PUBLIC_HOST=&set DUCKDNS_DOMAIN=&set DUCKDNS_TOKEN=&set NO_BUILD=&set OPEN_BROWSER=
for %%a in (%*) do (
  echo %%a|findstr /b "--main=">nul && set MAIN_URL=%%a&set MAIN_URL=!MAIN_URL:--main=!
  echo %%a|findstr /b "--port=">nul && set CUSTOM_PORT=%%a&set CUSTOM_PORT=!CUSTOM_PORT:--port=!
  echo %%a|findstr /b "--psk=">nul && set CUSTOM_PSK=%%a&set CUSTOM_PSK=!CUSTOM_PSK:--psk=!
  echo %%a|findstr /b "--name=">nul && set CUSTOM_NAME=%%a&set CUSTOM_NAME=!CUSTOM_NAME:--name=!
  echo %%a|findstr /b "--duckdns-domain=">nul && set DUCKDNS_DOMAIN=%%a&set DUCKDNS_DOMAIN=!DUCKDNS_DOMAIN:--duckdns-domain=!
  echo %%a|findstr /b "--duckdns-token=">nul && set DUCKDNS_TOKEN=%%a&set DUCKDNS_TOKEN=!DUCKDNS_TOKEN:--duckdns-token=!
  if "%%a"=="--no-build" set NO_BUILD=1
  if "%%a"=="--open" set OPEN_BROWSER=1
  if "%%a"=="--help" goto :help
)
if "%MAIN_URL%"=="" (echo ERROR: --main required e.g. --main http://192.168.1.10:4433&exit /b 1)
if not "%CUSTOM_PORT%"=="" set PORT=%CUSTOM_PORT%
echo                     [SUB HOST — registers with MAIN]
if not "%DUCKDNS_DOMAIN%"=="" echo  DuckDNS: %DUCKDNS_DOMAIN%.duckdns.org
echo  Main: %MAIN_URL%
echo [1/5] Checking Node.js ...
where node>nul 2>&1 || (echo Node not found &exit /b 1)
for /f "tokens=*" %%v in ('node -v') do set NODE_V=%%v
echo  Node %NODE_V%
if defined NO_BUILD goto :skip_build
echo [2/5] Installing ...
pushd "%SERVER%"&call npm install&popd
echo [3/5] Building ...
pushd "%SERVER%"&call npm run build
if %errorlevel% neq 0 call npx tsc --outDir dist
popd
:skip_build
if not "%CUSTOM_PSK%"=="" (set PSK=%CUSTOM_PSK%&echo [4/5] PSK: !PSK!) else (
  if exist "%ROOT%.psk" (for /f "delims=" %%p in (%ROOT%.psk) do set PSK=%%p&echo [4/5] Reused PSK from .psk: !PSK!) else (
    set PSK=%DEMO_PSK_DEFAULT%&echo [4/5] Demo PSK: !PSK!
  )
)
set LOCAL_IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (for /f "tokens=*" %%b in ("%%a") do set LOCAL_IP=%%b&goto :gotip)
:gotip
for /f "tokens=*" %%i in ("%LOCAL_IP%") do set LOCAL_IP=%%i
if not "%DUCKDNS_DOMAIN%"=="" (
  set PUBLIC_HOST=%DUCKDNS_DOMAIN%.duckdns.org
  set WSS_URL=wss://%PUBLIC_HOST%/ops
  echo ==============================================================
  echo   SUB HOST (DuckDNS) will register with MAIN
  echo ==============================================================
  echo   Main: %MAIN_URL%
  echo   Sub DuckDNS: https://%PUBLIC_HOST% -^> %WSS_URL%
  echo   App: GET %MAIN_URL%/api/hosts -^> wss://%PUBLIC_HOST%/ops
  echo ==============================================================
  if defined OPEN_BROWSER start http://localhost:%PORT%/health 2>nul
  set PORT=%PORT%&set HOST=%HOST%&set DEMO_PSK=!PSK!&set ROLE=sub&set MAIN_URL=%MAIN_URL%&set DUCKDNS_DOMAIN=%DUCKDNS_DOMAIN%&set SUB_DUCKDNS_DOMAIN=%DUCKDNS_DOMAIN%&set DUCKDNS_TOKEN=%DUCKDNS_TOKEN%
  if not "%CUSTOM_NAME%"=="" (set HOST_NAME=%CUSTOM_NAME%) else (set HOST_NAME=Sub %PUBLIC_HOST%)
  set HOST_ID=sub-%PUBLIC_HOST%-%PORT%&set PUBLIC_HOST=%PUBLIC_HOST%&set PUBLIC_WSS=%WSS_URL%
  if not "%CUSTOM_REGION%"=="" (set HOST_REGION=%CUSTOM_REGION%) else (set HOST_REGION=home)
  set OPS_PATH=/ops
) else (
  if "%PUBLIC_HOST%"=="" set PUBLIC_HOST=%LOCAL_IP%
  set WSS_URL=wss://%PUBLIC_HOST%:%PORT%/ops
  echo ==============================================================
  echo   SUB HOST will register with MAIN
  echo ==============================================================
  echo   Main: %MAIN_URL%
  echo   Sub URL: %WSS_URL%
  echo   Health: http://%PUBLIC_HOST%:%PORT%/health
  echo   App: GET %MAIN_URL%/api/hosts -^> sees this sub
  echo   Tip: give this sub its own DuckDNS: --duckdns-domain openpath-sub1 --duckdns-token xxx
  echo ==============================================================
  if defined OPEN_BROWSER start http://localhost:%PORT%/health 2>nul
  set PORT=%PORT%&set HOST=%HOST%&set DEMO_PSK=!PSK!&set ROLE=sub&set MAIN_URL=%MAIN_URL%
  if not "%CUSTOM_NAME%"=="" (set HOST_NAME=%CUSTOM_NAME%) else (set HOST_NAME=Sub %PUBLIC_HOST%:%PORT%)
  set HOST_ID=sub-%PUBLIC_HOST%-%PORT%&set PUBLIC_HOST=%PUBLIC_HOST%&set PUBLIC_WSS=%WSS_URL%
  if not "%CUSTOM_REGION%"=="" (set HOST_REGION=%CUSTOM_REGION%) else (set HOST_REGION=home)
  set OPS_PATH=/ops
)
echo [5/5] Starting SUB on %HOST%:%PORT% -^> %MAIN_URL% ^(Ctrl+C^)
pushd "%SERVER%"&node dist\index.js&popd
goto :eof
:help
echo Usage: setup-sub.bat --main http://MAIN:4433 [--port=4434] [--psk=XXX]
exit /b 0
