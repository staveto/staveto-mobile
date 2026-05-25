<#
.SYNOPSIS
  Záloha priečinka mobilnej aplikácie Staveto na externý / lokálny disk.

.DESCRIPTION
  - Kopíruje celý obsah zdrojového priečinka (vrátane .git, node_modules, google/…).
  - Nevkladá do zálohy známe tajomstvá (plaintext .env, exporty účtov, service account JSON).
  - Robocopy: /NP (menej šumu), /LOG (textový log), bez pipy do Out-String.

.PARAMETER Source
  Koreň projektu (predvolené: priečinok nad scripts = mobile).

.PARAMETER Destination
  Cieľová cesta (predvolené: D:\Cursor zaloha\Staveto_Mobile).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\backup-staveto-mobile-secure.ps1
#>
[CmdletBinding()]
param(
  [string] $Source = "",
  [string] $Destination = "D:\Cursor zaloha\Staveto_Mobile"
)

$ErrorActionPreference = "Stop"

if (-not $Source) {
  $scriptRoot = [System.IO.Path]::GetDirectoryName($MyInvocation.MyCommand.Path)
  if (-not $scriptRoot) {
    throw "Cannot resolve script directory."
  }
  $Source = (Resolve-Path (Join-Path $scriptRoot "..")).Path
}

$logDir = Join-Path $Destination "_backup_logs"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "robocopy-$stamp.log"

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$readme = @"
Staveto Mobile — bezpečná záloha
================================
Čas: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Zdroj: $Source
Cieľ:  $Destination

ČO JE V ZÁLOHE
--------------
Zdrojový kód, konfigurácia verejná pre klienta (app.json, app.config.js), Firebase
google-services / plist (ak sú v repozitári), node_modules, .git, dokumentácia, skripty.

ČO SA NEKOPÍRUJE (bezpečnosť — dopln ručne do šifrovaného úložiska)
-------------------------------------------------------------------
- .env, .env.* (okrem .env.example)
- auth-export.json (export Firebase Auth)
- google-service-account.json, *service-account*.json v koreni (Android Play API)
- credentials\ (Firebase Admin / service účty podľa .gitignore)

Tieto súbory obnovíš z: správca hesiel, BitLocker USB, alebo EAS Secrets — nie z verejnej zálohy.

Po každom behu skript odstráni z cieľa vyššie uvedené súbory/priečinok credentials,
ak tam ostali z predchádzajúcej nezabezpečenej kopie.

TECH
----
Log robocopy: $logFile

Ďalší beh skriptu znova zosúladí súbory (inkrementálne).
"@

Set-Content -Path (Join-Path $Destination "STAVETO_BACKUP_README.txt") -Value $readme -Encoding UTF8

# Tajomstvá: /XF konkrétne súbory; /XD credentials; .env* cez viac /XF (robocopy nemá glob v /XF)
$excludeFiles = @(
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.staging",
  "auth-export.json",
  "google-service-account.json",
  "firebase-service-account.json",
  "service-account.json"
)

$xfArgs = @()
foreach ($f in $excludeFiles) {
  $xfArgs += $f
}

$robocopyArgs = @(
  $Source,
  $Destination,
  "*.*",
  "/E",
  "/COPY:DAT",
  "/DCOPY:DAT",
  "/R:2",
  "/W:2",
  "/MT:12",
  "/NP",
  "/NDL",
  "/NJH",
  "/XD",
  "node_modules\.cache",
  "credentials",
  "/XF"
) + $xfArgs + @(
  "/LOG:$logFile",
  "/TEE"
)

Write-Host "Zdroj:      $Source"
Write-Host "Cieľ:       $Destination"
Write-Host "Log:        $logFile"
Write-Host "Spúšťam robocopy…"

& robocopy @robocopyArgs
$code = $LASTEXITCODE

# Stará "plná" záloha mohla skopírovať .env atď. — z cieľa odstrániť, ak tam ešte sú.
$purgeOnDest = @(
  ".env", ".env.local", ".env.production", ".env.development", ".env.staging",
  "auth-export.json", "google-service-account.json", "firebase-service-account.json", "service-account.json"
)
foreach ($rel in $purgeOnDest) {
  $p = Join-Path $Destination $rel
  if (Test-Path -LiteralPath $p) {
    Remove-Item -LiteralPath $p -Force
    Write-Host "Removed from backup (secrets): $rel"
  }
}
if (Test-Path -LiteralPath (Join-Path $Destination "credentials")) {
  Remove-Item -LiteralPath (Join-Path $Destination "credentials") -Recurse -Force
  Write-Host "Removed from backup (secrets): credentials\"
}

Write-Host "Robocopy exit code: $code (0-7 = OK for robocopy)"
if ($code -ge 8) {
  exit $code
}
exit 0
