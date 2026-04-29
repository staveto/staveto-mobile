# AI vytváranie projektov – nastavenie

## Čo je potrebné

AI agent na vytváranie projektov volá Firebase Cloud Functions:
- `generateProjectStructure` – generuje plán z popisu
- `createProjectFromAiPlan` – vytvorí projekt, fázy a úlohy
- `refineGeneratedProjectNode` – prepracovanie jednej fázy / úlohy v náhľade (bez celkovej regenerácie)

## 1. Backend (Firebase Functions)

### GOOGLE_GENERATIVE_AI_API_KEY

Funkcia `generateProjectStructure` vyžaduje API kľúč pre Google Gemini:

```bash
# V Firebase Console alebo cez firebase functions:secrets:set
firebase functions:secrets:set GOOGLE_GENERATIVE_AI_API_KEY
# Zadaj kľúč z https://aistudio.google.com/app/apikey
```

Alebo v `functions/.env` (ak používaš dotenv):
```
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

### Deploy

```bash
cd functions
npm install
firebase deploy --only functions:generateProjectStructure,functions:createProjectFromAiPlan,functions:refineGeneratedProjectNode
```

Po deployi skopíruj URL z výstupu (napr. `https://europe-west1-staveto-mvp-5f251.cloudfunctions.net/generateProjectStructure`).

## 2. Mobile app (.env)

Pridaj do `.env`:

```
EXPO_PUBLIC_AI_GENERATE_PROJECT_URL=https://europe-west1-TVOJ_PROJECT.cloudfunctions.net/generateProjectStructure
EXPO_PUBLIC_AI_CREATE_PROJECT_URL=https://europe-west1-TVOJ_PROJECT.cloudfunctions.net/createProjectFromAiPlan
# Voliteľné – ak HTTP callable vracia NOT_FOUND pri refine, nastav explicitne:
# EXPO_PUBLIC_AI_REFINE_PROJECT_NODE_URL=https://europe-west1-TVOJ_PROJECT.cloudfunctions.net/refineGeneratedProjectNode
```

Nahraď `TVOJ_PROJECT` skutočným Firebase project ID.

**Poznámka:** Ak tieto premenné nie sú nastavené, app používá fallback URL. Pre Firebase Functions v2 môže byť fallback URL nesprávny – vtedy je potrebné nastaviť URL explicitne.

## 3. EAS Build (production)

Pre EAS build nastav premenné cez EAS Dashboard alebo:

```bash
eas secret:create --name EXPO_PUBLIC_AI_GENERATE_PROJECT_URL --value "https://..."
eas secret:create --name EXPO_PUBLIC_AI_CREATE_PROJECT_URL --value "https://..."
```

## Časté chyby

| Chyba | Riešenie |
|-------|----------|
| "AI služba nie je nakonfigurovaná" | Nastav GOOGLE_GENERATIVE_AI_API_KEY v Firebase |
| "Musíte byť prihlásený" | Odhlás sa a prihlás znova (refresh tokenu) |
| "Slabé pripojenie" | Skontroluj internet |

## Debug

V Metro konzole (__DEV__) pri volaní AI uvidíš:
- `[aiProject] Function URL:` – URL, ktorá sa volá
- `[aiProject] Calling generateProjectStructure` – parametre
- Pri chybe: `[CreateProjectAIFlow] AI generation failed:` – kód a správa

V development build sa pri chybe zobrazí aj technická správa `[code] message` pod hlavnou chybou – môžeš ju skopírovať pre diagnostiku.

## Verifikácia

Spusti skript na overenie nastavenia:

```powershell
.\mobile\scripts\verify-ai-setup.ps1
```

Skontroluje:
- existenciu Firebase a AI funkcií
- nastavenie GOOGLE_GENERATIVE_AI_API_KEY
- konfiguráciu .env
