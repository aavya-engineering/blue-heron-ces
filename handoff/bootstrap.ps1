# CES handoff bootstrap (Blue Heron Defense, CES team). Windows PowerShell 5.1 (pwsh not needed).
#   powershell -NoProfile -ExecutionPolicy Bypass -File handoff\bootstrap.ps1 -Root C:\ces-nb [-Origin <url-or-dir>] [-Checkout] [-Reinstall]
# One entry point. It reads handoff.manifest.yaml (next to this script; the parser is lib\HandoffManifest.ps1) and:
#   1. checks every toolchain entry: runs its `check` command and matches the output against `version`;
#   2. clones each repo the components name into the nested layout at <Root>\ces, at the manifest commit,
#      or verifies an existing clone sits at that commit (-Checkout moves a CLEAN clone there; a dirty one fails);
#   3. installs and builds every component in build order (the topological order of `deps`, the same
#      order BUILD-ORDER.md shows), failing fast on the first error with the last log lines. It runs ONE `npm ci`
#      per npm install root: the ces-mono root (<Root>\ces) once, and each separate package (ces-tenant,
#      tenant-stacksim, ces-tester, ces-muster, ces-muster\muster-api). It never runs `npm ci` inside a ces-mono
#      workspace member (ces-shared, ces-stamper, ces-eo, ces-ao, ...), even when that folder still holds an old
#      package-lock.json: npm treats a member as the workspace root, so `npm ci` there would wipe the shared
#      root node_modules (FIX-KIT, clean-room finding CR-03).
# It is idempotent: rerun it after a failure or at any time; finished clones are verified, current installs are
# skipped (-Reinstall forces npm ci), builds rerun. It never kills a process and never writes outside <Root>.
# Logs: <Root>\out\bootstrap\<step>.out|.err and <Root>\out\bootstrap\bootstrap.json (the summary).
# Next: verify\smoke.ps1 -Root <Root>, then verify\round.ps1 -Root <Root> (the four-scenario round; ACCEPTANCE.md).
# -Live: toolchain entries named in -LiveOnlyTools (default: the Graph PowerShell module) become required; without it a
#   missing one is a warning, because the simulator path does not use them.
# -Origin: a git URL prefix (default: the private org below) or a local directory holding <repo>.git bare mirrors.
# -ModuleSecretsPath (optional, for running the servers outside the simulator harness): step 4 makes the DPAPI
#   module-secret store there with ces-shared\scripts\New-CesModuleSecrets.ps1 if it is absent (-ModuleSecretsNoAcl skips
#   its ACL step, for a dev folder only), then renews CES_MUSTER_SECRETS_TOKEN (KNOWN-ISSUES KI-02, fixed in PH-7): lib\Set-MusterSecretsToken.ps1
#   re-mints the muster-api JWT the store already holds (tenant -MusterTenantId). This is the only step
#   that may write outside <Root>, and only to the path you name. The simulator acceptance run does not need it.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Origin = 'https://github.com/blue-heron-defense-CES',
  [string]$Manifest = '',
  [switch]$Checkout,
  [switch]$Reinstall,
  [string]$ModuleSecretsPath,
  [switch]$ModuleSecretsNoAcl,
  [string]$MusterTenantId = 'mx-sim-tenant',
  [switch]$Live,
  [string[]]$LiveOnlyTools = @('Microsoft.Graph.Authentication')
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside an advanced script's param defaults, so defaults that need it are set here (H1).
if (-not $Manifest) { $Manifest = Join-Path $PSScriptRoot 'handoff.manifest.yaml' }
. (Join-Path $PSScriptRoot 'lib\HandoffManifest.ps1')
$Kit = $PSScriptRoot
$Pkg = Get-HandoffPackageDir $Kit
New-Item -ItemType Directory -Force $Root | Out-Null
$Root = (Resolve-Path $Root).Path
# Contractor monorepo (H1, 2026-11-01): the kit sits at <monorepo>\handoff next to SOURCES.json, and the module repos are
# plain folders (ces\, ces\ces-muster\, ..., pkg\ces-muster-run\). Step 2 then checks the folders against SOURCES.json
# instead of cloning, and -Root must be the monorepo folder itself (for example C:\ces-nb).
$MonoRoot = Split-Path -Parent $Kit
$Sources = Read-HandoffSources $MonoRoot
if ($null -ne $Sources -and ((Resolve-Path $MonoRoot).Path.TrimEnd('\') -ne $Root.TrimEnd('\'))) {
  throw "contractor monorepo: pass -Root $MonoRoot (the folder that holds SOURCES.json and handoff\), not $Root"
}
$CES = Join-Path $Root 'ces'
$BLOG = Join-Path $Root 'out\bootstrap'
New-Item -ItemType Directory -Force $BLOG | Out-Null
$Git = @('-c', 'core.longpaths=true', '-c', 'core.autocrlf=false')
$OriginIsDir = Test-Path $Origin -PathType Container
if ($OriginIsDir) { $Origin = (Resolve-Path $Origin).Path } else { $Origin = $Origin.TrimEnd('/') }
function Repo-Url([string]$remote) { if ($OriginIsDir) { Join-Path $Origin "$remote.git" } else { "$Origin/$remote.git" } }

$Summary = [ordered]@{ schema = 'handoff/bootstrap@1'; started = (Get-Date).ToUniversalTime().ToString('o'); root = $Root
  manifest = $Manifest; release = $null; ok = $false; failed_step = $null; error = $null; toolchain = @(); repos = @(); order = @(); steps = @() }
function Save-Summary { $Summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $BLOG 'bootstrap.json') }
function Say([string]$m) { Write-Host "==> $m" }
function Quote([string]$a) { if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a } }
function Try-Run([string]$Name, [string]$Exe, [string]$ArgLine, [string]$Cwd) {
  $o = Join-Path $BLOG "$Name.out"; $e = Join-Path $BLOG "$Name.err"
  $p = Start-Process -FilePath $Exe -ArgumentList $ArgLine -WorkingDirectory $Cwd -NoNewWindow -PassThru `
    -RedirectStandardOutput $o -RedirectStandardError $e
  $null = $p.Handle; $p.WaitForExit()
  return $p.ExitCode
}
# Run one step to completion; on a non-zero exit print the log tails and stop the whole bootstrap.
function Run([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$Cwd) {
  $t0 = Get-Date
  $rc = Try-Run $Name $Exe (($ArgList | ForEach-Object { Quote $_ }) -join ' ') $Cwd
  Add-Step $Name $rc $t0
  if ($rc -ne 0) { Fail-Step $Name $rc }
  Write-Host "OK   $Name"
}
# A manifest command string (build / install), run through cmd.exe so npm resolves to npm.cmd.
function Run-Shell([string]$Name, [string]$Command, [string]$Cwd) {
  $t0 = Get-Date
  $rc = Try-Run $Name 'cmd.exe' "/d /s /c `"$Command`"" $Cwd
  Add-Step $Name $rc $t0
  if ($rc -ne 0) { Fail-Step $Name $rc }
  Write-Host "OK   $Name"
}
function Add-Step([string]$Name, [int]$Rc, [datetime]$T0) {
  $Summary.steps += [ordered]@{ name = $Name; rc = $Rc; seconds = [math]::Round(((Get-Date) - $T0).TotalSeconds, 1) }
  Save-Summary
}
function Fail-Step([string]$Name, [int]$Rc) {
  foreach ($f in @("$Name.err", "$Name.out")) {
    $p = Join-Path $BLOG $f
    if ((Test-Path $p) -and (Get-Item $p).Length -gt 0) {
      Write-Host "FAIL $Name (exit $Rc); last lines of $p :"
      Get-Content $p -Tail 20 | ForEach-Object { Write-Host "     $_" }
      break
    }
  }
  $Summary.failed_step = $Name
  throw "bootstrap step failed: $Name (exit $Rc)"
}
# Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'; these two helpers use 'Continue'.
function Git-Out([string]$Dir, [string[]]$GitArgs) {
  $ErrorActionPreference = 'Continue'
  $out = & git -C $Dir @GitArgs 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ([string]($out -join "`n")).Trim()
}
# A toolchain `check` is a cmd.exe command line (like `build`), so PowerShell does not expand the $ inside it.
function Invoke-Check([string]$Name, [string]$Command) {
  $n = 'check-' + ($Name -replace '[^A-Za-z0-9_.-]', '_')
  $rc = Try-Run $n 'cmd.exe' "/d /s /c `"$Command`"" $Root
  $text = ((Get-Content (Join-Path $BLOG "$n.out") -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content (Join-Path $BLOG "$n.err") -Raw -ErrorAction SilentlyContinue)).Trim()
  return @{ rc = $rc; text = $text }
}
# The npm install root of a folder (FIX-KIT, CR-03): the nearest ancestor inside <Root> whose package.json lists the
# folder in `workspaces` (npm installs a workspace member from that root), else the folder itself. Patterns are
# matched with -like (* and ?), which covers the literal names the ces-mono root uses.
$script:InstallRootCache = @{}
function Get-NpmInstallRoot([string]$Dir) {
  $Dir = $Dir.TrimEnd('\')
  if ($script:InstallRootCache.ContainsKey($Dir)) { return $script:InstallRootCache[$Dir] }
  $found = $Dir
  $d = Split-Path -Parent $Dir
  while ($d -and $d.Length -ge $Root.TrimEnd('\').Length) {
    $pj = Join-Path $d 'package.json'
    if (Test-Path $pj -PathType Leaf) {
      $ws = $null
      try { $ws = (Get-Content -Raw -Path $pj | ConvertFrom-Json).workspaces } catch { $ws = $null }
      if ($null -ne $ws -and $ws -isnot [array] -and $null -ne $ws.packages) { $ws = $ws.packages }
      $rel = ($Dir.Substring($d.TrimEnd('\').Length).TrimStart('\')) -replace '\\', '/'
      $hit = @(@($ws) | Where-Object { $null -ne $_ } | Where-Object { $rel -like ((([string]$_) -replace '^\./', '').TrimEnd('/')) })
      if ($hit.Count -gt 0) { $found = $d; break }
    }
    $parent = Split-Path -Parent $d
    if (-not $parent -or $parent -eq $d) { break }
    $d = $parent
  }
  $script:InstallRootCache[$Dir] = $found
  return $found
}

try {
  # ---------- 0. manifest ----------
  Say "manifest $Manifest"
  $M = Read-HandoffManifest -Path $Manifest
  $Summary.release = [ordered]@{ id = $M.release.id; cut = [string]$M.release.cut; status = $M.release.status }
  $Order = Get-HandoffBuildOrder $M
  $Summary.order = @($Order | ForEach-Object { [string]$_.id })
  Write-Host "     release $($M.release.id) ($($M.release.status)); $(@($M.components).Count) components"
  if ($M.release.status -ne 'pinned') { Write-Host 'WARN release is a draft: commits may read HEAD-at-cut and are not reproducible until the release is pinned.' }
  if ($Root.Length -gt 60) {
    Write-Host "WARN Root is $($Root.Length) characters. Windows PowerShell 5.1 cannot open paths over 260 characters;"
    Write-Host '     use a short root such as C:\ces-nb. Continuing.'
  }

  # ---------- 1. prerequisites (toolchain) ----------
  Say 'prerequisites (manifest toolchain)'
  $bad = @()
  foreach ($t in @($M.toolchain | Where-Object { $null -ne $_ })) {
    $err = $null; $res = @{ rc = -1; text = '' }
    try { $res = Invoke-Check ([string]$t.name) ([string]$t.check) } catch { $err = $_.Exception.Message }
    # every dotted number in the output counts (a module can list several installed versions)
    $nums = @(Get-HandoffVersionNumbers $res.text)
    $match = @($nums | Where-Object { Test-HandoffVersion $_ ([string]$t.version) })
    $ok = (-not $err) -and $res.rc -eq 0 -and $match.Count -gt 0
    $found = if ($match.Count) { $match[0] } elseif ($nums.Count) { $nums -join ', ' } else { $null }
    $liveOnly = $LiveOnlyTools -contains [string]$t.name
    $Summary.toolchain += [ordered]@{ name = $t.name; want = [string]$t.version; found = $found; ok = [bool]$ok; live_only = $liveOnly; check = $t.check }
    $shown = if ($found) { $found } elseif ($err) { "not runnable ($err)" } else { "no version in output (exit $($res.rc))" }
    if ($ok) { Write-Host "OK   $($t.name): want $($t.version), found $shown" }
    elseif ($liveOnly -and -not $Live) { Write-Host "WARN $($t.name): want $($t.version), found $shown. Needed for live tenants only; the simulator run does not use it (-Live makes it required)." }
    else { Write-Host "FAIL $($t.name): want $($t.version), found $shown"; $bad += "$($t.name) (want $($t.version); $($t.why))" }
  }
  Save-Summary
  if ($bad.Count) { $Summary.failed_step = 'prerequisites'; throw "missing or wrong prerequisites: $($bad -join '; ')" }

  # ---------- 2. repos at the manifest commits ----------
  Say "repos (origin $Origin)"
  $repoCommit = [ordered]@{}
  foreach ($c in @($M.components)) {
    $r = [string]$c.repo; $sha = [string]$c.commit
    if ($repoCommit.Contains($r) -and $repoCommit[$r] -ne $sha) { $Summary.failed_step = 'repos'; throw "repo $r has two commits in the manifest: $($repoCommit[$r]) and $sha" }
    $repoCommit[$r] = $sha
  }
  # ces-mono first: the other repos clone into directories inside it.
  $repoOrder = @($repoCommit.Keys | Sort-Object { if ($_ -eq 'ces-mono') { 0 } elseif ($_ -eq 'ces-muster-run') { 2 } else { 1 } })
  if ($null -ne $Sources) {
    Say 'contractor monorepo: module folders are checked against SOURCES.json (no clone, no checkout)'
    # CR-01: a clone made without -c core.autocrlf=false under Git for Windows' default (true) has CRLF copies of LF files.
    $acr = Git-Out $MonoRoot @('config', 'core.autocrlf')
    if ($acr -and $acr -ne 'false') {
      Write-Host "WARN core.autocrlf is '$acr' in this clone, so files may be checked out with changed line endings (KNOWN-ISSUES KI-21)."
      Write-Host '     Re-clone with: git clone -c core.autocrlf=false -c core.longpaths=true <url> C:\ces-nb (START-HERE.md). Continuing.'
    }
  }
  foreach ($r in $repoOrder) {
    $want = $repoCommit[$r]
    $pinned = $want -match '^[0-9a-f]{40}$'
    $dir = Get-HandoffRepoRoot $r $CES $Pkg
    $remote = $script:HandoffRepoMap[$r].remote
    $action = 'verified'
    if ($null -ne $Sources) {
      if (-not (Test-Path $dir -PathType Container)) { $Summary.failed_step = 'repos'; throw "$r : folder $dir is missing from the monorepo" }
      $head = $Sources[$r]
      if (-not $head) { $Summary.failed_step = 'repos'; throw "$r : SOURCES.json has no commit for this repo" }
      if ($pinned -and $head -ne $want) { $Summary.failed_step = 'repos'; throw "$r : the monorepo folder was exported from $head, not the manifest commit $want; use the monorepo built for this release" }
      if (-not $pinned) { Write-Host "WARN $r : manifest commit is '$want' (not a sha); SOURCES.json says $head" }
      $Summary.repos += [ordered]@{ repo = $r; dir = $dir; want = $want; head = $head; action = 'monorepo' }
      Save-Summary
      Write-Host "     $r @ $($head.Substring(0, [Math]::Min(7, $head.Length))) (monorepo folder)"
      continue
    }
    if ($r -eq 'ces-muster-run') {
      if (-not (Test-Path (Join-Path $dir '.git'))) { throw "ces-muster-run: this kit must run from a git checkout of the package ($dir)" }
    } elseif (-not (Test-Path (Join-Path $dir '.git'))) {
      if ((Test-Path $dir) -and @(Get-ChildItem $dir -Force -ErrorAction SilentlyContinue).Count -gt 0 -and $r -ne 'ces-mono') {
        throw "$r : $dir exists, is not a git clone, and is not empty; move it away and rerun"
      }
      Say "clone $remote -> $dir"
      Run "clone-$r" 'git' ($Git + @('clone', '-q', '--no-checkout', (Repo-Url $remote), $dir)) $Root
      if ($pinned) {
        if ($null -eq (Git-Out $dir @('cat-file', '-e', "$want^{commit}"))) { Run "fetch-$r" 'git' ($Git + @('-C', $dir, 'fetch', '-q', 'origin', $want)) $Root }
        Run "checkout-$r" 'git' ($Git + @('-C', $dir, 'checkout', '-q', '--detach', $want)) $Root
      } else {
        Run "checkout-$r" 'git' ($Git + @('-C', $dir, 'checkout', '-q')) $Root
      }
      $action = 'cloned'
    }
    if ($r -ne 'ces-muster-run') { & git -C $dir config core.longpaths true; & git -C $dir config core.autocrlf false }
    $head = Git-Out $dir @('rev-parse', 'HEAD')
    if (-not $head) { throw "$r : cannot read HEAD in $dir (git rev-parse failed)" }
    if ($pinned -and $head -ne $want) {
      $dirty = Git-Out $dir @('status', '--porcelain')
      if (-not $Checkout -or $r -eq 'ces-muster-run') {
        throw "$r : HEAD $head is not the manifest commit $want. Rerun with -Checkout to move a clean clone (not the kit's own package), or check out the commit yourself."
      }
      if ($dirty) { throw "$r : HEAD $head is not the manifest commit $want and the working tree has changes; commit or stash them first (bootstrap never discards work)" }
      if ($null -eq (Git-Out $dir @('cat-file', '-e', "$want^{commit}"))) { Run "fetch-$r" 'git' ($Git + @('-C', $dir, 'fetch', '-q', 'origin', $want)) $Root }
      Run "checkout-$r" 'git' ($Git + @('-C', $dir, 'checkout', '-q', '--detach', $want)) $Root
      $head = Git-Out $dir @('rev-parse', 'HEAD')
      if ($head -ne $want) { throw "$r : checkout did not reach $want (HEAD $head)" }
      $action = 'checked out'
    }
    if (-not $pinned) { Write-Host "WARN $r : manifest commit is '$want' (not a sha); using HEAD $head" }
    $Summary.repos += [ordered]@{ repo = $r; dir = $dir; want = $want; head = $head; action = $action }
    Save-Summary
    Write-Host "     $r @ $($head.Substring(0, 7)) ($action)"
  }

  # ---------- 3. install and build, in build order ----------
  Say "install and build ($($Summary.order -join ' -> '))"
  $installed = @{}
  foreach ($c in $Order) {
    $id = [string]$c.id
    $repoRoot = Get-HandoffRepoRoot ([string]$c.repo) $CES $Pkg
    $compDir = Get-HandoffComponentDir $c $CES $Pkg
    $buildDir = if ($c.cwd) { Join-Path $CES (([string]$c.cwd) -replace '/', '\') } else { $repoRoot }
    if (-not (Test-Path $compDir)) { $Summary.failed_step = "build-$id"; throw "$id : component path $compDir does not exist at this commit" }
    # A build that runs `npm ci` itself (the manifest's choice) is the install of its build directory's install root:
    # no second npm ci there in this run.
    if ([string]$c.build -match '(^|&&|\s)npm\s+ci(\s|$)') { $installed[(Get-NpmInstallRoot $buildDir)] = $true }
    # Every directory from the repo root down to the component (and the build cwd) that holds a package-lock.json,
    # mapped to its npm install root and de-duplicated, repo root first. Covers nested separate packages such as
    # ces-muster\muster-api. A lockfile inside a workspace member is skipped: the root lockfile governs (CR-03).
    $lockDirs = @()
    $d = $compDir
    while ($d -and $d.Length -ge $repoRoot.Length) {
      if (Test-Path (Join-Path $d 'package-lock.json')) { $lockDirs += $d }
      if ($d -eq $repoRoot) { break }
      $d = Split-Path -Parent $d
    }
    if ((Test-Path (Join-Path $buildDir 'package-lock.json')) -and $lockDirs -notcontains $buildDir) { $lockDirs += $buildDir }
    $installRoots = @()
    foreach ($ld in $lockDirs) {
      $ir = Get-NpmInstallRoot $ld
      if ($ir -ne $ld.TrimEnd('\') -and -not $installed.ContainsKey("note:$ld")) {
        $installed["note:$ld"] = $true
        Write-Host "     skip npm ci in $ld : workspace member of $ir (its package-lock.json is not used; the root lockfile governs)"
      }
      if ($installRoots -notcontains $ir) { $installRoots += $ir }
    }
    foreach ($ld in @($installRoots | Sort-Object Length)) {
      if ($installed.ContainsKey($ld)) { continue }
      $installed[$ld] = $true
      $stamp = Join-Path $ld 'node_modules\.package-lock.json'
      $tag = (($ld.Substring($Root.Length).TrimStart('\')) -replace '[\\/:]', '_')
      if (-not $Reinstall -and (Test-Path $stamp) -and (Get-Item $stamp).LastWriteTimeUtc -ge (Get-Item (Join-Path $ld 'package-lock.json')).LastWriteTimeUtc) {
        Write-Host "     install $tag : current (node_modules newer than package-lock.json; -Reinstall forces npm ci)"
        continue
      }
      Run "ci-$tag" 'npm.cmd' @('ci', '--no-audit', '--no-fund') $ld
    }
    if ($c.build) { Run-Shell "build-$id" ([string]$c.build) $buildDir }
    else { Write-Host "     $id : no build step in the manifest" }
  }

  # ---------- 4. optional: module-secret store + muster-api token renewal (KI-02) ----------
  if ($ModuleSecretsPath) {
    Say "module-secret store $ModuleSecretsPath"
    $gen = Join-Path $CES 'ces-shared\scripts\New-CesModuleSecrets.ps1'
    if (-not (Test-Path -LiteralPath $ModuleSecretsPath)) {
      $ga = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $gen, '-Path', $ModuleSecretsPath)
      if ($ModuleSecretsNoAcl) { $ga += '-NoAcl' }
      Run 'module-secrets' 'powershell.exe' $ga $Root
    } else { Write-Host '     store exists: kept (regenerate with New-CesModuleSecrets.ps1 -Force; see RUNBOOK.md)' }
    Run 'ki02-muster-token' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Kit 'lib\Set-MusterSecretsToken.ps1'),
      '-Path', $ModuleSecretsPath, '-Ces', $CES, '-TenantId', $MusterTenantId) $Root
  }

  $Summary.ok = $true
  Save-Summary
  Say "DONE: $(@($Order).Count) components built at $CES (summary: $BLOG\bootstrap.json)"
  Write-Host "     next: powershell -NoProfile -ExecutionPolicy Bypass -File $Kit\verify\smoke.ps1 -Root $Root"
  Write-Host "     then: powershell -NoProfile -ExecutionPolicy Bypass -File $Kit\verify\round.ps1 -Root $Root (the four-scenario round, ACCEPTANCE.md)"
  exit 0
} catch {
  $Summary.error = $_.Exception.Message
  if (-not $Summary.failed_step) { $Summary.failed_step = 'bootstrap' }
  Save-Summary
  Write-Host "FAIL $($_.Exception.Message)"
  Write-Host "     summary: $BLOG\bootstrap.json; step logs: $BLOG\<step>.out|.err. Fix the cause and rerun (idempotent)."
  exit 1
}
