# Staveto – release flow (Android AAB, Google Play Internal testing)

## Finálna Workers API URL

Po prvom deployi backendu bude URL v tvare:
**`https://staveto-app-api.<tvoj-cloudflare-subdomain>.workers.dev`**  
Napríklad: `https://staveto-app-api.abc123.workers.dev`

Túto URL použi pre `EXPO_PUBLIC_API_URL` v EAS a v `.env` (dev).

---

## 1) Presné príkazy (PowerShell)

### Backend – deploy na Cloudflare Workers

```powershell
cd C:\Users\Marek\Staveto_Cursor\staveto-app_v2\backend-worker
npm i
npx wrangler login
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Po deployi skopíruj URL z výstupu (napr. `https://staveto-app-api.xxx.workers.dev`) a otestuj:
- `GET <URL>/health` → `{"ok":true,"ts":...}`
- `POST <URL>/auth/login` s `{"email":"..."}` (reálny user z Airtable)

### Mobile – AAB pre Google Play

Pred buildom odporúčané (v `mobile`):

```powershell
cd C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npx expo-doctor@latest
```
Ak expo-doctor nájde problémy (napr. verzie SDK, chýbajúce balíčky), oprav ich podľa výstupu.

Potom:

```powershell
cd C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npm i
npx eas-cli@latest login
npx eas-cli@latest build:configure
```

Nastav **EAS env** pre production:
- [expo.dev](https://expo.dev) → tvoj projekt Staveto → **Environment variables**
- Pre **Production** pridaj: `EXPO_PUBLIC_API_URL` = `https://staveto-app-api.<tvoj-subdomain>.workers.dev`

Potom spusti build:

```powershell
npx eas-cli@latest build -p android --profile production
```

Po dokončení stiahni AAB z odkazu v konzole (alebo z expo.dev → Builds) a nahraj ho do Play Console.

---

## 2) Play Console – kam kliknúť (Internal testing)

1. **Play Console** → tvoja appka **Staveto**
2. **Testing** → **Internal testing**
3. **Create new release** (alebo uprav existujúci)
4. **Upload** → vyber stiahnutý `.aab`
5. **Save** → **Review release** → **Start rollout to Internal testing**

Potvrdenia (Content rating, Privacy policy, atď.) rieš podľa úvodníka Play Console, ak ešte nie sú vyplnené.

---

## 3) App signing / “wrong key” – čo robiť

- **Kde to nájdeš:** Play Console → **Setup** → **App integrity** (alebo **Release** → **Setup** → **App signing**).
- **“Wrong key”** = AAB je podpísaný iným kľúčom ako ten, ktorý Play očakáva (pôvodný upload key alebo predchádzajúci app signing key).
- **Možnosti:**
  1. **Použiť pôvodný upload key**  
     Ak máš keystore z pôvodnej VS Code / staršej buildovacej pipeline, nakonfiguruj EAS tak, aby pri buildovaní používal tento upload key (EAS → Credentials → Android → Upload možnosti), alebo podpíš AAB lokálne týmto kľúčom a nahraj už podpísaný AAB.
  2. **Reset upload key**  
     V App integrity → **Request upload key reset**. Play ti povoľuje nahrať nový upload key (napr. ten z EAS). Postupuj podľa návodu v konzole (vygeneruješ nový key, nahráš certifikát, atď.). Ďalšie AAB musia byť podpísané týmto novým kľúčom.

Praktický checklist pri odmietnutí AAB:
- Over v **App integrity**, či máš “App signing key” a “Upload key” – ktorý z nich Play hlási ako nezhodu.
- Ak ideš cez EAS prvýkrát a predtým si vydával z iného nástroja → väčšinou treba **Request upload key reset** a zaregistrovať EAS upload key.
- Po resete všetky nové AAB musia ísť z EAS production buildu (bez ďalšieho lokálneho podpisovania vlastným keystore).

---

## 4) 10-bodový checklist “Dnes vydávam”

1. [ ] Backend: v `backend-worker` spustené `npx wrangler deploy`, mám finálnu URL Workera (`https://staveto-app-api.<subdomain>.workers.dev`).
2. [ ] Backend: otestované `GET /health` a `POST /auth/login` na produkčnej URL.
3. [ ] Mobile: v EAS (expo.dev) je pre **Production** nastavené `EXPO_PUBLIC_API_URL` = Workers URL.
4. [ ] Mobile: `app.json` má `android.package` = `com.staveto.app` (zhoda s Play Console).
5. [ ] Mobile: `cd mobile` → `npm i` → `npx eas-cli@latest build -p android --profile production` bez chýb.
6. [ ] AAB stiahnutý z expo.dev (Builds) alebo z linku po buildi.
7. [ ] Play Console: Testing → Internal testing → Create new release → Upload AAB → Save → Review → Rollout.
8. [ ] Ak Play hlási chybu podpisu: App integrity → riešenie cez “Request upload key reset” alebo použitie pôvodného upload key.
9. [ ] V Account (debug) v aplikácii overím, že baseURL je Workers URL, nie LAN.
10. [ ] Internal testovací track je nahratý a rollout dokončený.

---

## Zoznam súborov zmenených pre release

- `mobile/app.json` – name, slug, android.package, versionCode, userInterfaceStyle, dark splash/adaptive
- `mobile/eas.json` – nový súbor (development, preview, production)
- `mobile/src/api/client.ts` – env stratégia (production bez LAN fallbacku)
- `mobile/.env.example` – návod + EXPO_PUBLIC_API_URL
- `backend-worker/wrangler.toml` – name = `staveto-app-api`
- `backend-worker/SETUP.md` – deploy príkazy a finálna URL
- `RELEASE.md` – tento súbor (príkazy, Play Console, signing, checklist)
