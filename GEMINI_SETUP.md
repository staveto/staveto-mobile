# Nastavenie Gemini API pre AI vytváranie projektov

Tento návod vysvetľuje, ako povoliť a nakonfigurovať Gemini API, aby fungovalo vytváranie projektov s AI v Staveto.

## Krok 1: Získaj API kľúč

1. Otvor [Google AI Studio – API Keys](https://aistudio.google.com/app/apikey)
2. Prihlás sa Google účtom
3. Ak nemáš projekt, vytvor nový alebo importuj existujúci (napr. Firebase projekt `staveto-mvp-5f251`)
4. Klikni **Create API key** a vyber projekt
5. Skopíruj vygenerovaný API kľúč

## Krok 2: Povol Generative Language API

1. Otvor [Google Cloud Console – APIs & Services](https://console.cloud.google.com/apis/library)
2. Vyber projekt **staveto-mvp-5f251** (alebo tvoj Firebase projekt)
3. Vyhľadaj **Generative Language API**
4. Klikni **Enable** (ak ešte nie je povolená)

## Krok 3: Nastav tajný kľúč v Firebase

V termináli z koreňa projektu (`staveto-app_v2`):

```bash
firebase functions:secrets:set GOOGLE_GENERATIVE_AI_API_KEY
```

Keď CLI vypíše výzvu, vlož svoj Gemini API kľúč a potvrď Enter.

Alternatíva (Windows PowerShell):

```powershell
"TVOJ_API_KLUC" | firebase functions:secrets:set GOOGLE_GENERATIVE_AI_API_KEY
```

## Krok 4: Nasadiť Functions

```bash
firebase deploy --only functions:generateProjectStructure
```

Alebo všetky functions:

```bash
firebase deploy --only functions
```

## Overenie

Po nasadení skús v aplikácii vytvoriť nový projekt cez **Mit KI erstellen**. Ak je všetko nastavené správne, AI by malo vygenerovať plán projektu.

## Riešenie problémov

- **„AI service not configured“** – tajný kľúč nie je nastavený alebo function nemá prístup. Skontroluj, či si spustil `firebase functions:secrets:set GOOGLE_GENERATIVE_AI_API_KEY` a znovu nasadil functions.
- **„AI generation failed“** – API kľúč môže byť neplatný, Generative Language API nemusí byť povolená, alebo môže ísť o rate limit. Skontroluj [Google AI Studio](https://aistudio.google.com/) a [Cloud Console](https://console.cloud.google.com/apis/library).
