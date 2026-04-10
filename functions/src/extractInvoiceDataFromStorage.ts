import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

/**
 * Stub `rawText` must be long enough and invoice-like for the mobile client’s
 * cloud-PDF gate (min ~12 non-space chars + amount / keywords). See
 * `extractPdfWithLocalAndCloud` in `mobile/src/services/invoiceOCR.ts`.
 */
const STUB_RAW_TEXT =
  "STUB Faktúra FA 2025-001 Dodávateľ TEST s.r.o. Celkom EUR 14.00 DPH 20% Variabilný symbol 1234567890 K úhrade 14.00 EUR";

/**
 * Response contract — keep fields in sync with
 * `mobile/src/lib/extractInvoiceDataFromStorageContract.ts`.
 */
const STUB_RESPONSE = {
  success: true,
  ok: true,
  source: "cloud-ocr",
  rawText: STUB_RAW_TEXT,
  confidence: 0.5,
  parsed: null,
  vendorName: null,
  invoiceNumber: null,
  total: null,
};

/**
 * HTTPS callable — name must match client: `extractInvoiceDataFromStorage` (europe-west1).
 */
export const extractInvoiceDataFromStorage = onCall(
  { region: "europe-west1" },
  async (request) => {
    logger.info("extractInvoiceDataFromStorage invoked", {
      data: request.data,
    });

    logger.info("extractInvoiceDataFromStorage response payload", STUB_RESPONSE);

    return STUB_RESPONSE;
  }
);
