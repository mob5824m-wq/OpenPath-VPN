@echo off
REM OpenPath VPN — MAIN HOST setup (Windows)
REM   git clone https://github.com/mob5824m-wq/OpenPath-VPN
REM   cd OpenPath-VPN
REM   setup-main.bat
REM Main = directory: app GET /api/hosts gets list of sub-hosts.
setlocal enabledelayedexpansion
set ROOT=%~dp0
set SERVER=%ROOT%server
set PORT=4433
set HOST=0.0.0.0
set DEMO_PSK_DEFAULT=demo-student-key-do-not-use-prod
set CUSTOM_PORT=&set CUSTOM_PSK=&set CUSTOM_NAME=&set CUSTOM_REGION=&set NO_BUILD=&set OPEN_BROWSER=
for %%a in (%*) do (
  echo %%a|findstr /b "--port=">nul && set CUSTOM_PORT=%%a&set CUSTOM_PORT=!CUSTOM_PORT:--port=!
  echo %%a|findstr /b "--psk=">nul && set CUSTOM_PSK=%%a&set CUSTOM_PSK=!CUSTOM_PSK:--psk=!
  echo %%a|findstr /b "--name=">nul && set CUSTOM_NAME=%%a&set CUSTOM_NAME=!CUSTOM_NAME:--name=!
  if "%%a"=="--no-build" set NO_BUILD=1
  if "%%a"=="--open" set OPEN_BROWSER=1
  if "%%a"=="--help" goto :help
)
if not "%CUSTOM_PORT%"=="" set PORT=%CUSTOM_PORT%
echo.
echo                     [MAIN HOST — directory for sub-hosts]
echo  Root: %ROOT%
echo [1/5] Checking Node.js ...
where node>nul 2>&1 || (echo Node.js not found https://nodejs.org&exit /b 1)
for /f "tokens=*" %%v in ('node -v') do set NODE_V=%%v
echo  Node %NODE_V%
if defined NO_BUILD goto :skip_build
echo [2/5] Installing deps ...
pushd "%SERVER%"&call npm install&popd
echo [3/5] Building ...
pushd "%SERVER%"&call npm run build
if %errorlevel% neq 0 call npx tsc --outDir dist
popd
:skip_build
if not "%CUSTOM_PSK%"=="" (set PSK=%CUSTOM_PSK%&echo [4/5] PSK: !PSK!) else (
  for /f "delims=" %%p in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"') do set PSK=%%p
  echo [4/5] Generated PSK: !PSK!
)
echo !PSK!>"%ROOT%.psk" 2>nul
set LOCAL_IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (for /f "tokens=*" %%b in ("%%a") do set LOCAL_IP=%%b&goto :gotip)
:gotip
for /f "tokens=*" %%i in ("%LOCAL_IP%") do set LOCAL_IP=%%i
echo ==============================================================
echo   MAIN HOST ready
echo ==============================================================
echo   Health: http://localhost:%PORT%/health
echo   Hosts:  http://localhost:%PORT%/api/hosts  ^<- app
echo   LAN:    http://%LOCAL_IP%:%PORT%/api/hosts
echo   PSK: !PSK!
echo   Subs: setup-sub.bat --main http://%LOCAL_IP%:%PORT%
echo ==============================================================
if defined OPEN_BROWSER start http://localhost:%PORT%/api/hosts 2>nul
set PORT=%PORT%&set HOST=%HOST%&set DEMO_PSK=!PSK!&set ROLE=main
if not "%CUSTOM_NAME%"=="" (set HOST_NAME=%CUSTOM_NAME%) else (set HOST_NAME=OpenPath Main)
set HOST_ID=main-%HOST%-%PORT%
if not "%CUSTOM_REGION%"=="" (set HOST_REGION=%CUSTOM_REGION%) else (set HOST_REGION=us-east)
set OPS_PATH=/ops
echo [5/5] Starting MAIN on %HOST%:%PORT% ^(Ctrl+C to stop^)
pushd "%SERVER%"&node dist\index.js&popd
goto :eof
:help
echo Usage: setup-main.bat [--port=4433] [--psk=XXX] [--name=MyMain] [--region=us-east]
exit /b 0
