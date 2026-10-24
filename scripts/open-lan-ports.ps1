# Opens the local Supabase ports so another computer on the network can reach them.
#
# Windows Firewall has a rule for Node (so the dev server works) but none for Docker,
# and the local Supabase stack runs in Docker. Without this rule the app on another
# computer times out when it tries to reach the server.
#
# Right-click this file and choose "Run with PowerShell", or run it from an
# elevated PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\open-lan-ports.ps1
#
# It asks for administrator rights itself, so a double-click is enough.

$ErrorActionPreference = "Stop"
$ports = 54321, 54322, 54323, 54324

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

$name = "Murmur local Supabase"
$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "The rule is already there." -ForegroundColor Green
  Get-NetFirewallRule -DisplayName $name |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-Table -AutoSize
  Write-Host ""
  Write-Host "To close the ports again, run this in an elevated PowerShell:"
  Write-Host "  Remove-NetFirewallRule -DisplayName `"$name`""
  Read-Host "Press Enter to close"
  exit
}

New-NetFirewallRule `
  -DisplayName $name `
  -Description "Lets another computer on the local network reach the local Supabase stack: the API (54321), the database (54322), Studio (54323) and the mail catcher (54324)." `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $ports `
  -Profile Any | Out-Null

Write-Host "The ports are open: $($ports -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "The other computer can now use:" -ForegroundColor Cyan
Write-Host "  the app      http://<this-computer-ip>:8090"
Write-Host "  the server   http://<this-computer-ip>:54321"
Write-Host "  Studio       http://<this-computer-ip>:54323"
Write-Host ""
Write-Host "To close the ports again, run this in an elevated PowerShell:"
Write-Host "  Remove-NetFirewallRule -DisplayName `"$name`""
Read-Host "Press Enter to close"
