$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting Backend (FastAPI)..." -ForegroundColor Cyan
# Run uvicorn from the project root: `backend/http.py` would otherwise shadow
# Python's stdlib `http` module. --reload is disabled because the file watcher
# does not fire on this mounted drive (D:); restart the backend after changes.
$backendJob = Start-Process -FilePath "uvicorn" -ArgumentList "backend.main:app --host 0.0.0.0 --port 8000" `
    -WorkingDirectory $Root -NoNewWindow -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting Dashboard (Vite)..." -ForegroundColor Cyan
$frontendJob = Start-Process -FilePath "npm" -ArgumentList "run dev" `
    -WorkingDirectory (Join-Path $Root "dashboard") -NoNewWindow -PassThru

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Gateway:  http://localhost:8000"        -ForegroundColor Green
Write-Host "  Dashboard: http://localhost:5173"       -ForegroundColor Green
Write-Host "  Docs:     http://localhost:8000/docs"   -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop both services."      -ForegroundColor Yellow

try {
    while ($true) {
        if ($backendJob.HasExited -or $frontendJob.HasExited) {
            Write-Host "A process has exited. Shutting down..." -ForegroundColor Red
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    if (-not $backendJob.HasExited) { Stop-Process -Id $backendJob.Id -Force }
    if (-not $frontendJob.HasExited) { Stop-Process -Id $frontendJob.Id -Force }
    Write-Host "Services stopped." -ForegroundColor Cyan
}
