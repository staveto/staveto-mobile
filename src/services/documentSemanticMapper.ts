import { parseMoneyToNumber } from "../helpers/parseMoney";
import type { InvoiceExtractionSource } from "../lib/invoiceTypes";
import type { OcrParsed } from "../lib/ocrTypes";
import type { RejectedCandidate } from "../lib/expenseDocumentParseTypes";
import type { ParsedDocumentData, ParsedDocumentExtractionSource, ScoredCandidate } from "../lib/parsedDocumentTypes";
import type { CurrencyCode } from "../utils/invoiceUniversal";
import { isPlainObject } from "../utils/isPlainObject";
import {
  buildDueDateCandidates,
  buildIssueDateCandidates,
  buildSupplierNameCandidates,
  detectLanguageHint,
  extractVariableSymbol,
  readBackendCurrency,
  readBackendSupplier,
  readBackendTotal,
  readSubtotalTaxFromLines,
  resolveTotalWithCandidates,
  RESOLVED_TOTAL_MIN_CONFIDENCE,
} from "./documentCandidateScoring";
import { buildExpenseParseDebugSnapshot, parseExpenseDocument } from "./expenseDocumentParser";
import { extractPossibleInvoiceLineItems } from "../utils/invoiceLineItems";

const MAX_AMOUNT = 999_999.99;

function dedupeCandidates<T>(arr: ScoredCandidate<T>[]): ScoredCandidate<T>[] {
  const seen = new Map<string, ScoredCandidate<T>>();
  for (const c of arr) {
    const k = String(c.value).toLowerCase().replace(/\s+/g, " ");
    const prev = seen.get(k);
    if (!prev || c.confidence > prev.confidence) seen.set(k, c);
  }
  return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
}

function mapInvoiceSourceToParsed(s: InvoiceExtractionSource): ParsedDocumentExtractionSource {
  switch (s) {
    case "image-ocr":
      return "image-ocr";
    case "pdf-text":
      return "pdf-text";
    case "pdf-render-ocr":
      return "pdf-render-ocr";
    case "cloud-ocr":
      return "cloud-docai";
    default:
      return "image-ocr";
  }
}

function readBackendTaxId(backend: Record<string, unknown>): string | undefined {
  const v = backend.supplierTaxId ?? backend.vendorTaxId ?? backend.taxId;
  if (typeof v === "string" && v.trim().length >= 6) return v.trim();
  return undefined;
}

function readBackendInvoiceNo(backend: Record<string, unknown>): string | undefined {
  const v = backend.invoiceNumber ?? backend.documentNumber;
  if (typeof v === "string" && v.trim().length >= 2) return v.trim();
  return undefined;
}

function readBackendDates(backend: Record<string, unknown>): { issue?: string; due?: string } {
  const issue = backend.issueDate;
  const due = backend.dueDate;
  return {
    issue: typeof issue === "string" ? issue : undefined,
    due: typeof due === "string" ? due : undefined,
  };
}

function readBackendRegistrationId(backend: Record<string, unknown>): string | undefined {
  const v = backend.ico ?? backend.supplierIco ?? backend.companyRegistrationId;
  if (typeof v !== "string") return undefined;
  const d = v.replace(/\D/g, "");
  if (d.length === 8) return d;
  return undefined;
}

function readBackendVatId(backend: Record<string, unknown>): string | undefined {
  const v = backend.supplierVatId ?? backend.vatId ?? backend.icDph;
  if (typeof v === "string" && v.replace(/\s+/g, "").length >= 8) {
    return v.replace(/\s+/g, "").toUpperCase();
  }
  return undefined;
}

/**
 * Builds universal `ParsedDocumentData` from raw text + optional Vision/backend object.
 */
export function buildParsedDocumentData(input: {
  rawText: string | null | undefined;
  invoiceExtractionSource: InvoiceExtractionSource;
  backendParsed?: Record<string, unknown> | null;
}): ParsedDocumentData {
  const rawText = typeof input.rawText === "string" ? input.rawText : "";
  const backend = isPlainObject(input.backendParsed) ? input.backendParsed : {};
  const parsedSource = mapInvoiceSourceToParsed(input.invoiceExtractionSource);

  const parseBundle = parseExpenseDocument(rawText, parsedSource);
  const lines = parseBundle.lines;
  const rejected: RejectedCandidate[] = [...parseBundle.rejected];

  const documentType = parseBundle.documentType;
  const language = detectLanguageHint(parseBundle.normalizedText || rawText);
  const extractionQuality = parseBundle.extractionQuality;

  const beDates = readBackendDates(backend);
  const beInv = readBackendInvoiceNo(backend);

  const backendAmt = readBackendTotal(backend);
  const totalRes = resolveTotalWithCandidates(
    parseBundle.normalizedText || rawText,
    backendAmt,
    readBackendCurrency(backend),
    { invoiceNumberHint: parseBundle.bestInvoiceNumberHint, rejected }
  );

  const supplierCands = buildSupplierNameCandidates(lines, parseBundle.normalizedText);
  const backendSup = readBackendSupplier(backend);
  const mergedSupplier: ScoredCandidate<string>[] = [...supplierCands];
  if (backendSup && backendSup.length >= 2) {
    mergedSupplier.push({ value: backendSup.slice(0, 200), confidence: 0.48, source: "backend" });
  }
  mergedSupplier.sort((a, b) => b.confidence - a.confidence);
  const dedupedSupplier = dedupeCandidates(mergedSupplier);

  const issueCands = buildIssueDateCandidates(lines, parseBundle.normalizedText);
  const dueCands = buildDueDateCandidates(lines, parseBundle.normalizedText);
  const docNoCands = dedupeCandidates<string>([
    ...(beInv ? [{ value: beInv.slice(0, 60), confidence: 0.55, source: "backend" as const }] : []),
    ...parseBundle.mergedDocumentNumberCandidates,
  ]).slice(0, 10);

  if (beDates.issue) {
    issueCands.unshift({ value: beDates.issue, confidence: 0.52, source: "backend" });
  }
  if (beDates.due) {
    dueCands.unshift({ value: beDates.due, confidence: 0.58, source: "backend" });
  }

  const taxId = readBackendTaxId(backend);
  const backendRegistrationId = readBackendRegistrationId(backend);
  const backendVatId = readBackendVatId(backend);

  const vs = extractVariableSymbol(parseBundle.normalizedText || rawText);
  const { subtotal, taxAmount } = readSubtotalTaxFromLines(parseBundle.normalizedText || rawText);

  const bestSup = dedupedSupplier[0];
  const bestIssue = issueCands[0];
  const bestDue = dueCands[0];
  const bestDoc = docNoCands[0];

  const SUP_MIN = 0.33;
  /** Keep in sync with `RESOLVED_TOTAL_MIN_CONFIDENCE` — otherwise `totalRes.amount` is set but `doc.total` stays empty. */
  const TOTAL_MIN = RESOLVED_TOTAL_MIN_CONFIDENCE;
  const DATE_MIN = 0.34;
  const DOC_MIN = 0.48;

  const supplierBlock =
    bestSup && bestSup.confidence >= SUP_MIN
      ? { name: bestSup.value }
      : backendSup && backendSup.length >= 3 && !/^\d+$/.test(backendSup)
        ? { name: backendSup.slice(0, 200) }
        : undefined;

  const total =
    totalRes.amount != null && totalRes.confidence >= TOTAL_MIN ? totalRes.amount : undefined;
  const issueDate =
    bestIssue && bestIssue.confidence >= DATE_MIN ? bestIssue.value : beDates.issue;
  const dueDate = bestDue && bestDue.confidence >= 0.42 ? bestDue.value : beDates.due;
  const documentNumber =
    bestDoc && bestDoc.confidence >= DOC_MIN ? bestDoc.value : beInv?.slice(0, 60);

  const bestIco = parseBundle.icoCandidates[0];
  const bestDic = parseBundle.dicCandidates[0];
  const registrationId =
    backendRegistrationId ?? (bestIco && bestIco.confidence >= 0.58 ? bestIco.value : undefined);
  const vatIdResolved =
    backendVatId ?? (bestDic && bestDic.confidence >= 0.54 ? bestDic.value : undefined);

  const confParts: number[] = [];
  if (total != null) confParts.push(totalRes.confidence);
  if (supplierBlock?.name) confParts.push(Math.min(1, (bestSup?.confidence ?? 0.45) + 0.05));
  if (issueDate) confParts.push(Math.min(1, (bestIssue?.confidence ?? 0.4) + 0.1));
  const confidence =
    confParts.length > 0 ? confParts.reduce((a, b) => a + b, 0) / confParts.length : 0.25;

  const totalScored: ScoredCandidate<number>[] = totalRes.candidates.length
    ? totalRes.candidates
    : totalRes.amount != null
      ? [{ value: totalRes.amount, confidence: totalRes.confidence, source: "pickTotal" }]
      : [];

  const supplierPayload =
    supplierBlock?.name || registrationId || vatIdResolved || taxId
      ? {
          ...(supplierBlock?.name ? { name: supplierBlock.name } : {}),
          ...(registrationId ? { registrationId } : {}),
          ...(vatIdResolved ? { vatId: vatIdResolved } : {}),
          ...(taxId ? { taxId } : {}),
        }
      : undefined;

  const expenseParseDebug = buildExpenseParseDebugSnapshot({
    documentType,
    extractionQuality,
    docKindNotes: parseBundle.docKindNotes,
    normalizedText: parseBundle.normalizedText,
    localeHints: parseBundle.localeHints,
    totalRes,
    supplierCands: dedupedSupplier,
    selectedSupplier: supplierBlock?.name,
    issueCands,
    selectedIssue: typeof issueDate === "string" ? issueDate : undefined,
    dueCands,
    selectedDue: typeof dueDate === "string" ? dueDate : undefined,
    docNoCands,
    selectedDocNo: typeof documentNumber === "string" ? documentNumber : undefined,
    icoCands: parseBundle.icoCandidates,
    dicCands: parseBundle.dicCandidates,
    selectedIco: registrationId,
    selectedDic: vatIdResolved,
    rejected,
  });

  const normalizedForItems = parseBundle.normalizedText || rawText;
  const items = extractPossibleInvoiceLineItems(normalizedForItems);
  if (__DEV__) {
    console.log("[ExpenseLineItemsDebug]", {
      rawTextLength: normalizedForItems.length,
      lineItemCount: items.length,
      hasItems: items.length > 0,
    });
  }

  return {
    documentType,
    source: parsedSource,
    language,
    rawText,
    extractionQuality,
    expenseParseDebug,
    confidence: Math.min(1, Math.max(0, confidence)),
    supplier: supplierPayload,
    documentNumber,
    variableSymbol: vs,
    issueDate,
    dueDate,
    currency: totalRes.currency !== "UNKNOWN" ? totalRes.currency : undefined,
    subtotal,
    taxAmount,
    total,
    ...(items.length > 0 ? { items } : {}),
    candidates: {
      supplierName: dedupedSupplier.slice(0, 8),
      total: totalScored.slice(0, 8),
      issueDate: issueCands.slice(0, 8),
      dueDate: dueCands.slice(0, 8),
      documentNumber: docNoCands.slice(0, 8),
    },
  };
}

/**
 * Maps universal document to legacy `OcrParsed` with **conservative** filled fields
 * (low-confidence totals/supplier cleared).
 */
export function parsedDocumentToOcrParsed(doc: ParsedDocumentData, backend?: Record<string, unknown>): OcrParsed {
  const be = isPlainObject(backend) ? backend : {};
  const totalCand0 = doc.candidates?.total?.[0];
  const supCand0 = doc.candidates?.supplierName?.[0];

  let totalAmount: number | null =
    doc.total != null && doc.total > 0 && doc.total <= MAX_AMOUNT ? doc.total : null;

  /**
   * `buildParsedDocumentData` only sets `doc.total` when line-total confidence passed TOTAL_MIN (same as `RESOLVED_TOTAL_MIN_CONFIDENCE`).
   * Do not mix in `doc.confidence` (average of several fields) — it was clearing valid totals too often.
   */
  let totalConf = 0;
  if (totalAmount != null) {
    const matchCand = doc.candidates?.total?.find((c) => c.value === totalAmount);
    totalConf = Math.max(totalCand0?.confidence ?? 0, matchCand?.confidence ?? 0, 0.47);
  } else if (totalCand0 != null) {
    totalConf = totalCand0.confidence;
  } else {
    totalConf = doc.confidence ?? 0;
  }

  if (totalAmount != null && totalConf < 0.28) {
    totalAmount = null;
  }

  let supplierName: string | null = doc.supplier?.name?.trim() ?? null;
  if (supplierName && /^[\u0600-\u06FF\s]+$/.test(supplierName) && supplierName.length < 10) {
    supplierName = null;
  }
  if (supplierName && supCand0 && supCand0.confidence < 0.28) {
    supplierName = null;
  }
  if (supplierName && /^[yíýľ]\s+/i.test(supplierName)) {
    supplierName = supplierName.replace(/^[yíýľ]\s+/i, "").trim();
  }

  const currency = (doc.currency as CurrencyCode | undefined) ?? "EUR";

  const issueDate = doc.issueDate ?? null;
  const dueDate = doc.dueDate ?? null;
  const invoiceNumber = doc.documentNumber?.trim() ?? null;

  let vatAmount: number | null = doc.taxAmount != null && Number.isFinite(doc.taxAmount) ? doc.taxAmount : null;
  if (vatAmount == null) {
    const beVat = be.vatAmount ?? be.vat;
    if (typeof beVat === "number" && Number.isFinite(beVat)) {
      vatAmount = beVat >= 10000 ? beVat / 100 : beVat;
    } else {
      vatAmount = parseMoneyToNumber(beVat);
    }
  }
  if (vatAmount != null && (vatAmount <= 0 || vatAmount > MAX_AMOUNT)) vatAmount = null;

  const overall =
    totalAmount != null ? Math.min(1, (totalConf + (supCand0?.confidence ?? 0)) / 2) : supCand0?.confidence ?? 0.35;

  return {
    supplierName,
    supplierTaxId:
      typeof be.supplierTaxId === "string"
        ? be.supplierTaxId
        : doc.supplier?.vatId ?? doc.supplier?.taxId ?? doc.supplier?.registrationId ?? null,
    invoiceNumber,
    issueDate,
    dueDate,
    totalAmount,
    vatAmount,
    currency: currency && currency.length === 3 ? currency : "EUR",
    confidence: {
      total: totalConf,
      currency: doc.currency ? 0.82 : 0.5,
      overall,
    },
    matchedLine: undefined,
  };
}

/**
 * Full pipeline slice: text + source + backend → `ParsedDocumentData` + conservative `OcrParsed`.
 */
export function mapExtractionToStructured(input: {
  rawText: string | null | undefined;
  invoiceExtractionSource: InvoiceExtractionSource;
  backendParsed?: Record<string, unknown> | null;
}): { document: ParsedDocumentData; ocrParsed: OcrParsed } {
  const document = buildParsedDocumentData(input);
  if (__DEV__ && document.expenseParseDebug) {
    const d = document.expenseParseDebug;
    console.log(
      `[expenseParse] kind=${d.documentType} quality=${d.extractionQuality} rejected=${d.rejected.length} previewLen=${d.rawTextPreview.length}`,
      {
        localeRegions: d.localeDetection?.regions ?? [],
        localeHints: d.localeDetection?.hints ?? [],
      }
    );
  }
  const ocrParsed = parsedDocumentToOcrParsed(
    document,
    isPlainObject(input.backendParsed) ? input.backendParsed : {}
  );
  return { document, ocrParsed };
}
