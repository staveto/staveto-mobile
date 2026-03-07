# Enable Windows long paths (260+ characters) - REQUIRES ADMIN
# Run: Right-click PowerShell -> Run as Administrator, then:
#   Set-ExecutionPolicy Bypass -Scope Process -Force; & ".\scripts\enable-long-paths.ps1"

$path = "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem"
$name = "LongPathsEnabled"
$value = 1

try {
    $current = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($current.$name -eq 1) {
        Write-Host "Long paths are already enabled." -ForegroundColor Green
        exit 0
    }
} catch {}

Set-ItemProperty -Path $path -Name $name -Value $value -Type DWORD -Force
Write-Host "Long paths ENABLED. Restart your computer for the change to take effect." -ForegroundColor Green
