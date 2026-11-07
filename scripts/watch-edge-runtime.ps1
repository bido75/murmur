# Watchdog: keeps the local Edge Functions runtime serving.
#
# The `supabase functions serve` runtime can crash (OOM, resource contention, a
# stale deno.lock reload, etc.), which turns every /functions/v1/* call into a
# 502/503 and silently blocks transcription + note generation. This script probes
# a cheap health endpoint once and restarts the runtime if it stops answering.
#
# Run it on demand, or register it as a repeating scheduled task:
#   schtasks /Create /TN MurmurEdgeWatchdog /TR "powershell -ExecutionPolicy Bypass -File <repo>\scripts\watch-edge-runtime.ps1" /SC MINUTE /MO 2
#
$ErrorActionPreference = 'Continue'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

$healthUrl = 'http://127.0.0.1:54321/functions/v1/calendar/providers'
$log = Join-Path $project 'logs\edge-watchdog.log'
New-Item -ItemType Directory -Force (Join-Path $project 'logs') | Out-Null

function Log($msg) {
    Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
}

function IsServing {
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 12 -UseBasicParsing
        # 2xx/4xx means the runtime answered (route live); 5xx means it is down.
        return ($r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

# If it is already serving, do nothing (idempotent, safe to run frequently).
if (IsServing) { exit 0 }

Log 'Edge Functions runtime not serving; restarting...'

Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'functions serve' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2
docker rm -f supabase_edge_runtime_murmur 2>&1 | Out-Null

Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npx supabase functions serve --env-file supabase\functions\.env' `
    -RedirectStandardOutput (Join-Path $project 'logs\functions.log') `
    -RedirectStandardError (Join-Path $project 'logs\functions-err.log') `
    -WorkingDirectory $project

Log 'Restart initiated.'
