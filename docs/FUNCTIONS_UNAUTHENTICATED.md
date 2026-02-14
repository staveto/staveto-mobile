# UNAUTHENTICATED pri Cloud Functions (callable)

Ak callable funkcie vracajú `UNAUTHENTICATED` aj keď je používateľ prihlásený, skontroluj:

## 1. Cloud Run IAM (najčastejšia príčina)

Firebase callable funkcie (2nd gen) bežia na Cloud Run. Cloud Run služba musí povoliť invokácie:

1. Otvor [Google Cloud Console – Cloud Run](https://console.cloud.google.com/run)
2. Vyber projekt (staveto-mvp-5f251)
3. Nájdi službu zodpovedajúcu funkcii (napr. `listpendinginvites`)
4. Klikni na názov → **Permissions** → **Add principal**
5. Principal: `allUsers`
6. Role: **Cloud Run invoker**
7. Ulož (Allow public access)

Alternatíva cez Cloud Functions:
1. [Cloud Functions list](https://console.cloud.google.com/functions/list)
2. Zaškrtni funkciu → **Permissions** → **Add principal**
3. Principal: `allUsers`, Role: **Cloud Functions Invoker**

## 2. Rovnaký Firebase projekt

Over, že app používa rovnaký projekt ako funkcie:
- V dev móde sa loguje `[functions] region europe-west1 projectId <id>`
- Projekt by mal byť `staveto-mvp-5f251`

## 3. Region

Všetky callable sú v `europe-west1`. `getFns()` vracia `auth.app.functions('europe-west1')` – rovnaká app ako auth.
