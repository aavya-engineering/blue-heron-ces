# Blue Heron CES — Stop Docker Stack
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Stopping Blue Heron CES Docker containers..." -ForegroundColor Yellow
docker compose down
Write-Host "-> Stack stopped." -ForegroundColor Green
