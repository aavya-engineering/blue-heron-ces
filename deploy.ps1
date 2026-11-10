param (
    [string]$KeyPath = "id_ed25519",
    [string]$RemoteHost = "136.108.118.191",
    [string]$RemoteUser = "neele",
    [string]$RemoteDir = "/home/neele/project/CES"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Deploying CES Stack to ${RemoteUser}@${RemoteHost}" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Determine SSH / SCP arguments
$SshKeyOpt = @()
$ScpKeyOpt = @()
if (Test-Path $KeyPath) {
    $SshKeyOpt = @("-i", (Resolve-Path $KeyPath).Path)
    $ScpKeyOpt = @("-i", (Resolve-Path $KeyPath).Path)
} elseif (Test-Path "$HOME\.ssh\$KeyPath") {
    $SshKeyOpt = @("-i", "$HOME\.ssh\$KeyPath")
    $ScpKeyOpt = @("-i", "$HOME\.ssh\$KeyPath")
} elseif (Test-Path "$HOME\.ssh\id_ed25519") {
    $SshKeyOpt = @("-i", "$HOME\.ssh\id_ed25519")
    $ScpKeyOpt = @("-i", "$HOME\.ssh\id_ed25519")
}

$CommonSshArgs = @("-n", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no")
$CommonScpArgs = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no")

# 1. Test SSH
Write-Host "==> 1. Testing SSH connectivity..." -ForegroundColor Yellow
& ssh @CommonSshArgs @SshKeyOpt "${RemoteUser}@${RemoteHost}" "echo 'SSH connection successful. Server hostname: ' \$(hostname)"

# 2. Stop old containers (down old CES containers to free ports 80 & 443)
Write-Host "==> 2. Stopping and taking down existing containers on remote server..." -ForegroundColor Yellow
& ssh @CommonSshArgs @SshKeyOpt "${RemoteUser}@${RemoteHost}" "docker rm -f ces-nginx-ssl ces-web ces-api ces-db ces-nginx ces-app 2>/dev/null || true"

# 3. Create remote directory
Write-Host "==> 3. Ensuring remote directory exists..." -ForegroundColor Yellow
& ssh @CommonSshArgs @SshKeyOpt "${RemoteUser}@${RemoteHost}" "mkdir -p ${RemoteDir}"

# 4. Prepare archive to upload
Write-Host "==> 4. Preparing application archive to upload..." -ForegroundColor Yellow
$ArchiveFile = "$env:TEMP\ces-deploy.tar.gz"
if (Test-Path $ArchiveFile) { Remove-Item $ArchiveFile -Force }

tar -czf $ArchiveFile --exclude="node_modules" --exclude="*/node_modules" --exclude="*node_modules*" --exclude="out" --exclude="*/out" --exclude=".git" --exclude="*.log" --exclude="dist" --exclude="*/dist" --exclude=".stacksim" *

Write-Host "==> 5. Uploading archive to remote server..." -ForegroundColor Yellow
& scp @CommonScpArgs @ScpKeyOpt $ArchiveFile "${RemoteUser}@${RemoteHost}:${RemoteDir}/ces-deploy.tar.gz"
Remove-Item $ArchiveFile -Force

# 6. Extract, build and launch containers
Write-Host "==> 6. Extracting, building and launching Docker containers on remote server..." -ForegroundColor Yellow
& ssh @CommonSshArgs @SshKeyOpt "${RemoteUser}@${RemoteHost}" "cd ${RemoteDir} && tar -xzf ces-deploy.tar.gz && rm -f ces-deploy.tar.gz && docker compose build && docker compose up -d && docker compose ps"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  CES Stack Successfully Deployed with Nginx Proxy!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Domain Access (HTTP & HTTPS via 136.108.118.191.sslip.io):" -ForegroundColor Cyan
Write-Host " - Portal Dashboard:   https://136.108.118.191.sslip.io/"
Write-Host " - Muster Web UI:      https://muster.136.108.118.191.sslip.io/   (or /muster/)"
Write-Host " - Stamper GUI:        https://stamper.136.108.118.191.sslip.io/  (or /stamper/)"
Write-Host " - AdminOps GUI:       https://ao.136.108.118.191.sslip.io/       (or /ao/)"
Write-Host " - EvidenceOps GUI:    https://eo.136.108.118.191.sslip.io/       (or /eo/)"
Write-Host " - Tenant Simulator:   https://sim.136.108.118.191.sslip.io/      (or /stacksim/)"
Write-Host " - Evidence Collector: https://ec.136.108.118.191.sslip.io/       (or /ec/)"
Write-Host " - Muster REST API:    https://api.136.108.118.191.sslip.io/      (or /muster-api/)"
Write-Host "==========================================================" -ForegroundColor Green
