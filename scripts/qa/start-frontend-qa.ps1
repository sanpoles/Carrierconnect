param(
  [int]$Port = 5173,
  [string]$RealtimeServerUrl = "http://localhost:4000"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

$env:VITE_REALTIME_SERVER_URL = $RealtimeServerUrl

Write-Host "Starting CareerConnect frontend for QA"
Write-Host "Frontend URL=http://localhost:$Port"
Write-Host "Realtime URL=$env:VITE_REALTIME_SERVER_URL"

Push-Location $repoRoot
try {
  npm run dev -- --host localhost --port $Port
}
finally {
  Pop-Location
}
