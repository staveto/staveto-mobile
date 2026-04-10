/**
 * Universal receipt/invoice parsing helpers.
 * Supports multi-currency, multi-format money parsing and total extraction.
 */

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

const TOTAL_KEYWORDS = [
  "TOTAL",
  "GRAND TOTAL",
  "AMOUNT DUE",
  "BALANCE DUE",
  "AMOUNT PAYABLE",
  "TO PAY",
  "PAYABLE",
  "SUMME",
  "GESAMT",
  "GESAMTSUMME",
  "RECHNUNGSBETRAG",
  "ZAHLBETRAG",
  "ENDSUMME",
  "BRUTTO",
  "NETTO",
  "FÄLLIG",
  "FAELLIG",
  "TOTAL TTC",
  "MONTANT",
  "A PAYER",
  "À PAYER",
  "TOTALE",
  "DA PAGARE",
  "IMPORTE",
  "IMPORTE TOTAL",
  "A PAGAR",
  "SPOLU",
  "SPOLU S DPH",
  "DPH SPOLU",
  "CELKOM",
  "CELKEM",
  "K ÚHRADE",
  "K ÚHRADĚ",
  "K UHRADĚ",
  "ÚHRADĚ",
  "NA ZAPLACENIE",
  "ZAPLATIŤ",
  "ÚHRADA",
  "UHRADA",
  "DO ZAPŁATY",
  "DO ZAPLATY",
  "RAZEM",
  "SUMA",
  "DO ZAPLATENIA",
  "ÖSSZESEN",
  "ÖSSZEG",
  "FIZETENDŐ",
  "FIZETENDO",
  "TOTAL PLATA",
  "DE PLATIT",
  "EFT", // Total-EFT on receipts
];

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
    const parts = s.split(",");
    if (parts[parts.length - 1].length === 2 && /^\d+$/.test(parts[parts.length - 1])) {
      normalized = s.replace(/,/g, ".");
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
  return n;
}

/** Extract numeric tokens from a line that could be money amounts */
function extractMoneyTokens(line: string): Array<{ raw: string; value: number }> {
  const tokens: Array<{ raw: string; value: number }> = [];
  const patterns = [
    /(\d{1,3}(?:[ '\u00A0]\d{3})*(?:[.,]\d{2})?)/g,
    /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/g,
    /(\d{1,6}[.,]\d{2})/g,
    /(\d{1,6}[.,]\d)/g,
    /(\d{1,8})/g,
  ];
  const seen = new Set<number>(); // per-line dedupe
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const v = parseMoneyUniversal(m[1]);
      if (v != null && v > 0 && v <= 999_999.99 && !seen.has(v)) {
        seen.add(v);
        tokens.push({ raw: m[1], value: v });
      }
    }
  }
  return tokens;
}

export type PickBestTotalResult = {
  money?: Money;
  confidence: number;
  reason?: string;
  matchedLine?: string;
  candidatesTop?: Array<{ line: string; money: Money; score: number; reason: string }>;
};

/** Pick best total from raw text using scoring. */
export function pickBestTotalFromText(rawText: string): PickBestTotalResult {
  if (!rawText || typeof rawText !== "string") {
    return { confidence: 0 };
  }
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const globalCandidates = detectCurrencyCandidates(rawText);
  const topCurrency: CurrencyCode = globalCandidates[0]?.currency ?? "UNKNOWN";

  const candidates: Array<{ line: string; money: Money; score: number; reason: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineCandidates = detectCurrencyCandidates(line);
    const currency: CurrencyCode = lineCandidates[0]?.currency ?? topCurrency;

    const tokens = extractMoneyTokens(line);
    for (const { value } of tokens) {
      let score = 0;
      const reasons: string[] = [];

      // Bottom-position bonus (last third of document)
      const lineRatio = (i + 1) / lines.length;
      if (lineRatio >= 0.6) {
        score += 15;
        reasons.push("bottom");
      } else if (lineRatio >= 0.4) {
        score += 5;
      }

      // Keyword bonus
      const lineUpper = line.toUpperCase();
      for (const kw of TOTAL_KEYWORDS) {
        if (lineUpper.includes(kw)) {
          score += 12;
          reasons.push(`kw:${kw}`);
          break;
        }
      }
      if (lineUpper.includes("TOTAL") && lineUpper.includes("EFT")) {
        score += 18;
        reasons.push("total-eft");
      }

      // Penalize bad context
      if (BAD_CONTEXT_REGEX.test(line)) {
        score -= 25;
        reasons.push("bad-ctx");
      }

      // Penalize tax rate lines (e.g. "MWST B 8.10%" or "VAT 20%")
      if (/%\s*$|^\s*\d+[.,]?\d*%|\b(?:MWST|VAT|TAX)\s+[A-Z]?\s*\d/i.test(line)) {
        score -= 15;
        reasons.push("tax-rate");
      }

      // Prefer decimals (two decimals) unless JPY/VND/KRW
      const hasDecimals = value % 1 !== 0;
      const isIntegerOnly = INTEGER_ONLY_CURRENCIES.includes(currency);
      if (hasDecimals && !isIntegerOnly) {
        score += 10;
        reasons.push("decimals");
      } else if (!hasDecimals && !isIntegerOnly && value < 1000) {
        score -= 5;
        reasons.push("no-decimals");
      }

      // Sanity range
      if (value <= 5000) score += 5;
      if (value > 20000) score -= 15;

      // Penalize long integers that look like refs (e.g. 874371)
      if (!hasDecimals && value >= 100000 && value < 1000000) {
        score -= 20;
        reasons.push("likely-ref");
      }

      if (score > 0) {
        candidates.push({
          line,
          money: { amount: value, currency },
          score,
          reason: reasons.join(","),
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const second = candidates[1];
  const gap = top ? (second ? top.score - second.score : top.score) : 0;
  const confidence = top ? Math.min(1, Math.max(0, (top.score + gap * 0.5) / 50)) : 0;

  return {
    money: top?.money,
    confidence,
    reason: top?.reason,
    matchedLine: top?.line,
    candidatesTop: candidates.slice(0, 5),
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
