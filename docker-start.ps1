# Blue Heron CES — Docker Stack Launch Script
# Run as: pwsh docker-start.ps1   (or .\docker-start.ps1)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Blue Heron CES -- Docker Deployment Launcher" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Preflight: Check Docker
Write-Host "`n[PREFLIGHT] Checking Docker daemon..." -ForegroundColor Yellow
try {
    $dockerCheck = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Docker is not running." -ForegroundColor Red
        Write-Host "  Please start Docker Desktop and run this script again." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  -> Docker daemon is running." -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Docker command failed. Is Docker installed and in your PATH?" -ForegroundColor Red
    exit 1
}

# Ensure .env exists
if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Host "  Creating .env from .env.example..." -ForegroundColor Yellow
    Copy-Item "$PSScriptRoot\.env.example" "$PSScriptRoot\.env"
}

# Launch stack
Write-Host "`n[DOCKER] Building and starting all containers..." -ForegroundColor Yellow
Set-Location $PSScriptRoot
docker compose up --build -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n  ERROR: docker compose up failed. Inspect errors above." -ForegroundColor Red
    exit 1
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  ALL CES SERVICES RUNNING IN DOCKER" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Muster Web Portal (HTTPS): https://127.0.0.1.sslip.io" -ForegroundColor Green
Write-Host "  Muster Web Portal (HTTP):  http://localhost:5173" -ForegroundColor White
Write-Host "  Alternative HTTP Web:      http://localhost:8080" -ForegroundColor White
Write-Host "  Muster Backend API:        http://localhost:4000/auth/me" -ForegroundColor White
Write-Host "  Tenant Auth Daemon:        http://localhost:4690/status" -ForegroundColor White
Write-Host "  Mock GCC High Cloud:       http://localhost:4390" -ForegroundColor White
Write-Host "  PostgreSQL Database:       localhost:5434 (db: muster_db)" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Note: Open https://127.0.0.1.sslip.io in your browser" -ForegroundColor Yellow
Write-Host "        (accept self-signed cert on first visit)" -ForegroundColor Yellow
Write-Host "  To view logs:    docker compose logs -f" -ForegroundColor Gray
Write-Host "  To stop stack:   docker compose down" -ForegroundColor Gray
Write-Host "  With Stamper:    docker compose --profile full up -d" -ForegroundColor Gray
Write-Host ""
