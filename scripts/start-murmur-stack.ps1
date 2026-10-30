# Starts the whole Murmur serving stack after a PC reboot, idempotently:
#   1. waits for the Docker engine (Docker Desktop may still be starting)
#   2. brings up the Supabase stack if it is not running
#   3. recreates the Edge Functions runtime when it is missing
#   4. starts the static web server on 8090 when it is missing
#   5. health-checks everything and writes one log line per step
#
# Registered as a Windows scheduled task ("MurmurStack") that runs at startup.
# Safe to run any time: every step checks first and does nothing if already up.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-murmur-stack.ps1

$ErrorActionPreference = 'Continue'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
$log = Join-Path $project 'logs\stack-startup.log'
New-Item -ItemType Directory -Force (Join-Path $project 'logs') | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $log -Value $line
}

Log '=== Murmur stack startup ==='

# --- 1. Wait for the Docker engine (up to 15 minutes after boot) ---
$waited = 0
while ($waited -lt 900) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 15
    $waited += 15
    if ($waited % 60 -eq 0) { Log "still waiting for the Docker engine (${waited}s)..." }
}
if ($LASTEXITCODE -ne 0) { Log 'FATAL: Docker engine never became reachable'; exit 1 }
Log 'Docker engine is up.'

# --- 2. Supabase stack (kong, auth, rest, storage, db) ---
$started = $false
for ($i = 0; $i -lt 3 -and -not $started; $i++) {
    $kong = docker ps --format '{{.Names}}' | Select-String -SimpleMatch 'supabase_kong_murmur'
    if ($kong) { $started = $true; break }
    Log 'Supabase stack is down; starting it (restores from the local backup)...'
    supabase start *> $null
    Start-Sleep -Seconds 10
    $kong = docker ps --format '{{.Names}}' | Select-String -SimpleMatch 'supabase_kong_murmur'
    if ($kong) { $started = $true } else { Start-Sleep -Seconds 20 }
}
if ($started) { Log 'Supabase stack is up.' } else { Log 'WARN: Supabase stack did not come up; will retry next run.' }

# --- 3. Edge Functions runtime (recreated when missing) ---
$edge = docker ps --format '{{.Names}}' | Select-String -SimpleMatch 'supabase_edge_runtime_murmur'
if (-not $edge) {
    Log 'Edge Functions runtime is missing; recreating it...'
    # Any stale container from before the reboot is removed first, then the
    # runtime is served again with the functions env (the same env the CLI reads).
    docker rm -f supabase_edge_runtime_murmur 2>&1 | Out-Null
    $serve = 'npx supabase functions serve --env-file supabase\functions\.env'
    Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
        -ArgumentList '/c', $serve `
        -RedirectStandardOutput (Join-Path $project 'logs\functions.log') `
        -RedirectStandardError (Join-Path $project 'logs\functions-err.log') `
        -WorkingDirectory $project
    # The runtime container appears a few seconds after the serve process starts.
    Start-Sleep -Seconds 20
    $edge = docker ps --format '{{.Names}}' | Select-String -SimpleMatch 'supabase_edge_runtime_murmur'
}
if ($edge) { Log 'Edge Functions runtime is up.' } else { Log 'WARN: Edge Functions runtime did not start; check logs\functions-err.log.' }

# --- 4. Static web server on 8090 ---
# A half-dead process can hold the port without serving, and a healthy one
# already listening means nothing to do — probe health, not just the port.
$healthy = $false
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/' -TimeoutSec 8 -UseBasicParsing
    $healthy = ($r.StatusCode -eq 200)
} catch { $healthy = $false }
if (-not $healthy) {
    Log 'Static web server (8090) is down or unhealthy; starting it...'
    # A zombie bound to the port without serving must be cleared first.
    $holder = Get-NetTCPConnection -LocalPort 8090 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($holder) {
        Log "clearing the process holding port 8090 (pid $($holder.OwningProcess))..."
        Stop-Process -Id $holder.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    Start-Process -WindowStyle Hidden -FilePath 'node' `
        -ArgumentList 'scripts\serve-web-dist.cjs', 'dist-web', '8090' `
        -WorkingDirectory $project `
        -RedirectStandardOutput (Join-Path $project 'logs\web-server.log') `
        -RedirectStandardError (Join-Path $project 'logs\web-server-err.log')
    Start-Sleep -Seconds 3
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/' -TimeoutSec 8 -UseBasicParsing
        $healthy = ($r.StatusCode -eq 200)
    } catch { $healthy = $false }
}
if ($healthy) { Log 'Static web server is up on 8090.' } else { Log 'WARN: web server did not start; check logs\web-server-err.log.' }

# --- 5. Health checks (local, so the tunnel has something healthy to route to) ---
$health = @()
try {
    $r1 = Invoke-WebRequest -Uri 'http://127.0.0.1:54321/auth/v1/health' -TimeoutSec 15 -UseBasicParsing
    $health += "auth $($r1.StatusCode)"
} catch { $health += 'auth DOWN' }
try {
    $r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/' -TimeoutSec 15 -UseBasicParsing
    $health += "app $($r2.StatusCode)"
} catch { $health += 'app DOWN' }
try {
    $r3 = Invoke-WebRequest -Uri 'http://127.0.0.1:54321/functions/v1/calendar/providers' -TimeoutSec 15 -UseBasicParsing
    $health += "functions $($r3.StatusCode)"
} catch { $health += 'functions DOWN' }

Log "health: $($health -join ' | ')"
Log '=== startup complete ==='
