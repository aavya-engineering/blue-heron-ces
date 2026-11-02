# MX verify (Blue Heron Defense, CES team). Windows PowerShell 5.1 wrapper for verify.mjs.
#   powershell -ExecutionPolicy Bypass -File verify.ps1 -Root <WS> [-Scenario muster-partial] [-Baseline <summary.json>]
# Checks V1-V11 over the last e2e run in <WS>\out and writes <WS>\out\verify.json and summary.json.
# The default baseline is ..\expected-outputs\<slug>\summary.json (muster-partial: ..\expected-outputs\summary.json);
# without one, V6 records the first green run.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Scenario = 'muster-partial',
  [string]$Baseline = ''
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
# Synthetic-customer W0: without -Baseline, verify.mjs resolves it per scenario (expected-outputs.mjs):
# expected-outputs\<slug>\summary.json, else (muster-partial only) expected-outputs\summary.json.
if ($Baseline) { & node (Join-Path $PSScriptRoot 'verify.mjs') --root $Root --scenario $Scenario --baseline $Baseline }
else { & node (Join-Path $PSScriptRoot 'verify.mjs') --root $Root --scenario $Scenario }
exit $LASTEXITCODE
