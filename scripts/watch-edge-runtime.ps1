# Watchdog: keeps the local Edge Functions runtime serving.
#
# The `supabase functions serve` runtime can crash, which turns every
# /functions/v1/* call into a 502/503 and silently blocks transcription + note
# generation. This script probes a cheap health endpoint once and restarts the
# runtime only when it is both unresponsive AND no serve process is already up
# (a serve can take a while to load all functions without answering yet).
#
# Safe to run frequently (idempotent). Registered as "MurmurEdgeWatchdog".
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
        return ($r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function IsServeRunning {
    $c = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'functions serve' } |
        Measure-Object
    return ($c.Count -gt 0)
}

# Healthy: nothing to do.
if (IsServing) { exit 0 }

# Unresponsive but a serve is already up (still loading): do not pile another on.
if (IsServeRunning) {
    Log 'not serving yet but a serve process is present; waiting for it to load'
    exit 0
}

# Actually down: clean up and start fresh.
Log 'Edge Functions runtime not serving and no serve running; restarting...'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
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