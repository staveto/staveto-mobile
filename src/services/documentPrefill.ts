import type { ParsedDocumentData } from "../lib/parsedDocumentTypes";
import type { OcrResult } from "../lib/ocrTypes";
import { isPlainObject } from "../utils/isPlainObject";
import { RESOLVED_TOTAL_MIN_CONFIDENCE } from "./documentCandidateScoring";

export type PrefillTier = "high" | "medium" | "low";

export type PrefillField<T> = {
  value: T | null;
  tier: PrefillTier;
};

/** Internal OCR → form mapping for amount, supplier, date, currency, tax id only (never title/note). */
export type ExpenseDocumentPrefill = {
  amount: PrefillField<number>;
  supplierName: PrefillField<string>;
  issueDate: PrefillField<string>;
  currency: PrefillField<string>;
  supplierTaxId: PrefillField<string>;
};

const HIGH = 0.55;
const MED = 0.4;

function tierFromConfidence(c: number): PrefillTier {
  if (c >= HIGH) return "high";
  if (c >= MED) return "medium";
  return "low";
}

/**
 * Derives confidence-aware expense prefill from OCR result (parsed + optional universal document).
 * Does not compute title or note — business rule: OCR must not suggest those fields.
 */
export function buildExpenseDocumentPrefill(result: OcrResult): ExpenseDocumentPrefill {
  const parsed = result.parsed;
  const doc: ParsedDocumentData | undefined = result.parsedDocument;

  const overall = parsed?.confidence?.overall ?? doc?.confidence ?? 0;
  const topTotalCand = doc?.candidates?.total?.[0];

  const amountFromParsed =
    parsed?.totalAmount != null && parsed.totalAmount > 0 && parsed.totalAmount <= 999_999.99
      ? parsed.totalAmount
      : null;

  /** Same number pipeline as `parsed.totalAmount`, still on the universal doc when legacy parsed missed it. */
  const amountFromDocTotal =
    doc?.total != null && Number.isFinite(doc.total) && doc.total > 0 && doc.total <= 999_999.99
      ? doc.total
      : null;

  /**
   * Top scored total candidate: always take numeric value when in range.
   * Do not require `confidence >= RESOLVED_TOTAL_MIN_CONFIDENCE` here — that gate is for *selection* upstream;
   * prefill would otherwise drop a correct `value` with a slightly low mapped confidence (e.g. score/980).
   */
  const amountFromCandidate =
    topTotalCand != null &&
    typeof topTotalCand.value === "number" &&
    Number.isFinite(topTotalCand.value) &&
    topTotalCand.value > 0 &&
    topTotalCand.value <= 999_999.99
      ? topTotalCand.value
      : null;

  const amountChosenSource: "parsed_totalAmount" | "doc_total" | "top_total_candidate" | "none" =
    amountFromParsed != null
      ? "parsed_totalAmount"
      : amountFromDocTotal != null
        ? "doc_total"
        : amountFromCandidate != null
          ? "top_total_candidate"
          : "none";

  const amountNum = amountFromParsed ?? amountFromDocTotal ?? amountFromCandidate;

  let amountConfForTier = 0;
  if (amountNum != null && amountNum > 0) {
    const pTot = parsed?.confidence?.total;
    const docConf = typeof doc?.confidence === "number" ? doc.confidence : 0;
    const candConf =
      topTotalCand != null && Math.abs(topTotalCand.value - amountNum) < 1e-6
        ? topTotalCand.confidence ?? 0
        : 0;

    if (amountFromParsed != null && typeof pTot === "number" && pTot > 0) {
      amountConfForTier = Math.max(pTot, candConf);
    } else if (amountFromDocTotal != null) {
      amountConfForTier = Math.max(docConf, candConf, typeof pTot === "number" ? pTot : 0);
    } else if (amountFromCandidate != null) {
      amountConfForTier = Math.max(candConf, docConf, RESOLVED_TOTAL_MIN_CONFIDENCE);
    }
    if (amountConfForTier < 1e-6 && typeof overall === "number") {
      amountConfForTier = overall;
    }
  }

  const amountTier =
    amountNum != null && amountNum > 0 ? tierFromConfidence(amountConfForTier) : ("low" as const);

  const amountTierReason =
    amountNum == null || amountNum <= 0
      ? "no_amount"
      : amountChosenSource === "parsed_totalAmount"
        ? "parsed_totalAmount"
        : amountChosenSource === "doc_total"
          ? "doc_total"
          : amountChosenSource === "top_total_candidate"
            ? "top_total_candidate"
            : "unknown";

  const supplierRaw = parsed?.supplierName?.trim() ?? doc?.supplier?.name?.trim() ?? "";
  const supConfFromDoc = doc?.candidates?.supplierName?.[0]?.confidence;
  const supConf =
    typeof supConfFromDoc === "number"
      ? supConfFromDoc
      : supplierRaw.length >= 4
        ? Math.max(overall, 0.42)
        : 0;
  const supplierTier = tierFromConfidence(supConf);

  const issue = parsed?.issueDate?.trim() ?? doc?.issueDate ?? "";
  const issueCandConf = doc?.candidates?.issueDate?.[0]?.confidence ?? 0;
  const dateTier: PrefillTier = issue
    ? issueCandConf >= 0.42 || /^\d{4}-\d{2}-\d{2}$/.test(issue)
      ? "high"
      : tierFromConfidence(Math.max(issueCandConf, 0.5))
    : "low";

  const cur = parsed?.currency && parsed.currency !== "UNKNOWN" ? parsed.currency : doc?.currency ?? "";
  const currencyTier = cur ? ("high" as const) : ("low" as const);

  const taxId = parsed?.supplierTaxId?.trim() ?? doc?.supplier?.taxId?.trim() ?? "";
  const taxTier = taxId.length >= 8 ? tierFromConfidence(0.52) : ("low" as const);

  if (__DEV__) {
    console.log("[documentPrefill] buildExpenseDocumentPrefill", {
      parsedTotalAmount: parsed?.totalAmount ?? null,
      docTotal: doc?.total ?? null,
      topTotalCandidate: topTotalCand
        ? { value: topTotalCand.value, confidence: topTotalCand.confidence }
        : null,
      amountChosenSource,
      amountFromParsed,
      amountFromDocTotal,
      amountFromCandidate,
      finalAmountNum: amountNum,
      finalAmountTier: amountTier,
      amountConfForTier,
      amountTierReason,
      parsedConfidenceTotal: parsed?.confidence?.total ?? null,
      docConfidence: doc?.confidence ?? null,
    });
  }

  return {
    amount: { value: amountNum, tier: amountTier },
    supplierName: { value: supplierRaw || null, tier: supplierTier },
    issueDate: { value: issue || null, tier: dateTier },
    currency: { value: cur || null, tier: currencyTier },
    supplierTaxId: { value: taxId || null, tier: taxTier },
  };
}

/** Values safe to push into expense form state (confidence-aware). Never includes title or note. */
export type ExpensePrefillValues = {
  amount?: string;
  supplierName?: string;
  issueDate?: string;
  currency?: string;
  supplierIco?: string;
};

/**
 * Maps OCR pipeline output to form field values. Prefer this over reading `OcrParsed` directly in UI.
 * Title and note are intentionally never populated from OCR.
 */
export function getConfidenceAwareExpensePrefill(result: OcrResult): ExpensePrefillValues {
  const pre = buildExpenseDocumentPrefill(result);
  const doc = result.parsedDocument;
  const out: ExpensePrefillValues = {};

  const prefillAmountBeforeGate = pre.amount.value;
  const topTotal = doc?.candidates?.total?.[0];
  const invoiceAlignedTotal =
    doc?.documentType === "invoice" &&
    pre.amount.value != null &&
    pre.amount.value > 0 &&
    topTotal != null &&
    Math.abs(topTotal.value - pre.amount.value) < 0.01 &&
    (topTotal.confidence ?? 0) >= RESOLVED_TOTAL_MIN_CONFIDENCE;

  const allowAmount =
    pre.amount.value != null &&
    pre.amount.value > 0 &&
    (pre.amount.tier !== "low" || invoiceAlignedTotal);

  let amountKeepBranch: string = "drop";
  if (allowAmount) {
    amountKeepBranch =
      pre.amount.tier !== "low"
        ? "keep_tier_medium_or_high"
        : "keep_invoice_top_candidate_aligned";
    out.amount = String(pre.amount.value);
  } else if (pre.amount.value != null && pre.amount.value > 0) {
    amountKeepBranch =
      pre.amount.tier === "low"
        ? "drop_tier_low_no_invoice_override"
        : "drop_invalid_value";
  }

  if (__DEV__) {
    console.log("[documentPrefill] getConfidenceAwareExpensePrefill amount", {
      prefillAmountBeforeGate,
      tier: pre.amount.tier,
      prefillAmountAfterGate: out.amount ?? null,
      amountKeepBranch,
      invoiceAlignedTotal,
      topTotalCand: topTotal ? { v: topTotal.value, conf: topTotal.confidence } : null,
    });
  }
  const supplierOk =
    pre.supplierName.value &&
    (pre.supplierName.tier === "high" ||
      (pre.supplierName.tier === "medium" && pre.supplierName.value.trim().length >= 4));
  if (supplierOk) {
    out.supplierName = pre.supplierName.value;
  }
  if (pre.issueDate.value && (pre.issueDate.tier === "high" || pre.issueDate.tier === "medium")) {
    out.issueDate = pre.issueDate.value;
  }
  if (pre.currency.tier === "high" && pre.currency.value && pre.currency.value !== "UNKNOWN") {
    out.currency = pre.currency.value;
  }
  if (
    pre.supplierTaxId.value &&
    (pre.supplierTaxId.tier === "high" ||
      (pre.supplierTaxId.tier === "medium" && pre.supplierTaxId.value.trim().length >= 8))
  ) {
    out.supplierIco = pre.supplierTaxId.value;
  }

  return out;
}

/** Log payload for support — safe serialization. */
export function prefillDebugPayload(result: OcrResult, prefill: ExpenseDocumentPrefill): Record<string, unknown> {
  const doc = result.parsedDocument;
  const base: Record<string, unknown> = {
    status: result.status,
    extractionSource: result.extractionSource ?? null,
    prefill: {
      amount: prefill.amount,
      supplierName: prefill.supplierName,
      issueDate: prefill.issueDate,
    },
  };
  if (doc && isPlainObject(doc as object)) {
    base.documentType = doc.documentType;
    base.documentConfidence = doc.confidence ?? null;
    base.candidateTotals = (doc.candidates?.total ?? []).slice(0, 3).map((c) => ({
      v: c.value,
      conf: c.confidence,
    }));
    base.candidateSuppliers = (doc.candidates?.supplierName ?? []).slice(0, 3).map((c) => ({
      v: c.value.slice(0, 40),
      conf: c.confidence,
    }));
  }
  return base;
}
