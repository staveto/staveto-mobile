/**
 * Universal receipt/invoice parsing helpers.
 * Supports multi-currency, multi-format money parsing and total extraction.
 */

import { detectLocaleContext, getMergedFinalTotalLabelRules } from "../lib/localePacks";
import type { FinalTotalLineRule } from "../lib/localePacks/types";
import { isPlaceholderOrMockOcrText } from "./ocrPlaceholderGuards";

export type CurrencyCode =
  | "EUR"
  | "CHF"
  | "USD"
  | "GBP"
  | "CZK"
  | "PLN"
  | "HUF"
  | "SEK"
  | "NOK"
  | "DKK"
  | "RON"
  | "BGN"
  | "HRK"
  | "AED"
  | "SAR"
  | "QAR"
  | "KWD"
  | "JPY"
  | "CNY"
  | "HKD"
  | "SGD"
  | "KRW"
  | "INR"
  | "THB"
  | "VND"
  | "IDR"
  | "MYR"
  | "PHP"
  | "AUD"
  | "CAD"
  | "NZD"
  | "TRY"
  | "ZAR"
  | "BRL"
  | "MXN"
  | "ILS"
  | "UNKNOWN";

export type Money = { amount: number; currency: CurrencyCode };

export type CurrencyCandidate = {
  currency: CurrencyCode;
  reason: "iso" | "symbol" | "text";
  count: number;
};

const ISO_CURRENCY_REGEX =
  /\b(EUR|CHF|USD|GBP|CZK|PLN|HUF|SEK|NOK|DKK|RON|BGN|HRK|AED|SAR|QAR|KWD|JPY|CNY|HKD|SGD|KRW|INR|THB|VND|IDR|MYR|PHP|AUD|CAD|NZD|TRY|ZAR|BRL|MXN|ILS)\b/gi;

const SWISS_FRANC_REGEX = /\b(?:Fr\.?|SFr\.?|CHF)\b/gi;

const INTEGER_ONLY_CURRENCIES: CurrencyCode[] = ["JPY", "VND", "KRW"];

const RECEIPT_STYLE_TOTAL_LINE =
  /\b(SUMME|TOTAL-EFT|ENDSUMME|RECHNUNGSBETRAG|GESAMTSUMME|ZAHLBETRAG)\b/i;

const BAD_CONTEXT_REGEX =
  /\b(AUTH|APPROVAL|AID|RRN|REF|REFERENCE|TRANSACTION|TERMINAL|MID|TID|ACQ|CARD|VISA|MASTERCARD)\b/i;

/** Detect currency candidates from raw text. Sorted by count desc. */
export function detectCurrencyCandidates(rawText: string): CurrencyCandidate[] {
  if (!rawText || typeof rawText !== "string") return [{ currency: "UNKNOWN", reason: "text", count: 1 }];

  const counts = new Map<CurrencyCode, { count: number; reason: "iso" | "symbol" | "text" }>();

  // ISO codes (high weight)
  let m: RegExpExecArray | null;
  const isoRe = new RegExp(ISO_CURRENCY_REGEX.source, "gi");
  while ((m = isoRe.exec(rawText)) !== null) {
    const code = m[1].toUpperCase() as CurrencyCode;
    const cur = counts.get(code);
    counts.set(code, { count: (cur?.count ?? 0) + 10, reason: "iso" });
  }

  // Swiss Fr. / SFr
  const swissRe = new RegExp(SWISS_FRANC_REGEX.source, "gi");
  while ((m = swissRe.exec(rawText)) !== null) {
    const cur = counts.get("CHF");
    counts.set("CHF", { count: (cur?.count ?? 0) + 8, reason: "text" });
  }

  // Symbols (lower weight due to ambiguity)
  const symbolMap: [RegExp, CurrencyCode][] = [
    [/€/g, "EUR"],
    [/£/g, "GBP"],
    [/¥|￥/g, "JPY"],
    [/₩/g, "KRW"],
    [/₹/g, "INR"],
    [/₫/g, "VND"],
    [/R\$/g, "BRL"],
    [/HK\$/g, "HKD"],
    [/S\$/g, "SGD"],
    [/A\$/g, "AUD"],
    [/C\$/g, "CAD"],
    [/\$/g, "USD"], // ambiguous, lowest
  ];
  for (const [re, code] of symbolMap) {
    const matches = rawText.match(re);
    if (matches) {
      const cur = counts.get(code);
      const add = code === "USD" ? 1 : 3;
      counts.set(code, { count: (cur?.count ?? 0) + add * matches.length, reason: "symbol" });
    }
  }

  const arr: CurrencyCandidate[] = Array.from(counts.entries()).map(([currency, v]) => ({
    currency,
    reason: v.reason,
    count: v.count,
  }));
  arr.sort((a, b) => b.count - a.count);
  if (arr.length === 0) return [{ currency: "UNKNOWN", reason: "text", count: 1 }];
  return arr;
}

/** Parse money from string. Supports 1'234.50, 1 234,50, 1.234,50, 12.95, 12,95 */
export function parseMoneyUniversal(
  input: string,
  _currencyHint?: CurrencyCode
): number | null {
  if (input == null || typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  // Remove common currency symbols and codes for number extraction
  s = s
    .replace(/\s+/g, " ")
    .replace(/€|£|¥|₩|₹|₫|R\$|HK\$|S\$|A\$|C\$/g, "")
    .replace(/\b(EUR|CHF|USD|GBP|CZK|PLN|Fr\.?|SFr\.?)\b/gi, "");
  s = s.replace(/[^\d\s,.'\-]/g, "");
  s = s.replace(/\s/g, "");
  if (!s) return null;

  // Normalize apostrophes to space for thousands
  s = s.replace(/['']/g, " ");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "").replace(".", ".");
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(",").filter((p) => p.length > 0);
    const lastPart = parts[parts.length - 1] ?? "";
    const allIntPartsNumeric = parts.slice(0, -1).every((p) => /^\d+$/.test(p));
    if (parts.length >= 2 && /^\d{2}$/.test(lastPart) && allIntPartsNumeric) {
      const intCombined = parts.slice(0, -1).join("");
      const intNorm = intCombined.replace(/^0+(?=\d)/, "") || "0";
      normalized = `${intNorm}.${lastPart}`;
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasDot && !hasComma) {
    const parts = s.split(".");
    if (parts[parts.length - 1].length === 2 && /^\d+$/.test(parts[parts.length - 1])) {
      normalized = s;
    } else {
      normalized = s.replace(/\./g, "");
    }
  } else {
    normalized = s;
  }
  normalized = normalized.replace(/\s/g, "").replace(/'/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0 || n > 999_999.99) return null;
  return Math.round(n * 100) / 100;
}

/** One monetary amount span on a line (non-overlapping after merge). */
export type MoneyLexeme = { raw: string; value: number; start: number; end: number };

/**
 * OCR money spans — ordered most-specific first so `2.009,80` wins over inner `009,80`.
 * `(?!\d)` avoids extending into a third decimal digit.
 */
const MONEY_AMOUNT_REGEXES: readonly RegExp[] = [
  /\d{1,3}(?:\.\d{3})+,\d{2}(?!\d)/g,
  /\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)/g,
  /\d{1,3}(?:['\s\u00A0]\d{3})+,\d{2}(?!\d)/g,
  /\d{1,3}(?:['\s\u00A0]\d{3})+\.\d{2}(?!\d)/g,
  /\d+,\d{2}(?!\d)/g,
  /\d+\.\d{2}(?!\d)/g,
];

function mergeNonOverlappingMoneySpans(spans: MoneyLexeme[]): MoneyLexeme[] {
  const sorted = [...spans].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start
  );
  const picked: MoneyLexeme[] = [];
  for (const s of sorted) {
    if (picked.some((p) => !(s.end <= p.start || s.start >= p.end))) continue;
    picked.push(s);
  }
  picked.sort((a, b) => a.start - b.start || a.end - b.end);
  const byKey = new Map<string, MoneyLexeme>();
  for (const p of picked) {
    const k = `${p.start}:${p.end}:${p.raw}`;
    if (!byKey.has(k)) byKey.set(k, p);
  }
  return Array.from(byKey.values()).sort((a, b) => a.start - b.start);
}

/** Extract money amounts from a line without overlapping EU/US sub-fragments (e.g. never `009,80` inside `2.009,80`). */
function extractMoneyTokens(line: string): MoneyLexeme[] {
  const rawMatches: MoneyLexeme[] = [];
  const seenKey = new Set<string>();
  for (const re of MONEY_AMOUNT_REGEXES) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(line)) !== null) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      const key = `${start},${end}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      const v = parseMoneyUniversal(raw);
      if (v != null && v > 0 && v <= 999_999.99) {
        rawMatches.push({ raw, value: v, start, end });
      }
    }
  }
  return mergeNonOverlappingMoneySpans(rawMatches);
}

/**
 * Invoice years (2024, 2025…) are often parsed as amounts via the generic `\d+` token pass.
 * Skip bare 4-digit year tokens unless the same line clearly contains a decimal money amount.
 */
function shouldSkipBareYearMoneyToken(raw: string, value: number, line: string): boolean {
  const compact = raw.replace(/\s/g, "");
  if (!/^\d{4}$/.test(compact)) return false;
  if (value < 1990 || value > 2035) return false;
  if (/\d{1,3}(?:[ \u00a0']\d{3})*[.,]\d{2}/.test(line)) return false;
  return true;
}

/** e.g. `2025-001` or `FA2025-12` must not yield money token `2025`. */
function shouldSkipInvoiceSerialMoneyToken(raw: string, value: number, line: string): boolean {
  const compact = raw.replace(/\s/g, "").replace(/–/g, "-");
  if (/^20\d{2}-\d{2,}$/.test(compact) || /^20\d{2}\/\d{2,}$/.test(compact)) return true;
  if (Number.isInteger(value) && value >= 1990 && value <= 2035) {
    if (/\b20\d{2}\s*[-–/]\s*\d/.test(line) && new RegExp(`\\b${value}\\s*[-–/]`).test(line)) return true;
  }
  return false;
}

/**
 * Skip `DD.MM` / `DD,MM` when it begins a European calendar date `DD.MM.YY` or `DD.MM.YYYY` on the same line.
 * OCR otherwise treats `16.04` in `Datum: 16.04.26` as a decimal amount (e.g. Swiss retail receipts).
 */
function shouldSkipEuropeanDatePrefixMoneyToken(line: string, tokenStart: number, raw: string): boolean {
  const head = line.slice(tokenStart);
  const normToken = raw.replace(/,/g, ".");
  const m = head.match(/^(\d{1,2})[.,](\d{2})[.,](\d{2}|\d{4})\b/);
  if (!m) return false;
  const rebuilt = `${m[1]}.${m[2]}`;
  if (rebuilt !== normToken) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return false;
  return true;
}

export type InvoiceTotalCandidateKind =
  | "final_total"
  | "subtotal"
  | "vat"
  | "item_row"
  | "unit_price_hint"
  | "other"
  | "fallback_line_sum";

export type InvoiceTotalCandidateDebug = {
  lineIndex: number;
  line: string;
  amount: number;
  currency: CurrencyCode;
  classification: InvoiceTotalCandidateKind;
  finalLabelTier: number | null;
  finalLabelId: string | null;
  score: number;
  scoreParts: string[];
  /** Matched money substring (e.g. `2.009,80`). */
  rawToken: string;
  tokenStart: number;
  tokenEnd: number;
};

export type PickBestTotalResult = {
  money?: Money;
  confidence: number;
  reason?: string;
  matchedLine?: string;
  /** Matched substring for `money` on `matchedLine` (debug / receipts). */
  winnerRawToken?: string;
  selectionExplanation?: string;
  candidatesTop?: Array<{
    line: string;
    money: Money;
    score: number;
    reason: string;
    classification: InvoiceTotalCandidateKind;
    finalLabelTier: number | null;
    finalLabelId: string | null;
    rawToken: string;
    tokenStart: number;
    tokenEnd: number;
  }>;
  candidatesDebug?: InvoiceTotalCandidateDebug[];
};

const EXPLICIT_SCORE_BASE = 10_000;
const NON_EXPLICIT_SCORE_CAP = 2_200;

function matchExplicitFinalTotalLabel(
  line: string,
  rules: readonly FinalTotalLineRule[]
): { tier: number; id: string } | null {
  const l = line;
  if (/\bzáklad\b/i.test(l) || /\bzaklad\b/i.test(l)) return null;
  if (/\bcelkom\s+bez\b/i.test(l) || /\bcelkem\s+bez\b/i.test(l)) return null;
  for (const rule of rules) {
    if (rule.match(l)) return { tier: rule.tier, id: rule.id };
  }
  return null;
}

function hasUnitPriceContext(line: string): boolean {
  return /\b(jednotkov|jednotk|za\s*ks|\/ks|\bks\s*[×x*]|\bMJ\b|cena\s*za|unit\s*price|cena\/jedn|\/\s*jedn)/i.test(
    line
  );
}

function looksLikeItemRow(line: string, lineIndex: number, totalLines: number): boolean {
  if (totalLines < 1) return false;
  const ratio = (lineIndex + 1) / totalLines;
  if (ratio > 0.78) return false;
  const moneyLike = line.match(/\d{1,3}(?:[ '\u00A0]\d{3})*(?:[.,]\d{2})|\d{1,6}[.,]\d{2}/g);
  if (moneyLike && moneyLike.length >= 2) return true;
  if (/\b\d{1,5}\s*[×x*]\s*\d+[.,]\d{2}/.test(line)) return true;
  if (/^\d{1,2}\s+[A-Za-zÀ-ž]/.test(line) && /\d+[.,]\d{2}\s*$/.test(line.trim())) return true;
  return false;
}

function isSubtotalLine(line: string, explicitOnLine: boolean): boolean {
  if (explicitOnLine) return false;
  return (
    /\b(bez\s*dph|základ|zaklad|subtotal|mezisúčet|medzisucet|partial|netto)\b/i.test(line) &&
    !/\bbrutto\b/i.test(line)
  );
}

function isVatAmountLine(line: string, explicitOnLine: boolean): boolean {
  if (explicitOnLine) return false;
  if (/\b(dph|vat|mwst|ust\.?)\s*[:=]\s*\d/i.test(line)) return true;
  if (/\bcelkom\s+dph\b/i.test(line) || /\bcelkem\s+dph\b/i.test(line)) return true;
  if (/\b(dph|vat)\s+celkom\b/i.test(line)) return true;
  if (/\b(sadzba|daňová|danova|taxable\s+amount)\b/i.test(line)) return true;
  if (/%/.test(line) && /\d+[.,]\d{2}/.test(line) && /\b(dph|vat|mwst|tax)\b/i.test(line)) return true;
  return false;
}

function classifyForDebug(
  explicit: { tier: number; id: string } | null,
  line: string,
  lineIndex: number,
  totalLines: number,
  tokenIsPrimaryOnExplicitLine: boolean
): InvoiceTotalCandidateKind {
  if (explicit && tokenIsPrimaryOnExplicitLine) return "final_total";
  if (explicit && !tokenIsPrimaryOnExplicitLine) return "other";
  if (isVatAmountLine(line, !!explicit)) return "vat";
  if (isSubtotalLine(line, !!explicit)) return "subtotal";
  if (hasUnitPriceContext(line)) return "unit_price_hint";
  if (looksLikeItemRow(line, lineIndex, totalLines)) return "item_row";
  return "other";
}

/** True if inner span is strictly contained in outer (same OCR line) — inner is a fragment of the full amount. */
function isStrictSubSpan(
  innerStart: number,
  innerEnd: number,
  outerStart: number,
  outerEnd: number
): boolean {
  return (
    innerStart >= outerStart &&
    innerEnd <= outerEnd &&
    (innerStart > outerStart || innerEnd < outerEnd)
  );
}

function compareInvoiceAmountCandidates(
  a: InvoiceTotalCandidateDebug,
  b: InvoiceTotalCandidateDebug
): number {
  const aEx = a.finalLabelTier;
  const bEx = b.finalLabelTier;
  const aHas = aEx != null;
  const bHas = bEx != null;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas && aEx !== bEx) return aEx - bEx;
  if (a.score !== b.score) return b.score - a.score;
  if (a.lineIndex === b.lineIndex) {
    const aInB = isStrictSubSpan(a.tokenStart, a.tokenEnd, b.tokenStart, b.tokenEnd);
    const bInA = isStrictSubSpan(b.tokenStart, b.tokenEnd, a.tokenStart, a.tokenEnd);
    if (aInB && !bInA) return 1;
    if (bInA && !aInB) return -1;
    if (Math.abs(a.amount - b.amount) > 1e-6) return b.amount - a.amount;
    return b.rawToken.length - a.rawToken.length;
  }
  return b.lineIndex - a.lineIndex;
}

function estimateLineItemsSum(
  lines: string[],
  explicitRules: readonly FinalTotalLineRule[]
): { sum: number; linesUsed: number } | null {
  const n = lines.length;
  if (n < 4) return null;
  let sum = 0;
  let used = 0;
  const start = Math.max(1, Math.floor(n * 0.1));
  const end = Math.min(n - 1, Math.ceil(n * 0.8));
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!looksLikeItemRow(line, i, n)) continue;
    if (isVatAmountLine(line, false) || isSubtotalLine(line, false)) continue;
    if (matchExplicitFinalTotalLabel(line, explicitRules)) continue;
    const tokens = extractMoneyTokens(line);
    if (tokens.length === 0) continue;
    sum += tokens[tokens.length - 1]!.value;
    used += 1;
  }
  if (used < 2) return null;
  return { sum: Math.round(sum * 100) / 100, linesUsed: used };
}

/** Pick best total from raw text: prioritized final-total labels, penalties, optional line-sum boost. */
export function pickBestTotalFromText(rawText: string): PickBestTotalResult {
  if (!rawText || typeof rawText !== "string") {
    return { confidence: 0 };
  }
  if (isPlaceholderOrMockOcrText(rawText)) {
    return { confidence: 0 };
  }
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const explicitRules = getMergedFinalTotalLabelRules(rawText);
  const globalCandidates = detectCurrencyCandidates(rawText);
  const topCurrency: CurrencyCode = globalCandidates[0]?.currency ?? "UNKNOWN";

  const candidates: InvoiceTotalCandidateDebug[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPlaceholderOrMockOcrText(line)) {
      continue;
    }
    const lineCandidates = detectCurrencyCandidates(line);
    const currency: CurrencyCode = lineCandidates[0]?.currency ?? topCurrency;
    const explicit = matchExplicitFinalTotalLabel(line, explicitRules);
    const tokens = extractMoneyTokens(line);
    let primaryTokenIndex = -1;
    if (tokens.length > 0) {
      let bestEnd = -1;
      for (let j = 0; j < tokens.length; j++) {
        if (tokens[j].end > bestEnd) {
          bestEnd = tokens[j].end;
          primaryTokenIndex = j;
        }
      }
    }

    for (let ti = 0; ti < tokens.length; ti++) {
      const { value, raw, start, end } = tokens[ti];
      if (shouldSkipBareYearMoneyToken(raw, value, line)) continue;
      if (shouldSkipInvoiceSerialMoneyToken(raw, value, line)) continue;
      if (shouldSkipEuropeanDatePrefixMoneyToken(line, start, raw)) continue;

      const tokenIsPrimaryOnExplicitLine = explicit != null && ti === primaryTokenIndex;
      const effectiveExplicit = tokenIsPrimaryOnExplicitLine ? explicit : null;

      const classification = classifyForDebug(
        explicit,
        line,
        i,
        lines.length,
        tokenIsPrimaryOnExplicitLine
      );

      const lineRatio = (i + 1) / lines.length;
      const scoreParts: string[] = [];
      let score = 0;

      if (effectiveExplicit) {
        score = EXPLICIT_SCORE_BASE - (effectiveExplicit.tier - 1) * 45;
        scoreParts.push(`explicit:${effectiveExplicit.id}(tier${effectiveExplicit.tier})`);
        if (lineRatio >= 0.55) {
          score += 30;
          scoreParts.push("near_bottom(+30)");
        } else if (lineRatio >= 0.35) {
          score += 10;
          scoreParts.push("mid_doc(+10)");
        }
      } else {
        if (explicit != null && !tokenIsPrimaryOnExplicitLine) {
          score -= 2_400;
          scoreParts.push("penalty:non_primary_amount_on_explicit_total_line(-2400)");
        }
        if (lineRatio >= 0.62) {
          score += 220;
          scoreParts.push("bottom(+220)");
        } else if (lineRatio >= 0.45) {
          score += 90;
          scoreParts.push("lower_half(+90)");
        } else {
          score += 20;
          scoreParts.push("upper(+20)");
        }

        if (RECEIPT_STYLE_TOTAL_LINE.test(line)) {
          score += 380;
          scoreParts.push("receipt_total_hint(+380)");
        }
        if (line.toUpperCase().includes("TOTAL") && line.toUpperCase().includes("EFT")) {
          score += 120;
          scoreParts.push("total_eft(+120)");
        }

        if (BAD_CONTEXT_REGEX.test(line)) {
          score -= 280;
          scoreParts.push("bad_ctx(-280)");
        }

        if (/%\s*$|^\s*\d+[.,]?\d*%|\b(?:MWST|VAT|TAX)\s+[A-Z]?\s*\d/i.test(line)) {
          score -= 120;
          scoreParts.push("tax_rate_line(-120)");
        }

        switch (classification) {
          case "vat":
            score -= 900;
            scoreParts.push("penalty:vat(-900)");
            break;
          case "subtotal":
            score -= 700;
            scoreParts.push("penalty:subtotal(-700)");
            break;
          case "item_row":
            score -= 650;
            scoreParts.push("penalty:item_row(-650)");
            break;
          case "unit_price_hint":
            score -= 550;
            scoreParts.push("penalty:unit_price(-550)");
            break;
          default:
            break;
        }

        const hasDecimals = value % 1 !== 0;
        const isIntegerOnly = INTEGER_ONLY_CURRENCIES.includes(currency);
        if (hasDecimals && !isIntegerOnly) {
          score += 70;
          scoreParts.push("decimals(+70)");
        } else if (!hasDecimals && !isIntegerOnly && value < 1000) {
          score -= 40;
          scoreParts.push("weak_integer(-40)");
        }

        if (value <= 8000) score += 25;
        if (value > 25_000) score -= 80;

        if (!hasDecimals && value >= 100_000 && value < 1_000_000) {
          score -= 180;
          scoreParts.push("likely_ref(-180)");
        }

        score = Math.min(score, NON_EXPLICIT_SCORE_CAP);
        scoreParts.push(`cap<=${NON_EXPLICIT_SCORE_CAP}`);
      }

      if (score <= 0 && effectiveExplicit == null) continue;

      candidates.push({
        lineIndex: i,
        line,
        amount: value,
        currency,
        classification,
        finalLabelTier: effectiveExplicit?.tier ?? null,
        finalLabelId: effectiveExplicit?.id ?? null,
        score,
        scoreParts,
        rawToken: raw,
        tokenStart: start,
        tokenEnd: end,
      });
    }
  }

  const hasAnyExplicit = candidates.some((c) => c.finalLabelTier != null);
  const lineSumInfo = !hasAnyExplicit ? estimateLineItemsSum(lines, explicitRules) : null;
  if (lineSumInfo != null) {
    const tol = Math.max(0.5, lineSumInfo.sum * 0.02);
    for (const c of candidates) {
      if (c.finalLabelTier != null) continue;
      if (Math.abs(c.amount - lineSumInfo.sum) <= tol) {
        c.score += 900;
        c.scoreParts.push(`boost:near_line_sum(${lineSumInfo.sum},±${tol.toFixed(2)})(+900)`);
        c.score = Math.min(c.score, NON_EXPLICIT_SCORE_CAP + 900);
      }
    }
  }

  candidates.sort(compareInvoiceAmountCandidates);
  const top = candidates[0];
  const second = candidates[1];

  let selectionExplanation = "no_candidate";
  if (top) {
    if (top.finalLabelTier != null) {
      selectionExplanation = `explicit_label:${top.finalLabelId ?? "?"},tier=${top.finalLabelTier} beats non-final rows (priority order K úhrade → … → Brutto)`;
    } else if (lineSumInfo && Math.abs(top.amount - lineSumInfo.sum) <= Math.max(0.5, lineSumInfo.sum * 0.02)) {
      selectionExplanation = `no_explicit_final_label;winner_aligned_with_line_item_sum(${lineSumInfo.sum},n=${lineSumInfo.linesUsed})`;
    } else {
      selectionExplanation =
        "no_explicit_final_label;best_scored_non_item/vat/unit_candidate(fallback_heuristic)";
    }
    if (second && compareInvoiceAmountCandidates(top, second) === 0) {
      selectionExplanation += ";tie_broken_equal_rank";
    }
  }

  const gap = top ? (second ? top.score - second.score : top.score) : 0;
  let confidence = 0;
  if (top) {
    if (top.finalLabelTier != null) {
      confidence = Math.min(1, 0.82 + (10 - top.finalLabelTier) * 0.015 + Math.min(0.08, gap / 500));
    } else {
      confidence = Math.min(1, Math.max(0.12, (top.score + gap * 0.35) / 2800));
    }
  }

  const candidatesTop = candidates.slice(0, 8).map((c) => ({
    line: c.line,
    money: { amount: c.amount, currency: c.currency },
    score: c.score,
    reason: c.scoreParts.join(";"),
    classification: c.classification,
    finalLabelTier: c.finalLabelTier,
    finalLabelId: c.finalLabelId,
    rawToken: c.rawToken,
    tokenStart: c.tokenStart,
    tokenEnd: c.tokenEnd,
  }));

  if (__DEV__ && candidates.length > 0) {
    const localeCtx = detectLocaleContext(rawText);
    console.log("[invoiceUniversal] pickBestTotalFromText", {
      localeRegions: localeCtx.regions,
      localeHints: localeCtx.hints,
      selectionExplanation,
      winnerAmount: top?.amount,
      winnerRawToken: top?.rawToken,
      winnerTokenSpan: top ? [top.tokenStart, top.tokenEnd] : null,
      winnerClassification: top?.classification,
      winnerLabelTier: top?.finalLabelTier,
      winnerLine: top?.line?.slice(0, 200),
      lineItemSumEstimate: lineSumInfo?.sum ?? null,
      monetaryCandidates: candidates.map((c) => ({
        amount: c.amount,
        rawToken: c.rawToken,
        tokenSpan: [c.tokenStart, c.tokenEnd],
        classification: c.classification,
        isFinalTotalLine: c.finalLabelTier != null,
        finalLabelTier: c.finalLabelTier,
        finalLabelId: c.finalLabelId,
        score: c.score,
        lineIndex: c.lineIndex,
        line: c.line.slice(0, 160),
        scoreParts: c.scoreParts,
      })),
    });
  }

  return {
    money: top ? { amount: top.amount, currency: top.currency } : undefined,
    confidence,
    reason: top?.scoreParts.join(";"),
    matchedLine: top?.line,
    winnerRawToken: top?.rawToken,
    selectionExplanation,
    candidatesTop,
    candidatesDebug: candidates,
  };
}

/**
 * Dev helper: run with sample OTTO'S receipt rawText to verify parsing.
 * Call from console or a dev-only script.
 */
export function __devTestOttoReceipt(): PickBestTotalResult {
  const sample = `
OTTO'S Siebnen
MWST-Nr. CHE-106.843.612

Michelino Edelstahl Wass    437210    CHF 12.95 B

SUMME [1]                    CHF 12.95
Total-EFT CHF                CHF 12.95

Visa Debit contactless
XXXXXXXXXXXX3095
31.01.2026

MWST B 8.10%    CHF 0.97
BRUTTO          CHF 12.95
NETTO           CHF 11.98

Datum 31.01.26  Uhrzeit 16:03
Fil Pos Bed Bon 033 101 9465 0574
`;
  return pickBestTotalFromText(sample);
}
