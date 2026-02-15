# Travel Expense (Cestovné A→B) — Deploy & Setup

## Cloud Function: `calculateDistanceKm`

Region: **europe-west1**. Client uses `getFns()` which targets this region.

### 1. Secret setup (staveto-functions-maps)

Použi secret **staveto-functions-maps** v Secret Manager (obsahuje Google Maps API key).

```bash
# Ak ešte neexistuje: vytvor secret
gcloud secrets create staveto-functions-maps --replication-policy="automatic"

# Pridaj API key
echo -n "YOUR_GOOGLE_MAPS_API_KEY" | gcloud secrets versions add staveto-functions-maps --data-file=-
```

Povol v Google Cloud Console:
- **Directions API** (nutné)
- (voliteľne) **Geocoding API** – len ak budeš riešiť čistenie adries alebo preklad na lat/lng

**Security:** API key v Secret Manager – nastav API restrictions na **Directions API** (Application restrictions pri server-side nie sú potrebné).

### 2. Grant access to Functions runtime

Pri deployi Firebase automaticky pridá prístup pre default compute service account. Pri custom SA skontroluj `roles/secretmanager.secretAccessor` na secrete **staveto-functions-maps**.

### 3. Deploy

```bash
cd functions
npm run build
firebase deploy --only functions:calculateDistanceKm
```

### 4. Client (dve možnosti)

**A) Client-side (aktuálne):** `src/services/mapsDistance.ts`
- Volá Google Directions API priamo z mobilnej aplikácie.
- API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` v `.env` / EAS env.
- V Google Cloud Console zapni **Directions API**.
- Obmedz kľúč: Application restrictions (Android/iOS bundle ID) + API restrictions (len Directions API).

**B) Cloud Function (alternatíva):** `src/services/distance.ts`
- Uses `getFns().httpsCallable("calculateDistanceKm")` (europe-west1).
- No API key in mobile bundle; key stays in Secret Manager.
