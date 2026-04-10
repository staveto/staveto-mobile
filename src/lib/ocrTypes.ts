import type { CurrencyCode } from "../utils/invoiceUniversal";
import type { InvoiceExtractionSource, ParsedInvoiceData } from "./invoiceTypes";

export type OcrStatus = "success" | "failed" | "limit";

export type OcrParsed = {
  supplierName: string | null;
  supplierTaxId?: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  /** Splatnosť / due date when detected in text (optional). */
  dueDate?: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: CurrencyCode;
  confidence?: { total?: number; currency?: number; overall?: number };
  matchedLine?: string;
};

export type OcrResult = {
  status: OcrStatus;
  parsed: OcrParsed | null;
  rawText?: string;
  errorCode?: string;
  cooldownSeconds?: number;
  extractionSource?: InvoiceExtractionSource;
  parsedInvoice?: ParsedInvoiceData;
};
