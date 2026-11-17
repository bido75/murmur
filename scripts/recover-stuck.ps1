# Recovers recordings that are stranded in a "transcribing"/"summarizing" state
# (a backend outage or edge-runtime crash can kill a pipeline run and leave the
# row stuck, because process-recording won't re-run a row already marked
# "transcribing").
#
# Posts to the scheduler function's recover-stuck job. In production this is done
# by pg_cron; this script is the local Windows equivalent and is registered as the
# "MurmurRecoverStuck" scheduled task (every 5 minutes).
$ErrorActionPreference = 'SilentlyContinue'
$project = Split-Path -Parent $PSScriptRoot

# The cron secret the scheduler expects; read from the functions env so it tracks
# the configured value instead of being hard-coded twice.
$secret = 'local-development-secret'
$envLine = Select-String -Path (Join-Path $project 'supabase\functions\.env') -Pattern '^CRON_SECRET=' |
    Select-Object -First 1
if ($envLine) { $secret = ($envLine.Line -split '=', 2)[1].Trim('"', ' ') }

try {
    Invoke-WebRequest 'http://127.0.0.1:54321/functions/v1/scheduler?job=recover-stuck' `
        -Method POST `
        -Headers @{ 'x-cron-secret' = $secret } `
        -TimeoutSec 25 -UseBasicParsing | Out-Null
} catch {
    # The runtime is down or not ready; the edge watchdog will bring it back and
    # this job will fall through on the next run.
}