# Spustenie kompletnej aplikácie Staveto

## 1. Predpoklady

- **Node.js** 20+ (pre functions)
- **npm** alebo **pnpm**
- **Firebase CLI**: `npm install -g firebase-tools`
- **Expo CLI**: v rámci projektu (`npx expo`)

---

## 2. Inštalácia závislostí

### Mobile app

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile

npm install
```

### Firebase Functions (OCR, WhatsApp, atď.)

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\functions

npm install
npm run build
```

---

## 3. Konfigurácia prostredia

### Mobile – `.env`

Skopíruj `.env.example` na `.env` a doplň Firebase hodnoty z Firebase Console:

```powershell
cd mobile
copy .env.example .env
# Otvor .env a doplň:
# EXPO_PUBLIC_FIREBASE_API_KEY=...
# EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
# EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
# EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
# EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
# EXPO_PUBLIC_FIREBASE_APP_ID=...
# EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
```

### Firebase prihlásenie

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2

firebase login
```

---

## 4. Spustenie aplikácie

### Mobilná appka (Expo)

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile

npx expo start --clear
```

Potom:
- **Android**: stlač `a` v termináli alebo naskenuj QR kód v Expo Go
- **iOS**: naskenuj QR kód v Expo Go (len na Macu)
- **Dev client**: ak máš `expo-dev-client`, spusti `npx expo run:android` alebo `npx expo run:ios`

### Android emulator – appka sa nenaštartuje

Ak sa appka v emulátore neotvorí, spusti `npm run start:emulator` namiesto `npx expo start --dev-client`:

```powershell
cd mobile
npm run start:emulator
```

Skript nastaví `adb reverse` a `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1`, aby emulátor spoľahlivo pripojil Metro.

### Firebase Functions (back-end pre OCR, WhatsApp)

Funkcie musia byť nasadené do Firebase, aby mobilná appka mohla používať OCR a iné Cloud Functions.

**Deploy na Firebase:**

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2

firebase deploy --only functions
```

**Alebo lokálne emulátory (testovanie):**

```powershell
cd functions
npm run serve
# Functions bežia na http://localhost:5001
```

---

## 5. Čo potrebuje fungovať

| Komponent | Účel |
|-----------|------|
| **Mobile** | UI, Firestore, Auth, Storage, volanie Functions |
| **Firebase Auth** | Prihlásenie (email, Google) |
| **Firestore** | Projekty, úlohy, výdavky, denník |
| **Storage** | Prílohy, fotky dokumentov |
| **Functions** | OCR účtov, WhatsApp webhook, pozvánky |

---

## 6. Rýchly štart (všetko naraz)

```powershell
# 1. Inštalácia
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npm install

cd ..\functions
npm install
npm run build

# 2. Deploy functions (ak ešte nie sú nasadené)
cd ..
firebase deploy --only functions

# 3. Spustenie mobilnej appky
cd mobile
npx expo start --clear
```

---

## 7. Riešenie problémov

- **Metro cache**: `npx expo start --clear`
- **Chýbajúce moduly**: `npm install` v `mobile/` aj `functions/`
- **Firebase permission denied**: skontroluj Firestore a Storage pravidlá v `firestore.rules` a `storage.rules`
- **OCR NOT_FOUND**: over, či sú Functions nasadené v regióne `europe-west1` a či súbor existuje v Storage
