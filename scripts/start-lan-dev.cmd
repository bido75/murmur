@echo off
REM Starts the app on the local network, with the local server reachable from
REM another computer.
REM
REM Two things are needed:
REM   1. The app, served so a phone can reach it:  npm run lan
REM   2. The local server, reachable from that phone.
REM
REM Docker Desktop publishes the local Supabase stack on 127.0.0.1 only on some
REM machines, even though `docker port` says 0.0.0.0, so another computer times
REM out when it reaches for the server. This starts a small proxy on the
REM computer's network address that forwards to it.
REM
REM Run this from an elevated PowerShell if the ports are not open yet:
REM   scripts\open-lan-ports.cmd

setlocal
set ADDRESS=%1
if "%ADDRESS%"=="" set ADDRESS=10.0.0.180
set APP_PORT=8090
set SERVER_PORT=54325
set LOCAL_SERVER_PORT=54321

echo Starting the server proxy on %ADDRESS%:%SERVER_PORT% ...
start "Murmur server proxy" /min node "%~dp0lan-server-proxy.cjs" %ADDRESS% %SERVER_PORT% %LOCAL_SERVER_PORT%

timeout /t 2 /nobreak >nul
echo Starting the app on %ADDRESS%:%APP_PORT% ...
call npx expo start --host lan --port %APP_PORT%
