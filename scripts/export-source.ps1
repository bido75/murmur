# Export a clean source archive for handoff.
#
# The recent handoff ZIP included .env files and the .git directory, which exposed
# credentials and full history. This script is the only sanctioned way to produce a
# source archive: git archive walks the committed tree only, so untracked secrets
# (.env, .env.local, .env.functions), node_modules, build outputs and .git can never
# get in. Tracked files are still the author's responsibility - run the secret scan
# (node scripts/secret-scan.mjs) before exporting.
#
# Usage: powershell -File scripts\export-source.ps1 [-Out murmur-src.zip] [-Ref HEAD]
param(
    [string]$Out = "murmur-src.zip",
    [string]$Ref = "HEAD"
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
if (Test-Path -LiteralPath $Out) { throw "Output file already exists: $Out - pick a new name instead of overwriting." }
& node scripts/secret-scan.mjs
if ($LASTEXITCODE -ne 0) { throw "Secret scan failed. Fix the findings before exporting." }
& git archive --format=zip --output="$Out" $Ref
if ($LASTEXITCODE -ne 0) { throw "git archive failed." }
Write-Host "Exported committed sources only (no .git, no .env*, no node_modules) to $Out"
