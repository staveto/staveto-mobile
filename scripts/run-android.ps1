# Spusti Android build mimo Cursor - obchadza limit 260 znakov (cursor-sandbox-cache)
# Spust: pravym klikom -> Spustit v PowerShell, alebo z normalneho PowerShell okna
$env:GRADLE_USER_HOME = "C:\Users\Marek\gradle"
Set-Location $PSScriptRoot\..
npx expo run:android
