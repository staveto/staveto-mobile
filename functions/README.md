# Firebase Functions (default codebase)

This directory is the **`functions`** source for `firebase.json` in the parent **`mobile/`** folder.

## Entrypoint

- `src/index.ts` re-exports **`extractInvoiceDataFromStorage`** so the CLI filter `default:extractInvoiceDataFromStorage` matches.

## Deploy

Run Firebase **from the `mobile` folder** — the one that contains **`firebase.json`** next to the **`functions/`** directory.

- If your shell is already at `...\staveto-app_v2\mobile`, **do not** run `cd mobile` again (that would try `mobile\mobile` and fail on Windows).
- **`YOUR_PROJECT_ID` was only a placeholder.** Use your real Firebase **project id** (all lowercase), e.g. from `google-services.json` → `project_info.project_id`.

**PowerShell (already in `mobile`):**

```powershell
firebase deploy --only functions:extractInvoiceDataFromStorage --project staveto-mvp-5f251
```

Use a different id only if your Firebase project is not `staveto-mvp-5f251`.

`predeploy` runs `npm run build` in the `functions` folder (TypeScript → `lib/`).

## Current implementation

`extractInvoiceDataFromStorage` downloads the Storage object, then:

- **PDF** — `pdf-parse` for the text layer; if that is too short, **Vision async PDF OCR** (`asyncBatchAnnotateFiles` + output JSON on the same Storage bucket, EU endpoint). See `src/extractInvoiceDataFromStorage.ts`.
- **Images** — Vision `textDetection` on bytes.

The app runs the multilingual **semantic mapper** on `rawText` client-side; the callable returns `parsed: null` by design (same contract as before).

Enable the **Cloud Vision API** on the GCP project. The Functions service account needs **Storage read + write** (temp paths `_invoice_ocr_tmp/…` for PDF OCR output).

### If the app still receives `STUB Faktúra…`

That string is **not produced by the TypeScript in this repo**. Typical causes:

1. **Old Cloud Function revision** — redeploy (`firebase deploy --only functions:extractInvoiceDataFromStorage`).
2. **`EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL`** points at a **mock/dev HTTPS endpoint** — remove it or fix the URL. Production builds ignore URLs that look like localhost / stub / mock (see `src/services/ocr.ts`).
3. Confirm logs show **`fnImplVersion` ending with `success-guard`** (e.g. `extractInvoiceDataFromStorage-async-pdf-v3-success-guard`) in `extractionLog` — if missing, the device is not calling this implementation.

Optional app override: **`EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL`** (see `src/services/ocr.ts`) — use only for a **real** alternate callable URL (https, not dev hosts).
