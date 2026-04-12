/**
 * Expense document extraction — public API for screens.
 * `processExpenseDocumentAttachment` is the preferred entry name.
 */

export { extractInvoiceData } from "./invoiceOCR";
export type { OcrParsed, OcrResult, OcrStatus } from "./invoiceOCR";
export { processExpenseDocumentAttachment, processInvoiceAttachment } from "./documentProcessing";
