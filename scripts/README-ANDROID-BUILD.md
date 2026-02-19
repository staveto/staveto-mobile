# Android build – riešenie chyby "Filename longer than 260 characters"

Build zlyhá kvôli:
1. **cursor-sandbox-cache** – Cursor terminál používa sandbox s dlhými cestami
2. **arm64-v8a** – Expo CLI pridáva arm64, čo spôsobuje path limit

## Riešenie: Spustiť MIMO Cursor (povinné)

**Dôležité:** Ak spúšťaš z Cursor terminálu, Gradle použije `cursor-sandbox-cache` a build zlyhá. Musíš spustiť z **externého** PowerShell.

### Kroky:

1. Otvor **Windows PowerShell** zo Start menu (nie Cursor terminál!)
2. Spusti:
   ```powershell
   cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile\scripts
   .\run-android.ps1
   ```
   alebo dvojklik na `run-android.bat`

3. Skript používa `--all-arch` – Gradle použije `gradle.properties` (x86_64), nie arm64

### Alternatíva: enable-long-paths.reg

1. **Pravým klikom** na `enable-long-paths.reg` → **Spustit ako správca**
2. Potvrď import do registra
3. **Reštartuj počítač**

Po reštarte môže fungovať aj z Cursor, ale odporúčame stále spúšťať mimo.

## Pred buildom (ak ste skúšali viackrát)

Zastav staré Gradle daemony:
```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile\android
.\gradlew.bat --stop
```
