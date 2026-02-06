# Dnes: Internal test (SK stačí, žiadne i18n)

## Workers URL (backend je live, /health funguje)

**`https://staveto-app-api.dark-truth-840d.workers.dev`**

---

## Zostáva: env → build → upload → kontrola

### 1) expo.dev – Production env

- [expo.dev](https://expo.dev) → projekt **Staveto** → **Environment variables**
- Nastav **iba pre Production**:
  - `EXPO_PUBLIC_API_URL` = `https://staveto-app-api.dark-truth-840d.workers.dev`  
  - (bez lomítka na konci, žiadna LAN IP)

### 2) Build AAB (production)

```powershell
cd C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
npx eas-cli@latest build -p android --profile production
```

Po dokončení: expo.dev → **Builds** → stiahni **.aab**.

### 3) Upload do Play (Internal testing)

- **Play Console** → Staveto → **Testing** → **Internal testing**
- **Create new release** → **Upload** → vyber .aab
- **Save** → **Review release** → **Start rollout to Internal testing**

### 4) Kontrola po instalácii (že build ide na Workers, nie na LAN)

Nainštaluj AAB cez Internal test, spusti appku:

- **Account** → **Debug**
- Skontroluj **baseURL**: musí byť  
  `https://staveto-app-api.dark-truth-840d.workers.dev`  
  *(nie 192.168…)*

---

**Play pri uploade AAB:**  
- [ ] Žiadna chyba, rollout prebehol.  
- [ ] Chyba – presný text sem: `________________________`
