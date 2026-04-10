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
  source?: string;
  rawText?: string | null;
  confidence?: number;
  parsed?: Record<string, unknown> | null;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  /** Only when using full OcrResult-style responses */
  status?: "success" | "failed" | "limit";
  errorCode?: string;
  cooldownSeconds?: number;
};
