# OCR Flow – prehľad a súvisiace súbory

## Čo robí OCR

Spracuje fotografiu/obrázok faktúry, stiahne text cez **Google Cloud Vision API** a parsuje z neho:
- názov dodávateľa
- číslo faktúry
- dátum vystavenia
- celková suma
- DPH

Výsledok sa predvyplní do formulára výdavku.

---

## Súbory súvisiace s OCR

| Súbor | Úloha |
|-------|-------|
| `mobile/src/services/invoiceOCR.ts` | Volanie Firebase callable, payload, parsing odpovede |
| `mobile/src/screens/ProjectOverviewScreen.tsx` | UI – spúšťanie OCR, modál „Spracovávam faktúru…“ |
| `mobile/src/screens/ExpenseReviewScreen.tsx` | Obrazovka na kontrolu a uloženie údajov z OCR |
| `mobile/src/services/attachments.ts` | Upload do Storage, generovanie `storagePath` |
| `mobile/src/services/projectEvents.ts` | Event `ocr_completed` po úspešnom OCR |
| `functions/src/index.ts` | Callable `extractInvoiceData` – Vision API, cache, limity |

---

## Flow (sekvencia)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. MOBILE – ProjectOverviewScreen                                             │
│    Užívateľ prida výdavok a vyberie prílohu (foto faktúry)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. attachments.uploadAttachment()                                            │
│    - Nahratie súboru do Firebase Storage                                      │
│    - Cesta: projects/{projectId}/attachments/{uploadFolder}/{fileName}       │
│    - Záznam v Firestore: projects/{projectId}/attachments                     │
│    - Vráti: { id (Firestore doc id), storagePath, mimeType, ... }            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. invoiceOCR.extractInvoiceData()                                            │
│    - Kontrola filePath (Storage fullPath, nie file:// / gs://)                │
│    - Volanie runInvoiceOCR() s payloadom:                                     │
│      { filePath, storagePath, attachmentId, mimeType, projectId }              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. runInvoiceOCR() – Firebase callable                                         │
│    - functions(app, "europe-west1").httpsCallable("extractInvoiceData")         │
│    - Odošle payload na Firebase Functions                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. CLOUD – functions/src/index.ts → extractInvoiceData                       │
│    a) Auth overenie (uid)                                                     │
│    b) Kontrola, že súbor existuje v Storage (bucket.file(storagePath).exists) │
│    c) Stiahnutie bytes z Storage                                              │
│    d) SHA256 hash → ocrCache lookup                                          │
│    e) Denný limit (30 OCR/deň) – users/{uid}/limits/ocr                     │
│    f) Google Vision API – textDetection(bytes)                                │
│    g) Parsing: parseInvoiceNumber, parseDate, parseSupplierName, amounts      │
│    h) Uloženie do ocrCache (users/{uid}/ocrCache/{hash})                     │
│    i) Vrátenie { status, parsed, rawText }                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. MOBILE – invoiceOCR.extractInvoiceData() – spracovanie odpovede            │
│    - Ak status === "success" → addProjectEvent("ocr_completed")              │
│    - Vráti OcrResult { status, parsed, errorCode? }                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. ProjectOverviewScreen                                                     │
│    - applyOcrPrefill(parsed) – predvyplnenie formulára                       │
│    - alebo navigateToExpenseReview() – prehľad a uloženie údajov              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 8. ExpenseReviewScreen                                                       │
│    - Zobrazenie predvyplnených údajov, možnosť úpravy                         │
│    - expensesService.updateExpense() – uloženie výdavku s ocrStatus            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Dva spôsoby spustenia OCR

### A) Auto OCR pri pridaní prílohy k výdavku

1. Otvorenie modálu „Pridať výdavok“
2. Klepnutie na „Príloha faktúry“ → výber fotky
3. `uploadAttachment()` → potom `extractInvoiceData()`
4. Výsledok → `applyOcrPrefill()` v tom istom modále

### B) OCR pre existujúci výdavok (s už nahratou prílohou)

1. Výdavok v zozname s `filePath` / `storagePath`
2. Užívateľ klepne na „Spracovať faktúru“
3. `extractInvoiceData({ filePath, mimeType, attachmentId, projectId })`
4. Navigácia na `ExpenseReviewScreen` s `parsed` údajmi

---

## Formát storagePath

**Storage fullPath:**
```
projects/{projectId}/attachments/{uploadFolder}/{fileName}
```

Príklad: `projects/abc123/attachments/1739123456789_xyz789/uuid.jpeg`

- **projectId** – ID projektu
- **uploadFolder** – názov foldera v Storage (napr. `{timestamp}_{random}`)
- **fileName** – názov súboru (napr. `{uuid}.{ext}`)

**attachmentId** – Firestore metadata doc id (napr. `k4np9Tlws...`). Posiela sa do backendu len kvôli prepojeniu na appku, UX a eventy (napr. `ocr_completed`). **Nie je** súčasťou Storage cesty.

---

## Firestore kolekcie (backend)

| Kolekcia | Účel |
|----------|------|
| `users/{uid}/ocrCache/{hash}` | Cache výsledkov OCR podľa SHA256 hash súboru |
| `users/{uid}/limits/ocr` | Denný limit OCR (30/deň) |

---

## Možné chyby (errorCode)

| errorCode | Význam |
|-----------|--------|
| `EMPTY_FILE_PATH` | Chýba filePath |
| `INVALID_FILE_PATH` | filePath je `file://`, `content://` alebo `gs://` (ocakáva sa Storage fullPath) |
| `NOT_FOUND` / `FILE_NOT_FOUND` | Súbor neexistuje v Storage (bucket + storagePath) |
| `unauthenticated` | Používateľ nie je prihlásený |
| `limit` | Denný limit 30 OCR bol dosiahnutý |

---

## Závislosti

- **Mobile:** `@react-native-firebase/functions`, `@react-native-firebase/storage`, `@react-native-firebase/auth`
- **Functions:** `firebase-admin`, `@google-cloud/vision`
- **Storage bucket:** `staveto-mvp-5f251.firebasestorage.app`
- **Region:** `europe-west1`
