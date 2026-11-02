# CES handoff proof round (Blue Heron Defense, CES team). Windows PowerShell 5.1. Simulator only. Written by H1, 2026-11-01.
#   powershell -ExecutionPolicy Bypass -File handoff\verify\round.ps1 -Root <Root> [-Scenarios s1-mach,s2-eng] [-UiHeadless]
# The acceptance test for the handoff: the four synthetic customer scenarios end to end against the simulator, in the
# same order and with the same harness as BHD's proof rounds (FINISH-PLAN.md section 4, "Every round"):
#   S1 s1-mach, S2 s2-eng, S3 s3-def (MX_STACKS=m365_e5_gcc,microsoft_intune), mp muster-partial.
# It calls verify\acceptance.ps1 once per scenario: the first call runs the unit gate, later calls reuse it
# (-SkipUnitGate). Each scenario's rows come from verify\expected-results.md. mx-e2e.ps1 rewrites <Root>\out on every
# run, so after each scenario this script copies its outputs to <Root>\out\round\<slug>\.
# Output: <Root>\out\round\round.json (each scenario's exit code and the SHA-256 of its acceptance.json).
# Exit 0 = every scenario passed. A scenario takes about 30 minutes; the UI steps open a visible browser unless -UiHeadless.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string[]]$Scenarios = @('s1-mach', 's2-eng', 's3-def', 'muster-partial'),
  [switch]$UiHeadless
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$OUT = Join-Path $Root 'out'
$RD = Join-Path $OUT 'round'
New-Item -ItemType Directory -Force $RD | Out-Null
$Acc = Join-Path $PSScriptRoot 'acceptance.ps1'
function Hash([string]$p) { if (Test-Path $p) { (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower() } else { $null } }

$rows = @()
$first = $true
foreach ($s in $Scenarios) {
  Write-Host "==> round: scenario $s"
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Acc, '-Root', $Root, '-Scenario', $s, '-Harness', 'tester')
  if (-not $first) { $a += '-SkipUnitGate' }
  if ($UiHeadless) { $a += '-UiHeadless' }
  $t0 = Get-Date
  & powershell.exe @a
  $rc = $LASTEXITCODE
  $dest = Join-Path $RD $s
  New-Item -ItemType Directory -Force $dest | Out-Null
  foreach ($f in @('acceptance.json', 'verify.json', 'summary.json', 'steps.json', 'unit-gate.json')) {
    $src = Join-Path $OUT $f
    if (Test-Path $src) { Copy-Item -Force $src (Join-Path $dest $f) }
  }
  $rows += [ordered]@{ scenario = $s; rc = $rc; pass = ($rc -eq 0); minutes = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
    acceptance_sha256 = (Hash (Join-Path $dest 'acceptance.json')) }
  Write-Host ("     {0} exit {1}" -f $s, $rc)
  $first = $false
}
$pass = (@($rows | Where-Object { -not $_.pass }).Count -eq 0)
$doc = [ordered]@{ schema = 'handoff/round@1'; taken = (Get-Date).ToUniversalTime().ToString('o'); root = $Root; pass = $pass; scenarios = $rows }
$doc | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $RD 'round.json')
foreach ($r in $rows) { Write-Host ("{0} {1,-16} exit {2}" -f $(if ($r.pass) { 'OK  ' } else { 'FAIL' }), $r.scenario, $r.rc) }
if ($pass) { Write-Host "==> ROUND PASS. Cite in ACCEPTANCE.md: out\round\round.json sha256 $(Hash (Join-Path $RD 'round.json'))"; exit 0 }
Write-Host "==> ROUND FAIL: see $RD\<scenario>\acceptance.json and KNOWN-ISSUES.md"
exit 1
