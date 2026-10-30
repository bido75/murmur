@echo off
REM Opens the local Supabase ports for other computers on the network.
REM It asks for administrator rights by itself.
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0open-lan-ports.ps1"
