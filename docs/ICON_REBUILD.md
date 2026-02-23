# Obnovenie ikony aplikácie na Android emulátore

Ak sa ikona na emulátore nezobrazuje správne (stará/nesprávna ikona), treba obnoviť natívny build.

## Požiadavky na súbory

- **icon.png** – 1024×1024 px, PNG
- **adaptive-icon.png** – 1024×1024 px, PNG s **priehľadným pozadím**
  - Logo umiestni do stredu (bezpečná zóna ~66 %), Android aplikuje kruhovú masku
  - Farba pozadia: `#253a6a` (nastavená v `app.json`)
- **splash-icon.png** – 1024×1024 px, PNG

## Kroky na obnovenie ikony

1. **Regenerovať Android priečinok** (vygeneruje nové ikony z assets):
   ```powershell
   cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
   npm run prebuild:android
   ```
   alebo priamo: `npx expo prebuild --platform android --clean`

2. **Odstrániť aplikáciu z emulátora** (aby sa zmazala cache):
   - Dlhým stlačením ikony Staveto → Odinstalovať
   - alebo: Settings → Apps → Staveto → Uninstall

3. **Spustiť build**:
   ```powershell
   .\scripts\run-android.ps1
   ```
   alebo:
   ```powershell
   npx expo run:android
   ```

## Ak ikona stále nepasuje

- **adaptive-icon.png** musí mať priehľadné pozadie – logo na priehľadnom PNG
- Dôležitý obsah musí byť v strede obrázka (v ~66 % plochy)
- Po zmene obrazkov vždy spusti `npx expo prebuild --platform android --clean`
- Po prebuilde odstráň aplikáciu z emulátora pred novým spustením
