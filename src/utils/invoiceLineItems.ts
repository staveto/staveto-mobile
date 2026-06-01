import { parseMoneyToNumber } from "../helpers/parseMoney";
import type { ParsedDocumentLineItem } from "../lib/parsedDocumentTypes";
import {
  inferMaterialCategoryFromName,
  isInvalidMaterialLineName,
  normalizeMaterialUnit,
} from "../lib/materialCatalog";

const MAX_LINE_ITEMS = 50;
const MAX_AMOUNT = 999_999.99;
const MIN_DESCRIPTION_LEN = 3;

const KNOWN_UNITS =
  /\b(ks|pc|pcs|st|stk|bal|bal\.|pack|m2|m²|m3|m³|bm|m|kg|g|l|lt|hod|h|hod\.|deň|den|d)\b/i;

const SKIP_LINE =
  /\b(spolu|celkom|celkem|total|suma|uhrad|úhrad|uhraden|zaplac|zaplat|subtotal|mezisúčet|medzisucet|základ|zaklad|dph|vat|tax|iban|swift|bic|variabil|konstant|specif|ičo|ico|dič|dic|ič\s*dph|datum|dátum|date|splatn|due\s*date|faktúra|faktura|invoice|dodávate|dodavatel|supplier|odberate|customer|tel\.|telefon|phone|email|www\.|http|objednáv|objednav|payment|platba|hotovos|karta|card|eur\b|€|usd|chf|czk|pln|discount|rabat|zľav|zlev|doprav|transport|shipping)\b/i;

const FINAL_TOTAL_LINE =
  /\b(k\s*úhrade|k\s*uhrade|na\s*úhradu|na\s*uhradu|uhradiť|uhradit|amount\s*due|total\s*due|gesamt|razem|grand\s*total|brutto|spolu\s*v\s*eur)\b/i;

type MoneyToken = { raw: string; value: number; start: number };

function normalizeLines(rawText: string): string[] {
  if (!rawText || typeof rawText !== "string") return [];
  return rawText
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .split(/\n/)
    .map((l) => l.replace(/[\t \u00A0]+/g, " ").trim())
    .filter(Boolean);
}

function extractMoneyTokens(line: string): MoneyToken[] {
  const out: MoneyToken[] = [];
  const re = /\d{1,3}(?:[ '\u00A0]\d{3})*(?:[.,]\d{2})|\d{1,6}[.,]\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[0];
    const value = parseMoneyToNumber(raw);
    if (value == null || value <= 0 || value > MAX_AMOUNT) continue;
    if (/^20\d{2}$/.test(raw.replace(/\s/g, ""))) continue;
    out.push({ raw, value, start: m.index });
  }
  return out;
}

function shouldSkipLine(line: string, lineIndex: number, totalLines: number): boolean {
  if (line.length < 4) return true;
  if (SKIP_LINE.test(line)) return true;
  if (FINAL_TOTAL_LINE.test(line)) return true;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(line.replace(/\s/g, ""))) return true;
  if (/^SK\d{2}\s*\d/i.test(line.replace(/\s/g, ""))) return true;
  if (/^\d{8,}$/.test(line.replace(/\D/g, "")) && line.replace(/\D/g, "").length >= 20) return true;
  const ratio = (lineIndex + 1) / Math.max(totalLines, 1);
  if (ratio > 0.82 && extractMoneyTokens(line).length <= 1 && line.length < 40) return true;
  return false;
}

function stripMoneyFromLine(line: string, tokens: MoneyToken[]): string {
  let desc = line;
  const sorted = [...tokens].sort((a, b) => b.start - a.start);
  for (const t of sorted) {
    desc = desc.slice(0, t.start) + " " + desc.slice(t.start + t.raw.length);
  }
  return desc.replace(/\s+/g, " ").replace(/^[\d.,\s×x*\-–|]+/, "").trim();
}

function parseQuantityUnitPrefix(line: string): { quantity?: number; unit?: string; rest: string } {
  const m = line.match(
    /^(\d+(?:[.,]\d{1,3})?)\s*(ks|pc|pcs|st|stk|bal|pack|m2|m²|m3|m³|bm|m|kg|g|l|lt|hod|h|deň|den|d)?[\s.:)\-–|]+(.*)$/i
  );
  if (!m) return { rest: line };
  const qty = parseMoneyToNumber(m[1]);
  if (qty == null || qty <= 0 || qty > 10_000) return { rest: line };
  const unit = m[2]?.toLowerCase().replace("m²", "m2").replace("m³", "m3");
  return { quantity: qty, unit, rest: (m[3] ?? "").trim() };
}

function parseQtyTimesPrice(line: string): { quantity?: number; unitPrice?: number } | null {
  const m = line.match(/(\d+(?:[.,]\d{1,3})?)\s*[×x*]\s*(\d+(?:[.,]\d{2})?)/);
  if (!m) return null;
  const quantity = parseMoneyToNumber(m[1]);
  const unitPrice = parseMoneyToNumber(m[2]);
  if (quantity == null || unitPrice == null) return null;
  return { quantity, unitPrice };
}

function parseTaxRate(line: string): number | undefined {
  const m = line.match(/\b(\d{1,2}(?:[.,]\d)?)\s*%\b/);
  if (!m) return undefined;
  const rate = parseMoneyToNumber(m[1]);
  if (rate == null || rate <= 0 || rate > 100) return undefined;
  return rate;
}

function amountsConsistent(qty: number, unitPrice: number, total: number): boolean {
  const expected = Math.round(qty * unitPrice * 100) / 100;
  const tol = Math.max(0.05, expected * 0.02);
  return Math.abs(expected - total) <= tol;
}

function scoreLineItem(item: ParsedDocumentLineItem): number {
  let score = 0.35;
  const desc = item.description?.trim() ?? "";
  if (desc.length >= MIN_DESCRIPTION_LEN) score += 0.15;
  if (desc.length >= 8) score += 0.05;
  if (item.total != null && item.total > 0) score += 0.15;
  if (item.unitPrice != null && item.unitPrice > 0) score += 0.1;
  if (item.quantity != null && item.quantity > 0) score += 0.1;
  if (item.unit) score += 0.05;
  if (
    item.quantity != null &&
    item.unitPrice != null &&
    item.total != null &&
    amountsConsistent(item.quantity, item.unitPrice, item.total)
  ) {
    score += 0.2;
  }
  return Math.min(1, score);
}

function parseLineItem(line: string, lineIndex: number, totalLines: number): ParsedDocumentLineItem | null {
  if (shouldSkipLine(line, lineIndex, totalLines)) return null;

  const tokens = extractMoneyTokens(line);
  if (tokens.length === 0) return null;

  const qtyPrice = parseQtyTimesPrice(line);
  const total = tokens[tokens.length - 1]!.value;
  let unitPrice: number | undefined =
    tokens.length >= 2 ? tokens[tokens.length - 2]!.value : undefined;
  let quantity: number | undefined = qtyPrice?.quantity;
  if (qtyPrice?.unitPrice != null) unitPrice = qtyPrice.unitPrice;

  const prefix = parseQuantityUnitPrefix(line);
  if (prefix.quantity != null) quantity = prefix.quantity;

  let description = stripMoneyFromLine(prefix.rest || line, tokens);
  description = description.replace(/\b\d{1,2}\s*%\b/g, "").replace(/\s+/g, " ").trim();

  if (description.length < MIN_DESCRIPTION_LEN) {
    if (tokens.length === 1 && line.length < 28) return null;
    if (description.length < 2) return null;
  }

  if (/^\d+$/.test(description)) return null;
  if (isInvalidMaterialLineName(description)) return null;
  if (SKIP_LINE.test(description) && description.length < 20) return null;

  const unitMatch = description.match(KNOWN_UNITS);
  let unit = prefix.unit;
  let originalUnit: string | undefined;
  if (!unit && unitMatch) {
    originalUnit = unitMatch[1]!;
    unit = unitMatch[1]!.toLowerCase().replace("m²", "m2").replace("m³", "m3");
    description = description.replace(KNOWN_UNITS, "").replace(/\s+/g, " ").trim();
  }
  if (unit) {
    const normalized = normalizeMaterialUnit(unit);
    unit = normalized.unit;
    originalUnit = originalUnit ?? normalized.originalUnit;
  }

  description = description.trim();
  if (!description || isInvalidMaterialLineName(description)) return null;
  if (description.length < MIN_DESCRIPTION_LEN) return null;

  if (quantity == null && unitPrice != null && amountsConsistent(1, unitPrice, total)) {
    quantity = 1;
  }
  if (quantity != null && unitPrice == null && quantity > 0 && total > 0) {
    const implied = Math.round((total / quantity) * 100) / 100;
    if (implied > 0 && implied <= MAX_AMOUNT) unitPrice = implied;
  }

  const taxRate = parseTaxRate(line);

  const item: ParsedDocumentLineItem = {
    description: description.slice(0, 200) || undefined,
    category: inferMaterialCategoryFromName(description),
    quantity,
    unit,
    originalUnit,
    unitPrice,
    total,
    taxRate,
  };

  item.confidence = scoreLineItem(item);
  if (item.confidence < 0.45) return null;

  return item;
}

function dedupeItems(items: ParsedDocumentLineItem[]): ParsedDocumentLineItem[] {
  const seen = new Set<string>();
  const out: ParsedDocumentLineItem[] = [];
  for (const item of items) {
    const key = [
      (item.description ?? "").toLowerCase(),
      item.quantity ?? "",
      item.total ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Best-effort extraction of invoice/receipt line items from OCR plain text.
 * Returns [] when uncertain; never throws.
 */
export function extractPossibleInvoiceLineItems(
  rawText: string,
  opts?: { currency?: string }
): ParsedDocumentLineItem[] {
  try {
    const lines = normalizeLines(rawText);
    if (lines.length < 3) return [];

    const items: ParsedDocumentLineItem[] = [];
    for (let i = 0; i < lines.length && items.length < MAX_LINE_ITEMS; i++) {
      const parsed = parseLineItem(lines[i]!, i, lines.length);
      if (parsed) items.push(parsed);
    }

    const currency = opts?.currency?.trim().toUpperCase();
    const deduped = dedupeItems(items)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, MAX_LINE_ITEMS)
      .map((item) => ({
        ...item,
        currency: item.currency ?? (currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined),
      }));

    return deduped;
  } catch {
    return [];
  }
}
