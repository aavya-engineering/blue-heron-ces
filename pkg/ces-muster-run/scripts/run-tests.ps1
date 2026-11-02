# MX unit gate (Blue Heron Defense, CES team). Windows PowerShell 5.1 wrapper for run-tests.mjs.
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-tests.ps1 -Root <WS>
# Passes (exit 0) when every failing test is listed in ..\known-failures.json. Writes <WS>\out\unit-gate.json.
param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
& node (Join-Path $PSScriptRoot 'run-tests.mjs') --ces (Join-Path $Root 'ces') --out (Join-Path $Root 'out') --known (Join-Path $PSScriptRoot '..\known-failures.json')
exit $LASTEXITCODE
