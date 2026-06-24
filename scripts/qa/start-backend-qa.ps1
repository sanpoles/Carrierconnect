param(
  [string]$DatabaseName = "careerconnect_qa",
  [int]$Port = 4000,
  [string]$FrontendUrl = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if ($DatabaseName -ne "careerconnect_qa") {
  throw "Refusing to start QA backend with DB_NAME=$DatabaseName. Expected careerconnect_qa."
}

$env:DB_NAME = $DatabaseName
$env:PORT = [string]$Port
$env:FRONTEND_URL = $FrontendUrl
$env:NODE_ENV = "test"

Write-Host "Starting CareerConnect backend in QA mode"
Write-Host "DB_NAME=$env:DB_NAME"
Write-Host "PORT=$env:PORT"
Write-Host "FRONTEND_URL=$env:FRONTEND_URL"

Push-Location (Join-Path $repoRoot "backend")
try {
  npm start
}
finally {
  Pop-Location
}
