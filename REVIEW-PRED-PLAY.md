# Staveto – review pred nahratím do Google Play Console

## Čo aktuálne funguje

### Konfigurácia a release
| Položka | Stav | Poznámka |
|--------|------|----------|
| **app.json** | OK | name „Staveto“, slug „staveto“, android.package „com.staveto.app“, versionCode 3, version 1.0.0, userInterfaceStyle dark |
| **Assety** | OK | icon.png, splash-icon.png, adaptive-icon.png, favicon.png v `mobile/assets/` |
| **eas.json** | OK | profily development, preview, production (autoIncrement, store, app-bundle) |
| **API client** | OK | Production používa `EXPO_PUBLIC_API_URL`, dev fallback 127.0.0.1:8787 |
| **Backend wrangler** | OK | name „staveto-app-api“, vars AIRTABLE_BASE_ID, main src/index.ts |

### Lokalizácia (EN / DE / SK / CS)
| Obrazovka / súbor | Stav | Poznámka |
|-------------------|------|----------|
| LoginScreen | OK | t() pre titul, API stav, placeholder, tlačidlá, link |
| RegisterScreen | OK | t() pre všetky stringy |
| OnboardingScreen | OK | t() pre slidy, Skip, Ďalej, Začať |
| HomeScreen | OK | t() pre prehľad, vitajte, nový projekt/úloha, prispôsobiť |
| TasksScreen | OK | t() pre empty, refresh, noTitle, modal, projekty, Create, Cancel |
| AppTabs | OK | t() pre názvy tabov |
| RootNavigator | OK | t() pre Loading, názvy stack obrazoviek |
| **AccountScreen** | Nie | Stále slovenské: Profil, Meno, Organizácia, Debug, Nastavenia, Push notifikácie, Odhlásiť sa, atď. |
| **SearchScreen** | Nie | „Hľadať projekty a úlohy…“, „Nič nenájdené“ |
| **TaskDetailScreen** | Nie | „Úloha nebola nájdená“, „Bez názvu“, „Termín:“, Status (Open, Robi sa, Hotové, …) |
| **NotificationsScreen** | Nie | „Nová notifikácia“, „Text upozornenia“, „Koho notifikovať“, atď. |
| **CustomizeHomeScreen** | Nie | „Prispôsobiť úvodnú obrazovku“, „Možnosti prispôsobenia čoskoro.“ |
| **ProjectsScreen** | Čiastočné | Má useI18n, ale stringy sú stále hardcoded (Žiadne projekty, Nový projekt, Názov projektu, Zdieľať…, Zrušiť, Vytvoriť) |

### Závislosti (Expo SDK 54)
| Balík | Stav |
|-------|------|
| expo-localization | V package.json, treba `npm i` |
| react-native-reanimated | ~4.1.1 (OK pre SDK 54) |
| react-native-safe-area-context | ~5.6.0 (OK) |
| Ostatné | Upravené podľa expo-doctor |

---

## Čo ešte pred nahratím do Play Console

### Povinné kroky

1. **Backend na Cloudflare**
   - V `backend-worker`: `npx wrangler login`, `npx wrangler secret put AIRTABLE_API_KEY`, `npx wrangler secret put JWT_SECRET`, `npx wrangler deploy`.
   - Zapíš si finálnu URL: `https://staveto-app-api.<subdomain>.workers.dev`.
   - Otestuj `GET /health` a `POST /auth/login`.

2. **EAS env pre production**
   - Na [expo.dev](https://expo.dev) → projekt Staveto → **Environment variables**.
   - Production: `EXPO_PUBLIC_API_URL` = táto Workers URL (bez koncového lomítka).

3. **Build AAB**
   - `cd mobile`
   - `npm install` (ak si ešte nerobil alebo pribudol expo-localization)
   - `npx expo-doctor@latest` – mal by prejsť (ak nie, oprav podľa výstupu)
   - `npx eas-cli@latest login` (ak ešte nie si prihlásený)
   - `npx eas-cli@latest build -p android --profile production`
   - Po buildi stiahni AAB z expo.dev → Builds.

4. **Play Console**
   - Testing → Internal testing → Create new release → Upload AAB.
   - Ak hlási zlý podpis: Setup → App integrity → Request upload key reset (ak prvýkrát cez EAS).

### Voliteľné pred Internal testing (odporúčané)

5. **Doplniť i18n** v obrazovkách, ktoré ho ešte nemajú, aby EN/DE/SK/CS boli konzistentné:
   - AccountScreen (Profil, Meno, Debug, Nastavenia, Odhlásiť sa; voliteľne výber jazyka).
   - SearchScreen (placeholder, „Nič nenájdené“).
   - TaskDetailScreen (statusy, „Úloha nebola nájdená“, „Termín:“).
   - NotificationsScreen (všetky texty).
   - CustomizeHomeScreen (titulok, „čoskoro“).
   - ProjectsScreen (nahradiť zvyšné SK stringy za `t("projects.xxx")`).

6. **Výber jazyka v účte**
   - V AccountScreen pridať sekciu „Jazyk“ s výberom EN / DE / SK / CS (voliteľné, môže ísť do ďalšej iterácie).

---

## Checklist „Pred prvým nahratím do Play Console“

- [ ] Backend nasadený na Workers, mám URL a otestované /health, /auth/login.
- [ ] V EAS (expo.dev) mám pre Production nastavené `EXPO_PUBLIC_API_URL` na túto URL.
- [ ] V `mobile` som spustil `npm install` a `npx expo-doctor@latest` (všetky checks passed).
- [ ] EAS build production prebehol: `npx eas-cli@latest build -p android --profile production`.
- [ ] AAB som stiahol z expo.dev (Builds).
- [ ] V Play Console mám appku s package name **com.staveto.app** (zhoda s app.json).
- [ ] Ak treba – vyplnené Content rating, Privacy policy, atď. podľa úvodníka Play.
- [ ] Upload AAB do Internal testing → Save → Review → Start rollout.
- [ ] Ak Play píše „wrong key“ – App integrity → Request upload key reset a pokračuj podľa RELEASE.md.

---

## Ďalšie kroky po prvom nahratí (Internal testing)

- Overiť v aplikácii (Account → Debug), že **baseURL** je Workers URL.
- Otestovať login, projekty, úlohy na reálnom zariadení / emulátore s production buildom.
- Podľa potreby doplniť chýbajúce preklady a výber jazyka, potom ďalší release (zvýšiť versionCode / version).
