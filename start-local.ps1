# Start all CES modules locally on Windows
param(
  [string]$Root = "C:\ces-nb",
  [string]$Scenario = "s1-mach"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$CES = Join-Path $Root "ces"
$Out = Join-Path $Root "out\local"
$Logs = Join-Path $Out "logs"
$Data = Join-Path $Out "data"
New-Item -ItemType Directory -Force $Logs, $Data | Out-Null

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting CES Local Stack ($Scenario) at $Root" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Free ports
. (Join-Path $PSScriptRoot "stop-local.ps1")

# 2. Clear stale stacksim locks (including hidden .stacksim folders)
Get-ChildItem -Path (Join-Path $CES "tenant-stacksim") -Filter "*.lock" -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# Helper function to start background service
function Start-ServiceProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )
  
  Write-Host "Starting $Name..." -NoNewline
  $stdout = Join-Path $Logs "$Name.out"
  $stderr = Join-Path $Logs "$Name.err"
  
  # Set environment in current context for process creation
  $savedEnv = @{}
  foreach ($k in $Environment.Keys) {
    $savedEnv[$k] = [Environment]::GetEnvironmentVariable($k, "Process")
    [Environment]::SetEnvironmentVariable($k, $Environment[$k], "Process")
  }
  
  try {
    $p = Start-Process -FilePath $FilePath -ArgumentList ($ArgumentList -join " ") `
      -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Write-Host " [PID $($p.Id)]" -ForegroundColor Green
    return $p
  } finally {
    foreach ($k in $savedEnv.Keys) {
      [Environment]::SetEnvironmentVariable($k, $savedEnv[$k], "Process")
    }
  }
}

# 3. Seed simulator scenario if not already seeded
$scenarioDir = Join-Path $CES "tenant-stacksim\.stacksim\tenants\$Scenario"
if (-not (Test-Path $scenarioDir)) {
  Write-Host "Seeding simulator scenario $Scenario..." -ForegroundColor Yellow
  Push-Location (Join-Path $CES "tenant-stacksim")
  try {
    & node bin/stacksim.mjs scenario $Scenario
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Simulator scenario $Scenario is already seeded." -ForegroundColor Green
}

# 4. Start Stacksim (port 4390)
Start-ServiceProcess -Name "stacksim" -FilePath "node" `
  -ArgumentList @("bin/stacksim.mjs", "serve", "m365_azure", "--slug", $Scenario, "--port", "4390") `
  -WorkingDirectory (Join-Path $CES "tenant-stacksim")

# 5. Start Muster API (port 4000)
Start-ServiceProcess -Name "muster-api" -FilePath "node" `
  -ArgumentList @("dist/server.js") `
  -WorkingDirectory (Join-Path $CES "ces-muster\muster-api") `
  -Environment @{ PORT = "4000"; JWT_SECRET = "ces_dev_super_secret_jwt_key_2026" }

# 6. Start Evidence Collector (port 4001)
Start-ServiceProcess -Name "ces-ec" -FilePath "node" `
  -ArgumentList @("dist/index.js") `
  -WorkingDirectory (Join-Path $CES "ces-ec") `
  -Environment @{
    EC_PORT = "4001";
    EC_HOST = "0.0.0.0";
    EVIDENCE_OPS_SECRET = "eo-dev-token";
    CES_EC_PRINCIPAL_SECRET = "ec-dev-token";
    CES_EVIDENCE_CATALOG_PATH = (Join-Path $CES "ces-muster\src\features\plan\engine\data\evidence-catalog\evidence-catalog-release-0.json")
  }

# 7. Start Stamper GUI (port 5002)
Start-ServiceProcess -Name "ces-stamper" -FilePath "node" `
  -ArgumentList @("dist/cli/index.js", "gui", "--port", "5002", "--stacksim") `
  -WorkingDirectory (Join-Path $CES "ces-stamper") `
  -Environment @{
    CES_STAMPER_AUTH_TOKEN = "stamper-dev-token";
    CES_NO_OPEN = "1";
    CES_PIPELINE_ROOT = $Data
  }

# 8. Start AdminOps (port 5003)
Start-ServiceProcess -Name "ces-ao" -FilePath "node" `
  -ArgumentList @("dist/cli/index.js", "gui", "--port", "5003") `
  -WorkingDirectory (Join-Path $CES "ces-ao") `
  -Environment @{
    CES_AO_AUTH_TOKEN = "ao-dev-token";
    CES_NO_OPEN = "1";
    CES_AO_BIND = "0.0.0.0";
    CES_PIPELINE_ROOT = $Data
  }

# 9. Start EvidenceOps (port 5004)
Start-ServiceProcess -Name "ces-eo" -FilePath "node" `
  -ArgumentList @("dist/eo/index.js") `
  -WorkingDirectory (Join-Path $CES "ces-eo") `
  -Environment @{
    EO_PORT = "5004";
    CES_EO_BIND = "0.0.0.0";
    REGISTRY_PATH = (Join-Path $CES "ces-stamper\src\registry\cmmc-l2-commands.registry.json");
    STORAGE_ROOT = $Data;
    TENANT_SLUG = $Scenario;
    CES_EO_AUTH_TOKEN = "eo-dev-token";
    CES_EO_OPERATOR_DEV_FALLBACK = "1"
  }

# 10. Start Muster Web UI (port 5173)
Start-ServiceProcess -Name "ces-muster-ui" -FilePath "node" `
  -ArgumentList @("node_modules\vite\bin\vite.js", "preview", "--port", "5173", "--host", "0.0.0.0") `
  -WorkingDirectory (Join-Path $CES "ces-muster")

# 11. Wait for services to be ready
Write-Host "`nWaiting for services to become healthy..." -ForegroundColor Yellow
$portsToCheck = @(
  @{ name = "Tenant Stacksim"; port = 4390; url = "http://localhost:4390/" },
  @{ name = "Muster API"; port = 4000; url = "http://localhost:4000/" },
  @{ name = "Evidence Collector"; port = 4001; url = "http://localhost:4001/api/health" },
  @{ name = "Stamper GUI"; port = 5002; url = "http://localhost:5002/" },
  @{ name = "AdminOps GUI"; port = 5003; url = "http://localhost:5003/api/health" },
  @{ name = "EvidenceOps GUI"; port = 5004; url = "http://localhost:5004/api/health" },
  @{ name = "Muster Web UI"; port = 5173; url = "http://localhost:5173/" }
)

Start-Sleep -Seconds 3

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " CES Local Services are Ready!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Muster Web UI:        http://localhost:5173/" -ForegroundColor Cyan
Write-Host "  Stamper GUI:          http://localhost:5002/" -ForegroundColor Cyan
Write-Host "  AdminOps (AO):        http://localhost:5003/" -ForegroundColor Cyan
Write-Host "  EvidenceOps (EO):     http://localhost:5004/" -ForegroundColor Cyan
Write-Host "  Tenant Stacksim:      http://localhost:4390/" -ForegroundColor Cyan
Write-Host "  Muster API:           http://localhost:4000/" -ForegroundColor Cyan
Write-Host "  Evidence Collector:   http://localhost:4001/" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Run .\stop-local.ps1 anytime to stop all services." -ForegroundColor Gray

# Keep script running to maintain daemon child processes
while ($true) {
  Start-Sleep -Seconds 60
}
