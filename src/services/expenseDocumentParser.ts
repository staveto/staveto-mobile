import type {
  ExpenseParseDebugSnapshot,
  ExtractionQuality,
  FieldDebugSnapshot,
  RejectedCandidate,
} from "../lib/expenseDocumentParseTypes";
import type {
  ParsedDocumentExtractionSource,
  ParsedDocumentType,
  ScoredCandidate,
} from "../lib/parsedDocumentTypes";
import {
  buildDocumentNumberCandidates,
  dedupeScoredStringCandidates,
  splitTextLines,
  type TotalResolution,
} from "./documentCandidateScoring";
import { classifyDocumentFromText } from "./documentClassifier";
import { detectLocaleContext } from "../lib/localePacks";

export type ExpenseDocumentParseBundle = {
  normalizedText: string;
  lines: string[];
  extractionQuality: ExtractionQuality;
  documentType: ParsedDocumentType;
  docKindNotes: string[];
  mergedDocumentNumberCandidates: ScoredCandidate<string>[];
  /** Best invoice/document number string for cross-field rules (e.g. amount disambiguation). */
  bestInvoiceNumberHint?: string;
  /** Heuristic region hints for locale packs (EU/US); not legal jurisdiction. */
  localeHints: { regions: readonly string[]; hints: readonly string[] };
  icoCandidates: ScoredCandidate<string>[];
  dicCandidates: ScoredCandidate<string>[];
  rejected: RejectedCandidate[];
};

/** Unicode NFKC + stable newlines; line splitting is done via `splitTextLines`. */
export function normalizeExpenseDocumentText(rawText: string): string {
  if (!rawText || typeof rawText !== "string") return "";
  return rawText
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/[\t \u00A0]+/g, " ")
    .trim();
}

export function inferExtractionQuality(
  normalizedText: string,
  source: ParsedDocumentExtractionSource
): ExtractionQuality {
  const len = normalizedText.length;
  const lettersDigits = (normalizedText.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const ratio = len > 0 ? lettersDigits / len : 0;

  if (source === "image-ocr" || source === "pdf-render-ocr") {
    if (len < 90 || ratio < 0.42) return "weak";
    return "ocr_only";
  }
  if (source === "pdf-text") {
    if (len < 120 || ratio < 0.34) return "weak";
    return "full_text";
  }
  if (len < 100 || ratio < 0.32) return "weak";
  return "full_text";
}

function normInvoiceToken(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/–/g, "-");
}

/**
 * High-precision patterns: `2025-001`, `2025/12`, `FA 2025-001` — must not be treated as money.
 */
export function extractStrongInvoiceNumberPatterns(text: string): ScoredCandidate<string>[] {
  const out: ScoredCandidate<string>[] = [];
  if (!text) return out;

  const reYearSeries = /\b(20\d{2}\s*[-–/]\s*\d{2,6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = reYearSeries.exec(text)) !== null) {
    const v = normInvoiceToken(m[1]);
    if (v.length >= 6) {
      out.push({ value: v, confidence: 0.9, source: "pattern:YYYY-series" });
    }
  }

  const rePrefixed = /\b(?:FA|FV|INV|FAKT)[\s#:.]*([0-9]{4}\s*[-–/]\s*\d{2,6})\b/gi;
  while ((m = rePrefixed.exec(text)) !== null) {
    const v = normInvoiceToken(m[1]);
    if (v.length >= 6) {
      out.push({ value: v, confidence: 0.88, source: "pattern:prefixed-year-series" });
    }
  }

  return dedupeScoredStringCandidates(out);
}

export function extractIcoDicCandidates(lines: string[]): {
  ico: ScoredCandidate<string>[];
  dic: ScoredCandidate<string>[];
} {
  const ico: ScoredCandidate<string>[] = [];
  const dic: ScoredCandidate<string>[] = [];
  const max = Math.min(lines.length, 56);
  for (let i = 0; i < max; i++) {
    const line = lines[i];
    for (const m of line.matchAll(/\b(?:ičo|i\.?\s*c\.?\s*o\.?|ico)\s*[:#]?\s*(\d{8})\b/gi)) {
      if (m[1]) ico.push({ value: m[1], confidence: 0.84 - i * 0.004, source: `line:${i}` });
    }
    for (const m of line.matchAll(
      /\b(?:ič\s*dph|ičdvph|dič|dic|vat\s*(?:id|no|number)?|dph\s*id)\s*[:#]?\s*((?:sk|cz|pl|hu)?\s*[0-9]{8,12})\b/gi
    )) {
      const v = (m[1] ?? "").replace(/\s+/g, "").toUpperCase();
      if (v.length >= 8) dic.push({ value: v, confidence: 0.82 - i * 0.004, source: `line:${i}` });
    }
  }
  return {
    ico: dedupeScoredStringCandidates(ico).slice(0, 6),
    dic: dedupeScoredStringCandidates(dic).slice(0, 6),
  };
}

/**
 * First pass after text extraction: normalize, classify, merge invoice-number candidates, ICO/DIČ.
 */
export function parseExpenseDocument(
  rawText: string,
  extractionSource: ParsedDocumentExtractionSource
): ExpenseDocumentParseBundle {
  const normalizedText = normalizeExpenseDocumentText(typeof rawText === "string" ? rawText : "");
  const lines = splitTextLines(normalizedText);
  const extractionQuality = inferExtractionQuality(normalizedText, extractionSource);
  const documentType = classifyDocumentFromText(normalizedText);

  const docKindNotes: string[] = [];
  if (extractionQuality !== "full_text") docKindNotes.push(`extraction:${extractionQuality}`);
  if (documentType === "credit_note") docKindNotes.push("classified:credit_note");

  const strongInv = extractStrongInvoiceNumberPatterns(normalizedText);
  const restInv = buildDocumentNumberCandidates(normalizedText, lines);
  const mergedDocumentNumberCandidates = dedupeScoredStringCandidates([...strongInv, ...restInv]).slice(0, 18);
  const bestInvoiceNumberHint = mergedDocumentNumberCandidates[0]?.value;

  const { ico, dic } = extractIcoDicCandidates(lines);
  const localeCtx = detectLocaleContext(normalizedText);

  return {
    normalizedText,
    lines,
    extractionQuality,
    documentType,
    docKindNotes,
    mergedDocumentNumberCandidates,
    bestInvoiceNumberHint,
    localeHints: { regions: localeCtx.regions, hints: localeCtx.hints },
    icoCandidates: ico,
    dicCandidates: dic,
    rejected: [],
  };
}

function fieldSnap<T>(
  selected: T | undefined,
  top: ScoredCandidate<T>[],
  limit = 5
): FieldDebugSnapshot {
  return {
    selected,
    topCandidates: top.slice(0, limit).map((c) => ({
      value: c.value,
      confidence: c.confidence,
      source: c.source,
    })),
  };
}

/** Compact snapshot for logs / dev tools — avoid shipping raw full text in production analytics. */
export function buildExpenseParseDebugSnapshot(input: {
  documentType: string;
  extractionQuality: ExtractionQuality;
  docKindNotes: string[];
  normalizedText: string;
  totalRes: TotalResolution;
  supplierCands: ScoredCandidate<string>[];
  selectedSupplier?: string;
  issueCands: ScoredCandidate<string>[];
  selectedIssue?: string;
  dueCands: ScoredCandidate<string>[];
  selectedDue?: string;
  docNoCands: ScoredCandidate<string>[];
  selectedDocNo?: string;
  icoCands: ScoredCandidate<string>[];
  dicCands: ScoredCandidate<string>[];
  selectedIco?: string;
  selectedDic?: string;
  rejected: RejectedCandidate[];
  localeHints?: { regions: readonly string[]; hints: readonly string[] };
}): ExpenseParseDebugSnapshot {
  const preview = input.normalizedText.length > 520 ? `${input.normalizedText.slice(0, 520)}…` : input.normalizedText;
  return {
    documentType: input.documentType,
    extractionQuality: input.extractionQuality,
    docKindNotes: input.docKindNotes,
    rawTextPreview: preview,
    localeDetection: input.localeHints,
    topByField: {
      amount: {
        selected: input.totalRes.amount,
        topCandidates: input.totalRes.candidates.slice(0, 5).map((c) => ({
          value: c.value,
          confidence: c.confidence,
          source: c.source,
        })),
      },
      supplier_name: fieldSnap(input.selectedSupplier, input.supplierCands),
      issue_date: fieldSnap(input.selectedIssue, input.issueCands),
      due_date: fieldSnap(input.selectedDue, input.dueCands),
      invoice_number: fieldSnap(input.selectedDocNo, input.docNoCands),
      supplier_ico: fieldSnap(input.selectedIco, input.icoCands),
      supplier_dic: fieldSnap(input.selectedDic, input.dicCands),
    },
    rejected: input.rejected,
  };
}
