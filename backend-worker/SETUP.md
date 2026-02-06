# Staveto Backend – spustenie a deploy

## Lokálny vývoj

1. **Závislosti**
   ```bash
   cd backend-worker
   npm install
   ```

2. **Secrets (lokálne)**
   - Skopíruj `.dev.vars.example` na `.dev.vars`.
   - Vyplň Airtable PAT (z [airtable.com/create/tokens](https://airtable.com/create/tokens)):
     - Buď `AIRTABLE_API_KEY=patxxx.yyy` (celý token),
     - alebo `AIRTABLE_API_KEY_PART1=patxxx` + `AIRTABLE_API_KEY_PART2=yyy` (ak niektorý loader skracuje na bodku).
   - Nastav `JWT_SECRET` (min. 32 znakov).
   - `AIRTABLE_BASE_ID` môže byť v `.dev.vars` alebo už je v `wrangler.toml` ako `AIRTABLE_BASE_ID`.

3. **Spustenie**
   ```bash
   npx wrangler dev --ip 0.0.0.0 --port 8787
   ```
   - Pre mobil v LAN: `--ip 0.0.0.0`, v mobile použi `EXPO_PUBLIC_API_URL=http://<LAN_IP>:8787`.
   - Pre test v prehliadači: `http://127.0.0.1:8787/health`.

4. **Test /health**
   V prehliadači alebo curl:
   ```bash
   curl http://127.0.0.1:8787/health
   ```
   Očakávané: `{"ok":true,"ts":...}`.

## Deploy (Cloudflare)

1. **Prihlásenie Wranglera**
   ```bash
   npx wrangler login
   ```
   Povol prístup v prehliadači („Allow Wrangler access to your Cloudflare account?“).

2. **Secrets (produkcia)**  
   Ak v appke vidíš **„Airtable 401 - Authentication required“**, v produkčnom Workeri chýba alebo je zlý Airtable token. Nastav secrets (spúšťaj z `backend-worker`):

   ```bash
   npx wrangler secret put AIRTABLE_API_KEY
   ```
   Zadaj **celý** Airtable PAT (napr. `patXXXXXXXXXXXXXXXX.YYYYYY...` z [airtable.com/create/tokens](https://airtable.com/create/tokens) – token musí mať práva na bázu z `AIRTABLE_BASE_ID`).

   ```bash
   npx wrangler secret put JWT_SECRET
   ```
   Zadaj tajný reťazec pre JWT (min. 32 znakov).

   Potom znova deploy: `npx wrangler deploy`. Žiadny reštart – Worker si nové secrets berie pri ďalšom requeste.

3. **Deploy** (spúšťaj z priečinka `backend-worker`)
   ```powershell
   cd C:\Users\Marek\Staveto_Cursor\staveto-app_v2\backend-worker
   npx wrangler deploy
   ```
   Po nasadení bude Worker dostupný na:
   **`https://staveto-app-api.<tvoj-subdomain>.workers.dev`**
   (subdoménu uvidel wrangler pri prvom deployi). Túto URL nastav v mobile ako `EXPO_PUBLIC_API_URL` (EAS env pre production alebo `.env` pri dev).

## Pravidlá

- **Nikdy** necommituj `.dev.vars` ani hodnoty `AIRTABLE_API_KEY` / `JWT_SECRET`.
- V mobile nikdy nepoužívaj `localhost` – na reálnom zariadení treba LAN IP alebo verejnú URL Workera.
