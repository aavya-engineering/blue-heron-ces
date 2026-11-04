<#
.SYNOPSIS
  Stop what Start-Mine.ps1 started: the Demo Commander page and only the modules it launched.

.DESCRIPTION
  An "attached" module (one that was already running when Start-Mine.ps1 ran) is never stopped. The browser windows
  the Demo Commander opened are closed. At the end it prints each port: free, ours or someone else's.

.PARAMETER Status
  Only show each port's state; stop nothing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\walkthrough\Stop-Mine.ps1
#>
param([switch]$Status)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  Write-Host 'Node.js (node.exe) is not on PATH. Install it or open a shell where node works, then run this again.'
  exit 2
}
$verb = 'stop'
if ($Status) { $verb = 'status' }
Push-Location $here
try {
  & $node.Source (Join-Path $here 'scripts\mine.mjs') $verb
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $code
