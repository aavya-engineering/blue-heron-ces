<#
.SYNOPSIS
  Start the CES Demo Commander against the modules on this machine (the built clone C:\ces-nb\ces, or
  $env:WALKTHROUGH_ROOT\ces when that variable is set).

.DESCRIPTION
  For each kit port (simulator 4390, Evidence Collector 4001, EvidenceOps 4002, muster-api 4011, Stamper 3000,
  AdminOps 3001, Muster screens 4173): a free port gets that module started from the built clone; a port already held
  by something this launcher did not start is reported "attached" and left alone. Then the Demo Commander page on 4600
  (refused when 4600 is held) and the default browser at http://127.0.0.1:4600/.
  Everything runs in the background; this window may close. Stop it all with Stop-Mine.ps1.

.PARAMETER Keep
  Keep the data of the last run (runs\mine) and do not reseed the simulator. Default: fresh.

.PARAMETER NoOpen
  Do not open the browser.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\walkthrough\Start-Mine.ps1
#>
param([switch]$Keep, [switch]$NoOpen)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  Write-Host 'Node.js (node.exe) is not on PATH. Install it or open a shell where node works, then run this again.'
  exit 2
}
$nodeArgs = @((Join-Path $here 'scripts\mine.mjs'), 'start')
if ($Keep) { $nodeArgs += '--keep' } else { $nodeArgs += '--fresh' }
if ($NoOpen) { $nodeArgs += '--no-open' }
Push-Location $here
try {
  & $node.Source @nodeArgs
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $code
