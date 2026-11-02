# MX end-to-end run (Blue Heron Defense, CES team). Windows PowerShell 5.1.
#   powershell -ExecutionPolicy Bypass -File mx-e2e.ps1 -Root <WS> [-Scenario muster-partial] [-From E1]
# <WS> holds the nested workspace at <WS>\ces (made by bootstrap.ps1). Simulator only.
# Steps E1-E9 (see BRING-MUSTER-CURRENT.md). Every step logs to <WS>\out\logs\<step>.*
# and records its exit code in <WS>\out\steps.json. E9 runs verify.ps1.
# v2 / Phase 3 order: E1-E6, E8.5 (start EC, one catalog-tagged upload; it runs before E7 because EO reads
# EC items during /api/assess), E7, E8 (+ EO ledger and evidence package), E8B (bundle.mjs: raw + shared
# evidence), E8F (forced-failure run into <WS>\out\runs\forced; -SkipForcedRun skips it), E9.
# -From reruns from a step; earlier outputs in <WS>\out are reused.
# Synthetic-customer W0: -Scenario <slug> takes any scenario the simulator has (scenarios\<slug>.json in tenant-stacksim);
# the verify baseline is expected-outputs\<slug>\summary.json (muster-partial: expected-outputs\summary.json).
# Synthetic-customer W1: E6's overrides step is conditional (scripts\overrides-gate.mjs; MX_ALLOW_OVERRIDES=1 = transition
# aid). Gap closure FLOW-5 (a): initialPassword is no longer minted here; muster-api issues it at E3 as a secret reference
# (the plan carries the reference) and Stamper resolves it from muster-api at E6 and E8F (CES_MUSTER_SECRETS_URL/TOKEN).
# Gap closure API-3a: E3 compiles through muster-api's POST /api/plan/compile (scripts\plan-compile.mjs); muster-api starts at
# E3 and stays up through E8F. The retired runner (ces-muster scripts\mx\plan-from-discovery.ts) runs once more on the same
# inputs into out\plan-script, only for V88's comparison.
# P4.2: -Harness tester hands E1-E8F to ces-tester (run-scenario --scenario <slug> = scenarios\muster\<slug>-e2e.json, which also runs
# the tester's comparison EX and stacksim coverage-ao AO and writes out\tester-run.json + out\coverage-ao.json into the same
# out\ layout); this script keeps the port guard, the V10 snapshots and E9 (verify adds V23/V26). Default -Harness mx.
# Synthetic-customer W2: E7B (one more EO assess, not forced, out\eo-assess-7b.json) runs after E7 under both harnesses and E8
# builds the SSP / POA&M from its snapshot. E6X (S3 re-injection) and E7A (AdminOps) run under -Harness tester only; verify
# reports V45, V46 and V48 "not run" under -Harness mx.
# W2 follow-up (per-run AdminOps isolation): <WS>\pl\ces.db is one append-only SQLite file, so no AdminOps row is ever deleted;
# the EO server gets CES_EO_ADMINOPS_SINCE = E1's start and reads only this run's AdminOps rows (both harnesses; the tester
# sets it itself). Six-year retention is a production property, not a simulator one. out\ao (the tester's throwaway sim
# PFX for AdminOps' cert-path check) is removed at the start of every full run.
# W8-UIT1 (PLAN section 8b): step EU runs after E8F under both harnesses, once the twin's servers are stopped and inside the V10
# window: ces-tester's ui-e2e Stamper use case (scenarios\ui\<slug>-stamper-ui-e2e.json; S1 today) on the legacy console and,
# when ces-stamper\public\app is built, on the SPA (/app/); it writes out\ui-e2e-stamper.json and out\ui\<variant>\ for V73.
# Watchable by default (headed browser on the desktop, paced, captioned, video + trace); -UiHeadless only for unattended reruns.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Scenario = 'muster-partial',
  [ValidateSet('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8.5', 'E8.6', 'E7', 'E7B', 'E8', 'E8B', 'E8F', 'E9')][string]$From = 'E1',
  # P3.2: a second execute with one entry forced to fail (Stamper CLI --force-fail), then one EO assess + SSP into out\runs\forced.
  # On by default; powershell.exe -File cannot pass -ForcedRun:$false, so -SkipForcedRun turns it off.
  [switch]$ForcedRun = $true,
  [switch]$SkipForcedRun,
  [string]$ForceFailEntry = 'SC.L2-3.13.15.anti-spam',
  # Set by bootstrap.ps1, which took the "before" snapshot for V10 at its own start (so V10 also covers the unit gate).
  [switch]$KeepOutsideBaseline,
  [ValidateSet('mx', 'tester')][string]$Harness = 'mx',
  # W8-UIT1: step EU drives the UI headless. Ask for it explicitly; the default is headed and watchable (founder rule).
  [switch]$UiHeadless
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$Pkg = Split-Path -Parent $PSScriptRoot
$CES = Join-Path $Root 'ces'
$OUT = Join-Path $Root 'out'
$LOG = Join-Path $OUT 'logs'
$PL = Join-Path $Root 'pl'            # CES_PIPELINE_ROOT (short name: Windows MAX_PATH)
$TEN = Join-Path $Root 'tenants'      # CES_TENANT_ROOT
$Helpers = Join-Path $PSScriptRoot 'mx-helpers.mjs'
$SIM = Join-Path $CES 'tenant-stacksim'
$SimUrl = 'http://127.0.0.1:4390'
$Ports = @(4390, 4011, 4002, 4001, 3000, 3001, 4173)   # 3000: the Stamper GUI server of step EU (W8-UIT1); 3001 / 4173: AO GUI and Muster SPA of EU-AO / EU-MU (FIN-35)
$StepsFile = Join-Path $OUT 'steps.json'
$Order = @('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8.5', 'E8.6', 'E7', 'E7B', 'E8', 'E8B', 'E8F', 'E9')
$EcUrl = 'http://127.0.0.1:4001'
$EcSecret = [guid]::NewGuid().ToString('N')   # this run only; never written to a file
# NS-4 (gap closure, V80): three more run-only secrets, never written to a file, all different. EC verifies the uploader's
# principal with the first (CES_EC_PRINCIPAL_SECRET); EO signs and verifies approver tokens with the second
# (CES_AO_PRINCIPAL_SECRET) and accepts this harness as a loopback dev operator with the third (CES_EO_OPERATOR_SECRET with
# CES_EO_OPERATOR_DEV_FALLBACK=1, simulator only). E8.5 writes the review plan of customers\<slug>\document-reviews.json here.
$EcPrincipalSecret = [guid]::NewGuid().ToString('N')
$AoPrincipalSecret = [guid]::NewGuid().ToString('N')
$EoOperatorSecret = [guid]::NewGuid().ToString('N')
$ReviewPlanFile = Join-Path $LOG 'E8.5-review-plan.json'
# Gap closure FLOW-5 (a): the harness no longer generates initialPassword (New-InitialPassword and STAMPER_INITIAL_PASSWORD are
# retired). muster-api issues it at E3 as a one-time secret reference and holds the value; Stamper resolves it at E6 / E8F.
$MusterUrl = 'http://127.0.0.1:4011'

New-Item -ItemType Directory -Force $OUT, $LOG, $PL, $TEN | Out-Null
$env:CES_PIPELINE_ROOT = $PL
$env:CES_TENANT_ROOT = $TEN
$env:STACKSIM_ROOT = $SIM
$env:STAMPER_REGISTRY_ROOT = Join-Path $CES 'ces-stamper\src\registry'
$BaseEnv = @{ Path = $env:Path; PSModulePath = $env:PSModulePath }

# ---------- helpers ----------
$Steps = [ordered]@{}
if ($From -ne 'E1' -and (Test-Path $StepsFile)) {
  (Get-Content $StepsFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $Steps[$_.Name] = $_.Value }
}
function Now { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Save-Steps { $Steps | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $StepsFile }
function Record([string]$Id, [int]$Rc, [string]$Started, [hashtable]$Extra = @{}) {
  $o = [ordered]@{ rc = $Rc; started = $Started; ended = (Now) }
  foreach ($k in $Extra.Keys) { $o[$k] = $Extra[$k] }
  $Steps[$Id] = $o; Save-Steps
  $tag = if ($Rc -eq 0) { 'OK  ' } else { 'FAIL' }
  Write-Host "$tag $Id (rc=$Rc)"
}
function Quote([string]$a) { if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a } }
# Run a native command to completion; stdout/stderr to <LOG>\<Name>.out/.err. Returns the exit code.
function Invoke-Logged([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$Cwd, [string]$StdinText = $null) {
  $o = Join-Path $LOG "$Name.out"; $e = Join-Path $LOG "$Name.err"
  $p = @{ FilePath = $Exe; ArgumentList = (($ArgList | ForEach-Object { Quote $_ }) -join ' '); WorkingDirectory = $Cwd
    NoNewWindow = $true; PassThru = $true; RedirectStandardOutput = $o; RedirectStandardError = $e }
  if ($null -ne $StdinText) { $in = Join-Path $LOG "$Name.stdin"; Set-Content -Encoding ascii $in $StdinText; $p.RedirectStandardInput = $in }
  $proc = Start-Process @p
  $null = $proc.Handle
  $proc.WaitForExit()
  return $proc.ExitCode
}
function Start-Bg([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$Cwd) {
  $o = Join-Path $LOG "$Name.out"; $e = Join-Path $LOG "$Name.err"
  $proc = Start-Process -FilePath $Exe -ArgumentList (($ArgList | ForEach-Object { Quote $_ }) -join ' ') -WorkingDirectory $Cwd `
    -NoNewWindow -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
  Set-Content (Join-Path $LOG "$Name.pid") $proc.Id
  return $proc
}
# PH-13 (LOG-PH13-FX.md STOP-2): a grandchild that exits during /T made taskkill's stderr terminating under Stop (V75 lost auth-probe.json).
function Stop-Tree($proc) { if ($proc -and -not $proc.HasExited) { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $eap } } }
# v2: never kill. Before the run, refuse to start while any port is held (another build may own it).
# After the run, only report: this script stops its own children with Stop-Tree.
function Get-PortHolders {
  $held = @()
  foreach ($port in $Ports) {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($id in $pids) { if ($id -gt 0) { $held += [pscustomobject]@{ port = $port; pid = $id } } }
  }
  return $held
}
function Assert-PortsFree {
  $held = @(Get-PortHolders)
  if ($held.Count) {
    foreach ($h in $held) { Write-Host "  REFUSE: port $($h.port) is held by pid $($h.pid); this script never kills processes" }
    throw "ports in use: $(($held | ForEach-Object { $_.port } | Sort-Object -Unique) -join ', '). Stop that build yourself, then rerun."
  }
}
function Report-Ports {
  foreach ($h in @(Get-PortHolders)) { Write-Host "  WARN port $($h.port) still held by pid $($h.pid) after the run (not killed)" }
}
function Wait-Http([string]$Url, [string]$Method = 'GET', [int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      if ($Method -eq 'POST') { Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Url -Body '{}' -ContentType 'application/json' -TimeoutSec 3 | Out-Null }
      else { Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null }
      return $true
    } catch {
      if ($_.Exception.Response) { return $true }   # any HTTP answer means the server is up
      Start-Sleep -Seconds 1
    }
  }
  return $false
}
function Latest([string]$Dir, [string]$Prefix) {
  if (-not (Test-Path $Dir)) { return $null }
  $f = Get-ChildItem $Dir -Filter "$Prefix*.json" | Sort-Object Name | Select-Object -Last 1
  if ($f) { $f.FullName } else { $null }
}
function Use-SimEnv {
  $se = Get-Content (Join-Path $OUT 'sim-env.json') -Raw | ConvertFrom-Json
  $env:PSModulePath = $se.PSModulePath; $env:Path = $se.Path; $env:STACKSIM_SERVER_URL = $se.STACKSIM_SERVER_URL
}
function Use-BaseEnv { $env:Path = $BaseEnv.Path; $env:PSModulePath = $BaseEnv.PSModulePath; Remove-Item Env:STACKSIM_SERVER_URL, Env:CES_MUSTER_SECRETS_URL, Env:CES_MUSTER_SECRETS_TOKEN -ErrorAction SilentlyContinue }
# FLOW-5 (a): the Stamper calls only (EC and EO never see it): where Stamper resolves the initial-password reference muster-api
# issued at E3. The value itself never passes through this script.
function Use-StamperSecret { if ($MusterToken -and $apiProc -and -not $apiProc.HasExited) { $env:CES_MUSTER_SECRETS_URL = $MusterUrl; $env:CES_MUSTER_SECRETS_TOKEN = $MusterToken } }
# FLOW-5 harness fix (DB-1 follow-up): the EC reset also deletes the ec_* rows from <PL>\ces.db, with ces-tester's compiled helper
# (src\flow\ec-reset.ts clearEcRows; only ec_* collections, AO and EO rows stay). Returns the rows removed, or a note.
function Clear-EcRows {
  $db = Join-Path $PL 'ces.db'
  $helper = Join-Path $CES 'ces-tester\dist\src\flow\ec-reset.js'
  if (-not (Test-Path $db)) { return 'no ces.db' }
  if (-not (Test-Path $helper)) { return 'ces-tester dist\src\flow\ec-reset.js not built: ec_* rows NOT cleared' }
  $n = & node -e "import(process.argv[1]).then((m) => console.log(m.clearEcRows(process.argv[2])))" ([uri]$helper).AbsoluteUri $db
  return "$n ec_* rows removed"
}
# NS-4 (gap closure, V80): an HS256 principal token signed with ces-shared's signPrincipalToken (dist). The claims and the
# secret reach the one node call through its env only (never argv, a file or a log); the token stays in this process.
function New-PrincipalToken([string]$Sub, [string]$Upn, [string[]]$Roles, [string]$Secret) {
  $mod = ([uri](Join-Path $CES 'ces-shared\dist\http\requestPrincipal.js')).AbsoluteUri
  $claims = [ordered]@{ sub = $Sub; upn = $Upn }
  if ($Roles) { $claims['roles'] = @($Roles) }
  $env:MX_PRINCIPAL_CLAIMS = ($claims | ConvertTo-Json -Compress); $env:MX_PRINCIPAL_SECRET = $Secret
  try {
    $tok = & node -e "import(process.argv[1]).then((m) => process.stdout.write(m.signPrincipalToken(JSON.parse(process.env.MX_PRINCIPAL_CLAIMS), { secret: process.env.MX_PRINCIPAL_SECRET, ttlSeconds: 3600 })))" $mod
  } finally { Remove-Item Env:MX_PRINCIPAL_CLAIMS, Env:MX_PRINCIPAL_SECRET -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0 -or -not $tok) { throw 'could not sign a principal token (ces-shared dist http\requestPrincipal.js)' }
  return ([string]$tok).Trim()
}
# NS-4 / V78: one JSON request that never throws; returns the HTTP status and the body (parsed when it is JSON).
function Invoke-JsonCall([string]$Method, [string]$Url, $Body, [hashtable]$Headers = @{}) {
  $o = @{ status = $null; body = $null }
  $raw = ''
  try {
    $p = @{ UseBasicParsing = $true; Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = 600 }
    if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Depth 6); $p.ContentType = 'application/json' }
    $r = Invoke-WebRequest @p
    $o.status = [int]$r.StatusCode; $raw = [string]$r.Content
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $o.status = [int]$resp.StatusCode
      $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $raw = $sr.ReadToEnd(); $sr.Dispose()
    } else { $raw = $_.Exception.Message }
  }
  try { $o.body = $raw | ConvertFrom-Json } catch { $o.body = $raw }
  return $o
}
# NS-4 step E8.6 (GAP-CLOSURE-PLAN.md section 4 G-NS, rule GD-b section 7, V80): the reviewer named in
# customers\<slug>\document-reviews.json records one document review per objective in EO (POST /api/reviews) with an
# approver token EO mints for them (POST /api/approver-tokens; this harness is the loopback dev operator). Runs inside E7,
# after EO answers /api/health and before the first assess, so every assess pass of the run reads the same reviews (V14,
# the one-SPRS check). The artifact hashes are the ones EC returned at E8.5 (out\ec-upload-reviews.json). A self-review
# probe (a token minted for the uploader) must be refused 403. Writes out\eo-reviews.json (statuses and ids, never a token).
# Not fatal: V1 (rc) and V80 judge it. Every run posts afresh; eo_document_reviews is WORM in the shared ces.db.
function Invoke-ReviewStep([string]$EoBase) {
  $t = Now
  $file = Join-Path $OUT 'eo-reviews.json'
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  $rec = [ordered]@{ schema = 'mx-e2e/eo-reviews@1'; taken = $t; tenant = $Scenario; reviews_planned = 0; posted_201 = 0; posted = @() }
  $posted = New-Object System.Collections.ArrayList
  $rc = 1
  try {
    if (-not (Test-Path $ReviewPlanFile)) { $rec.note = 'no review plan (no customers\<slug>\document-reviews.json, or E8.5 did not run)'; $rc = 0 }
    else {
      $plan = Get-Content $ReviewPlanFile -Raw | ConvertFrom-Json
      $rec.uploader_upn = $plan.uploader.upn; $rec.reviewer_upn = $plan.reviewer.upn; $rec.operator_upn = $plan.operatorUpn
      $rec.reviews_planned = @($plan.reviews).Count
      if ($rec.reviews_planned -eq 0) { $rec.note = 'the plan has no review (probe upload only)'; $rc = 0 }
      else {
        $hashOf = @{}
        foreach ($u in @(Get-Content (Join-Path $OUT 'ec-upload-reviews.json') -Raw | ConvertFrom-Json)) { $hashOf[[string]$u.id] = [string]$u.sha256 }
        $opTok = New-PrincipalToken "bhd-operator:$($plan.operatorUpn.ToLower())" $plan.operatorUpn @('bhd-operator') $EoOperatorSecret
        $mint = Invoke-JsonCall 'POST' "$EoBase/api/approver-tokens?tenant=$Scenario" @{ approverUpn = $plan.reviewer.upn } @{ 'x-ces-principal' = $opTok }
        $rec.mint_status = $mint.status; $rec.mint_id = $mint.body.mintId; $rec.mint_operator_auth = $mint.body.operatorAuth
        if ($mint.status -ne 201) { $rec.mint_error = $mint.body }
        else {
          $revTok = [string]$mint.body.token
          foreach ($r in @($plan.reviews)) {
            $b = [ordered]@{ tenant = $Scenario; controlId = $r.control_id; objectiveId = $r.objective_id; artifactHash = $hashOf[[string]$r.artifact]; verdict = $r.verdict; notes = $r.notes }
            $res = Invoke-JsonCall 'POST' "$EoBase/api/reviews" $b @{ 'x-ces-principal' = $revTok }
            $err = if ($res.status -ne 201) { $res.body } else { $null }
            [void]$posted.Add([ordered]@{ control_id = $r.control_id; objective_id = $r.objective_id; artifact = $r.artifact; verdict = $r.verdict; http_status = $res.status; review_id = $res.body.reviewId; error = $err })
          }
          # GD-b: nobody reviews their own upload. A review with a token minted for the uploader must get 403 reviewer_is_uploader.
          $first = @($plan.reviews)[0]
          $selfMint = Invoke-JsonCall 'POST' "$EoBase/api/approver-tokens?tenant=$Scenario" @{ approverUpn = $plan.uploader.upn } @{ 'x-ces-principal' = $opTok }
          $rec.self_mint_status = $selfMint.status
          if ($selfMint.status -eq 201) {
            $sb = [ordered]@{ tenant = $Scenario; controlId = $first.control_id; objectiveId = $first.objective_id; artifactHash = $hashOf[[string]$first.artifact]; verdict = 'met'; notes = 'self-review probe (must be refused)' }
            $self = Invoke-JsonCall 'POST' "$EoBase/api/reviews" $sb @{ 'x-ces-principal' = [string]$selfMint.body.token }
            $rec.self_review_status = $self.status; $rec.self_review_error = $self.body.error
          }
          $rec.posted_201 = @($posted | Where-Object { $_.http_status -eq 201 }).Count
          if ($rec.posted_201 -eq $rec.reviews_planned -and $rec.self_review_status -eq 403) { $rc = 0 }
        }
      }
    }
  } catch { $rec.error = $_.Exception.Message; Write-Host "  E8.6 error: $($_.Exception.Message)" }
  $rec.posted = @($posted)
  $rec | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $file
  Write-Host "  E8.6: $($rec.reviews_planned) review(s) planned, $($rec.posted_201) posted (201); self-review HTTP $($rec.self_review_status)"
  Record 'E8.6' $rc $t @{ reviews = $rec.reviews_planned; posted = $rec.posted_201; self_review_status = $rec.self_review_status; file = 'eo-reviews.json' }
}
function Snapshot-Outside([string]$Tag) {
  $snap = [ordered]@{ taken = (Now) }
  # Synthetic-customer W0 (V10 extended): %LOCALAPPDATA%\CES is watched too (V24's snapshot-outside does not cover it).
  $lad = Join-Path $env:LOCALAPPDATA 'CES'
  foreach ($d in @('C:\CES_Pipeline', (Join-Path $HOME '.ces'), (Join-Path $HOME '.stamper'), $lad)) {
    $files = @(Get-ChildItem $d -Recurse -File -Force -ErrorAction SilentlyContinue)
    $max = if ($files.Count) { ($files | Measure-Object LastWriteTimeUtc -Maximum).Maximum.ToString('o') } else { $null }
    $key = if ($d -eq $lad) { '%LOCALAPPDATA%\CES' } else { $d -replace [regex]::Escape($HOME), '~' }
    $snap[$key] = [ordered]@{ count = $files.Count; max_mtime = $max }
  }
  $snap | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $OUT "outside-$Tag.json")
}
# Run 61 (per-run cleanup): every per-run artefact of an earlier run goes before E1 (an aborted E7 left run 60's passes
# 2 and 3 for V14). Same list as ces-tester's perRunArtefacts (src\flow\muster-e2e-run.ts), plus out\outside-*.json, which
# this wrapper owns (skipped with -KeepOutsideBaseline). Kept: out\run*-console.log, out\verify-*.log, baselines,
# captures, archived run bundles, the simulator's tenant folders. Returns the number of paths removed.
function Clear-PerRun {
  $n = 0
  $fileRe = '^(eo-assess.*\.json|eo-ledger\.json|eo-connect\.json|ssp\..*|poam\.json|scorecard-.*\.json|GAPS-.*|steps\.json|tester-run\.json|coverage-ao\.json|summary\.json|verify\.json|push-response\.json|ec-upload.*\.json|adminops-e7a\.json|e6x\.json|eo-package.*|muster-results\.json|eo-records\.json|plan-compile\.json|eo-reviews\.json|ui-e2e-stamper\.json|sim-store-e6\.json|ui-e2e-(ao|eo|muster)\.json|sim-store-e7a-pre\.json|sim-store-e7b\.json)$'
  if (-not $KeepOutsideBaseline) { $fileRe = $fileRe.TrimEnd('$').TrimEnd(')') + '|outside-.*\.json)$' }
  $dirs = @('plan', 'eo', 'st', 'disc', 'coverage-ao', 'ao', 'ui')   # W8-UIT1: 'ui' (step EU) and ui-e2e-stamper.json above
  $dirs += 'plan-script'   # API-3a (V88): the retired runner's twin output; plan-compile.json above
  $dirs += 'e7b'   # FIN-35: the state E7B assessed (the tester's EU-EO input)
  $paths = @()
  if (Test-Path $OUT) {
    $paths += @(Get-ChildItem $OUT -Force | Where-Object { $_.Name -match $fileRe -or ($_.PSIsContainer -and $dirs -contains $_.Name) } | ForEach-Object { $_.FullName })
    if (Test-Path $LOG) { $paths += @(Get-ChildItem $LOG -Force | ForEach-Object { $_.FullName }) }
    foreach ($x in @((Join-Path (Join-Path $OUT 'runs') 'forced'), (Join-Path (Join-Path $OUT 'runs') 'latest.json'))) { if (Test-Path $x) { $paths += $x } }
  }
  $tenantPl = Join-Path $PL "Stamper\plan-data\$Scenario"
  foreach ($sub in @('plans', 'state', 'evidence', 'evidence-by-task')) { $x = Join-Path $tenantPl $sub; if (Test-Path $x) { $paths += $x } }
  foreach ($x in $paths) { Remove-Item -Recurse -Force $x -ErrorAction SilentlyContinue; $n++ }
  New-Item -ItemType Directory -Force $LOG | Out-Null
  return $n
}
function Leaf([string]$p) { if ($p) { Split-Path -Leaf $p } else { $null } }
function Want([string]$Id) { $Order.IndexOf($Id) -ge $Order.IndexOf($From) }
# W8-UIT1 step EU (PLAN section 8b, UI-TRACK section 5): the Stamper UI use case through ces-tester, after the twin (E1-E8F) with
# its servers stopped. Runs only when the tester has scenarios\ui\<slug>-stamper-ui-e2e.json and the twin left its executable
# plan and execution report. Not fatal: V73 judges out\ui-e2e-stamper.json. Headed unless -UiHeadless.
function Invoke-UiStep {
  $uiScenario = Join-Path $CES "ces-tester\scenarios\ui\$Scenario-stamper-ui-e2e.json"
  if (-not (Test-Path $uiScenario)) { Write-Host "  EU: no UI use case for $Scenario (ces-tester scenarios\ui\$Scenario-stamper-ui-e2e.json); skipped"; return }
  if (-not ((Test-Path (Join-Path $OUT 'executable-plan.json')) -and (Test-Path (Join-Path $OUT 'execution-report.json')))) {
    Write-Host '  EU: the twin left no out\executable-plan.json or out\execution-report.json; skipped (V73 reports it)'; return
  }
  $t = Now
  $spaBuilt = Test-Path (Join-Path $CES 'ces-stamper\public\app\index.html')
  $uargs = @('bin/ces-tester.mjs', 'run-scenario', $uiScenario, '--root', $Root, '--package-root', $Pkg)
  if ($UiHeadless) { $uargs += '--headless' }
  $spaNote = if ($spaBuilt) { ' then the SPA (/app/)' } else { ' (SPA /app/ not built: not run)' }
  $howNote = if ($UiHeadless) { 'headless (requested)' } else { 'headed on this desktop' }
  Write-Host "  EU: Stamper UI use case, legacy console$spaNote, $howNote"
  $rc = Invoke-Logged 'EU-ui' 'node' $uargs (Join-Path $CES 'ces-tester')
  Get-Content (Join-Path $LOG 'EU-ui.out') | Select-Object -Last 12 | ForEach-Object { Write-Host "  $_" }
  Record 'EU' $rc $t @{ headed = (-not $UiHeadless); spa_built = $spaBuilt; record = (Test-Path (Join-Path $OUT 'ui-e2e-stamper.json')) }   # not fatal: V73
  Invoke-ConsoleUiSteps
}

# FIN-35 (finishing plan PH-3): the watched AO, EO and Muster console runs, after the Stamper EU, each against its twin:
# EU-AO (V123, ces-tester scenarios\ui\<slug>-ao-ui-e2e.json), EU-EO (V124, FIN-31's spec), EU-MU (V125, FIN-32's spec).
# Each runs on private roots under out\ui\<surface>\ and writes out\ui-e2e-<surface>.json. Not fatal: the V-checks judge
# the records. Headed unless -UiHeadless (rounds run headless until the founder watches).
function Invoke-ConsoleUiSteps {
  foreach ($s in @(@{ surface = 'ao'; id = 'EU-AO' }, @{ surface = 'eo'; id = 'EU-EO' }, @{ surface = 'muster'; id = 'EU-MU' })) {
    $file = Join-Path $CES "ces-tester\scenarios\ui\$Scenario-$($s.surface)-ui-e2e.json"
    if (-not (Test-Path $file)) { Write-Host "  $($s.id): no $($s.surface) UI use case for $Scenario; skipped"; continue }
    $t = Now
    $cargs = @('bin/ces-tester.mjs', 'run-scenario', $file, '--root', $Root, '--package-root', $Pkg)
    if ($UiHeadless) { $cargs += '--headless' }
    Write-Host "  $($s.id): $($s.surface) console, $(if ($UiHeadless) { 'headless (requested)' } else { 'headed on this desktop' })"
    $rc = Invoke-Logged "$($s.id)-ui" 'node' $cargs (Join-Path $CES 'ces-tester')
    Get-Content (Join-Path $LOG "$($s.id)-ui.out") | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }
    Record $s.id $rc $t @{ headed = (-not $UiHeadless); record = (Test-Path (Join-Path $OUT "ui-e2e-$($s.surface).json")) }   # not fatal: V123-V125
  }
}

# SEC-4 (gap closure, V75): this run's bearer tokens for AO and EO. This process and its children only; never written to
# a file, a log or steps.json (out\auth-probe.json records statuses and /api/health bodies, never a token).
function New-RunToken {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $b = New-Object byte[] 32
  $rng.GetBytes($b); $rng.Dispose()
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Get-AuthProbe([string]$Url, [string]$Token = '') {
  $h = @{}
  if ($Token) { $h['Authorization'] = "Bearer $Token" }
  $o = [ordered]@{ url = $Url; with_token = [bool]$Token; status = $null; body = $null }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $h -TimeoutSec 10
    $o.status = [int]$r.StatusCode
    try { $o.body = $r.Content | ConvertFrom-Json } catch { $o.body = [string]$r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $o.status = [int]$resp.StatusCode
      try { $o.body = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() | ConvertFrom-Json } catch { $o.body = $null }
    } else { $o['error'] = $_.Exception.Message }
  }
  return $o
}
# FIN-42 / SP-4 (V75 clause (b), SECRETS-PLAN.md section 5): start AO once more from a DPAPI module-secret store written
# under out\fin42 (New-CesModuleSecrets.ps1, CurrentUser scope, -NoAcl on this temp path) and WITHOUT CES_AO_AUTH_TOKEN
# in its environment. Expect /api/health 200 with auth "ENFORCED" and a tokenless /api/commands 401. The token never
# leaves the store (nothing here reads it); the store folder is deleted afterwards. Needs ces-ao\dist built against
# ces-shared\dist\secrets.
function Invoke-AuthProbeStore([string]$AoUrl) {
  $dir = Join-Path $OUT 'fin42'
  $store = Join-Path $dir 'module-secrets.dpapi'
  $gen = Join-Path $CES 'ces-shared\scripts\New-CesModuleSecrets.ps1'
  $o = [ordered]@{ url = $AoUrl; store = 'out/fin42/module-secrets.dpapi'; names = @('CES_AO_AUTH_TOKEN'); generated = $false; env_token = $false; up = $false }
  $proc = $null
  try {
    if (-not (Test-Path $gen)) { throw "no store generator at $gen" }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $null = & $gen -Path $store -NoAcl -Force -Names CES_AO_AUTH_TOKEN
    $o.generated = [bool](Test-Path $store)
    Remove-Item Env:CES_AO_AUTH_TOKEN -ErrorAction SilentlyContinue
    $o.env_token = [bool]$env:CES_AO_AUTH_TOKEN
    $env:CES_MODULE_SECRETS_PATH = $store; $env:CES_NO_OPEN = '1'
    $proc = Start-Bg 'AUTH-ao-store' 'node' @((Join-Path $CES 'ces-ao\dist\cli\index.js'), 'gui', '--port', '3000') (Join-Path $CES 'ces-ao')
    Remove-Item Env:CES_MODULE_SECRETS_PATH, Env:CES_NO_OPEN -ErrorAction SilentlyContinue
    $o.up = Wait-Http "$AoUrl/api/health" 'GET' 60
    if ($o.up) {
      $o.health = Get-AuthProbe "$AoUrl/api/health"
      $o.api_no_token = Get-AuthProbe "$AoUrl/api/commands"
    }
  } catch { $o['error'] = $_.Exception.Message } finally {
    Stop-Tree $proc
    Remove-Item Env:CES_MODULE_SECRETS_PATH, Env:CES_NO_OPEN -ErrorAction SilentlyContinue
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    $o.store_removed = -not (Test-Path $store)
  }
  return $o
}
# SEC-4 / V75: after the tester run (its servers stopped), start AO (ao gui, port 3000) and EO (port 4002) with this run's
# tokens, GET each /api/health and a tokenless /api route (expect 401), then stop both. AO's tokenless /api/health is open
# by intent (ENFORCED + bind); EO's /api/health sits behind its token, so EO's body is read with the token.
function Invoke-AuthProbe {
  $file = Join-Path $OUT 'auth-probe.json'
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  $t = Now
  $aoUrl = 'http://127.0.0.1:3000'; $eoUrl = 'http://127.0.0.1:4002'
  $probe = [ordered]@{ schema = 'mx-e2e/auth-probe@1'; taken = $t; ao = [ordered]@{ url = $aoUrl }; eo = [ordered]@{ url = $eoUrl } }
  $aoProc = $null; $eoProc = $null
  try {
    $env:CES_AO_AUTH_TOKEN = $AoToken; $env:CES_NO_OPEN = '1'
    $aoProc = Start-Bg 'AUTH-ao' 'node' @((Join-Path $CES 'ces-ao\dist\cli\index.js'), 'gui', '--port', '3000') (Join-Path $CES 'ces-ao')
    Remove-Item Env:CES_AO_AUTH_TOKEN, Env:CES_NO_OPEN -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $OUT 'sim-env.json')) { Use-SimEnv }
    $env:REGISTRY_PATH = Join-Path $CES 'ces-stamper\src\registry\cmmc-l2-commands.registry.json'
    $env:STORAGE_ROOT = Join-Path $LOG 'auth-probe-eo'; $env:TENANT_SLUG = $Scenario; $env:EO_PORT = '4002'
    $env:COMPLIANCE_REPO_PATH = Join-Path $LOG 'auth-probe-eo-repo'; $env:CES_EO_AUTH_TOKEN = $EoToken
    $eoProc = Start-Bg 'AUTH-eo' 'node' @((Join-Path $CES 'node_modules\tsx\dist\cli.mjs'), 'src/eo/index.ts') (Join-Path $CES 'ces-eo')
    Use-BaseEnv
    Remove-Item Env:REGISTRY_PATH, Env:STORAGE_ROOT, Env:TENANT_SLUG, Env:EO_PORT, Env:COMPLIANCE_REPO_PATH, Env:CES_EO_AUTH_TOKEN -ErrorAction SilentlyContinue
    $probe.ao.up = Wait-Http "$aoUrl/api/health" 'GET' 60
    if ($probe.ao.up) {
      $probe.ao.health = Get-AuthProbe "$aoUrl/api/health"
      $probe.ao.api_no_token = Get-AuthProbe "$aoUrl/api/commands"
      $probe.ao.api_with_token = Get-AuthProbe "$aoUrl/api/commands" $AoToken
      $probe.ao.api_with_token.body = $null   # the command list is not needed for V75
    }
    $probe.eo.up = Wait-Http "$eoUrl/api/health" 'GET' 120
    if ($probe.eo.up) {
      $probe.eo.health_no_token = Get-AuthProbe "$eoUrl/api/health"
      $probe.eo.health = Get-AuthProbe "$eoUrl/api/health" $EoToken
      $probe.eo.api_no_token = Get-AuthProbe "$eoUrl/api/ledger?tenant=$Scenario"
    }
  } catch { $probe['error'] = $_.Exception.Message } finally {
    try { Stop-Tree $aoProc } catch { $probe['stop_error_ao'] = $_.Exception.Message }
    try { Stop-Tree $eoProc } catch { $probe['stop_error_eo'] = $_.Exception.Message }
    Remove-Item Env:CES_AO_AUTH_TOKEN, Env:CES_EO_AUTH_TOKEN, Env:CES_NO_OPEN -ErrorAction SilentlyContinue
  }
  # FIN-42 (V75 clause (b)): AO from the module-secret store, after the first AO has stopped (same port).
  $probe.ao_store = Invoke-AuthProbeStore $aoUrl
  $probe | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $file
  $ok = ($probe.ao.health.status -eq 200) -and ($probe.ao.api_no_token.status -eq 401) -and ($probe.ao.api_with_token.status -eq 200) -and ($probe.eo.api_no_token.status -eq 401) -and ($probe.eo.health.status -eq 200) -and ($probe.ao_store.health.status -eq 200) -and ($probe.ao_store.health.body.auth -eq 'ENFORCED') -and ($probe.ao_store.api_no_token.status -eq 401)
  Record 'AUTH' ([int](-not $ok)) $t @{ file = 'auth-probe.json' }
}
# ---------- -Harness tester (P4.2): ces-tester runs E1-E8F, EX and AO; this script keeps the port guard, V10 and E9 ----------
if ($Harness -eq 'tester') {
  if ($From -ne 'E1') { throw '-From is not supported with -Harness tester (the tester runs the whole sequence)' }
  # Synthetic-customer W0: any scenario the simulator has. The tester resolves --scenario <slug> to its
  # scenarios\muster\<slug>-e2e.json (musterE2eFile.ts musterE2eFileForSlug); checked here first for a clear error.
  if ($Scenario -notmatch '^[a-z0-9][a-z0-9-]{0,39}$') { throw "-Scenario '$Scenario' is not a scenario slug (lower case, digits, '-')" }
  $TesterRoot = Join-Path $CES 'ces-tester'
  $TesterScenario = Join-Path $TesterRoot "scenarios\muster\$Scenario-e2e.json"
  if (-not (Test-Path $TesterScenario)) { throw "-Harness tester: no tester scenario scenarios\muster\$Scenario-e2e.json for sim scenario $Scenario" }
  if (-not (Test-Path (Join-Path $SIM "scenarios\$Scenario.json"))) { throw "-Harness tester: the simulator has no scenarios\$Scenario.json" }
  $t = Now
  $rc = 1
  try {
    Assert-PortsFree
    # Synthetic customers / run 61: the tester harness starts from a clean set of per-run outputs so an aborted run never
    # leaves another run's files for the checks (run 40 read S1's SSP; run 61's V14 read run 60's passes 2 and 3).
    $cleaned = Clear-PerRun; Write-Host "per-run cleanup: $cleaned earlier artefacts removed"
    if (-not ($KeepOutsideBaseline -and (Test-Path (Join-Path $OUT 'outside-before.json')))) { Snapshot-Outside 'before' }
    $targs = @('bin/ces-tester.mjs', 'run-scenario', '--scenario', $Scenario, '--root', $Root, '--package-root', $Pkg, '--force-fail-entry', $ForceFailEntry)
    if ($SkipForcedRun -or -not $ForcedRun) { $targs += '--skip-forced-run' }
    # SEC-4 (V75): the tester's AO and EO children inherit this run's tokens; its EO calls send CES_EO_AUTH_TOKEN.
    $AoToken = New-RunToken; $EoToken = New-RunToken
    $env:CES_AO_AUTH_TOKEN = $AoToken; $env:CES_EO_AUTH_TOKEN = $EoToken
    $rc = Invoke-Logged 'tester-run' 'node' $targs $TesterRoot
    Remove-Item Env:CES_AO_AUTH_TOKEN, Env:CES_EO_AUTH_TOKEN -ErrorAction SilentlyContinue
    Get-Content (Join-Path $LOG 'tester-run.out') | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    # W8-UIT1 EU: keep the tester's steps.json rows (E1-E8F, EX, AO) before Record adds EU.
    $Steps = [ordered]@{}
    if (Test-Path $StepsFile) { (Get-Content $StepsFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $Steps[$_.Name] = $_.Value } }
    try { Invoke-UiStep } catch { Write-Host "  EU error: $($_.Exception.Message)" }
    try { Invoke-AuthProbe } catch { Write-Host "  AUTH error: $($_.Exception.Message)" }
  } finally {
    Report-Ports
    Snapshot-Outside 'after'
  }
  # The tester wrote out\steps.json (E1-E8F, EX, AO); keep it and add this wrapper's own rows.
  $Steps = [ordered]@{}
  if (Test-Path $StepsFile) { (Get-Content $StepsFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $Steps[$_.Name] = $_.Value } }
  Record 'TESTER' $rc $t
  $t = Now
  $env:MX_HARNESS = 'tester'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify.ps1') -Root $Root -Scenario $Scenario
  $rc = $LASTEXITCODE
  Remove-Item Env:MX_HARNESS -ErrorAction SilentlyContinue
  Record 'E9' $rc $t
  exit $rc
}

$simProc = $null; $apiProc = $null; $MusterToken = $null; $eoProc = $null; $ecProc = $null; $ledgerTaken = $false; $forcedRan = $false; $euReady = $false
$planDir = Join-Path $OUT 'plan'
$plansPushed = Join-Path $PL "Stamper\plan-data\$Scenario\plans"
try {
  Assert-PortsFree
  # P4.4 / run 61: a full run starts from a clean set of per-run outputs so an aborted run never leaves another run's files
  # for the checks to read (run 33 read S1's SSP on a muster-partial run; run 61's V14 read run 60's passes 2 and 3).
  # Run 61 change: out\eo (EO assessment history) is now removed too, so E7 pass 1 is a drift baseline on every run
  # (V43b passes a baseline); the evidence store inside it is still wiped again at E6.
  if ($From -eq 'E1') { $cleaned = Clear-PerRun; Write-Host "per-run cleanup: $cleaned earlier artefacts removed" }
  if ($From -eq 'E1' -and -not ($KeepOutsideBaseline -and (Test-Path (Join-Path $OUT 'outside-before.json')))) { Snapshot-Outside 'before' }

  # ---------- E1: seed and serve the sim ----------
  $t = Now
  $psmWritten = $null
  if (Want 'E1') {
    # W5 cycle 6 (run 52): regenerate the sim's PowerShell modules from the built sim before E6 (the AO step does it only at the end).
    $psmDir = Join-Path $SIM 'psmodules'; $psmSince = (Get-Date).ToUniversalTime()
    $rc = Invoke-Logged 'E1-psmodules' 'node' @('dist/src/codegen/generatePsModule.js', $psmDir) $SIM
    $psmWritten = @(Get-ChildItem $psmDir -Directory -ErrorAction SilentlyContinue | Where-Object { $m = Join-Path $_.FullName "$($_.Name).psd1"; (Test-Path $m) -and (Get-Item $m).LastWriteTimeUtc -ge $psmSince }).Count
    if ($rc -ne 0 -or $psmWritten -eq 0) { Record 'E1' $(if ($rc -ne 0) { $rc } else { 1 }) $t @{ psmodules_written = $psmWritten }; throw 'E1: psmodules generation failed' }
    $rc = Invoke-Logged 'E1-scenario' 'node' @('bin/stacksim.mjs', 'scenario', $Scenario) $SIM
    if ($rc -ne 0) { Record 'E1' $rc $t; throw "E1: stacksim scenario failed" }
  }
  $simProc = Start-Bg 'E1-serve' 'node' @('bin/stacksim.mjs', 'serve', 'm365_azure', '--slug', $Scenario, '--port', '4390') $SIM
  $up = Wait-Http "$SimUrl/ledger" 'POST' 30
  $tenantDir = Test-Path (Join-Path $SIM ".stacksim\tenants\$Scenario")
  if (Want 'E1') { Record 'E1' ($(if ($up -and $tenantDir) { 0 } else { 1 })) $t @{ psmodules_written = $psmWritten; ledger_up = $up; tenant_dir = $tenantDir } }
  if (-not ($up -and $tenantDir)) { throw 'E1: sim not serving or tenant dir missing' }

  # ---------- E2: discovery (mu discovery --sim) ----------
  $disc = Join-Path $OUT 'discovery-result.json'
  if (Want 'E2') {
    $t = Now
    # W5 cycle 4: the customer's interview answers reach discovery too (lookup verdicts that need answered values, e.g. the Wi-Fi SSID).
    $e2Args = @('dist/cli/bin.js', 'discovery', '--sim', '--slug', $Scenario, '--out', $disc)
    $e2Answers = Join-Path (Split-Path -Parent $PSScriptRoot) "customers\$Scenario\interview-answers.json"
    if (Test-Path $e2Answers) { $e2Args += @('--answers', $e2Answers) }
    $raw = Invoke-Logged 'E2-discovery' 'node' $e2Args (Join-Path $CES 'ces-muster\muster-api')
    $okLine = Select-String -Path (Join-Path $LOG 'E2-discovery.out') -Pattern '"ok":true' -SimpleMatch -Quiet
    # Node 24 on Windows can abort on exit (libuv UV_HANDLE_CLOSING) after the file is written:
    # the run counts as passed when mu printed ok:true and the file exists.
    $rc = if ($raw -eq 0 -or ($okLine -and (Test-Path $disc))) { 0 } else { 1 }
    Record 'E2' $rc $t @{ raw_rc = $raw; ok_line = [bool]$okLine }
    if ($rc -ne 0) { throw 'E2: discovery failed' }
  }

  # ---------- E3: readiness and compile (API-3a: muster-api POST /api/plan/compile) ----------
  if (Want 'E3') {
    $t = Now
    if (Test-Path $planDir) { Remove-Item -Recurse -Force $planDir }
    # V58: a synthetic customer's organisation content carries its `simulation` block (the fictional marker).
    $orgContent = Join-Path (Split-Path -Parent $PSScriptRoot) "customers\$Scenario\org-content.json"
    # W1: the customer's interview answers fill unsure/unanswered facts, ODPs and operator values.
    $answers = Join-Path (Split-Path -Parent $PSScriptRoot) "customers\$Scenario\interview-answers.json"
    # API-3a: muster-api starts here and stays up through E8F (E4 pushes to it, and FLOW-5 (a): Stamper resolves the
    # initial-password reference it issued here at E6 and E8F). No database (MS-R5 plan routes only). ROLE-1 (founder
    # ruling 2026-10-30): Muster receives no execution results; nothing is delivered to it.
    $rc = 1
    $env:JWT_SECRET = [guid]::NewGuid().ToString('N'); $env:PORT = '4011'
    $apiProc = Start-Bg 'E3-muster-api' 'node' @('dist/server.js') (Join-Path $CES 'ces-muster\muster-api')
    if (Wait-Http "$MusterUrl/" 'GET' 30) {
      $MusterToken = & node (Join-Path $PSScriptRoot 'mint-token.mjs') $CES
      # FIN-29 (SP-11 R6): the bearer reaches plan-compile.mjs in its environment (MUSTER_API_TOKEN), never on argv.
      $cargs = @((Join-Path $PSScriptRoot 'plan-compile.mjs'), '--api', $MusterUrl, '--slug', $Scenario, '--disc', $disc, '--out', $planDir, '--record', (Join-Path $OUT 'plan-compile.json'))
      if (Test-Path $orgContent) { $cargs += @('--org-content', $orgContent) }
      if (Test-Path $answers) { $cargs += @('--answers', $answers) }
      $env:MUSTER_API_TOKEN = $MusterToken
      try { $rc = Invoke-Logged 'E3-plan' 'node' $cargs $OUT } finally { Remove-Item Env:MUSTER_API_TOKEN -ErrorAction SilentlyContinue }
    } else { Write-Host '  E3: muster-api did not answer' }
    Remove-Item Env:JWT_SECRET, Env:PORT -ErrorAction SilentlyContinue
    $mp = Latest $planDir 'manual-mission-plan-'; $tm = Latest $planDir 'tenant-manifest-'
    if ($rc -eq 0 -and -not ($mp -and $tm)) { $rc = 1 }
    # V88: the retired runner, standalone on the same inputs, into out\plan-script (compared by V88, never pushed). Not fatal.
    $twinRc = $null
    if ($rc -eq 0) {
      $twin = Join-Path $OUT 'plan-script'
      if (Test-Path $twin) { Remove-Item -Recurse -Force $twin }
      $env:MX_DISCOVERY = $disc; $env:MX_OUT = $twin; $env:MX_SLUG = $Scenario
      if (Test-Path $orgContent) { $env:MX_ORG_CONTENT = $orgContent } else { Remove-Item Env:MX_ORG_CONTENT -ErrorAction SilentlyContinue }
      if (Test-Path $answers) { $env:MX_ANSWERS = $answers } else { Remove-Item Env:MX_ANSWERS -ErrorAction SilentlyContinue }
      $mu = Join-Path $CES 'ces-muster'
      $twinRc = Invoke-Logged 'E3-plan-script' 'node' @((Join-Path $mu 'node_modules\vite-node\vite-node.mjs'), 'scripts/mx/plan-from-discovery.ts') $mu
      Remove-Item Env:MX_DISCOVERY, Env:MX_OUT, Env:MX_SLUG, Env:MX_ORG_CONTENT, Env:MX_ANSWERS -ErrorAction SilentlyContinue
    }
    Record 'E3' $rc $t @{ mode = 'api'; mp = (Leaf $mp); tm = (Leaf $tm); im = (Leaf (Latest $planDir 'infrastructure-manifest-')); record = 'plan-compile.json'; script_twin_rc = $twinRc }
    if ($rc -ne 0) { throw 'E3: muster-api plan compile failed (see logs\E3-plan.err, out\plan-compile.json)' }
  }

  # ---------- E4: push to Stamper's plan-data (muster-api, no database) ----------
  if (Want 'E4') {
    $t = Now
    if (Test-Path $plansPushed) { Remove-Item -Recurse -Force $plansPushed }
    # API-3a: muster-api is E3's. A -From E4 rerun starts a new one (it holds no E3 secret reference: E6 cannot resolve it).
    if (-not ($apiProc -and -not $apiProc.HasExited)) {
      $env:JWT_SECRET = [guid]::NewGuid().ToString('N'); $env:PORT = '4011'
      $apiProc = Start-Bg 'E4-muster-api' 'node' @('dist/server.js') (Join-Path $CES 'ces-muster\muster-api')
      if (Wait-Http "$MusterUrl/" 'GET' 30) { $MusterToken = & node (Join-Path $PSScriptRoot 'mint-token.mjs') $CES }
      Remove-Item Env:JWT_SECRET, Env:PORT -ErrorAction SilentlyContinue
    }
    $mode = 'api'
    $rc = 1
    $pushResp = Join-Path $OUT 'push-response.json'
    if (Test-Path $pushResp) { Remove-Item -Force $pushResp }
    if ($MusterToken -and (Wait-Http "$MusterUrl/" 'GET' 30)) {
      $env:MUSTER_API_TOKEN = $MusterToken   # FIN-29 (SP-11 R6): env, not argv
      try { $rc = Invoke-Logged 'E4-push' 'node' @($Helpers, 'push', '--api', $MusterUrl, '--plans', $planDir, '--slug', $Scenario, '--out', $pushResp) $OUT } finally { Remove-Item Env:MUSTER_API_TOKEN -ErrorAction SilentlyContinue }
    }
    # MG-12: muster-api answered but refused (e.g. 400: malformed hand-off envelope or hash mismatch): surface the body, no fallback.
    if ($rc -ne 0 -and (Test-Path $pushResp)) {
      Get-Content (Join-Path $LOG 'E4-push.err') | ForEach-Object { Write-Host "  $_" }
      Stop-Tree $apiProc; $apiProc = $null
      Record 'E4' $rc $t @{ mode = 'api-refused'; plans_dir = $plansPushed }
      throw 'E4: muster-api refused the push (see logs\E4-push.err)'
    }
    if ($rc -ne 0) {
      # Fallback (muster-api did not answer): write the same names directly (muster-api/src/routes/plan.ts), MG-12 envelopes included.
      # FLOW-5 (b): EVERY envelope the push stores (muster-api planHandoff.ts HANDOFF_KINDS): the six MG-12 hand-off envelopes,
      # the two policy envelopes and the CUI Boundary among them, beside the MP, TM and IM.
      $mode = 'direct-write'
      New-Item -ItemType Directory -Force $plansPushed | Out-Null
      $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
      foreach ($pfx in @('manual-mission-plan', 'tenant-manifest', 'infrastructure-manifest', 'si-baseline', 'tcp', 'readiness-posture', 'policy-inputs-profile', 'policy-set-manifest', 'cui-boundary')) {
        $src = Latest $planDir "$pfx-"
        if ($src) { Copy-Item $src (Join-Path $plansPushed "$pfx-$Scenario-$ts.json") }
      }
      $rc = 0
    }
    # FLOW-5 (a): after an API push muster-api stays up through E8F (Stamper's secret reference only; ROLE-1: no results).
    if ($mode -ne 'api') { Stop-Tree $apiProc; $apiProc = $null; $MusterToken = $null }
    $ok = (Latest $plansPushed 'manual-mission-plan-') -and (Latest $plansPushed 'tenant-manifest-')
    if (-not $ok) { $rc = 1 }
    Record 'E4' $rc $t @{ mode = $mode; plans_dir = $plansPushed }
    if ($rc -ne 0) { throw 'E4: push failed' }
  }
  $pMP = Latest $plansPushed 'manual-mission-plan-'; $pTM = Latest $plansPushed 'tenant-manifest-'

  # ---------- sim tenant registration + launch env (used by E5-E8) ----------
  if (Want 'E5') {
    $rc = Invoke-Logged 'E5-sim-env' 'node' @($Helpers, 'sim-env', '--ces', $CES, '--slug', $Scenario, '--out', (Join-Path $OUT 'sim-env.json')) $OUT
    if ($rc -ne 0) { Record 'E5' $rc (Now); throw 'E5: sim tenant registration failed' }
  }

  # ---------- E5: Stamper translate ----------
  $exe = Join-Path $OUT 'executable-plan.json'
  $stamperCli = Join-Path $CES 'ces-stamper\dist\cli\index.js'
  $stCwd = Join-Path $OUT 'stamper-cwd'; $stStore = Join-Path $OUT 'st'
  New-Item -ItemType Directory -Force $stCwd, $stStore | Out-Null
  if (Want 'E5') {
    $t = Now
    Use-SimEnv; Use-StamperSecret
    $rc = Invoke-Logged 'E5-translate' 'node' @($stamperCli, 'translate', $pMP, '-m', $pTM, '--tenant', $Scenario, '-o', $exe) $stCwd
    Use-BaseEnv
    if ($rc -eq 0 -and -not (Test-Path $exe)) { $rc = 1 }
    Record 'E5' $rc $t
    if ($rc -ne 0) { throw 'E5: translate failed' }
  }

  # ---------- E6: Stamper execute on the sim ----------
  if (Want 'E6') {
    $t = Now
    # Synthetic-customer W1: overrides retired. overrides-gate.mjs checks the pushed TM's tenant_identity for the twelve keys
    # Muster supplies (PLAN §2.3). All present: the overrides file is not read ("overrides: not needed"). Any missing: E6
    # fails with the list, unless MX_ALLOW_OVERRIDES=1 (transition aid; merges the missing keys, never initialPassword).
    # The log is <OUT>\logs\E6-overrides.json (mode, missing, applied; key names only). V54 reads it.
    $ovFile = Join-Path (Split-Path -Parent $PSScriptRoot) "customers\$Scenario\sim-overrides.json"
    if (-not (Test-Path $ovFile)) { $ovFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'sim-overrides.json' }
    if (-not $pTM) { Record 'E6' 1 $t; throw 'E6: no pushed tenant manifest for the overrides gate' }
    $rcOv = Invoke-Logged 'E6-overrides' 'node' @((Join-Path $PSScriptRoot 'overrides-gate.mjs'), '--plan', $exe, '--tm', $pTM, '--overrides', $ovFile, '--out', (Join-Path $LOG 'E6-overrides.json')) $OUT
    Get-Content (Join-Path $LOG 'E6-overrides.out') | ForEach-Object { Write-Host "  $_" }
    if ($rcOv -ne 0) { Record 'E6' $rcOv $t @{ overrides = 'refused' }; throw "E6: $((Get-Content (Join-Path $LOG 'E6-overrides.out') -Raw).Trim())" }
    # v2: a run's Stamper outputs are exactly this run's. Earlier runs' evidence files under the tenant folder let EO
    # assess two controls from stale entries in the long-lived workspace (found by the Phase 5 fresh-root proof).
    # Two folders carry Stamper output: the synthetic STORAGE_ROOT ($stStore) and, since FX-02, the pipeline-root tenant
    # folder <PL>\Stamper\plan-data\<slug> (evidence, evidence-by-task, state), which EO reads. Both are wiped; plans/ is
    # rewritten by E4 and kept.
    $tenantPl = Join-Path $PL "Stamper\plan-data\$Scenario"
    foreach ($base in @($stStore, $tenantPl)) {
      foreach ($sub in @('state', 'evidence', 'evidence-by-task')) {
        if (Test-Path (Join-Path $base $sub)) { Remove-Item -Recurse -Force (Join-Path $base $sub) }
      }
    }
    # EO-collection W1.6 (V14): EO's evidence store (<OUT>\eo\evidence-store, one folder per tenant id) is wiped once
    # per run, before E7, so its records are exactly this run's. Sim storage root only (not six-year retention).
    $eoStore = Join-Path $OUT 'eo\evidence-store'
    if (Test-Path $eoStore) { Remove-Item -Recurse -Force $eoStore }
    $cert = Join-Path $OUT 'stamper.cert.placeholder'; Set-Content $cert ''
    $envFile = Join-Path $OUT 'stamper.synthetic.env'
    $recTid = $null; $recPath = Join-Path $TEN "sim\$Scenario.json"
    if (Test-Path $recPath) { $recTid = (Get-Content $recPath -Raw | ConvertFrom-Json).tenant.tenant_id }
    if (-not $recTid) { $recTid = '00000000-0000-0000-0000-000000000000' }
    @("TENANT_ID=$recTid", 'APP_ID=00000000-0000-0000-0000-000000000001',
      'CERT_THUMBPRINT=0000000000000000000000000000000000000000',
      "CERT_PATH=$($cert.Replace('\', '/'))", "STORAGE_ROOT=$($stStore.Replace('\', '/'))") | Set-Content -Encoding ascii $envFile
    Use-SimEnv; Use-StamperSecret
    # ROLE-1 (founder ruling 2026-10-30): Muster receives no execution results. Stamper runs without CES_MUSTER_API_URL /
    # TOKEN (its ExecutionResultsPublisher has no Muster endpoint); steps.json E6 muster_api_url records it (V100).
    Remove-Item Env:CES_MUSTER_API_URL, Env:CES_MUSTER_API_TOKEN -ErrorAction SilentlyContinue
    $musterApiUrlSet = [bool]$env:CES_MUSTER_API_URL
    # v2 / FX-02: --tenant gives the CLI path the tenant slug (execution context, evidence folder)
    $rc = Invoke-Logged 'E6-execute' 'node' @($stamperCli, 'execute', $exe, '--mode', 'auto', '-e', $envFile, '--tenant', $Scenario) $stCwd "`n"
    Use-BaseEnv
    $rep = Get-ChildItem (Join-Path $stStore 'state') -Recurse -Filter 'execution-report-*.json' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if ($rep) { Copy-Item $rep.FullName (Join-Path $OUT 'execution-report.json') -Force } elseif ($rc -eq 0) { $rc = 1 }
    # FLOW-5 (a): muster-api stays up for E8F's Stamper (secret reference); the finally block stops it.
    Record 'E6' $rc $t @{ overrides = (Get-Content (Join-Path $LOG 'E6-overrides.json') -Raw | ConvertFrom-Json).mode; muster_api_url = $musterApiUrlSet }
    if ($rc -ne 0) { throw 'E6: execute failed or no execution report' }
    # R-UIT3-1: the twin's sim store as E6 left it (before E7A / E8F write), for V73 (c).
    $e6Store = Join-Path $SIM ".stacksim\tenants\$Scenario\store.json"
    if (Test-Path $e6Store) { Copy-Item $e6Store (Join-Path $OUT 'sim-store-e6.json') -Force }
  }

  # ---------- E8.5: start EC and make one catalog-tagged upload (EVC.5 / V27) ----------
  # Runs before E7: EO reads EC items during /api/assess (assess_ec_items) and again when it builds the package.
  if (Want 'E7') {
    # A run's EC items are exactly this run's: the EC store under the pipeline root otherwise accumulates one upload per run
    # (12 after run 16). Harmless under DEC-7, but the bundle and V27 should describe one run.
    if (Test-Path (Join-Path $PL 'EvidenceCollector')) { Remove-Item -Recurse -Force (Join-Path $PL 'EvidenceCollector') }
    Write-Host "  EC reset: $(Clear-EcRows)"
    Use-SimEnv
    $env:EC_PORT = '4001'; $env:EVIDENCE_OPS_SECRET = $EcSecret
    $env:CES_EC_PRINCIPAL_SECRET = $EcPrincipalSecret   # NS-0 / NS-4: EC records the uploader of a signed x-ces-principal
    $env:CES_EVIDENCE_CATALOG_PATH = Join-Path $CES 'ces-muster\src\features\plan\engine\data\evidence-catalog\evidence-catalog-release-0.json'   # FIN-28 B-1: ces-planner retired
    $ecProc = Start-Bg 'E8.5-ec' 'node' @((Join-Path $CES 'node_modules\tsx\dist\cli.mjs'), 'src/index.ts') (Join-Path $CES 'ces-ec')
    Use-BaseEnv
    Remove-Item Env:EC_PORT, Env:EVIDENCE_OPS_SECRET, Env:CES_EVIDENCE_CATALOG_PATH, Env:CES_EC_PRINCIPAL_SECRET -ErrorAction SilentlyContinue
  }
  if (Want 'E8.5') {
    $t = Now
    $rc = 1; $status = $null; $planNote = 'not run'
    if (Wait-Http "$EcUrl/api/health" 'GET' 60) {
      $req = [ordered]@{ tenantSlug = $Scenario; controlIds = @('AC.L1-3.1.1'); source = 'manual_upload'; filename = 'acp.pdf'
        mediaType = 'application/pdf'; contentBase64 = 'JVBERi0xLjQK'; submittedByRole = 'compliance_officer'
        form_id = 'access_control_policy'; emx_ids = @('EMX-IAM-004') }
      $reqJson = $req | ConvertTo-Json -Depth 4
      Set-Content -Encoding utf8 (Join-Path $OUT 'ec-upload-request.json') $reqJson
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$EcUrl/api/ingest" -Body $reqJson -ContentType 'application/json' `
          -Headers @{ Authorization = "Bearer $EcSecret" } -TimeoutSec 60
        $status = [int]$r.StatusCode
        Set-Content -Encoding utf8 (Join-Path $OUT 'ec-upload.json') $r.Content
        if ($status -eq 201) { $rc = 0 }
      } catch {
        $body = ''
        if ($_.Exception.Response) {
          $status = [int]$_.Exception.Response.StatusCode
          $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $body = $sr.ReadToEnd(); $sr.Dispose()
        }
        Set-Content -Encoding utf8 (Join-Path $OUT 'ec-upload.json') (@{ error_status = $status; error = $_.Exception.Message; body = $body } | ConvertTo-Json)
        Write-Host "  E8.5 error: HTTP $status $($_.Exception.Message)"
      }
      # NS-4 (V80): the artifacts and the probe of customers\<slug>\document-reviews.json (build-customer-records.mjs
      # --review-plan checks the file first), each sent with the uploader's signed principal so EC records uploadedBy. The AC
      # item above stays V27's upload (no principal; out\ec-upload.json). Results (EC's sha256 per artifact) go to
      # out\ec-upload-reviews.json for E8.6.
      $planNote = 'none'
      Remove-Item $ReviewPlanFile -Force -ErrorAction SilentlyContinue
      $prc = Invoke-Logged 'E8.5-review-plan' 'node' @((Join-Path $PSScriptRoot 'build-customer-records.mjs'), '--review-plan', '--slug', $Scenario, '--out', $ReviewPlanFile, '--objectives', (Join-Path $CES 'ces-shared\dist\data\assessment-objectives.reference.json')) $OUT
      if ($prc -ne 0) { $rc = 1; $planNote = 'refused'; Write-Host "  E8.5: review plan refused: $((Get-Content (Join-Path $LOG 'E8.5-review-plan.err') -Raw))" }
      elseif (Test-Path $ReviewPlanFile) {
        $plan = Get-Content $ReviewPlanFile -Raw | ConvertFrom-Json
        $upTok = New-PrincipalToken "uploader:$($plan.uploader.upn.ToLower())" $plan.uploader.upn @() $EcPrincipalSecret
        $results = New-Object System.Collections.ArrayList
        foreach ($u in @($plan.uploads)) {
          $res = Invoke-JsonCall 'POST' "$EcUrl/api/ingest" $u.body @{ Authorization = "Bearer $EcSecret"; 'x-ces-principal' = $upTok }
          [void]$results.Add([ordered]@{ id = $u.id; file = $u.file; control_ids = @($u.control_ids); http_status = $res.status; item_id = $res.body.itemId
            sha256 = $res.body.sha256; sha256_match = ($res.body.sha256 -eq $u.sha256); uploaded_by = $res.body.uploadedBy.upn })
        }
        ConvertTo-Json -InputObject @($results) -Depth 5 | Set-Content -Encoding utf8 (Join-Path $OUT 'ec-upload-reviews.json')
        $bad = @($results | Where-Object { $_.http_status -ne 201 -or -not $_.sha256_match -or -not $_.uploaded_by })
        $planNote = "$($results.Count) upload(s), $($bad.Count) failed"
        if ($bad.Count) { $rc = 1; Write-Host "  E8.5 review uploads failed: $(($bad | ForEach-Object { "$($_.id) HTTP $($_.http_status)" }) -join ', ')" }
      }
    } else { Write-Host '  E8.5: EC did not answer /api/health' }
    Record 'E8.5' $rc $t @{ http_status = $status; ec_url = $EcUrl; review_uploads = $planNote }
    if ($rc -ne 0) { throw 'E8.5: EC upload failed' }
  }

  # ---------- E7: EO assessment on the post-Stamper sim ----------
  $eoUrl = 'http://127.0.0.1:4002'
  if (Want 'E7') {
    $t = Now
    Use-SimEnv
    $env:REGISTRY_PATH = Join-Path $CES 'ces-stamper\src\registry\cmmc-l2-commands.registry.json'
    $env:STORAGE_ROOT = Join-Path $OUT 'eo'; $env:TENANT_SLUG = $Scenario; $env:EO_PORT = '4002'
    $env:COMPLIANCE_REPO_PATH = Join-Path $OUT 'eo-repo'
    $env:EC_URL = $EcUrl; $env:EVIDENCE_OPS_SECRET = $EcSecret   # Phase 3: EO reads the E8.5 upload from EC
    # NS-4 (E8.6): EO mints the reviewer's approver token (and verifies it on POST /api/reviews) with CES_AO_PRINCIPAL_SECRET;
    # the harness is a loopback dev operator (CES_EO_OPERATOR_DEV_FALLBACK=1, simulator only).
    $env:CES_AO_PRINCIPAL_SECRET = $AoPrincipalSecret; $env:CES_EO_OPERATOR_SECRET = $EoOperatorSecret; $env:CES_EO_OPERATOR_DEV_FALLBACK = '1'
    # W2 follow-up: EO reads only this run's AdminOps rows (rows from E1's start on). ces.db is append-only and shared across
    # runs; the window is a simulator property (six-year retention is a production one). A -From rerun reuses E1's start.
    $since = if ($Steps['E1']) { [string]$Steps['E1'].started } else { '' }
    if (-not $since) { throw 'E7 needs E1''s start in steps.json for CES_EO_ADMINOPS_SINCE (rerun from E1)' }
    $env:CES_EO_ADMINOPS_SINCE = $since
    # v2 / EVC.4: EO now finds the latest tenant-manifest-<slug>-*.json itself (N-05 retired); TENANT_MANIFEST_PATH is no longer set,
    # so this run proves the discovery path. The pushed TM is $pTM; verify V9/V12 compare against it.
    $eoProc = Start-Bg 'E7-eo' 'node' @((Join-Path $CES 'node_modules\tsx\dist\cli.mjs'), 'src/eo/index.ts') (Join-Path $CES 'ces-eo')
    Use-BaseEnv
    Remove-Item Env:REGISTRY_PATH, Env:STORAGE_ROOT, Env:TENANT_SLUG, Env:EO_PORT, Env:COMPLIANCE_REPO_PATH, Env:TENANT_MANIFEST_PATH, Env:EC_URL, Env:EVIDENCE_OPS_SECRET, Env:CES_EO_ADMINOPS_SINCE -ErrorAction SilentlyContinue
    Remove-Item Env:CES_AO_PRINCIPAL_SECRET, Env:CES_EO_OPERATOR_SECRET, Env:CES_EO_OPERATOR_DEV_FALLBACK -ErrorAction SilentlyContinue
    $rc = 1
    if (Wait-Http "$eoUrl/api/health" 'GET' 120) {
      # ---------- E8.6 (NS-4): document reviews, before the first assess (Invoke-ReviewStep) ----------
      if (Want 'E8.6') { Invoke-ReviewStep $eoUrl }
      $rc = Invoke-Logged 'E7-connect' 'node' @($Helpers, 'sse', '--url', "$eoUrl/api/connect?tenant=$Scenario", '--stop', 'connection_log:done', '--out', (Join-Path $OUT 'eo-connect.json'), '--timeout', '120000') $OUT
      if ($rc -eq 0) {
        $rc = Invoke-Logged 'E7-assess' 'node' @($Helpers, 'sse', '--url', "$eoUrl/api/assess?tenant=$Scenario", '--stop', 'assess_done', '--out', (Join-Path $OUT 'eo-assess.json'), '--timeout', '900000') $OUT
        # v2 / V14 (FX-15): two more back-to-back assessments of the same sim state; verify compares the counts.
        for ($i = 2; $i -le 3 -and $rc -eq 0; $i++) {
          $rc = Invoke-Logged "E7-assess-$i" 'node' @($Helpers, 'sse', '--url', "$eoUrl/api/assess?tenant=$Scenario", '--stop', 'assess_done', '--out', (Join-Path $OUT "eo-assess-$i.json"), '--timeout', '900000') $OUT
        }
      }
    }
    Record 'E7' $rc $t @{ adminops_since = $since }
    if ($rc -ne 0) { throw 'E7: EO connect/assess failed' }
  }

  # ---------- E7B (synthetic-customer W2): one more EO assess, not forced; E8 builds from its snapshot ----------
  # Under -Harness mx no AdminOps step runs before it (E7A is tester-only), so this is a fourth assess of the same sim state.
  if (Want 'E7B') {
    $t = Now
    if (-not $eoProc) { throw 'E7B needs the EO server from E7 (rerun with -From E7)' }
    $rc = Invoke-Logged 'E7B-assess' 'node' @($Helpers, 'sse', '--url', "$eoUrl/api/assess?tenant=$Scenario", '--stop', 'assess_done', '--out', (Join-Path $OUT 'eo-assess-7b.json'), '--timeout', '900000') $OUT
    Record 'E7B' $rc $t
    if ($rc -ne 0) { throw 'E7B: EO assess failed' }
  }

  # ---------- E8: SSP (JSON + DOCX) and POA&M ----------
  if (Want 'E8') {
    $t = Now
    if (-not $eoProc) { throw 'E8 needs the EO server from E7 (rerun with -From E7)' }
    # Synthetic-customer W2: the E7B snapshot (PLAN section 3, E8).
    $aid = ((Get-Content (Join-Path $OUT 'eo-assess-7b.json') -Raw | ConvertFrom-Json) | Where-Object { $_.type -eq 'assess_summary' } | Select-Object -First 1).snapshotId
    $body = @{ tenantSlug = $Scenario; assessmentId = $aid } | ConvertTo-Json
    $rc = 0
    try {
      # V35: the POA&M is generated first so the SSP's section 14 cites the POA&M the bundle ships (one id, not two).
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$eoUrl/api/poam/generate" -Body $body -ContentType 'application/json' -OutFile (Join-Path $OUT 'poam.json') -TimeoutSec 600
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$eoUrl/api/ssp/generate" -Body $body -ContentType 'application/json' -OutFile (Join-Path $OUT 'ssp.json') -TimeoutSec 600
      $sspId = (Get-Content (Join-Path $OUT 'ssp.json') -Raw | ConvertFrom-Json).sspId
      Invoke-WebRequest -UseBasicParsing -Uri "$eoUrl/api/ssp/export/$($sspId)?tenant=$Scenario" -OutFile (Join-Path $OUT 'ssp.docx') -TimeoutSec 600
    } catch { Write-Host "  E8 error: $($_.Exception.Message)"; $rc = 1 }
    # Phase 3: EO's determination ledger (per-control rollup with the EC catalog ids) and its evidence package (V27).
    # Built here, before E8F, so the package holds the normal run's assessment.
    $pkgDir = Join-Path $OUT 'eo-package'
    if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$eoUrl/api/ledger?tenant=$Scenario" -OutFile (Join-Path $OUT 'eo-ledger.json') -TimeoutSec 600
      $pb = @{ tenant = $Scenario } | ConvertTo-Json
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$eoUrl/api/package/build" -Body $pb -ContentType 'application/json' -OutFile (Join-Path $OUT 'eo-package-build.json') -TimeoutSec 600
      $zip = (Get-Content (Join-Path $OUT 'eo-package-build.json') -Raw | ConvertFrom-Json).filePath
      Copy-Item $zip (Join-Path $OUT 'eo-package.zip') -Force
      Expand-Archive -Path (Join-Path $OUT 'eo-package.zip') -DestinationPath $pkgDir -Force
    } catch { Write-Host "  E8 package error: $($_.Exception.Message)"; $rc = 1 }
    Record 'E8' $rc $t @{ assessment_id = $aid; package = (Test-Path (Join-Path $OUT 'eo-package.zip')) }
    # Sim ledger snapshot now, before E8F writes to the sim (V7 reads this one).
    if ($simProc -and -not $simProc.HasExited) { & node $Helpers ledger --out (Join-Path $OUT 'ledger.json') | Out-Host; $ledgerTaken = $true }
  }

  # ---------- E8B: evidence bundle (P3.1): raw + shared copies, manifest, identity scan ----------
  # Before E8F: the forced run reuses the plan's task ids and its execution-results file name.
  if (Want 'E8B') {
    $t = Now
    $rc = Invoke-Logged 'E8B-bundle' 'node' @((Join-Path $PSScriptRoot 'bundle.mjs'), '--root', $Root, '--scenario', $Scenario) $OUT
    Get-Content (Join-Path $LOG 'E8B-bundle.out') | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }
    Record 'E8B' $rc $t   # not fatal here: V25 reports it
  }

  # ---------- E8F: forced-failure run (P3.2, V13) ----------
  if ((Want 'E8F') -and $ForcedRun -and -not $SkipForcedRun) {
    $t = Now
    $FD = Join-Path $OUT 'runs\forced'
    $extra = [ordered]@{ entry = $ForceFailEntry }
    $rc = 1
    if (-not ($eoProc -and $simProc)) { Write-Host '  E8F needs the sim and EO from E7 (rerun with -From E7); out\runs\forced left as it was' }
    else {
      if (Test-Path $FD) { Remove-Item -Recurse -Force $FD }
      New-Item -ItemType Directory -Force (Join-Path $FD 'st') | Out-Null
      $fenv = Join-Path $FD 'stamper.synthetic.env'
      (Get-Content (Join-Path $OUT 'stamper.synthetic.env')) | ForEach-Object {
        if ($_ -like 'STORAGE_ROOT=*') { "STORAGE_ROOT=$((Join-Path $FD 'st').Replace('\', '/'))" } else { $_ }
      } | Set-Content -Encoding ascii $fenv
      Use-SimEnv; Use-StamperSecret
      $xrc = Invoke-Logged 'E8F-execute' 'node' @($stamperCli, 'execute', $exe, '--mode', 'auto', '-e', $fenv, '--tenant', $Scenario, '--force-fail', $ForceFailEntry) $stCwd "`n"
      Use-BaseEnv
      $extra.execute_rc = $xrc   # non-zero is expected when a task fails; the report decides
      $frep = Get-ChildItem (Join-Path $FD 'st\state') -Recurse -Filter 'execution-report-*.json' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
      if ($frep) {
        Copy-Item $frep.FullName (Join-Path $FD 'execution-report.json') -Force
        # W0 drift baseline: forced=1 marks this snapshot forced, so EO never uses it as the next drift baseline.
        $arc = Invoke-Logged 'E8F-assess' 'node' @($Helpers, 'sse', '--url', "$eoUrl/api/assess?tenant=$Scenario&forced=1", '--stop', 'assess_done', '--out', (Join-Path $FD 'eo-assess.json'), '--timeout', '900000') $OUT
        $extra.assess_rc = $arc
        if ($arc -eq 0) {
          try {
            $faid = ((Get-Content (Join-Path $FD 'eo-assess.json') -Raw | ConvertFrom-Json) | Where-Object { $_.type -eq 'assess_summary' } | Select-Object -First 1).snapshotId
            $extra.assessment_id = $faid
            # V78 (PKG-1 gate): a build here is stale. The forced assess saved a newer snapshot and POA&M, while the SSP still
            # records E7B's snapshotId, so EO must refuse it (409). A 200 means the gate is broken: it is recorded, and the zip
            # it wrote is removed so E8's package stays the newest. Placed before the forced ssp/generate, after which a build
            # would match again (LOG-GC-PKG-1-2.md "Harness").
            $stale = Invoke-JsonCall 'POST' "$eoUrl/api/package/build" @{ tenant = $Scenario }
            $extra.stale_build_status = $stale.status
            $extra.stale_build_reason = if ($stale.body -is [string]) { $stale.body } else { [string]$stale.body.error }
            if ($stale.status -eq 200 -and $stale.body.filePath -and (Test-Path ([string]$stale.body.filePath))) { Remove-Item -Force ([string]$stale.body.filePath); $extra.stale_build_zip_removed = $true }
            $fbody = @{ tenantSlug = $Scenario; assessmentId = $faid } | ConvertTo-Json
            Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$eoUrl/api/ssp/generate" -Body $fbody -ContentType 'application/json' -OutFile (Join-Path $FD 'ssp.json') -TimeoutSec 600
            $rc = 0
          } catch { Write-Host "  E8F SSP error: $($_.Exception.Message)" }
        }
      } else { Write-Host '  E8F: no forced execution report' }
      $forcedRan = $true
      ($extra | ConvertTo-Json) | Set-Content -Encoding utf8 (Join-Path $FD 'forced.json')
    }
    Record 'E8F' $rc $t $extra   # not fatal: V13 reports it
  }
  $euReady = Want 'E8F'   # W8-UIT1: the twin ran to its end (a throw above skips EU); -From E9 does not rerun the UI
} finally {
  if ($simProc -and -not $simProc.HasExited) {
    if ($forcedRan) { & node $Helpers ledger --out (Join-Path $OUT 'runs\forced\ledger.json') | Out-Host }
    elseif (-not $ledgerTaken) { & node $Helpers ledger --out (Join-Path $OUT 'ledger.json') | Out-Host }
  }
  Stop-Tree $ecProc; Stop-Tree $eoProc; Stop-Tree $apiProc; Stop-Tree $simProc
  Use-BaseEnv
  if ($euReady) { try { Invoke-UiStep } catch { Write-Host "  EU error: $($_.Exception.Message)" } }   # W8-UIT1 step EU: ports 4390 and 3000 are free again; still inside the V10 window
  Report-Ports
  Snapshot-Outside 'after'
}

# ---------- E9: verify ----------
$t = Now
$env:MX_HARNESS = 'mx'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify.ps1') -Root $Root -Scenario $Scenario
$rc = $LASTEXITCODE
Remove-Item Env:MX_HARNESS -ErrorAction SilentlyContinue
Record 'E9' $rc $t
exit $rc
