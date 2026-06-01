/**
 * Universal normalized document parse result — language-agnostic concepts.
 * Single source of truth for expense document understanding.
 */

import type { ExpenseParseDebugSnapshot, ExtractionQuality } from "./expenseDocumentParseTypes";

export type ParsedDocumentType =
  | "invoice"
  | "receipt"
  | "credit_note"
  | "quote"
  | "delivery_note"
  | "unknown";

export type ParsedDocumentExtractionSource =
  | "image-ocr"
  | "pdf-text"
  | "pdf-render-ocr"
  | "cloud-docai"
  | "cloud-llm";

export type ScoredCandidate<T> = {
  value: T;
  confidence: number;
  source?: string;
};

export type ParsedDocumentLineItem = {
  description?: string;
  quantity?: number;
  /** Unit of measure when detected (ks, m, m², kg, …). */
  unit?: string;
  unitPrice?: number;
  total?: number;
  taxRate?: number;
  /** Heuristic confidence 0–1 for future review UI. */
  confidence?: number;
};

export type ParsedDocumentData = {
  documentType: ParsedDocumentType;
  source: ParsedDocumentExtractionSource;
  language?: string;
  rawText: string;
  confidence?: number;
  /** How trustworthy the raw text layer is (PDF text vs OCR, length, noise). */
  extractionQuality?: ExtractionQuality;
  /** Dev/support: per-field shortlists, rejections, doc hints (avoid logging in production if sensitive). */
  expenseParseDebug?: ExpenseParseDebugSnapshot;

  supplier?: {
    name?: string;
    registrationId?: string;
    taxId?: string;
    vatId?: string;
    address?: string;
    email?: string;
    phone?: string;
  };

  customer?: {
    name?: string;
    registrationId?: string;
    taxId?: string;
    vatId?: string;
    address?: string;
  };

  documentNumber?: string;
  variableSymbol?: string;
  issueDate?: string;
  dueDate?: string;
  transactionDate?: string;
  paymentMethod?: string;
  currency?: string;

  subtotal?: number;
  taxAmount?: number;
  total?: number;

  items?: ParsedDocumentLineItem[];

  candidates?: {
    supplierName?: Array<ScoredCandidate<string>>;
    total?: Array<ScoredCandidate<number>>;
    issueDate?: Array<ScoredCandidate<string>>;
    dueDate?: Array<ScoredCandidate<string>>;
    documentNumber?: Array<ScoredCandidate<string>>;
  };
};
