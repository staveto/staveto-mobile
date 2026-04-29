/**
 * Callable `extractInvoiceDataFromStorage` (europe-west1) — response contract.
 * Keep in sync with `functions/src/extractInvoiceDataFromStorage.ts`.
 *
 * Client accepts either:
 * - **Envelope** (no `status`): `success === true` or `ok === true`, plus `rawText` / optional `parsed`
 * - **Legacy OCR** shape: `status: "success" | "failed" | "limit"`, `parsed`, `rawText`, etc.
 */
export type ExtractInvoiceDataFromStorageResponse = {
  /** Preferred flag for storage-OCR success envelope */
  success?: boolean;
  /** Legacy alias still accepted by client */
  ok?: boolean;
  /** When `success` / `ok` is false — real extraction failed (no stub text). */
  errorCode?: string;
  source?: string;
  rawText?: string | null;
  confidence?: number;
  parsed?: Record<string, unknown> | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  /** Server-side extraction diagnostics (Firebase logs mirror this). */
  extractionLog?: Record<string, unknown>;
  /** Server-side expense enrichment (additive; deterministic + optional Gemini). */
  expenseExtraction?: Record<string, unknown>;
  /** Only when using full OcrResult-style responses */
  status?: "success" | "failed" | "limit";
  cooldownSeconds?: number;
};
