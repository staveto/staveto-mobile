/**
 * Legacy deterministic invoice parsing from OCR plain text (extracted from index.ts).
 * Behavior preserved — enrichment layers build on top in invoiceExpenseEnhancement.ts.
 */

/** Bump when `parseInvoiceText` behavior changes (audit / clients). */
export const LEGACY_PARSER_VERSION = "invoice-legacy-parse-v1";

export type ParsedInvoice = {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: string;
};

function parseAmount(value: string): number | null {
  const raw = value.replace(/[^\d,.\s]/g, "").replace(/\s/g, "");
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = /,\d{2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (hasDot) {
    normalized = /\.\d{2}$/.test(raw) ? raw : raw.replace(/\./g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

const MAX_REASONABLE_AMOUNT = 999_999.99;

function isReasonableAmount(n: number): boolean {
  return n > 0 && n <= MAX_REASONABLE_AMOUNT;
}

function pickLargestAmount(text: string): number | null {
  const matches = text.match(/[\d][\d\s.,]{1,}/g);
  if (!matches) return null;
  const amounts = matches
    .map((m) => parseAmount(m))
    .filter((n): n is number => typeof n === "number" && isReasonableAmount(n));
  if (!amounts.length) return null;
  return Math.max(...amounts);
}

function extractLineAmount(lines: string[], keywordRegex: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!keywordRegex.test(line)) continue;
    let amount = pickLargestAmount(line);
    if (amount !== null) return amount;
    if (i + 1 < lines.length) {
      amount = pickLargestAmount(lines[i + 1]);
      if (amount !== null) return amount;
    }
  }
  return null;
}

const BASE_ONLY_REGEX = /^(?:základ|base|netto|net|báze)\s*[:]?\s*/i;

function extractTotalWithVat(lines: string[]): number | null {
  const totalWithVatRegex =
    /(?:spolu\s+v\s+eur|na\s*[úu]hradu\s*(?:eur)?|celkom|total|summe|gesamt|totale|importe|razem|k\s*[úu]hrade|hotovosť|karta|platba|zaplatiť|betrag|úhradu\s*eur)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BASE_ONLY_REGEX.test(line)) continue;
    if (!totalWithVatRegex.test(line)) continue;
    let amount = pickLargestAmount(line);
    if (amount !== null) return amount;
    if (i + 1 < lines.length) {
      amount = pickLargestAmount(lines[i + 1]);
      if (amount !== null) return amount;
    }
  }
  return null;
}

function extractTotalFromBaseAndVat(lines: string[]): number | null {
  let base: number | null = null;
  let vat: number | null = null;
  const baseRegex = /(základ|base|netto|net)\s*[:]?\s*/i;
  const vatRegex = /(dph|vat|mwst|iva)\s*[:]?\s*/i;
  for (const line of lines) {
    if (baseRegex.test(line) && base === null) base = pickLargestAmount(line);
    if (vatRegex.test(line) && vat === null) vat = pickLargestAmount(line);
  }
  if (base != null && vat != null && isReasonableAmount(base + vat)) {
    return Math.round((base + vat) * 100) / 100;
  }
  return null;
}

function parseInvoiceNumber(text: string): string | null {
  const patterns = [
    /(?:fakt[úu]ra|invoice|rechnung|fattura|factura|rachunek|factuur)\s*(?:no\.?|nr\.?|number|nummer|numero)?\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
    /(?:č[íi]slo\s*fakt[úu]ry|invoice\s*no\.?|numero\s*fattura)\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function parseDate(text: string): string | null {
  const datePatterns = [/\b(\d{2})[./](\d{2})[./](\d{4})\b/, /\b(\d{4})-(\d{2})-(\d{2})\b/];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (!m) continue;
    if (m[0].includes("-")) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

function parseSupplierName(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/fakt[úu]ra|invoice|rechnung|fattura|factura|rachunek/i.test(trimmed)) continue;
    if (/\d{6,}/.test(trimmed)) continue;
    if (trimmed.length < 3) continue;
    return trimmed.slice(0, 80);
  }
  return null;
}

export function parseSupplierTaxId(text: string): string | null {
  const euVat = text.match(
    /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s\-]?([A-Z0-9]{8,12})\b/i
  );
  if (euVat?.[2]) return `${euVat[1].toUpperCase()}${euVat[2]}`;
  const ico = text.match(/\b(?:IČO|IČ|IC|DIČ|DS)[\s:]*(\d{8})\b/i);
  if (ico?.[1]) return ico[1];
  const ust = text.match(/\b(?:USt[- ]?IdNr?\.?|VAT|MwSt[- ]?Nr)[\s:]*([A-Z]{2}\s?[\dA-Z]{8,12})\b/i);
  if (ust?.[1]) return ust[1].replace(/\s/g, "");
  const nip = text.match(/\b(?:NIP)[\s:]*(\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}|\d{10})\b/i);
  if (nip?.[1]) return nip[1].replace(/[\s\-]/g, "");
  const piva = text.match(/\b(?:P\.?IVA|Partita IVA|CIF|NIF)[\s:]*([A-Z0-9]{9,12})\b/i);
  if (piva?.[1]) return piva[1];
  return null;
}

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const invoiceNumber = parseInvoiceNumber(rawText);
  const issueDate = parseDate(rawText);
  const totalRegex =
    /(?:spolu\s+v\s+eur|na\s*[úu]hradu|celkom|total|summe|gesamt|k\s*[úu]hrade|hotovosť|karta|platba|zaplatiť|betrag|úhradu\s*eur|eur\s*\d)/i;
  let totalAmount =
    extractTotalWithVat(lines) ??
    extractLineAmount(lines, totalRegex) ??
    extractTotalFromBaseAndVat(lines) ??
    pickLargestAmount(rawText);
  if (totalAmount != null && !isReasonableAmount(totalAmount)) {
    totalAmount = extractTotalFromBaseAndVat(lines) ?? pickLargestAmount(rawText);
  }
  const vatRegex = /(dph|vat|mwst|iva|tva|podatek)/i;
  const vatAmount = extractLineAmount(lines, vatRegex);
  const supplierName = parseSupplierName(lines);
  const supplierTaxId = parseSupplierTaxId(rawText);
  return {
    supplierName,
    supplierTaxId,
    invoiceNumber,
    issueDate,
    totalAmount,
    vatAmount,
    currency: "EUR",
  };
}
