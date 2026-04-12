import { parseMoneyToNumber } from "../helpers/parseMoney";
import type { RejectedCandidate } from "../lib/expenseDocumentParseTypes";
import { isPlaceholderOrMockOcrText } from "../utils/ocrPlaceholderGuards";
import type { ScoredCandidate } from "../lib/parsedDocumentTypes";
import { isPlainObject } from "../utils/isPlainObject";
import {
  detectCurrencyCandidates,
  parseMoneyUniversal,
  pickBestTotalFromText,
  type CurrencyCode,
  type Money,
} from "../utils/invoiceUniversal";
import { FIELD_LABEL_SYNONYMS, getEffectiveFieldSynonyms, type FieldConcept } from "./documentFieldDictionary";

const COMPANY_SUFFIX =
  /\b(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|sro|as|gmbh|ag|ltd|limited|inc\.?|llc|spa|srl|s\.a\.|s\.l\.|kft|zrt|sp\.?\s*z\s*o\.?\s*o\.?|s\.p\.a\.)\b/i;

const NOISE_LINE =
  /^(www\.|http|https|tel:|mailto:|iban|bic|swift|@)/i;

const VS_LINE = /variabil|variable\s*symbol|^vs[\s:.]*\d|\bvs\b[\s:.]*\d{6,}/i;

/** Maps `pickBestTotalFromText` row scores to 0–1 (aligned with new explicit / penalty model). */
function confidenceFromInvoiceTotalPickRow(row: { score: number; finalLabelTier: number | null }): number {
  if (row.finalLabelTier != null) {
    return Math.min(1, 0.86 + (11 - row.finalLabelTier) * 0.017);
  }
  return Math.min(1, Math.max(0.22, row.score / 980));
}

/** Safe line split for OCR blobs. */
export function splitTextLines(rawText: string): string[] {
  if (!rawText || typeof rawText !== "string") return [];
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns 0..1 bonus when line contains any synonym for the concept. */
export function labelBonusForConcepts(
  line: string,
  concepts: FieldConcept[],
  labelContextText?: string | null
): number {
  const syn = labelContextText ? getEffectiveFieldSynonyms(labelContextText) : FIELD_LABEL_SYNONYMS;
  const low = line.toLowerCase();
  let best = 0;
  for (const c of concepts) {
    const labels = syn[c];
    for (const lab of labels) {
      if (lab.length < 2) continue;
      if (low.includes(lab.toLowerCase())) {
        best = Math.max(best, Math.min(0.35, 0.12 + lab.length * 0.008));
      }
    }
  }
  return best;
}

/** Rough BCP-47-ish hint for UI / soft parsing (not a full CLD). */
export function detectLanguageHint(rawText: string): string | undefined {
  const t = rawText.slice(0, 8000);
  const scores: Record<string, number> = {
    sk: 0,
    cs: 0,
    en: 0,
    de: 0,
    pl: 0,
    hu: 0,
  };
  const bump = (lang: keyof typeof scores, w: number) => {
    scores[lang] += w;
  };
  if (/\b(faktúra|dodávateľ|dátum\s*vystavenia|ičo|ič\s*dph|splatnosť)\b/i.test(t)) bump("sk", 3);
  if (/\b(faktura|dodavatel|datum\s*vystavení|ičo|dič|splatnost)\b/i.test(t)) bump("cs", 3);
  if (/\b(invoice|supplier|vat\s*id|due\s*date|amount\s*due)\b/i.test(t)) bump("en", 2);
  if (/\b(rechnung|lieferant|ust[\s-]?id|faellig|brutto|netto)\b/i.test(t)) bump("de", 3);
  if (/\b(faktura|nabywca|sprzedawca|termin\s*płatności|nip)\b/i.test(t)) bump("pl", 3);
  if (/\b(számla|adószám|áfa|fizetendő|szállító)\b/i.test(t)) bump("hu", 3);
  let best: string | undefined;
  let max = 0;
  for (const k of Object.keys(scores)) {
    if (scores[k] > max) {
      max = scores[k];
      best = k;
    }
  }
  return max >= 2 ? best : undefined;
}

const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DATE_DMY = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/;

export function normalizeDateToIso(raw: string | null | undefined): string | undefined {
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
  const m2 = s.match(DATE_DMY);
  if (m2) {
    let y = m2[3];
    if (y.length === 2) y = `20${y}`;
    if (y.length === 4) {
      const d = m2[1].padStart(2, "0");
      const mo = m2[2].padStart(2, "0");
      return `${y}-${mo}-${d}`;
    }
  }
  const m3 = s.match(DATE_ISO);
  if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
  return undefined;
}

function extractDatesFromLine(line: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const reIso = new RegExp(DATE_ISO.source, "g");
  while ((m = reIso.exec(line)) !== null) {
    const iso = normalizeDateToIso(m[0]);
    if (iso) out.push(iso);
  }
  const reDmy = new RegExp(DATE_DMY.source, "g");
  while ((m = reDmy.exec(line)) !== null) {
    const iso = normalizeDateToIso(m[0]);
    if (iso) out.push(iso);
  }
  return out;
}

function scoreDateLine(
  line: string,
  lineIndex: number,
  totalLines: number,
  concepts: FieldConcept[],
  labelContextText?: string | null
): number {
  let score = 0.2;
  const ratio = totalLines > 0 ? (lineIndex + 1) / totalLines : 0.5;
  score += labelBonusForConcepts(line, concepts, labelContextText);
  if (/\b(auth|terminal|visa|mastercard|mid|tid)\b/i.test(line)) score -= 0.5;
  if (ratio > 0.85 && concepts.includes("issueDate")) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

export function buildIssueDateCandidates(
  lines: string[],
  labelContextText?: string | null
): ScoredCandidate<string>[] {
  const cands: ScoredCandidate<string>[] = [];
  const seen = new Set<string>();
  const n = lines.length || 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dates = extractDatesFromLine(line);
    for (const iso of dates) {
      if (seen.has(iso)) continue;
      const sc = scoreDateLine(line, i, n, ["issueDate", "invoiceNumber"], labelContextText);
      const hasIssueLabel = labelBonusForConcepts(line, ["issueDate"], labelContextText) >= 0.08;
      if (sc >= (hasIssueLabel ? 0.26 : 0.38)) {
        seen.add(iso);
        cands.push({ value: iso, confidence: sc, source: `line:${i}` });
      }
    }
  }
  cands.sort((a, b) => b.confidence - a.confidence);
  return cands.slice(0, 8);
}

export function buildDueDateCandidates(
  lines: string[],
  labelContextText?: string | null
): ScoredCandidate<string>[] {
  const cands: ScoredCandidate<string>[] = [];
  const seen = new Set<string>();
  const n = lines.length || 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bonus = labelBonusForConcepts(line, ["dueDate"], labelContextText);
    if (bonus < 0.08) continue;
    const dates = extractDatesFromLine(line);
    for (const iso of dates) {
      if (seen.has(iso)) continue;
      const sc = Math.min(1, bonus + 0.35);
      seen.add(iso);
      cands.push({ value: iso, confidence: sc, source: `line:${i}` });
    }
  }
  cands.sort((a, b) => b.confidence - a.confidence);
  return cands.slice(0, 6);
}

function scoreSupplierLine(
  line: string,
  index: number,
  totalLines: number,
  labelContextText?: string | null
): number {
  if (line.length < 3 || line.length > 120) return 0;
  if (NOISE_LINE.test(line)) return 0;
  if (/^\d+[\s,.]*$/.test(line.replace(/\s/g, ""))) return 0;
  if (/^\d{8,}$/.test(line.replace(/\s/g, ""))) return 0;
  if (VS_LINE.test(line)) return 0;
  if (/^[A-Z0-9\-_/]{6,40}$/.test(line) && !COMPANY_SUFFIX.test(line)) return 0.08;

  const trimmed = line.trim();

  let score = 0.15;
  const ratio = (index + 1) / (totalLines || 1);
  if (ratio <= 0.2) score += 0.35;
  else if (ratio <= 0.35) score += 0.2;
  else if (ratio <= 0.5) score += 0.08;

  if (
    /^(faktúra|faktura|daňový\s*doklad|danovy\s*doklad|daňový\s*dodávateľský\s*doklad|tax\s*invoice|invoice)\b/i.test(
      trimmed
    ) &&
    trimmed.length < 96
  ) {
    if (!COMPANY_SUFFIX.test(trimmed) && trimmed.length < 44) score -= 0.4;
    else score -= 0.12;
  }

  score += labelBonusForConcepts(line, ["supplier"], labelContextText);
  if (COMPANY_SUFFIX.test(line)) score += 0.28;
  if (/[a-záäčďéíĺľňóôřšťúýž]{3,}/i.test(line)) score += 0.08;
  if (/\d{5,}/.test(line)) score -= 0.2;
  if (/^(total|gesamt|sum|razem|spolu)\b/i.test(line)) score -= 0.35;
  return Math.max(0, Math.min(1, score));
}

export function buildSupplierNameCandidates(
  lines: string[],
  labelContextText?: string | null
): ScoredCandidate<string>[] {
  const maxScan = Math.min(lines.length, 42);
  const out: ScoredCandidate<string>[] = [];
  for (let i = 0; i < maxScan; i++) {
    const line = lines[i];
    const sc = scoreSupplierLine(line, i, lines.length, labelContextText);
    if (sc >= 0.28) {
      const cleaned = line.replace(/^[yíýľ]\s+/i, "").trim();
      out.push({ value: cleaned.slice(0, 200), confidence: sc, source: `line:${i}` });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return dedupeScoredStringCandidates(out).slice(0, 8);
}

export function dedupeScoredStringCandidates(arr: ScoredCandidate<string>[]): ScoredCandidate<string>[] {
  const seen = new Map<string, ScoredCandidate<string>>();
  for (const c of arr) {
    const k = c.value.toLowerCase().replace(/\s+/g, " ");
    const prev = seen.get(k);
    if (!prev || c.confidence > prev.confidence) seen.set(k, c);
  }
  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

const DOC_NUM_PATTERNS: RegExp[] = [
  /\b(?:invoice|rechnung|faktúra|faktura|fa|fv|inv)[\s#:.]*([A-Z0-9][A-Z0-9\-/]{2,38})\b/gi,
  /\b(?:č\.?\s*faktury|číslo\s*faktúry|číslo\s*faktury)[\s#:.]*([A-Z0-9][A-Z0-9\-/]{2,38})\b/gi,
];

export function buildDocumentNumberCandidates(rawText: string, lines: string[]): ScoredCandidate<string>[] {
  const out: ScoredCandidate<string>[] = [];
  const text = typeof rawText === "string" ? rawText : "";
  for (const re of DOC_NUM_PATTERNS) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    while ((m = r.exec(text)) !== null) {
      const v = m[1]?.trim();
      if (v && v.length >= 3 && v.length <= 42 && !/^\d{6,12}$/.test(v)) {
        out.push({
          value: v.slice(0, 60),
          confidence: 0.55 + Math.min(0.25, labelBonusForConcepts(m[0] ?? "", ["invoiceNumber"], text)),
          source: "regex",
        });
      }
    }
  }
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i];
    const bonus = labelBonusForConcepts(line, ["invoiceNumber"], text);
    if (bonus < 0.1) continue;
    const after = line.replace(/^[^:]{0,40}:\s*/i, "");
    const tok = after.match(/\b([A-Z0-9][A-Z0-9\-/]{2,38})\b/);
    if (tok?.[1]) {
      out.push({
        value: tok[1].slice(0, 60),
        confidence: 0.45 + bonus,
        source: `line:${i}`,
      });
    }
  }
  return dedupeScoredStringCandidates(out)
    .filter((c) => !/^[\d\s]+$/.test(c.value))
    .slice(0, 8);
}

export function extractVariableSymbol(rawText: string): string | undefined {
  const t = rawText.replace(/\r\n/g, "\n");
  const m =
    t.match(/(?:variabilný\s*symbol|variabilní\s*symbol|variable\s*symbol)\s*[:#]?\s*(\d{4,16})\b/i) ||
    t.match(/\bVS\s*[:#]?\s*(\d{4,16})\b/i);
  return m?.[1]?.trim();
}

export type TotalResolution = {
  amount: number | null;
  currency: CurrencyCode;
  confidence: number;
  matchedLine?: string;
  candidates: ScoredCandidate<number>[];
};

/**
 * When the invoice number looks like `2025-001`, the bare integer `2025` must not win as amount.
 */
export function amountConflictsWithInvoiceNumber(
  amount: number,
  invoiceHint: string | null | undefined
): boolean {
  if (invoiceHint == null || typeof invoiceHint !== "string") return false;
  const hint = invoiceHint.replace(/\s+/g, "").toLowerCase();
  if (hint.length < 4) return false;
  const looksLikeNumberedYearSeries = /\d{4}[-–/]\d{2,}/.test(hint);
  const y = Math.trunc(amount);
  const isBareYear =
    Number.isFinite(amount) && Math.abs(amount - y) < 1e-9 && y >= 1990 && y <= 2035;
  if (looksLikeNumberedYearSeries && isBareYear && hint.startsWith(String(y))) return true;
  if (looksLikeNumberedYearSeries && isBareYear && hint.includes(String(y)) && /[-/]/.test(hint)) return true;
  const amtStr =
    Number.isInteger(amount) || Math.abs(amount - Math.round(amount)) < 1e-9
      ? String(Math.round(amount))
      : String(amount);
  if (/[-/_a-z]/.test(hint) && hint.includes(amtStr) && hint.length >= amtStr.length + 2) {
    if (y >= 1990 && y <= 2035 && isBareYear) return true;
  }
  return false;
}

/** Must match the gate in `resolveTotalWithCandidates` when applying the text-derived total. */
export const RESOLVED_TOTAL_MIN_CONFIDENCE = 0.42;

export type ResolveTotalOptions = {
  invoiceNumberHint?: string | null;
  rejected?: RejectedCandidate[];
};

/**
 * Resolves total using Vision/backend hints + universal line scoring.
 */
export function resolveTotalWithCandidates(
  rawText: string,
  backendAmount: number | null | undefined,
  backendCurrency?: string | null,
  opts?: ResolveTotalOptions
): TotalResolution {
  if (rawText && isPlaceholderOrMockOcrText(rawText)) {
    return {
      amount: null,
      currency: "EUR",
      confidence: 0,
      candidates: [],
    };
  }

  const hint = opts?.invoiceNumberHint?.trim() || undefined;
  const rejected = opts?.rejected;

  let backendAmt: number | null =
    typeof backendAmount === "number" && Number.isFinite(backendAmount) ? backendAmount : null;
  if (backendAmt != null && hint && amountConflictsWithInvoiceNumber(backendAmt, hint)) {
    rejected?.push({ field: "amount", value: backendAmt, reason: "backend_overlaps_invoice_number" });
    backendAmt = null;
  }

  const pick = pickBestTotalFromText(rawText);
  if (__DEV__) {
    console.log("[documentCandidateScoring] resolveTotalWithCandidates", {
      selectionExplanation: pick.selectionExplanation,
      winnerAmount: pick.money?.amount,
      winnerRawToken: pick.winnerRawToken,
      confidence: pick.confidence,
      matchedLine: pick.matchedLine?.slice(0, 200),
    });
  }
  const curList = detectCurrencyCandidates(rawText);
  const topCur: CurrencyCode = curList[0]?.currency ?? "UNKNOWN";

  let currency: CurrencyCode =
    backendCurrency && typeof backendCurrency === "string" && backendCurrency.length >= 3
      ? (backendCurrency.toUpperCase() as CurrencyCode)
      : topCur;
  if (currency === "UNKNOWN") currency = "EUR";

  const cands: ScoredCandidate<number>[] = [];
  if (pick.candidatesTop) {
    for (const row of pick.candidatesTop) {
      cands.push({
        value: row.money.amount,
        confidence: confidenceFromInvoiceTotalPickRow(row),
        source: `${row.rawToken}|${row.classification}:${row.finalLabelId ?? "none"}:${row.reason}`,
      });
    }
  }

  const resolveTextWinner = (): { money: Money | undefined; conf: number; line?: string } => {
    const rows = pick.candidatesTop ?? [];
    if (!hint) {
      return { money: pick.money, conf: pick.confidence ?? 0, line: pick.matchedLine };
    }
    let skipped = 0;
    for (const row of rows) {
      if (amountConflictsWithInvoiceNumber(row.money.amount, hint)) {
        rejected?.push({ field: "amount", value: row.money.amount, reason: "overlaps_invoice_number" });
        skipped += 1;
        continue;
      }
      const baseConf = confidenceFromInvoiceTotalPickRow(row);
      const conf = Math.min(1, baseConf * (skipped === 0 ? 1 : 0.85));
      return { money: row.money, conf, line: row.line };
    }
    if (pick.money && !amountConflictsWithInvoiceNumber(pick.money.amount, hint)) {
      return { money: pick.money, conf: pick.confidence ?? 0, line: pick.matchedLine };
    }
    if (pick.money) {
      rejected?.push({ field: "amount", value: pick.money.amount, reason: "overlaps_invoice_number" });
    }
    return { money: undefined, conf: 0, line: undefined };
  };

  const textResolved = resolveTextWinner();
  const textWinner = textResolved.money;
  const pickConfidence = textResolved.conf;
  const pickMatchedLine = textResolved.line;

  let amount: number | null = backendAmt;
  let confidence = pick.confidence ?? 0;

  if (textWinner && pickConfidence >= RESOLVED_TOTAL_MIN_CONFIDENCE) {
    if (amount == null) {
      amount = textWinner.amount;
      currency = textWinner.currency !== "UNKNOWN" ? textWinner.currency : currency;
      confidence = pickConfidence;
    } else {
      const relDiff = Math.abs(amount - textWinner.amount) / Math.max(amount, 0.01);
      if (relDiff <= 0.02) {
        confidence = Math.max(confidence, 0.78);
      } else if (pickConfidence >= 0.58) {
        amount = textWinner.amount;
        currency = textWinner.currency !== "UNKNOWN" ? textWinner.currency : currency;
        confidence = pickConfidence * 0.92;
      } else {
        confidence = Math.min(confidence, pickConfidence) * 0.85;
      }
    }
  } else if (amount != null) {
    confidence = Math.min(0.55, confidence);
  }

  const MAX = 999_999.99;
  if (amount != null && (amount <= 0 || amount > MAX)) amount = null;

  return {
    amount,
    currency,
    confidence: amount != null ? Math.min(1, Math.max(0, confidence)) : 0,
    matchedLine: pickMatchedLine ?? pick.matchedLine,
    candidates: cands,
  };
}

/** Pull numeric amount hints from a loose backend `parsed` object. */
function isLikelyYearNotMoney(n: number): boolean {
  return Number.isInteger(n) && n >= 1990 && n <= 2035;
}

export function readBackendTotal(backend: Record<string, unknown> | null | undefined): number | null {
  if (!backend || !isPlainObject(backend)) return null;
  const keys = ["totalAmount", "total", "grandTotal", "amount", "sum", "amountCents"] as const;
  for (const k of keys) {
    const v = backend[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = k === "amountCents" ? v / 100 : v;
      if (n > 0 && n <= 999_999.99 && !isLikelyYearNotMoney(n)) return n;
    }
    const p = parseMoneyToNumber(v);
    if (p != null && p > 0 && p <= 999_999.99 && !isLikelyYearNotMoney(p)) return p;
  }
  return null;
}

export function readBackendCurrency(backend: Record<string, unknown> | null | undefined): string | undefined {
  if (!backend || !isPlainObject(backend)) return undefined;
  const c = backend.currency;
  if (typeof c === "string" && c.length >= 3) return c.toUpperCase();
  return undefined;
}

export function readBackendSupplier(backend: Record<string, unknown> | null | undefined): string | null {
  if (!backend || !isPlainObject(backend)) return null;
  const s = backend.supplierName ?? backend.vendorName;
  if (typeof s === "string" && s.trim().length >= 2) return s.trim();
  return null;
}

export function readSubtotalTaxFromLines(rawText: string): { subtotal?: number; taxAmount?: number } {
  const lines = splitTextLines(rawText);
  const syn = getEffectiveFieldSynonyms(rawText);
  let sub: number | undefined;
  let tax: number | undefined;
  for (const line of lines) {
    const lb = line.toLowerCase();
    if (syn.subtotal.some((x) => lb.includes(x.toLowerCase()))) {
      const m = line.match(/(\d{1,3}(?:[ '\u00a0]\d{3})*[,.]\d{2}|\d+[.,]\d{2})/);
      if (m) {
        const n = parseMoneyUniversal(m[1].replace(/\s/g, ""));
        if (n != null && n > 0 && n < 999_999.99) sub = n;
      }
    }
    if (
      syn.tax.some((x) => lb.includes(x.toLowerCase())) &&
      /\d+[.,]\d{2}/.test(line) &&
      !/%/.test(line)
    ) {
      const m = line.match(/(\d{1,3}(?:[ '\u00a0]\d{3})*[,.]\d{2}|\d+[.,]\d{2})/);
      if (m) {
        const n = parseMoneyUniversal(m[1].replace(/\s/g, ""));
        if (n != null && n > 0 && n < 999_999.99) tax = n;
      }
    }
  }
  return { subtotal: sub, taxAmount: tax };
}
