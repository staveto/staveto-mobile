# Android build – riešenie chyby "Filename longer than 260 characters"

Build zlyhá, pretože Cursor používa sandbox s dlhými cestami a Windows má limit 260 znakov.

## Riešenie 1: Povoliť dlhé cesty vo Windows (odporúčané)

1. **Pravým klikom** na `enable-long-paths.reg` → **Spustit ako správca**
2. Potvrď import do registra
3. **Reštartuj počítač**

Potom by mal `npx expo run:android` fungovať aj z Cursor terminálu.

## Riešenie 2: Spustiť mimo Cursor

1. Zatvor Cursor
2. Otvor **PowerShell** alebo **CMD** zo Start menu (nie z Cursor)
3. Spusti:
   ```powershell
   cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile\scripts
   .\run-android.ps1
   ```
   alebo dvojklik na `run-android.bat`

## Pred buildom (ak ste skúšali viackrát)

Zastav staré Gradle daemony:
```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile\android
.\gradlew.bat --stop
```
