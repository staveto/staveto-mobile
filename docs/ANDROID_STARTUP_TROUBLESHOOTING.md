# Android – Aplikácia sa nespustí

## Dôležité: Projekt používa expo-dev-client

**Expo Go nestačí.** Potrebuješ **development build** – vlastnú zostavenú APK s dev klientom. Chyba `unable to resolve Intent exp+stavetoapp://expo-development-client` znamená, že na emulátore nie je nainštalovaná Staveto app.

---

## Správny postup (prvý štart)

### Krok 1: Spusti emulátor MANUÁLNE

1. Otvor **Android Studio** → **Device Manager** (alebo Tools → Device Manager)
2. Spusti emulátor (napr. Medium_Phone_API_36) – klikni na ▶
3. Počkaj, kým sa úplne nabootuje (domovská obrazovka)

### Krok 2: Zostav a nainštaluj appku

V **externom PowerShelli** (nie Cursor):

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npm run dev:android:external
```

Toto zostaví APK a nainštaluje ju na bežiaci emulátor. Prvý build môže trvať 5–15 minút.

### Krok 3: Ďalšie spustenia

Keď už máš appku nainštalovanú, stačí:

```powershell
npx expo start --android
```

---

## Ak port 5554 odmietne spojenie

Chyba: `could not connect to TCP port 5554: target machine actively refused it`

**Príčina:** Emulátor ešte nebeží alebo ADB sa nepripojil.

**Riešenie:**
1. Spusti emulátor manuálne z Android Studio (krok 1 vyššie)
2. Počkaj 30–60 sekúnd na plné nabootovanie
3. Skontroluj: `adb devices` – mal by zobraziť emulator-5554
4. Potom spusti `npm run dev:android:external`

---

## Ak emulátor zobrazuje "Loading from 10.0.2.2..." a zostane tam

---

## 1. Zabiť ADB a reštartovať (najčastejšie riešenie)

1. Otvor **Správcu úloh** (Ctrl+Shift+Esc)
2. Nájdi proces **adb.exe**
3. Pravý klik → **Ukončiť úlohu**
4. V termináli spusti znova:
   ```powershell
   npx expo start --android
   ```
   alebo
   ```powershell
   npm run android
   ```

---

## 2. Spustiť MIMO Cursor (dôležité pre build)

Projekt má problém s dlhými cestami v Cursor sandboxe. **Spúšťaj z externého PowerShellu:**

1. Otvor **Windows PowerShell** zo Start menu (nie Cursor terminál)
2. Spusti:
   ```powershell
   cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
   npm run dev:android:external
   ```
   alebo pre len Metro + emulátor:
   ```powershell
   npm run android
   ```

---

## 3. Firewall – povoliť port 8082

Windows Firewall môže blokovať spojenie emulátor → Metro.

1. **Windows Defender Firewall** → Upravte nastavenia brány firewall
2. Povoliť **Node.js** alebo **node.exe** pre súkromnú sieť
3. Alternatíva: dočasne vypnúť firewall na test

---

## 4. Vyčistiť cache a reštartovať

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile

# Zastaviť Metro (Ctrl+C)
# Potom:
Remove-Item -Recurse -Force .expo -ErrorAction SilentlyContinue
npx expo start --clear --android
```

---

## 5. Skontrolovať Java verziu

Expo/React Native môže mať problémy s Java 22+.

```powershell
java -version
```

Odporúčaná: **Java 17** (LTS). Ak máš Java 22, nainštaluj Java 17 a nastav `JAVA_HOME`.

---

## 6. Emulátor – starší API level

API 36 môže spôsobovať problémy. Skús emulátor s **API 33** alebo **API 34**:

1. Android Studio → Device Manager
2. Vytvor nový emulátor s API 33/34
3. Spusti ho pred `npm run android`

---

## 7. Hermes warning (môžeš ignorovať)

"React Native DevTools can only be used with the Hermes engine" – toto je len varovanie o DevTools, nie o beh aplikácie. Expo SDK 54 používa Hermes, aplikácia by mala bežať.

---

## 8. Ak nič nepomôže – čistý build

```powershell
# MIMO Cursor – externý PowerShell!
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile

# Zastaviť Gradle
cd android
.\gradlew.bat --stop
cd ..

# Vyčistiť
Remove-Item -Recurse -Force .expo -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force node_modules\.cache -ErrorAction SilentlyContinue

# Rebuild
npm run dev:android:external
```

---

## Rýchly checklist

- [ ] Zabiť adb.exe v Správcovi úloh
- [ ] Spúšťať z externého PowerShellu (nie Cursor terminál)
- [ ] Firewall – povoliť Node.js
- [ ] `npx expo start --clear --android`
- [ ] Skontrolovať Java (odporúčaná 17)
- [ ] Skúsiť emulátor s API 33/34
