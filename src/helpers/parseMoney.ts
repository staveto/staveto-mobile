const MAX_REASONABLE = 999_999.99;

/**
 * Parse money value from various formats (65,19 / 65.19 / "65,19 EUR" etc.)
 * Returns number or null if unparseable.
 */
export function parseMoneyToNumber(v: unknown): number | null {
  if (v == null) return null;
  const raw = String(v)
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/EUR/gi, "")
    .replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  let normalized = raw;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", "."); // 1.234,56 -> 1234.56
  } else if (hasComma && !hasDot) {
    normalized = normalized.replace(",", "."); // 65,19 -> 65.19
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Highest priority: "uhradené" / "platené v hotovosti" = final paid amount (SK invoices) */
function extractPaidAmount(rawText: string): number | null {
  const block = rawText.replace(/\s+/g, " ");
  const paidRegex =
    /(?:uhraden[ée]|platen[ée](?:\s+v\s+hotovosti)?)\s*(\d{1,6}[.,]\d{2})\s*(?:eur|€|euro)?/gi;
  let lastMatch: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((lastMatch = paidRegex.exec(block)) !== null) last = lastMatch;
  if (last?.[1]) {
    const n = parseMoneyToNumber(last[1]);
    if (n != null && n > 0 && n <= MAX_REASONABLE) return n;
  }
  return null;
}

/** Fallback: extract total WITH VAT from raw OCR text (multi-language). Exclude "Základ" (base). */
export function extractTotalFromRawText(rawText: string | null | undefined): number | null {
  if (!rawText || typeof rawText !== "string") return null;
  const fromPaid = extractPaidAmount(rawText);
  if (fromPaid != null) return fromPaid;
  const totalWithVatRegex =
    /(?:spolu(?:\s+v\s+eur)?|uhraden[ée]|platen[ée](?:\s+v\s+hotovosti)?|na\s*[úu]hradu\s*(?:eur)?|celkom|total|summe|gesamt|totale|importe|razem|hotovosť|karta|platba|k\s*[úu]hrade|paid|bezahlt|pagato|betrag|amount|montant|importo)[\s\S]*?(\d{1,6}[.,]\d{2})\s*(?:eur|€|euro)?/i;
  const m = rawText.match(totalWithVatRegex);
  if (m?.[1]) {
    const n = parseMoneyToNumber(m[1]);
    if (n != null && n > 0 && n <= MAX_REASONABLE) return n;
  }
  const baseOnlyRegex = /(?:základ|base|netto)\s*[:]?\s*(\d{1,6}[.,]\d{2})/i;
  const avoid = new Set<number>();
  let baseMatch;
  while ((baseMatch = baseOnlyRegex.exec(rawText)) !== null) {
    const b = parseMoneyToNumber(baseMatch[1]);
    if (b != null) avoid.add(b);
  }
  const fallbackPatterns = [
    /(?:eur|€)\s*(\d{1,6}[.,]\d{2})/gi,
    /(\d{1,6}[.,]\d{2})\s*(?:eur|€)/gi,
  ];
  for (const re of fallbackPatterns) {
    let match;
    while ((match = re.exec(rawText)) !== null) {
      const n = parseMoneyToNumber(match[1]);
      if (n != null && n > 0 && n <= MAX_REASONABLE && !avoid.has(n)) return n;
    }
  }
  return null;
}
