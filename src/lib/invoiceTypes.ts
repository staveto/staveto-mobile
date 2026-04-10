/** Where invoice fields came from (for UI + analytics). */
export type InvoiceExtractionSource =
  | "image-ocr"
  | "pdf-text"
  | "pdf-render-ocr"
  | "cloud-ocr"
  | "none";

/** Normalized invoice fields (best-effort SK/CZ). */
export type ParsedInvoiceData = {
  rawText: string;
  source: InvoiceExtractionSource;
  confidence?: number;
  vendorName?: string;
  vendorIco?: string;
  vendorDic?: string;
  vendorIcdph?: string;
  invoiceNumber?: string;
  variableSymbol?: string;
  issueDate?: string;
  dueDate?: string;
  total?: number;
  subtotal?: number;
  taxAmount?: number;
  currency?: string;
  paymentMethod?: string;
  items?: Array<{
    name?: string;
    quantity?: number;
    unitPrice?: number;
    total?: number;
    taxRate?: number;
  }>;
};
