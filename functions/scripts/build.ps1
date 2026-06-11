$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
& node "./node_modules/typescript/bin/tsc"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
