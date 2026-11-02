# CES handoff smoke check (Blue Heron Defense, CES team). Windows PowerShell 5.1.
#   powershell -NoProfile -ExecutionPolicy Bypass -File handoff\verify\smoke.ps1 -Root C:\ces-nb [-Scenario s1-mach] [-Seconds 120] [-PortOffset 0]
# Run after bootstrap.ps1. For every manifest component that lists ports, it starts the server from the built
# workspace at <Root>\ces, waits until every listed port accepts a connection and answers HTTP, checks the
# listening address against the manifest's `bind`, then stops the server. The simulator (tenant-stacksim) starts
# first and stays up while the others are probed one at a time (AO and the Stamper GUI share port 3000).
# Isolation: CES_PIPELINE_ROOT and CES_TENANT_ROOT point under <Root>\out\smoke; every token or secret a server
# needs is a fresh random value held in this process's environment only (never written to a file or a log).
# Safety: it refuses to start while any target port is held, and it only ever stops processes it started.
# Exit: 0 all servers pass; 1 a server failed; 2 refused (port held, manifest problem, workspace not built).
# Output: <Root>\out\smoke\smoke.json and <Root>\out\smoke\logs\<component>.out|.err.
# -PortOffset <n> (FIX-KIT, clean-room finding CR-10; parse-checked, not yet run): adds n to every manifest port, so the
#   smoke test can run beside another CES instance on the same machine (for example -PortOffset 20000).
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Manifest = '',
  [string]$Scenario = 's1-mach',
  [int]$Seconds = 120,
  [int]$PortOffset = 0
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside an advanced script's param defaults, so defaults that need it are set here (H1).
if (-not $Manifest) { $Manifest = Join-Path (Split-Path -Parent $PSScriptRoot) 'handoff.manifest.yaml' }
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\HandoffManifest.ps1')
$Kit = Split-Path -Parent $PSScriptRoot
$Pkg = Get-HandoffPackageDir $Kit   # <pkg> in the module repos; <monorepo>\pkg\ces-muster-run in the contractor monorepo
$Root = (Resolve-Path $Root).Path
$CES = Join-Path $Root 'ces'
$SMK = Join-Path $Root 'out\smoke'
$LOG = Join-Path $SMK 'logs'
New-Item -ItemType Directory -Force $LOG, (Join-Path $SMK 'pl'), (Join-Path $SMK 'tenants'), (Join-Path $SMK 'eo'), (Join-Path $SMK 'eo-repo') | Out-Null
function Rand { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
$Tsx = Join-Path $CES 'node_modules\tsx\dist\cli.mjs'

# Start recipes, keyed by "<repo>/<path>" (the filesystem location, not the component id). The manifest has no start
# command field, so they live here; they match how scripts\mx-e2e.ps1 starts each server. Port comes from the
# manifest: every ports[] entry with a configKey is set in the environment; recipes that take --port use ports[0].
$Recipes = [ordered]@{
  'tenant-stacksim/.' = @{ first = $true; probe = 'POST /ledger'
    start = { param($c, $port) @{ exe = 'node'; args = @('bin/stacksim.mjs', 'serve', 'm365_azure', '--slug', $Scenario, '--port', "$port"); cwd = (Join-Path $CES 'tenant-stacksim'); env = @{} } } }
  'ces-muster/muster-api' = @{ probe = 'GET /'
    start = { param($c, $port) @{ exe = 'node'; args = @('dist/server.js'); cwd = (Join-Path $CES 'ces-muster\muster-api'); env = @{ PORT = "$port"; JWT_SECRET = (Rand) } } } }
  'ces-muster/.' = @{ probe = 'GET /'
    start = { param($c, $port) $h = if ($c.ports[0].bind) { [string]$c.ports[0].bind } else { '127.0.0.1' }
      @{ exe = 'node'; args = @((Join-Path $CES 'ces-muster\node_modules\vite\bin\vite.js'), '--port', "$port", '--strictPort', '--host', $h); cwd = (Join-Path $CES 'ces-muster'); env = @{} } } }
  'ces-mono/ces-eo' = @{ probe = 'GET /api/health'
    start = { param($c, $port) @{ exe = 'node'; args = @($Tsx, 'src/eo/index.ts'); cwd = (Join-Path $CES 'ces-eo')
        env = @{ EO_PORT = "$port"; REGISTRY_PATH = (Join-Path $CES 'ces-stamper\src\registry\cmmc-l2-commands.registry.json')
          STORAGE_ROOT = (Join-Path $SMK 'eo'); TENANT_SLUG = $Scenario; COMPLIANCE_REPO_PATH = (Join-Path $SMK 'eo-repo'); CES_EO_AUTH_TOKEN = (Rand) } } } }
  'ces-mono/ces-ec' = @{ probe = 'GET /api/health'
    start = { param($c, $port) @{ exe = 'node'; args = @($Tsx, 'src/index.ts'); cwd = (Join-Path $CES 'ces-ec')
        env = @{ EC_PORT = "$port"; EVIDENCE_OPS_SECRET = (Rand); CES_EC_PRINCIPAL_SECRET = (Rand)
          CES_EVIDENCE_CATALOG_PATH = (Join-Path $CES 'ces-muster\src\features\plan\engine\data\evidence-catalog\evidence-catalog-release-0.json') } } } }
  'ces-mono/ces-ao' = @{ probe = 'GET /api/health'
    start = { param($c, $port) @{ exe = 'node'; args = @((Join-Path $CES 'ces-ao\dist\cli\index.js'), 'gui', '--port', "$port"); cwd = (Join-Path $CES 'ces-ao'); env = @{ CES_AO_AUTH_TOKEN = (Rand); CES_NO_OPEN = '1' } } } }
  'ces-mono/ces-stamper' = @{ probe = 'GET /'
    start = { param($c, $port) @{ exe = 'node'; args = @((Join-Path $CES 'ces-stamper\dist\cli\index.js'), 'gui', '--port', "$port"); cwd = (Join-Path $CES 'ces-stamper'); env = @{ CES_STAMPER_AUTH_TOKEN = (Rand); CES_NO_OPEN = '1' } } } }
  'ces-tenant/.' = @{ probe = 'GET /'
    start = { param($c, $port) @{ exe = 'node'; args = @('dist/service/cli.js', 'serve', '--port', "$port"); cwd = (Join-Path $CES 'ces-tenant'); env = @{} } } }
}
# EC listens on every interface by default since PH-7 (EC_HOST unset or 'all'); the manifest's bind for EC is passed as
# EC_HOST so the listening address is checked against it.
$BindKeys = @{ 'ces-mono/ces-ec' = 'EC_HOST'; 'ces-mono/ces-eo' = 'CES_EO_BIND' }

function Quote([string]$a) { if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a } }
function Get-Holders([int[]]$Ports) {
  $held = @()
  foreach ($p in $Ports) {
    foreach ($id in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)) {
      if ($id -gt 0) { $held += [pscustomobject]@{ port = $p; pid = $id } }
    }
  }
  return $held
}
# The loopback address that accepts a connection on the port: 127.0.0.1, else ::1 (a server bound to "localhost" can
# listen on IPv6 only). Returns the URL host ('127.0.0.1' or '[::1]'), or $null.
function Get-TcpHost([int]$Port) {
  foreach ($a in @(@{ ip = '127.0.0.1'; url = '127.0.0.1'; fam = 'InterNetwork' }, @{ ip = '::1'; url = '[::1]'; fam = 'InterNetworkV6' })) {
    $cl = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::($a.fam))
    try {
      $ar = $cl.BeginConnect([System.Net.IPAddress]::Parse($a.ip), $Port, $null, $null)
      if ($ar.AsyncWaitHandle.WaitOne(1000)) { $cl.EndConnect($ar); return $a.url }
    } catch { } finally { $cl.Close() }
  }
  return $null
}
# Any HTTP answer counts (401 included: tokens gate access). Returns the status code, or $null.
function Get-HttpStatus([string]$HostPart, [int]$Port, [string]$Probe) {
  $method, $path = $Probe -split ' ', 2
  $url = "http://${HostPart}:$Port$path"
  try {
    if ($method -eq 'POST') { $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -Body '{}' -ContentType 'application/json' -TimeoutSec 5 }
    else { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 }
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return $null
  }
}
function Test-Bind([int]$Port, [string]$Bind) {
  $addrs = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress -Unique)
  $ok = switch ($Bind) {
    '' { $true }
    '0.0.0.0' { [bool](@($addrs | Where-Object { $_ -eq '0.0.0.0' -or $_ -eq '::' }).Count) }
    '127.0.0.1' { [bool](@($addrs | Where-Object { $_ -eq '127.0.0.1' -or $_ -eq '::1' }).Count) }
    'localhost' { [bool](@($addrs | Where-Object { $_ -eq '127.0.0.1' -or $_ -eq '::1' }).Count) }
    default { $addrs -contains $Bind }
  }
  return @{ ok = [bool]$ok; listening = ($addrs -join ',') }
}
function Start-Server([string]$Name, $Spec) {
  $saved = @{}
  foreach ($k in $Spec.env.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, [string]$Spec.env[$k], 'Process') }
  try {
    $p = Start-Process -FilePath $Spec.exe -ArgumentList (($Spec.args | ForEach-Object { Quote $_ }) -join ' ') -WorkingDirectory $Spec.cwd `
      -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $LOG "$Name.out") -RedirectStandardError (Join-Path $LOG "$Name.err")
    $null = $p.Handle
    return $p
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
  }
}
function Stop-Own($p) { if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null } }

$result = [ordered]@{ schema = 'handoff/smoke@1'; taken = (Get-Date).ToUniversalTime().ToString('o'); root = $Root; scenario = $Scenario; pass = $false; servers = @() }
function Save { $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $SMK 'smoke.json') }

try { $M = Read-HandoffManifest -Path $Manifest } catch { Write-Host "REFUSE $($_.Exception.Message)"; exit 2 }
$targets = @($M.components | Where-Object { $_ -and @($_.ports | Where-Object { $null -ne $_ }).Count -gt 0 })
if ($targets.Count -eq 0) { Write-Host 'REFUSE the manifest lists no ports; nothing to smoke-test'; exit 2 }
if ($PortOffset -ne 0) {
  foreach ($pe in @($targets | ForEach-Object { $_.ports } | Where-Object { $null -ne $_ })) { $pe.port = [int]$pe.port + $PortOffset }
  Write-Host "     ports shifted by $PortOffset (-PortOffset)"
}
if (-not (Test-Path (Join-Path $CES 'node_modules'))) { Write-Host "REFUSE $CES is not built; run bootstrap.ps1 first"; exit 2 }
$allPorts = @($targets | ForEach-Object { $_.ports } | Where-Object { $null -ne $_ } | ForEach-Object { [int]$_.port } | Sort-Object -Unique)
$held = @(Get-Holders $allPorts)
if ($held.Count) {
  foreach ($h in $held) { Write-Host "REFUSE port $($h.port) is held by pid $($h.pid); this script never kills processes" }
  Write-Host 'Stop that process yourself (another build or a proof round may own it), then rerun.'
  exit 2
}

# Common environment for every server this script starts (restored at the end).
$envKeys = @('CES_PIPELINE_ROOT', 'CES_TENANT_ROOT', 'STACKSIM_ROOT', 'STAMPER_REGISTRY_ROOT', 'STACKSIM_SERVER_URL')
$envSaved = @{}; foreach ($k in $envKeys) { $envSaved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
$env:CES_PIPELINE_ROOT = Join-Path $SMK 'pl'
$env:CES_TENANT_ROOT = Join-Path $SMK 'tenants'
$env:STACKSIM_ROOT = Join-Path $CES 'tenant-stacksim'
$env:STAMPER_REGISTRY_ROOT = Join-Path $CES 'ces-stamper\src\registry'

$keyOf = { param($c) $p = [string]$c.path; if ($p -eq '') { $p = '.' }; "$($c.repo)/$($p -replace '\\', '/')" }
$ordered = @($targets | Sort-Object { if ($Recipes[(& $keyOf $_)] -and $Recipes[(& $keyOf $_)].first) { 0 } else { 1 } })
$simProc = $null
try {
  foreach ($c in $ordered) {
    $id = [string]$c.id; $key = & $keyOf $c
    $ports = @($c.ports | Where-Object { $null -ne $_ })
    $row = [ordered]@{ id = $id; key = $key; ports = @(); pass = $false; note = $null; seconds = $null }
    $result.servers += $row
    $rec = $Recipes[$key]
    if (-not $rec) { $row.note = "no start recipe for '$key' in verify\smoke.ps1"; Write-Host "FAIL $id : $($row.note)"; Save; continue }
    $spec = & $rec.start $c ([int]$ports[0].port)
    # configKey is an environment variable name (EO_PORT) or a flag ("--port"); only names go into the environment.
    foreach ($pe in $ports) { if ([string]$pe.configKey -match '^[A-Za-z_][A-Za-z0-9_]*$') { $spec.env[[string]$pe.configKey] = [string]$pe.port } }
    if ($BindKeys[$key] -and $ports[0].bind) { $spec.env[$BindKeys[$key]] = [string]$ports[0].bind }
    if ($key -eq 'tenant-stacksim/.') {
      # seed the scenario before serving it (same as mx-e2e E1)
      $seed = Start-Process -FilePath 'node' -ArgumentList "bin/stacksim.mjs scenario $Scenario" -WorkingDirectory $spec.cwd -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $LOG "$id-scenario.out") -RedirectStandardError (Join-Path $LOG "$id-scenario.err")
      $null = $seed.Handle; $seed.WaitForExit()
      if ($seed.ExitCode -ne 0) { $row.note = "stacksim scenario $Scenario failed (exit $($seed.ExitCode)); see logs\$id-scenario.err"; Write-Host "FAIL $id : $($row.note)"; Save; continue }
    }
    $t0 = Get-Date
    $proc = Start-Server $id $spec
    $pending = @($ports | ForEach-Object { [int]$_.port })
    $answers = @{}
    while ($pending.Count -and ((Get-Date) - $t0).TotalSeconds -lt $Seconds -and -not $proc.HasExited) {
      foreach ($pp in @($pending)) {
        $hp = Get-TcpHost $pp
        if ($hp) { $st = Get-HttpStatus $hp $pp $rec.probe; if ($null -ne $st) { $answers[$pp] = $st; $pending = @($pending | Where-Object { $_ -ne $pp }) } }
      }
      if ($pending.Count) { Start-Sleep -Milliseconds 750 }
    }
    $row.seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $allOk = $true
    foreach ($pe in $ports) {
      $pn = [int]$pe.port
      $b = Test-Bind $pn ([string]$pe.bind)
      $pr = [ordered]@{ port = $pn; service = $pe.service; http = $answers[$pn]; bind_want = $pe.bind; listening = $b.listening; bind_ok = $b.ok }
      $row.ports += $pr
      if ($null -eq $answers[$pn] -or -not $b.ok) { $allOk = $false }
    }
    if ($proc.HasExited) { $allOk = $false; $row.note = "exited early (code $($proc.ExitCode)); see logs\$id.err" }
    elseif (-not $allOk -and -not $row.note) { $row.note = "not answering or wrong bind after $($row.seconds) s; see logs\$id.out|.err" }
    $row.pass = $allOk
    $tag = if ($allOk) { 'OK  ' } else { 'FAIL' }
    Write-Host "$tag $id ($(($row.ports | ForEach-Object { "$($_.port) http=$($_.http) bind=$($_.listening)" }) -join '; '))$(if ($row.note) { " - $($row.note)" })"
    if ($key -eq 'tenant-stacksim/.' -and $allOk) { $simProc = $proc; $env:STACKSIM_SERVER_URL = "http://127.0.0.1:$($ports[0].port)" }
    else { Stop-Own $proc }
    Save
  }
} finally {
  Stop-Own $simProc
  foreach ($k in $envKeys) { [Environment]::SetEnvironmentVariable($k, $envSaved[$k], 'Process') }
}
$result.pass = (@($result.servers | Where-Object { -not $_.pass }).Count -eq 0)
Save
foreach ($h in @(Get-Holders $allPorts)) { Write-Host "WARN port $($h.port) still held by pid $($h.pid) after the smoke run (not killed)" }
if ($result.pass) { Write-Host "SMOKE PASS ($(@($result.servers).Count) servers). Next: verify\acceptance.ps1 -Root $Root"; exit 0 }
Write-Host "SMOKE FAIL: see $SMK\smoke.json and $LOG"
exit 1
