# MX bootstrap (Blue Heron Defense, CES team). Windows PowerShell 5.1 (pwsh not needed).
#   powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Root C:\mx [-Origin <url-or-dir>] [-Scenario muster-partial] [-SkipE2E]
# -Origin: a git URL prefix or a local directory holding <repo>.git bare mirrors (default: pins.json org).
# Builds the nested CES workspace at <Root>\ces from pinned commits, applies the MX overlay and
# patches, builds everything, runs the unit gate, then the Muster -> Stamper -> EO run on the
# simulator (scripts\mx-e2e.ps1, which ends with scripts\verify.ps1).
# It never calls ces-mono's own scripts\bootstrap.ps1 and never writes to C:\CES_Pipeline.
# Logs: <Root>\out\bootstrap\*.out|.err. Rerunning reuses existing clones (they must sit at the pins).
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Origin,
  [string]$Scenario = 'muster-partial',
  [switch]$SkipE2E
)
$ErrorActionPreference = 'Stop'
$Pkg = $PSScriptRoot
$Pins = Get-Content (Join-Path $Pkg 'pins.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force $Root | Out-Null
$Root = (Resolve-Path $Root).Path
$CES = Join-Path $Root 'ces'
$BLOG = Join-Path $Root 'out\bootstrap'
New-Item -ItemType Directory -Force $BLOG | Out-Null
$Git = @('-c', 'core.longpaths=true', '-c', 'core.autocrlf=false')
# v2: clone source is <Origin>/<repo>.git; a local directory of bare mirrors works the same as the org
if (-not $Origin) { $Origin = $Pins.org }
$OriginIsDir = Test-Path $Origin -PathType Container
if ($OriginIsDir) { $Origin = (Resolve-Path $Origin).Path } else { $Origin = $Origin.TrimEnd('/') }
function Repo-Url([string]$repo) { if ($OriginIsDir) { Join-Path $Origin "$repo.git" } else { "$Origin/$repo.git" } }

function Say([string]$m) { Write-Host "==> $m" }
function Quote([string]$a) { if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a } }
function Try-Run([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$Cwd) {
  $o = Join-Path $BLOG "$Name.out"; $e = Join-Path $BLOG "$Name.err"
  $p = Start-Process -FilePath $Exe -ArgumentList (($ArgList | ForEach-Object { Quote $_ }) -join ' ') -WorkingDirectory $Cwd `
    -NoNewWindow -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
  $null = $p.Handle; $p.WaitForExit()
  return $p
}
function Run([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$Cwd) {
  $p = Try-Run $Name $Exe $ArgList $Cwd
  $e = Join-Path $BLOG "$Name.err"
  if ($p.ExitCode -ne 0) {
    Write-Host "FAIL $Name (exit $($p.ExitCode)); last lines of $e :"
    Get-Content $e -Tail 15 | ForEach-Object { Write-Host "     $_" }
    throw "bootstrap step failed: $Name"
  }
  Write-Host "OK   $Name"
}

# V10 baseline: what exists outside the workspace before anything runs (covers the unit gate too).
$snap = [ordered]@{ taken = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
$lad = Join-Path $env:LOCALAPPDATA 'CES'   # synthetic-customer W0: V10 also watches %LOCALAPPDATA%\CES
foreach ($d in @('C:\CES_Pipeline', (Join-Path $HOME '.ces'), (Join-Path $HOME '.stamper'), $lad)) {
  $files = @(Get-ChildItem $d -Recurse -File -Force -ErrorAction SilentlyContinue)
  $max = if ($files.Count) { ($files | Measure-Object LastWriteTimeUtc -Maximum).Maximum.ToString('o') } else { $null }
  $key = if ($d -eq $lad) { '%LOCALAPPDATA%\CES' } else { $d -replace [regex]::Escape($HOME), '~' }
  $snap[$key] = [ordered]@{ count = $files.Count; max_mtime = $max }
}
$snap | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $Root 'out\outside-before.json')

# 1. Prerequisites
Say 'prerequisites'
$nodeV = (& node -v) -replace '^v', ''
if ([int]($nodeV.Split('.')[0]) -lt 20) { throw "Node 20 or later is required (found $nodeV)" }
& git --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'git is required' }
if (-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)) { throw 'Windows PowerShell 5.1 (powershell.exe) is required' }
Write-Host "     node $nodeV, $(& git --version), powershell $($PSVersionTable.PSVersion)"
Write-Host "     origin $Origin"
if ($Root.Length -gt 60) {
  Write-Host "WARN Root is $($Root.Length) characters. Windows PowerShell 5.1 cannot open paths over 260 characters;"
  Write-Host '     use a short root such as C:\mx. Continuing.'
}

# 2. Clone at the pins (nested layout; ces-stacksim goes in as tenant-stacksim)
foreach ($r in $Pins.repos) {
  $dir = if ($r.dir -eq '.') { $CES } else { Join-Path $CES $r.dir }
  if (-not (Test-Path (Join-Path $dir '.git'))) {
    Say "clone $($r.repo)"
    Run "clone-$($r.repo)" 'git' ($Git + @('clone', '-q', (Repo-Url $r.repo), $dir)) $Root
  }
  & git -C $dir config core.longpaths true
  & git -C $dir config core.autocrlf false
  # v2: pins may name a branch (BHD's changes are commits on it); default local branch name is main
  $branch = if ($r.branch) { $r.branch } else { 'main' }
  Run "checkout-$($r.repo)" 'git' ($Git + @('-C', $dir, 'checkout', '-q', '-B', $branch, $r.sha)) $Root
  $head = (& git -C $dir rev-parse HEAD).Trim()
  if ($head -ne $r.sha) { throw "$($r.repo): HEAD $head is not the pin $($r.sha)" }
  Write-Host "     $($r.repo) @ $($head.Substring(0, 7))"
}

# 3. Overlay and patches (applied before the builds, so tsc and the builds see the patched code)
Say 'overlay and patches'
$ovRoot = Join-Path $Pkg 'overlay'
if (-not (Test-Path $ovRoot) -and -not $Pins.patches) { Write-Host '     none: v2 ships BHD changes as commits at the pins' }
foreach ($f in @(Get-ChildItem $ovRoot -Recurse -File -ErrorAction SilentlyContinue)) {
  $dest = Join-Path $CES $f.FullName.Substring($ovRoot.Length + 1)
  New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
  Copy-Item -Force $f.FullName $dest
  Write-Host "     overlay: $($f.FullName.Substring($ovRoot.Length + 1))"
}
foreach ($p in $Pins.patches) {
  $repoDir = Join-Path $CES $p.repo_dir
  $patch = Join-Path $Pkg $p.file
  $rev = Try-Run "applied-$(Split-Path -Leaf $patch)" 'git' @('-C', $repoDir, 'apply', '--reverse', '--check', $patch) $Root
  if ($rev.ExitCode -eq 0) { Write-Host "     $(Split-Path -Leaf $patch): already applied"; continue }
  Run "apply-check-$(Split-Path -Leaf $patch)" 'git' @('-C', $repoDir, 'apply', '--check', $patch) $Root
  Run "apply-$(Split-Path -Leaf $patch)" 'git' @('-C', $repoDir, 'apply', $patch) $Root
}

# 4. Install (npm ci: the lockfiles are used as committed) and build
Say 'install and build'
$npm = 'npm.cmd'
Run 'ci-ces-tenant' $npm @('ci', '--no-audit', '--no-fund') (Join-Path $CES 'ces-tenant')
Run 'build-ces-tenant' $npm @('run', 'build') (Join-Path $CES 'ces-tenant')
Run 'ci-ces-mono' $npm @('ci', '--no-audit', '--no-fund') $CES
Run 'build-core' $npm @('run', 'build:core') $CES
Run 'ci-tenant-stacksim' $npm @('ci', '--no-audit', '--no-fund') (Join-Path $CES 'tenant-stacksim')
Run 'build-tenant-stacksim' $npm @('run', 'build') (Join-Path $CES 'tenant-stacksim')
Run 'ci-ces-tester' $npm @('ci', '--no-audit', '--no-fund') (Join-Path $CES 'ces-tester')
Run 'build-ces-tester' $npm @('run', 'build') (Join-Path $CES 'ces-tester')
Run 'ci-ces-muster' $npm @('ci', '--no-audit', '--no-fund') (Join-Path $CES 'ces-muster')
Run 'ci-muster-api' $npm @('ci', '--no-audit', '--no-fund') (Join-Path $CES 'ces-muster\muster-api')
Run 'build-muster-api' $npm @('run', 'build') (Join-Path $CES 'ces-muster\muster-api')
Run 'build-muster-spa' $npm @('run', 'build') (Join-Path $CES 'ces-muster')

# 5. Unit gate (starts and stops `stacksim up` itself for the live-sim suites)
Say 'unit gate (scripts\run-tests.ps1)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pkg 'scripts\run-tests.ps1') -Root $Root
$gate = $LASTEXITCODE
if ($gate -ne 0) { Write-Host 'FAIL unit gate: see <Root>\out\unit-gate.json (unexpected failures listed there)' } else { Write-Host 'OK   unit gate' }

# 6. End to end on the simulator, then verify
if ($SkipE2E) { Say 'E2E skipped (-SkipE2E)'; exit $gate }
Say 'end to end (scripts\mx-e2e.ps1)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pkg 'scripts\mx-e2e.ps1') -Root $Root -Scenario $Scenario -KeepOutsideBaseline
$e2e = $LASTEXITCODE
if ($e2e -eq 0 -and $gate -eq 0) { Say "DONE: all checks pass (<Root>\out\verify.json)"; exit 0 }
Say "NOT DONE: unit gate exit $gate, e2e/verify exit $e2e. See <Root>\out\verify.json and BRING-MUSTER-CURRENT.md troubleshooting."
exit 1
