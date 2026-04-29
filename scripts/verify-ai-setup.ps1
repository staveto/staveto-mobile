# Verify AI project creation setup
# Run from repo root: .\mobile\scripts\verify-ai-setup.ps1

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "=== AI project setup verification ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check Firebase project
$firebaseRc = Join-Path $projectRoot "firebase.json"
if (-not (Test-Path $firebaseRc)) {
    Write-Host "[FAIL] firebase.json not found in $projectRoot" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] firebase.json exists" -ForegroundColor Green

# 2. Check functions
$genPath = Join-Path $projectRoot "functions\src\generateProjectStructure.ts"
$createPath = Join-Path $projectRoot "functions\src\createProjectFromAiPlan.ts"
if (-not (Test-Path $genPath)) {
    Write-Host "[FAIL] generateProjectStructure.ts not found" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $createPath)) {
    Write-Host "[FAIL] createProjectFromAiPlan.ts not found" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] AI functions exist" -ForegroundColor Green

# 3. GOOGLE_GENERATIVE_AI_API_KEY reminder
Write-Host ""
Write-Host "GOOGLE_GENERATIVE_AI_API_KEY must be set in Firebase:" -ForegroundColor Yellow
Write-Host "  firebase functions:secrets:set GOOGLE_GENERATIVE_AI_API_KEY" -ForegroundColor White
Write-Host "  (Get key from https://aistudio.google.com/app/apikey)" -ForegroundColor Gray
Write-Host "  Then redeploy (include refine for „Prepracovať úlohu“):" -ForegroundColor Gray
Write-Host "  firebase deploy --only functions:generateProjectStructure,functions:createProjectFromAiPlan,functions:refineGeneratedProjectNode" -ForegroundColor Gray

# 4. Check .env
$envPath = Join-Path $projectRoot "mobile\.env"
Write-Host ""
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    $hasGen = $envContent -match "EXPO_PUBLIC_AI_GENERATE_PROJECT_URL\s*=\s*[^\s#]"
    $hasCreate = $envContent -match "EXPO_PUBLIC_AI_CREATE_PROJECT_URL\s*=\s*[^\s#]"
    if ($hasGen -and $hasCreate) {
        Write-Host "[OK] .env has AI URLs configured" -ForegroundColor Green
    } else {
        Write-Host "[WARN] .env may be missing AI URLs. Add:" -ForegroundColor Yellow
        Write-Host "  EXPO_PUBLIC_AI_GENERATE_PROJECT_URL=https://europe-west1-YOUR_PROJECT.cloudfunctions.net/generateProjectStructure" -ForegroundColor White
        Write-Host "  EXPO_PUBLIC_AI_CREATE_PROJECT_URL=https://europe-west1-YOUR_PROJECT.cloudfunctions.net/createProjectFromAiPlan" -ForegroundColor White
    }
} else {
    Write-Host "[WARN] mobile\.env not found. Create it with AI URLs (see docs/AI_PROJECT_SETUP.md)" -ForegroundColor Yellow
}

# 5. Deploy reminder
Write-Host ""
Write-Host "To deploy AI functions:" -ForegroundColor Cyan
Write-Host "  cd functions" -ForegroundColor White
Write-Host "  npm run build" -ForegroundColor White
Write-Host "  firebase deploy --only functions:generateProjectStructure,functions:createProjectFromAiPlan,functions:refineGeneratedProjectNode" -ForegroundColor White
Write-Host ""
Write-Host "After deploy, copy the function URLs from the output into .env" -ForegroundColor Gray
Write-Host ""
