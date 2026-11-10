# MX evidence capture (Blue Heron Defense, CES team). Windows PowerShell 5.1.
#   powershell -ExecutionPolicy Bypass -File capture-evidence.ps1 -Root <WS> [-Dest <folder>] [-Scenario muster-partial]
# Retired in Phase 3 (P3.3) in favour of bundle.mjs, which this script now calls. The old version hashed the
# outputs BEFORE rewriting paths and copied ssp.docx unscrubbed; bundle.mjs copies all twelve evidence items,
# rewrites local paths (also inside DOCX parts), hashes AFTER rewriting and runs identity-scan.ps1.
# Output: <WS>\out\runs\<run-id>\evidence\{raw,shared}. -Dest also copies the shared bundle there.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Dest = '',
  [string]$Scenario = 'muster-partial'
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
& node (Join-Path $PSScriptRoot 'bundle.mjs') --root $Root --scenario $Scenario
$rc = $LASTEXITCODE
if ($Dest) {
  $runs = Join-Path $Root 'out\runs'
  $latest = Get-Content (Join-Path $runs 'latest.json') -Raw | ConvertFrom-Json
  $shared = Join-Path (Join-Path $runs $latest.evidence) 'shared'
  New-Item -ItemType Directory -Force $Dest | Out-Null
  Copy-Item (Join-Path $shared '*') $Dest -Recurse -Force
  Write-Host "shared bundle $($latest.runId) copied to $Dest"
}
exit $rc
