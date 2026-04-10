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

`extractInvoiceDataFromStorage` is a **minimal v2 callable** (region `europe-west1`) so deploy succeeds. Replace the handler body with Storage download + extraction when ready.

Optional app override: **`EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL`** (see `src/services/ocr.ts`).
