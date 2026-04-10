/**
 * Unified entry for invoice attachment OCR / text extraction.
 * Delegates to `extractInvoiceData` (image → Vision callable, PDF → local text + cloud fallback).
 */
export { extractInvoiceData, extractInvoiceData as processInvoiceAttachment } from "./invoiceOCR";
export type { OcrParsed, OcrResult, OcrStatus } from "../lib/ocrTypes";
