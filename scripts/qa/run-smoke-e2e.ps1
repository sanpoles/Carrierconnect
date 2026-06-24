param(
  [string]$FrontendUrl = "http://localhost:5173",
  [string]$BackendUrl = "http://localhost:4000",
  [string]$DatabaseName = "careerconnect_qa",
  [string]$HostName = "localhost",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [int]$Workers = 1,
  [switch]$SkipDatabaseCheck
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if ($DatabaseName -ne "careerconnect_qa") {
  throw "Refusing to run E2E against DB_NAME=$DatabaseName. Expected careerconnect_qa."
}

function Test-HttpEndpoint($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  }
  catch {
    return $false
  }
}

if (-not (Test-HttpEndpoint "$BackendUrl/api/health")) {
  throw "Backend is not reachable at $BackendUrl. Start it with scripts\qa\start-backend-qa.ps1."
}

if (-not (Test-HttpEndpoint $FrontendUrl)) {
  throw "Frontend is not reachable at $FrontendUrl. Start it with scripts\qa\start-frontend-qa.ps1."
}

if (-not $SkipDatabaseCheck) {
  $requiredAccounts = @(
    "qa.user@careerconnect.test",
    "qa.counsellor@careerconnect.test",
    "qa.operational.admin@careerconnect.test",
    "qa.platform.owner@careerconnect.test"
  )

  $accountList = ($requiredAccounts | ForEach-Object { "'$_'" }) -join ","
  $query = "SELECT COUNT(*) FROM users WHERE email IN ($accountList);"
  $count = (& psql -h $HostName -p $Port -U $User -d $DatabaseName -t -A -c $query).Trim()

  if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify QA database. Create and seed $DatabaseName manually or rerun with -SkipDatabaseCheck."
  }

  if ($count -ne "4") {
    throw "QA database is not seeded with all required accounts. Run qa/sql/seed_qa_accounts.sql manually."
  }
}

$env:QA_FRONTEND_URL = $FrontendUrl

Push-Location $repoRoot
try {
  npm exec -- playwright test qa/e2e/specs --project=chromium --workers=$Workers --retries=0
}
finally {
  Pop-Location
}
