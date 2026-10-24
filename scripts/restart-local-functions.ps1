# Restart the local Edge Functions with the current .env.local.
#
# The Supabase CLI only reads the env file when it creates the Edge Runtime container,
# so changing .env.local needs the container to be rebuilt, not just restarted.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\restart-local-functions.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

# Stop the running serve, but never this script's own shell: the search text appears
# in our own command line.
$me = $PID
Get-CimInstance Win32_Process |
    Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -match 'supabase functions serve' } |
    ForEach-Object {
        Write-Host "  stopping pid $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 5

# Rebuild the container so it picks up the new env.
docker rm -f supabase_edge_runtime_murmur 2>&1 | Out-Null
Start-Sleep -Seconds 3

Remove-Item 'functions.log', 'functions-err.log' -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npx supabase functions serve --env-file .env.local' `
    -RedirectStandardOutput 'functions.log' `
    -RedirectStandardError 'functions-err.log' `
    -WorkingDirectory $project

Write-Host '  waiting for the Edge Runtime to come up...'
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 5
    try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:54321/functions/v1/bot/available' -TimeoutSec 20 -UseBasicParsing | Out-Null
        break
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 401) { break }
    }
}

Write-Host ''
Write-Host 'The Edge Runtime has these settings:'
docker exec supabase_edge_runtime_murmur env 2>&1 |
    Select-String -Pattern '^(LLM_PROVIDER|OPENROUTER_MODEL|OLLAMA_BASE_URL|OLLAMA_MODEL|ANTHROPIC_API_KEY|DEEPGRAM_API_KEY|OPENROUTER_API_KEY)=' |
    ForEach-Object { $name = ($_.Line -split '=', 2)[0]; Write-Host "  $name" }
