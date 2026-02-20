# Android – Aplikácia sa nespustí (Loading stuck)

Ak emulátor zobrazuje "Loading from 10.0.2.2:8082..." a zostane tam, skús tieto kroky.

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
