# Stop any running CES processes on kit ports
param(
  [switch]$Force
)

$ports = @(4390, 4000, 4001, 5173, 5002, 5003, 5004, 4690, 3000)
Write-Host "Stopping CES processes on ports: $($ports -join ', ')..." -ForegroundColor Yellow

$stopped = 0
foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $pidToKill = $c.OwningProcess
    if ($pidToKill -gt 0) {
      try {
        Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped process PID $pidToKill listening on port $port" -ForegroundColor Green
        $stopped++
      } catch {}
    }
  }
}

if ($stopped -eq 0) {
  Write-Host "No active CES processes were found listening on kit ports." -ForegroundColor Gray
} else {
  Write-Host "Successfully stopped $stopped process(es)." -ForegroundColor Green
}

