# CES handoff acceptance run (Blue Heron Defense, CES team). Windows PowerShell 5.1. Simulator only.
#   powershell -NoProfile -ExecutionPolicy Bypass -File handoff\verify\acceptance.ps1 -Root <Root> [-Scenario s1-mach] [-Harness tester|mx] [-UiHeadless] [-SkipUnitGate]
# The full acceptance test is the 4-scenario proof round: verify\round.ps1 calls this script once per scenario
# (H1, 2026-11-01). The default harness is tester, as in BHD's proof rounds (FINISH-PLAN.md section 4).
# Run after bootstrap.ps1 and smoke.ps1. Three parts, all against the workspace at <Root>\ces:
#   1. the unit gate: scripts\run-tests.ps1 (every package's unit suite; known failures from known-failures.json);
#   2. one simulator scenario end to end: scripts\mx-e2e.ps1 -Scenario s1-mach (Muster -> Stamper -> EO; its last
#      step E9 runs scripts\verify.ps1, which writes <Root>\out\verify.json and <Root>\out\summary.json);
#   3. the comparison: every row of the table in verify\expected-results.md is checked against those outputs.
# The e2e run's last UI step opens a visible (headed) browser on the desktop by default; -UiHeadless hides it.
# Before part 1 it records what exists outside the workspace (<Root>\out\outside-before.json), so verify's V10
# ("nothing written outside the workspace") covers the unit gate too. Never kills a process; mx-e2e refuses held ports.
# Output: <Root>\out\acceptance.json (each row, the SHA-256 of each output it read). Exit 0 = every row matches.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Scenario = 's1-mach',
  [ValidateSet('mx', 'tester')][string]$Harness = 'tester',
  [switch]$UiHeadless,
  [string]$Expected = '',
  [switch]$CompareOnly,
  # H1: reuse the unit gate already run in this round (<Root>\out\unit-gate.json) instead of running it again.
  [switch]$SkipUnitGate
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside an advanced script's param defaults, so defaults that need it are set here (H1).
if (-not $Expected) { $Expected = Join-Path $PSScriptRoot 'expected-results.md' }
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\HandoffManifest.ps1')
$Kit = Split-Path -Parent $PSScriptRoot
$Pkg = Get-HandoffPackageDir $Kit   # <pkg> in the module repos; <monorepo>\pkg\ces-muster-run in the contractor monorepo
$Root = (Resolve-Path $Root).Path
$OUT = Join-Path $Root 'out'
New-Item -ItemType Directory -Force $OUT | Out-Null
$started = (Get-Date).ToUniversalTime()
function Say([string]$m) { Write-Host "==> $m" }

$gateRc = $null; $e2eRc = $null
if (-not $CompareOnly) {
  if (-not (Test-Path (Join-Path $Root 'ces\node_modules'))) { Write-Host "REFUSE $Root\ces is not built; run bootstrap.ps1 first"; exit 2 }
  # PL-125 / CR-08: "built" also means the last bootstrap finished. bootstrap.json with ok false = refuse; no
  # bootstrap.json (the tree was built by hand, GUIDE 6.2) = a warning only.
  $bootJson = Join-Path $Root 'out\bootstrap\bootstrap.json'
  if (Test-Path $bootJson) {
    $boot = $null; try { $boot = Get-Content $bootJson -Raw | ConvertFrom-Json } catch { $boot = $null }
    if (-not $boot -or $boot.ok -ne $true) { Write-Host "REFUSE $bootJson does not say ""ok"": true (the last bootstrap failed$(if ($boot -and $boot.failed_step) { " at $($boot.failed_step)" })); fix the cause and rerun bootstrap.ps1"; exit 2 }
  } else { Write-Host "WARN no $bootJson (bootstrap.ps1 has not run here): only the node_modules folder was checked" }
  # V10 baseline (same directories as mx-e2e's Snapshot-Outside), taken before the unit gate.
  $snap = [ordered]@{ taken = $started.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
  $lad = Join-Path $env:LOCALAPPDATA 'CES'
  foreach ($d in @('C:\CES_Pipeline', (Join-Path $HOME '.ces'), (Join-Path $HOME '.stamper'), $lad)) {
    $files = @(Get-ChildItem $d -Recurse -File -Force -ErrorAction SilentlyContinue)
    $max = if ($files.Count) { ($files | Measure-Object LastWriteTimeUtc -Maximum).Maximum.ToString('o') } else { $null }
    $key = if ($d -eq $lad) { '%LOCALAPPDATA%\CES' } else { $d -replace [regex]::Escape($HOME), '~' }
    $snap[$key] = [ordered]@{ count = $files.Count; max_mtime = $max }
  }
  $snap | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $OUT 'outside-before.json')

  if ($SkipUnitGate) {
    $ug = Join-Path $OUT 'unit-gate.json'
    if (-not (Test-Path $ug)) { Write-Host "REFUSE -SkipUnitGate but $ug does not exist; run the unit gate first"; exit 2 }
    $gateRc = if ((Get-Content $ug -Raw | ConvertFrom-Json).pass) { 0 } else { 1 }
    Say "part 1: unit gate reused from $ug (exit $gateRc)"
  } else {
    Say 'part 1: unit gate (scripts\run-tests.ps1)'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pkg 'scripts\run-tests.ps1') -Root $Root
    $gateRc = $LASTEXITCODE
    Write-Host "     unit gate exit $gateRc"
  }
  # S3 (s3-def) is compiled with these stacks in BHD's proof rounds (FINISH-PLAN.md section 4, "Every round").
  if ($Scenario -eq 's3-def' -and -not $env:MX_STACKS) { $env:MX_STACKS = 'm365_e5_gcc,microsoft_intune'; Write-Host '     MX_STACKS=m365_e5_gcc,microsoft_intune (s3-def)' }

  Say "part 2: simulator scenario $Scenario (scripts\mx-e2e.ps1 -Harness $Harness)"
  $e2eArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Pkg 'scripts\mx-e2e.ps1'), '-Root', $Root, '-Scenario', $Scenario, '-Harness', $Harness, '-KeepOutsideBaseline')
  if ($UiHeadless) { $e2eArgs += '-UiHeadless' }
  & powershell.exe @e2eArgs
  $e2eRc = $LASTEXITCODE
  Write-Host "     e2e exit $e2eRc"
}

Say "part 3: compare with $Expected"
function Read-Json([string]$p) { if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json } else { $null } }
function Hash([string]$p) { if (Test-Path $p) { (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower() } else { $null } }
$files = [ordered]@{ verify = (Join-Path $OUT 'verify.json'); summary = (Join-Path $OUT 'summary.json'); unit = (Join-Path $OUT 'unit-gate.json') }
$fresh = @{}
foreach ($k in $files.Keys) { $fresh[$k] = (Test-Path $files[$k]) -and ($CompareOnly -or ($SkipUnitGate -and $k -eq 'unit') -or (Get-Item $files[$k]).LastWriteTimeUtc -ge $started) }
$verify = if ($fresh.verify) { Read-Json $files.verify } else { $null }
$summary = if ($fresh.summary) { Read-Json $files.summary } else { $null }
$unit = if ($fresh.unit) { Read-Json $files.unit } else { $null }
if ($CompareOnly -and $unit) { $gateRc = if ($unit.pass) { 0 } else { 1 } }

# The rows: the Markdown table between <!-- acceptance:begin --> and <!-- acceptance:end --> in expected-results.md.
# A begin marker may name one scenario (<!-- acceptance:begin s2-eng -->); its rows then apply to that scenario only (H1).
$rows = @(); $inside = $false
foreach ($l in (Get-Content $Expected)) {
  if ($l -match '<!--\s*acceptance:begin(?:\s+([a-z0-9-]+))?\s*-->') { $inside = (-not $Matches[1]) -or ($Matches[1] -eq $Scenario); continue }
  if ($l -match '<!--\s*acceptance:end\s*-->') { $inside = $false; continue }
  if (-not $inside -or $l -notmatch '^\s*\|') { continue }
  $cells = @($l.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() -replace '^`|`$', '' })
  if ($cells[0] -eq 'key' -or $cells[0] -match '^-+$' -or $cells[0] -match '^:?-+:?$') { continue }
  $rows += [pscustomobject]@{ key = $cells[0]; expected = $cells[1]; note = $(if ($cells.Count -gt 2) { $cells[2] } else { '' }) }
}
if ($rows.Count -eq 0) { Write-Host "REFUSE no acceptance rows found in $Expected"; exit 2 }

function Get-Path($obj, [string]$path) {
  $cur = $obj
  foreach ($seg in $path.Split('.')) {
    if ($null -eq $cur) { return $null }
    if ($cur -is [array]) { if ($seg -match '^\d+$') { $cur = $cur[[int]$seg] } else { return $null } }
    else { $p = $cur.PSObject.Properties[$seg]; if ($p) { $cur = $p.Value } else { return $null } }
  }
  return $cur
}
# A verify check's state: pass, fail, or not-run (verify.mjs marks a check it could not run as pass with "not run" detail).
function Get-CheckState($c) { if ($null -eq $c) { return 'missing' }; if ($c.pass -eq $true) { if ([string]$c.detail -match '^not run') { 'not-run' } else { 'pass' } } else { 'fail' } }
function Test-Expect([string]$state, [string]$want) {
  switch ($want) {
    'any' { return $true }
    'pass' { return ($state -eq 'pass' -or $state -eq 'not-run') }
    'ran-pass' { return ($state -eq 'pass') }
    default { return ($state -eq $want) }
  }
}
function Test-Value($actual, [string]$want) {
  if ($null -eq $actual) { return $false }
  $a = [string]$actual
  if ($want -match '^(>=|<=|>|<)\s*(-?\d+(\.\d+)?)$') {
    $n = [double]$a; $w = [double]$Matches[2]
    switch ($Matches[1]) { '>=' { return $n -ge $w } '<=' { return $n -le $w } '>' { return $n -gt $w } '<' { return $n -lt $w } }
  }
  if ($want -match '^(-?\d+)\.\.(-?\d+)$') { $n = [double]$a; return ($n -ge [double]$Matches[1] -and $n -le [double]$Matches[2]) }
  return ($a -eq $want)
}

$results = @()
$listed = @{}
foreach ($r in $rows) {
  $actual = $null; $ok = $false
  if ($r.key -eq 'gate:unit') { $actual = $gateRc; $ok = ($null -ne $gateRc) -and ([string]$gateRc -eq $r.expected) }
  elseif ($r.key -eq 'gate:e2e') {
    $actual = $e2eRc
    if ($CompareOnly) { $ok = $true; $actual = 'not run (-CompareOnly)' } else { $ok = ($null -ne $e2eRc) -and ([string]$e2eRc -eq $r.expected) }
  }
  elseif ($r.key -eq 'verify:pass') { $actual = if ($verify) { [string]$verify.pass } else { 'no fresh verify.json' }; $ok = ($verify -and ([string]$verify.pass).ToLower() -eq $r.expected.ToLower()) }
  elseif ($r.key -eq 'verify:scenario') { $actual = if ($verify) { $verify.scenario } else { $null }; $ok = ($actual -eq $r.expected) }
  elseif ($r.key -match '^verify:(V[0-9A-Za-z.]+)$') {
    $id = $Matches[1]; $listed[$id] = $true
    $c = if ($verify) { @($verify.checks | Where-Object { $_.id -eq $id })[0] } else { $null }
    $actual = Get-CheckState $c; $ok = Test-Expect $actual $r.expected
  }
  elseif ($r.key -match '^summary:(.+)$') { $actual = if ($summary) { Get-Path $summary $Matches[1] } else { $null }; $ok = Test-Value $actual $r.expected }
  elseif ($r.key -eq 'verify:*') { continue }   # applied below, after the listed checks
  else { $actual = 'unknown key'; $ok = $false }
  $results += [ordered]@{ key = $r.key; expected = $r.expected; actual = $actual; ok = [bool]$ok; note = $r.note }
}
$default = @($rows | Where-Object { $_.key -eq 'verify:*' })[0]
if ($default) {
  if (-not $verify) { $results += [ordered]@{ key = 'verify:*'; expected = $default.expected; actual = 'no fresh verify.json'; ok = $false; note = $default.note } }
  else {
    $off = @($verify.checks | Where-Object { -not $listed.ContainsKey($_.id) -and -not (Test-Expect (Get-CheckState $_) $default.expected) } | ForEach-Object { "$($_.id)=$(Get-CheckState $_)" })
    $results += [ordered]@{ key = 'verify:*'; expected = $default.expected; actual = $(if ($off.Count) { $off -join ', ' } else { "$(@($verify.checks).Count - $listed.Count) checks" }); ok = ($off.Count -eq 0); note = $default.note }
  }
}

$pass = (@($results | Where-Object { -not $_.ok }).Count -eq 0)
$doc = [ordered]@{ schema = 'handoff/acceptance@1'; taken = (Get-Date).ToUniversalTime().ToString('o'); root = $Root; scenario = $Scenario; harness = $Harness
  pass = $pass; unit_gate_rc = $gateRc; e2e_rc = $e2eRc; expected = $Expected; expected_sha256 = (Hash $Expected)
  outputs = [ordered]@{ verify = (Hash $files.verify); summary = (Hash $files.summary); unit_gate = (Hash $files.unit) }; rows = $results }
$doc | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OUT 'acceptance.json')
foreach ($x in $results) { Write-Host ("{0} {1,-34} want {2,-10} got {3}" -f $(if ($x.ok) { 'OK  ' } else { 'FAIL' }), $x.key, $x.expected, $x.actual) }
$h = Hash (Join-Path $OUT 'acceptance.json')
if ($pass) { Say "ACCEPTANCE PASS. Cite in ACCEPTANCE.md: out\acceptance.json sha256 $h"; exit 0 }
Say "ACCEPTANCE FAIL: see $OUT\acceptance.json, $OUT\verify.json, $OUT\unit-gate.json and KNOWN-ISSUES.md"
exit 1
