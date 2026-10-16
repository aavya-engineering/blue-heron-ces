# Blue Heron CES — Unified Platform Startup Script
# Run as: pwsh start-all.ps1   (PowerShell 5.1 or 7+)
#
# Prerequisites:
#   - Docker Desktop must be running (script checks and warns)
#   - Node.js 20+ and npm installed
#   - All repos cloned and npm installed (run: cd ces-mono-main && npm ci)
#   - muster-api built: cd ces-muster-main/muster-api && npm ci
#
# Ports used:
#   5434  PostgreSQL (Docker)
#   4690  ces-tenant auth daemon
#   4390  ces-stacksim mock GCC High
#   4000  muster-api backend
#   5173  Muster SPA (Vite dev server)
#   5002  Stamper remediation GUI
#   5001  Planner GUI (optional)
#   5003  AdminOps GUI (optional)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Blue Heron CES -- Full Platform Orchestrator" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ── Preflight: Docker ─────────────────────────────────────────────────────────
Write-Host "`n[PREFLIGHT] Checking Docker..." -ForegroundColor Yellow
try {
    $dockerStatus = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Docker Desktop is not running. Please start Docker Desktop and re-run this script." -ForegroundColor Red
        exit 1
    }
    Write-Host "  -> Docker is running." -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Cannot reach Docker. Is Docker Desktop installed and running?" -ForegroundColor Red
    exit 1
}

# ── 1. PostgreSQL via Docker ──────────────────────────────────────────────────
Write-Host "`n[1/5] Starting PostgreSQL Container (Port 5434)..." -ForegroundColor Yellow
Set-Location "$root\ces-muster-main"
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: docker compose up failed. Check docker-compose.yml and Docker Desktop." -ForegroundColor Red
    exit 1
}

# Health-check: wait for PostgreSQL to be ready (up to 30 seconds)
$pgReady = $false
$pgAttempts = 0
Write-Host "  Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
while (-not $pgReady -and $pgAttempts -lt 12) {
    Start-Sleep -Seconds 2
    $pgAttempts++
    $check = docker exec muster-postgres pg_isready -U muster_app -d muster_db 2>&1
    if ($LASTEXITCODE -eq 0) {
        $pgReady = $true
    } elseif ($pgAttempts -eq 1) {
        # First attempt: try postgres superuser as fallback
        $check2 = docker exec muster-postgres pg_isready -U postgres -d muster_db 2>&1
        if ($LASTEXITCODE -eq 0) { $pgReady = $true }
    }
}
if (-not $pgReady) {
    Write-Host "  WARNING: PostgreSQL did not become ready in 24 seconds. muster-api may fail to connect." -ForegroundColor Yellow
} else {
    Write-Host "  -> PostgreSQL is UP and healthy on port 5434." -ForegroundColor Green
}

# ── 2. Database migrations ────────────────────────────────────────────────────
Write-Host "`n[MIGRATE] Running Prisma migrations..." -ForegroundColor Yellow
$migrateDir = "$root\ces-muster-main\muster-api"
$env:DATABASE_URL = "postgresql://muster_app:password@localhost:5434/muster_db"
$migrateResult = & cmd /c "cd `"$migrateDir`" && npx.cmd prisma migrate deploy 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Prisma migrate deploy failed. muster-api may error on first run." -ForegroundColor Yellow
    Write-Host "  Run manually: cd ces-muster-main/muster-api && npx prisma migrate deploy" -ForegroundColor Yellow
} else {
    Write-Host "  -> Database schema up to date." -ForegroundColor Green
}

# ── 3. ces-tenant Daemon (:4690) ──────────────────────────────────────────────
Write-Host "`n[2/5] Starting Tenant Auth Daemon (:4690)..." -ForegroundColor Yellow
$tenantDir = "$root\ces-tenant-main"
if (-not (Test-Path "$tenantDir\dist\service\cli.js")) {
    Write-Host "  ces-tenant not built. Building now..." -ForegroundColor Yellow
    & cmd /c "cd `"$tenantDir`" && npm.cmd run build 2>&1"
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$tenantDir'; node dist/service/cli.js serve" -WindowStyle Normal
Write-Host "  -> Tenant Service starting at http://127.0.0.1:4690" -ForegroundColor Green

# ── 4. ces-stacksim Mock Cloud (:4390) ────────────────────────────────────────
Write-Host "`n[3/5] Starting Mock GCC High Simulator (:4390)..." -ForegroundColor Yellow
$simDir = "$root\ces-stacksim-main"
if (-not (Test-Path "$simDir\dist\index.js")) {
    Write-Host "  Stacksim not built. Building now (may take ~30s)..." -ForegroundColor Yellow
    & cmd /c "cd `"$simDir`" && npm.cmd run build 2>&1"
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$simDir'; node bin/stacksim.mjs serve m365_azure --slug aoops-g5 --port 4390" -WindowStyle Normal
Write-Host "  -> Mock GCC High starting at http://127.0.0.1:4390" -ForegroundColor Green

# ── 5. muster-api Backend (:4000) ─────────────────────────────────────────────
Write-Host "`n[4/5] Starting Muster Backend API (:4000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ces-muster-main\muster-api'; npm.cmd run dev" -WindowStyle Normal
Write-Host "  -> Muster API starting at http://localhost:4000" -ForegroundColor Green

# ── 6. Muster SPA + Stamper GUI ───────────────────────────────────────────────
Write-Host "`n[5/5] Starting Muster SPA (:5173) and Stamper GUI (:5002)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ces-muster-main'; npm.cmd run dev" -WindowStyle Normal
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\ces-mono-main'; npm.cmd run stamper" -WindowStyle Normal

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  ALL SERVICES STARTING" -ForegroundColor Green
Write-Host "  Allow 10-15 seconds for all services to be ready" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Muster Web Portal:       http://localhost:5173" -ForegroundColor White
Write-Host "  Muster Backend API:      http://localhost:4000/auth/me" -ForegroundColor White
Write-Host "  Stamper Remediation GUI: http://localhost:5002" -ForegroundColor White
Write-Host "  Tenant Auth Daemon:      http://127.0.0.1:4690/status" -ForegroundColor White
Write-Host "  Mock M365 GCC High:      http://127.0.0.1:4390" -ForegroundColor White
Write-Host "  PostgreSQL (Docker):     localhost:5434 (db: muster_db)" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "`n  Optional GUIs (run separately from ces-mono-main/):" -ForegroundColor Gray
Write-Host "    Planner:  npm run planner  -> http://localhost:5001" -ForegroundColor Gray
Write-Host "    AdminOps: npm run ao       -> http://localhost:5003" -ForegroundColor Gray
Write-Host "    EvidOps:  npm run eo       -> http://localhost:5004" -ForegroundColor Gray
Write-Host ""
