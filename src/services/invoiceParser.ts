import type { InvoiceExtractionSource, ParsedInvoiceData } from "../lib/invoiceTypes";
import type { OcrParsed } from "../lib/ocrTypes";
import { isPlainObject } from "../utils/isPlainObject";
import { buildParsedDocumentData } from "./documentSemanticMapper";

export function ocrParsedToBackendRecord(parsed: OcrParsed): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (parsed.supplierName) o.supplierName = parsed.supplierName;
  if (parsed.supplierTaxId) o.supplierTaxId = parsed.supplierTaxId;
  if (parsed.invoiceNumber) o.invoiceNumber = parsed.invoiceNumber;
  if (parsed.issueDate) o.issueDate = parsed.issueDate;
  if (parsed.dueDate) o.dueDate = parsed.dueDate;
  if (parsed.totalAmount != null) o.totalAmount = parsed.totalAmount;
  if (parsed.vatAmount != null) o.vatAmount = parsed.vatAmount;
  if (parsed.currency) o.currency = parsed.currency;
  return o;
}

function icoFromSupplier(doc: ReturnType<typeof buildParsedDocumentData>): string | undefined {
  const t = doc.supplier?.taxId?.trim();
  if (t && /^\d{8}$/.test(t)) return t;
  return doc.supplier?.registrationId;
}

function parsedDocumentToParsedInvoiceData(
  doc: ReturnType<typeof buildParsedDocumentData>,
  source: InvoiceExtractionSource
): ParsedInvoiceData {
  return {
    rawText: doc.rawText,
    source,
    confidence: doc.confidence,
    vendorName: doc.supplier?.name,
    vendorIco: icoFromSupplier(doc),
    vendorDic: doc.supplier?.vatId,
    vendorIcdph: doc.supplier?.vatId,
    invoiceNumber: doc.documentNumber,
    variableSymbol: doc.variableSymbol,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    total: doc.total,
    subtotal: doc.subtotal,
    taxAmount: doc.taxAmount,
    currency: doc.currency,
    paymentMethod: doc.paymentMethod,
    ...(doc.items && doc.items.length > 0
      ? {
          items: doc.items.map((row) => ({
            name: row.description,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            total: row.total,
            taxRate: row.taxRate,
          })),
        }
      : {}),
  };
}

/**
 * Optional second pass when `OcrParsed` was built without backend hints — merges text mapping.
 */
export function enrichOcrParsedWithInvoiceText(
  parsed: OcrParsed,
  rawText: string | null | undefined,
  extractionSource: InvoiceExtractionSource = "image-ocr"
): OcrParsed {
  if (!rawText || rawText.length < 8) return parsed;
  const doc = buildParsedDocumentData({
    rawText,
    invoiceExtractionSource: extractionSource,
    backendParsed: ocrParsedToBackendRecord(parsed),
  });
  const next = parsedDocumentToOcrParsedLoose(doc, parsed);
  return next;
}

function parsedDocumentToOcrParsedLoose(doc: ReturnType<typeof buildParsedDocumentData>, prev: OcrParsed): OcrParsed {
  const mergeStr = (a: string | null | undefined, b: string | null | undefined): string | null => {
    const x = typeof a === "string" ? a.trim() : "";
    if (x.length >= 2) return x;
    const y = typeof b === "string" ? b.trim() : "";
    return y.length >= 2 ? y : null;
  };
  return {
    supplierName: mergeStr(prev.supplierName, doc.supplier?.name ?? null),
    supplierTaxId: mergeStr(prev.supplierTaxId ?? null, doc.supplier?.taxId ?? null) ?? undefined,
    invoiceNumber: mergeStr(prev.invoiceNumber, doc.documentNumber ?? null),
    issueDate: mergeStr(prev.issueDate, doc.issueDate ?? null),
    dueDate: mergeStr(prev.dueDate ?? null, doc.dueDate ?? null) ?? undefined,
    totalAmount:
      prev.totalAmount != null && prev.totalAmount > 0
        ? prev.totalAmount
        : doc.total != null && doc.total > 0
          ? doc.total
          : prev.totalAmount,
    vatAmount:
      prev.vatAmount != null && prev.vatAmount > 0
        ? prev.vatAmount
        : doc.taxAmount != null && doc.taxAmount > 0
          ? doc.taxAmount
          : prev.vatAmount,
    currency: prev.currency && prev.currency !== "UNKNOWN" ? prev.currency : (doc.currency as OcrParsed["currency"]) ?? prev.currency,
    confidence: prev.confidence,
    matchedLine: prev.matchedLine,
  };
}

export function buildParsedInvoiceEnvelope(
  rawText: string | undefined,
  source: InvoiceExtractionSource,
  base: OcrParsed
): ParsedInvoiceData | undefined {
  if (!rawText || rawText.length < 3) return undefined;
  const backend = ocrParsedToBackendRecord(base);
  const doc = buildParsedDocumentData({
    rawText,
    invoiceExtractionSource: source,
    backendParsed: isPlainObject(backend) ? backend : {},
  });
  return parsedDocumentToParsedInvoiceData(doc, source);
}
