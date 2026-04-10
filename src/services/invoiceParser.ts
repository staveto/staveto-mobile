import type { InvoiceExtractionSource, ParsedInvoiceData } from "../lib/invoiceTypes";
import type { OcrParsed } from "../lib/ocrTypes";
import { parseMoneyToNumber } from "../helpers/parseMoney";
import type { CurrencyCode } from "../utils/invoiceUniversal";

/** Normalize SK/CZ date tokens to YYYY-MM-DD when possible. */
function normalizeDateToken(raw: string | null | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const s = raw.trim().replace(/\s+/g, " ");
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  const mDmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (mDmy) {
    const d = mDmy[1].padStart(2, "0");
    const mo = mDmy[2].padStart(2, "0");
    const y = mDmy[3];
    return `${y}-${mo}-${d}`;
  }
  return undefined;
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const g = m?.[1] ?? m?.[2];
  return typeof g === "string" ? g.trim() : undefined;
}

/**
 * Best-effort SK/CZ invoice field extraction from raw OCR / PDF text.
 * Defensive: only string operations on known string input.
 */
export function parseInvoiceTextToParsedData(
  rawText: string,
  source: InvoiceExtractionSource
): ParsedInvoiceData {
  const text = typeof rawText === "string" ? rawText : "";
  const t = text.replace(/\r\n/g, "\n");

  const vendorBlock = firstMatch(
    t,
    /(?:Dodávateľ|Dodavatel|Dodavateľ|Predávajúci|Predávajúci|Supplier|Verkäufer)\s*[:#]?\s*([^\n]{3,120})/i
  );
  const vendorName =
    vendorBlock?.replace(/\s+/g, " ").trim() ||
    firstMatch(t, /(?:Spoločnosť|Firma)\s*[:#]?\s*([^\n]{3,100})/i);

  const invoiceNumber =
    firstMatch(
      t,
      /(?:Faktúra\s*č\.?|Faktura\s*č\.?|Číslo\s*faktúry|Číslo\s*faktury|Č\.?\s*faktury|Invoice\s*No\.?|Invoice\s*#)\s*[:#]?\s*([A-Z0-9\-\/]{3,40})/i
    ) || firstMatch(t, /\b(?:FA|FV|FAK)[\s\-:]?([0-9]{4,12})\b/i);

  const variableSymbol = firstMatch(
    t,
    /(?:Variabilný\s*symbol|Variabilní\s*symbol|VS|Variabilní symbol)\s*[:#]?\s*([0-9]{3,16})\b/i
  );

  const issueDate = normalizeDateToken(
    firstMatch(
      t,
      /(?:Dátum\s*vystavenia|Datum\s*vystavení|Dátum\s*fakturácie|Date\s*of\s*issue|Issued)\s*[:#]?\s*([0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}|\d{4}-\d{2}-\d{2})/i
    )
  );

  const dueDate = normalizeDateToken(
    firstMatch(
      t,
      /(?:Dátum\s*splatnosti|Datum\s*splatnosti|Due\s*date|Splatnosť|Splatnost)\s*[:#]?\s*([0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}|\d{4}-\d{2}-\d{2})/i
    )
  );

  const ico = firstMatch(t, /(?:IČO|IČ\s*O|ICO)\s*[:#]?\s*([0-9]{8})\b/i);
  const dic = firstMatch(t, /(?:DIČ|IČ\s*DPH|DIC|VAT\s*ID)\s*[:#]?\s*([A-Z]{2}[0-9A-Z\-]{6,14})\b/i);
  const icDph = firstMatch(t, /(?:IČ\s*DPH|IČDPH|IC\s*DPH)\s*[:#]?\s*([A-Z]{2}[0-9]{8,10})\b/i);

  const totalLine = firstMatch(
    t,
    /(?:K\s*úhrade|K\s*úhradě|Celkom\s*SPOLU|Celkem\s*K\s*úhradě|Celkom|Celkem|Spolu|RAZEM|Total\s*due|Amount\s*due|Zu\s*zahlen)\s*[:#]?\s*([0-9\s\u00a0]{1,12}[,.][0-9]{2})\s*([A-Z]{3})?/i
  );
  let total: number | undefined;
  let currency: string | undefined;
  if (totalLine) {
    const numPart = firstMatch(totalLine, /^([0-9\s\u00a0]{1,12}[,.][0-9]{2})/);
    if (numPart) {
      const n = parseMoneyToNumber(numPart.replace(/\s/g, "").replace(/\u00a0/g, ""));
      if (n != null && n > 0 && n <= 999_999.99) total = n;
    }
    const cur = firstMatch(totalLine, /\b(EUR|CZK|SKK|USD|CHF|PLN|HUF)\b/i);
    if (cur) currency = cur.toUpperCase();
  }

  const subtotal = parseMoneyToNumber(
    firstMatch(t, /(?:Základ\s*dane|Základ\s*DPH|Základ\s*bez\s*DPH|Základ\s*DPH|Bez\s*DPH)\s*[:#]?\s*([0-9\s\u00a0]{1,12}[,.][0-9]{2})/i)?.replace(/\s/g, "")
  );
  const taxAmount = parseMoneyToNumber(
    firstMatch(t, /(?:DPH\s*20|DPH\s*10|DPH|VAT)\s*[:#]?\s*([0-9\s\u00a0]{1,12}[,.][0-9]{2})/i)?.replace(/\s/g, "")
  );

  const paymentMethod = firstMatch(
    t,
    /(?:Spôsob\s*úhrady|Způsob\s*úhrady|Forma\s*úhrady|Payment)\s*[:#]?\s*([^\n]{3,80})/i
  );

  return {
    rawText: text,
    source,
    vendorName: vendorName?.slice(0, 200),
    vendorIco: ico,
    vendorDic: dic,
    vendorIcdph: icDph ?? dic,
    invoiceNumber: invoiceNumber?.slice(0, 60),
    variableSymbol,
    issueDate,
    dueDate,
    total,
    subtotal: subtotal ?? undefined,
    taxAmount: taxAmount ?? undefined,
    currency,
    paymentMethod: paymentMethod?.slice(0, 120),
  };
}

/** Merge regex-based SK/CZ fields into Vision/PDF-normalized `OcrParsed` (non-destructive). */
export function enrichOcrParsedWithInvoiceText(parsed: OcrParsed, rawText: string | null | undefined): OcrParsed {
  if (!rawText || rawText.length < 8) return parsed;
  const ext = parseInvoiceTextToParsedData(rawText, "none");

  const mergeStr = (a: string | null | undefined, b: string | undefined): string | null => {
    const x = typeof a === "string" ? a.trim() : "";
    if (x.length >= 2) return x;
    const y = b?.trim();
    return y && y.length >= 2 ? y : null;
  };

  const nextCurrency: CurrencyCode =
    parsed.currency && parsed.currency !== "UNKNOWN"
      ? parsed.currency
      : ext.currency && /^[A-Z]{3}$/.test(ext.currency)
        ? (ext.currency as CurrencyCode)
        : parsed.currency;

  return {
    ...parsed,
    supplierName: mergeStr(parsed.supplierName, ext.vendorName),
    supplierTaxId: mergeStr(parsed.supplierTaxId ?? null, ext.vendorIco ?? ext.vendorDic) ?? undefined,
    invoiceNumber: mergeStr(parsed.invoiceNumber, ext.invoiceNumber),
    issueDate: mergeStr(parsed.issueDate, ext.issueDate),
    dueDate: mergeStr(parsed.dueDate ?? null, ext.dueDate) ?? undefined,
    totalAmount:
      parsed.totalAmount != null && parsed.totalAmount > 0
        ? parsed.totalAmount
        : ext.total != null && ext.total > 0
          ? ext.total
          : parsed.totalAmount,
    vatAmount:
      parsed.vatAmount != null && parsed.vatAmount > 0
        ? parsed.vatAmount
        : ext.taxAmount != null && ext.taxAmount > 0
          ? ext.taxAmount
          : parsed.vatAmount,
    currency: nextCurrency,
  };
}

export function buildParsedInvoiceEnvelope(
  rawText: string | undefined,
  source: InvoiceExtractionSource,
  base: OcrParsed
): ParsedInvoiceData | undefined {
  if (!rawText || rawText.length < 3) return undefined;
  const parsed = parseInvoiceTextToParsedData(rawText, source);
  return {
    ...parsed,
    vendorName: parsed.vendorName ?? base.supplierName ?? undefined,
    vendorIco: parsed.vendorIco ?? base.supplierTaxId ?? undefined,
    invoiceNumber: parsed.invoiceNumber ?? base.invoiceNumber ?? undefined,
    issueDate: parsed.issueDate ?? base.issueDate ?? undefined,
    dueDate: parsed.dueDate ?? base.dueDate ?? undefined,
    total: parsed.total ?? base.totalAmount ?? undefined,
    taxAmount: parsed.taxAmount ?? base.vatAmount ?? undefined,
    currency: parsed.currency ?? (base.currency !== "UNKNOWN" ? base.currency : undefined),
  };
}
