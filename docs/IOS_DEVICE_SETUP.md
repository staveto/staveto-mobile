# iPhone – Spustenie aplikácie cez development build

## Dôležité: Expo Go nefunguje

Projekt používa **expo-dev-client** a natívne moduly (Firebase, Maps, atď.), ktoré **Expo Go neobsahuje**. QR kód zo `expo start --tunnel` v **Expo Go** nebude fungovať.

Potrebuješ **development build** – vlastnú zostavenú aplikáciu s dev klientom.

---

## Postup (Windows – bez Macu)

### Krok 1: Zostaviť development build (prvýkrát)

V termináli:

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
eas build --profile development --platform ios
```

- Vyžaduje **Apple Developer účet** (platný)
- EAS vytvorí build v cloude (~15–20 min)
- Po dokončení EAS zobrazí odkaz na inštaláciu

### Krok 2: Nainštalovať na iPhone

- Klikni na odkaz z EAS (alebo TestFlight, ak používaš internal distribution)
- Nainštaluj **Staveto** development app na iPhone
- Pri prvom spustení môžeš musieť povoliť developer certifikát v Nastavenia → Všeobecné → VPN a zariadenie

### Krok 3: Spustiť Metro s tunelom

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npx expo start --tunnel --dev-client
```

### Krok 4: Pripojiť iPhone

- **Neotváraj Expo Go** – otvor **Staveto** (development build), ktorú si nainštaloval v kroku 2
- V Staveto app naskenuj QR kód z terminálu alebo zadaj URL ručne
- App sa pripojí na Metro cez tunel

---

## Ak máš Mac

Môžeš zostaviť lokálne bez EAS:

```bash
npx expo run:ios --device
```

Vyber svoje iPhone zo zoznamu. Prvý build môže trvať 5–10 minút.

---

## Rýchly checklist

- [ ] Development build nainštalovaný na iPhone (nie Expo Go)
- [ ] `npx expo start --tunnel --dev-client` beží
- [ ] Otvorená **Staveto** app (dev build), nie Expo Go
- [ ] iPhone a PC v rovnakej sieti alebo tunel (--tunnel) pre rôzne siete
