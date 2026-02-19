# Spusti Android build mimo Cursor - obchadza limit 260 znakov (cursor-sandbox-cache)
# Spust: pravym klikom -> Spustit v PowerShell, alebo z normalneho PowerShell okna
# DULEZITE: Musis spustit MIMO Cursor (Windows PowerShell zo Start menu)!
$env:GRADLE_USER_HOME = "C:\g"
$env:TMP = "C:\t"
$env:TEMP = "C:\t"
Set-Location $PSScriptRoot\..

# --all-arch = neposiela -PreactNativeArchitectures do Gradle, pouzije gradle.properties (x86_64)
# To obchadza arm64-v8a build ktory sposobuje "Filename longer than 260 characters"
npx expo run:android --all-arch
