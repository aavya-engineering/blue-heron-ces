# Blue Heron CES - Unified Platform Shutdown Script
# Run this script to stop all background Node servers and Docker containers

$root = $PSScriptRoot

Write-Host "Stopping Docker PostgreSQL container..." -ForegroundColor Yellow
Set-Location "$root\ces-muster-main"
docker compose down

Write-Host "Stopping Node processes on platform ports..." -ForegroundColor Yellow
$ports = @(4000, 4390, 4690, 5002, 5173)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $procId = $conn.OwningProcess
            if ($procId -gt 0) {
                Write-Host "  -> Terminating process $procId on port $port" -ForegroundColor Red
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "`nAll Blue Heron CES services stopped." -ForegroundColor Green
