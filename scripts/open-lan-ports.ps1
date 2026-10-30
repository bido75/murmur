# Opens the server proxy port so another computer on the network can reach it.
#
# The phone reaches the local server through `lan-server-proxy.cjs`, which listens
# on this computer's network address on port 54325 and forwards to the Supabase API
# on the loopback. Docker Desktop publishes the Supabase stack on 127.0.0.1 only,
# so the direct ports (54321 and the rest) are no use to another computer: only the
# proxy is, and only its port needs to be opened.
#
# Windows Firewall already has a rule for Node, so the dev server itself is
# reachable. This only opens the proxy.
#
#   powershell -ExecutionPolicy Bypass -File scripts\open-lan-ports.ps1
#
# It asks for administrator rights itself, so a double-click is enough.

$ErrorActionPreference = "Stop"
$port = 54325
$name = "Murmur local Supabase"

# Ask for administrator rights if we do not have them.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Asking for administrator rights..." -ForegroundColor Yellow
  try {
    Start-Process -FilePath "powershell.exe" `
      -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`"" `
      -Verb RunAs
  } catch {
    Write-Host "Could not ask for administrator rights." -ForegroundColor Red
    Write-Host "Right-click this file and choose 'Run with PowerShell' as administrator." -ForegroundColor Yellow
  }
  exit
}

$description = "Lets another computer on the local network reach the local server through the proxy (54325), which forwards to the Supabase API."

$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
  # The rule is there, but it may have been made for the old, wrong ports. Point it
  # at the proxy port instead of saying "already there" and leaving it wrong.
  $existing | Set-NetFirewallRule -Action Allow -Direction Inbound -Profile Any
  $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -LocalPort $port -Protocol TCP
  Write-Host "Updated the rule to open port $port." -ForegroundColor Green
} else {
  New-NetFirewallRule `
    -DisplayName $name `
    -Description $description `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $port `
    -Profile Any | Out-Null
  Write-Host "The port is open: $port" -ForegroundColor Green
}

Write-Host ""
Write-Host "The other computer can now use:" -ForegroundColor Cyan
Write-Host "  the app      http://<this-computer-ip>:8090"
Write-Host "  the server   http://<this-computer-ip>:54325"
Write-Host ""
Write-Host "To close the port again, run this in an elevated PowerShell:"
Write-Host "  Remove-NetFirewallRule -DisplayName `"$name`""
Read-Host "Press Enter to close"
