/**
 * Post-OCR enrichment: deterministic candidates, country inference (SK/CZ/DE/AT/PL MVP),
 * arithmetic validation, optional Gemini interpretation — never replaces OCR text extraction.
 */

import type { ParsedInvoice } from "./invoiceLegacyParse";
import { LEGACY_PARSER_VERSION, parseSupplierTaxId } from "./invoiceLegacyParse";

export const ENRICHMENT_VERSION = "invoice-enhancement-v1";

const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** MVP EU VAT prefix → ISO country */
const VAT_PREFIX_TO_COUNTRY: Record<string, string> = {
  SK: "SK",
  CZ: "CZ",
  DE: "DE",
  AT: "AT",
  PL: "PL",
};

export type EnhancementHints = {
  mimeType?: string;
  documentSource?: "image" | "pdf-text" | "pdf-render" | "cloud-docai";
  /** Weak hints only — never authoritative */
  projectCountry?: string;
  userLocale?: string;
  gpsCountry?: string;
};

export type ExpenseExtractionPayload = {
  enrichmentVersion: string;
  legacyParserVersion: string;
  inferredCountry: string | null;
  countryConfidence: number;
  countrySignals: string[];
  candidateTotals: Array<{ value: number; score: number; label?: string }>;
  validationFlags: string[];
  lowConfidenceReasons: string[];
  geminiUsed: boolean;
  geminiSkippedReason: string | null;
  fieldConfidence: Record<string, number>;
  evidenceHints: Record<string, string>;
  documentTypeGuess: "receipt" | "invoice" | "credit_note" | "unknown";
  /** Fields user should double-check (IDs for mobile UX) */
  reviewFieldIds: string[];
  normalized?: {
    subtotalAmount?: number | null;
    vatRatePercent?: number | null;
    supplierCountry?: string | null;
  };
};

export type ParsedInvoiceExtended = ParsedInvoice & {
  subtotalAmount?: number | null;
  vatRatePercent?: number | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normWs(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function evidenceMatches(rawText: string, quote: string | undefined): boolean {
  if (!quote || quote.length < 2) return false;
  const a = normWs(rawText);
  const b = normWs(quote);
  return b.length >= 2 && a.includes(b.slice(0, Math.min(120, b.length)));
}

function parseAmountLoose(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.\s]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let n = cleaned;
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      n = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      n = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    n = /,\d{2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (hasDot) {
    n = /\.\d{2}$/.test(cleaned) ? cleaned : cleaned.replace(/\./g, "");
  }
  const v = parseFloat(n);
  return Number.isFinite(v) && v > 0 && v <= 999_999.99 ? v : null;
}

/** Keyword-adjacent amount candidates for ranking */
function extractCandidateTotals(rawText: string): Array<{ value: number; score: number; label?: string }> {
  const lines = rawText.split(/\r?\n/);
  const out: Array<{ value: number; score: number; label?: string }> = [];
  const kw =
    /(?:celkom|spolu|razem|suma\s+butto|zu\s*zahlen|gesamt|summe|total\s+due|betrag|s\s+dph|mit\s+mwst|brutto|celkem\s*k\s*uhrade|do\s*zapłaty)/i;
  for (const line of lines) {
    if (!kw.test(line)) continue;
    const m = line.match(/([\d]{1,3}(?:[\s.,]\d{3})*[.,]\d{2}|[\d]+[.,]\d{2})\s*(?:€|EUR|EUR\b|PLN|zł|CZK|Kč)?/i);
    if (!m?.[1]) continue;
    const v = parseAmountLoose(m[1]);
    if (v != null) out.push({ value: v, score: 0.85, label: line.trim().slice(0, 80) });
  }
  const uniq = new Map<number, { value: number; score: number; label?: string }>();
  for (const c of out) {
    const prev = uniq.get(c.value);
    if (!prev || c.score > prev.score) uniq.set(c.value, c);
  }
  return Array.from(uniq.values()).sort((a, b) => b.score - a.score || b.value - a.value);
}

function classifyDocumentQuick(rawText: string): ExpenseExtractionPayload["documentTypeGuess"] {
  const t = rawText.toLowerCase();
  if (/korrektur|credit\s+note|storno|gutschrift|rabat/i.test(t)) return "credit_note";
  if (/fakt[uú]ra|invoice|rechnung|vat\s+invoice/i.test(t)) return "invoice";
  if (/účtenka|uctenka|bon|beleg|paragon|quittung|receipt/i.test(t)) return "receipt";
  return "unknown";
}

function inferCountryRanked(
  rawText: string,
  baseParsed: ParsedInvoice,
  hints?: EnhancementHints
): { country: string | null; confidence: number; signals: string[] } {
  const signals: string[] = [];
  const tid = baseParsed.supplierTaxId ?? parseSupplierTaxId(rawText);
  if (tid && /^[A-Z]{2}/.test(tid)) {
    const pfx = tid.slice(0, 2).toUpperCase();
    const cc = VAT_PREFIX_TO_COUNTRY[pfx];
    if (cc) {
      signals.push(`vat_prefix_${pfx}`);
      return { country: cc, confidence: 0.9, signals };
    }
  }

  const u = rawText.toUpperCase();
  if (/\bSLOVENSK|SK\s*-?\s*\d{3}\s*\d{2}\b|Slovenská republika/i.test(rawText)) {
    signals.push("address_sk_hint");
    return { country: "SK", confidence: 0.72, signals };
  }
  if (/\bČESK|Česká republika|CZECH\b/i.test(rawText)) {
    signals.push("address_cz_hint");
    return { country: "CZ", confidence: 0.72, signals };
  }
  if (/\bDEUTSCHLAND|Germany\b/i.test(rawText)) {
    signals.push("address_de_hint");
    return { country: "DE", confidence: 0.68, signals };
  }
  if (/\bÖSTERREICH|Austria\b/i.test(rawText)) {
    signals.push("address_at_hint");
    return { country: "AT", confidence: 0.68, signals };
  }
  if (/\bPOLSK|POLAND\b|\bPLN\b|\bzł\b/i.test(rawText)) {
    signals.push("address_or_currency_pl_hint");
    return { country: "PL", confidence: 0.65, signals };
  }

  let scoreSk = 0;
  let scoreCz = 0;
  let scoreDe = 0;
  let scoreAt = 0;
  let scorePl = 0;
  if (/\bDPH\b|IČ\s*DPH|základ\s+dane/i.test(u)) scoreSk += 3;
  if (/\bDIČ\b|základ\s+daně|celkem\s*k\s*uhrade/i.test(rawText)) scoreCz += 3;
  if (/\bMwSt\b|USt-IdNr|Brutto|Netto/i.test(rawText)) {
    scoreDe += 2;
    scoreAt += 2;
  }
  if (/\bNIP\b|Podatek|Razem/i.test(rawText)) scorePl += 3;

  const ranked = [
    { cc: "SK", s: scoreSk },
    { cc: "CZ", s: scoreCz },
    { cc: "DE", s: scoreDe },
    { cc: "AT", s: scoreAt },
    { cc: "PL", s: scorePl },
  ].sort((a, b) => b.s - a.s);

  if (ranked[0].s >= 2) {
    signals.push(`tax_keywords_${ranked[0].cc}`);
    return { country: ranked[0].cc, confidence: 0.55 + ranked[0].s * 0.05, signals };
  }

  if (hints?.projectCountry && /^[A-Z]{2}$/.test(hints.projectCountry.trim())) {
    signals.push("weak_hint_project_country");
    return { country: hints.projectCountry.trim().toUpperCase(), confidence: 0.42, signals };
  }
  if (hints?.userLocale?.includes("_")) {
    const cc = hints.userLocale.split("_")[1]?.toUpperCase();
    if (cc && VAT_PREFIX_TO_COUNTRY[cc]) {
      signals.push("weak_hint_user_locale");
      return { country: cc, confidence: 0.35, signals };
    }
  }
  if (hints?.gpsCountry && /^[A-Z]{2}$/.test(hints.gpsCountry.trim())) {
    signals.push("weak_hint_gps");
    return { country: hints.gpsCountry.trim().toUpperCase(), confidence: 0.28, signals };
  }

  signals.push("country_unknown");
  return { country: null, confidence: 0.25, signals };
}

function validateArithmetic(parsed: ParsedInvoiceExtended): {
  flags: string[];
  reasons: string[];
} {
  const flags: string[] = [];
  const reasons: string[] = [];
  const { totalAmount: T, vatAmount: V, subtotalAmount: B } = parsed;

  if (T != null && V != null && B != null) {
    const sum = Math.round((B + V) * 100) / 100;
    const diff = Math.abs(sum - T);
    const tol = Math.max(0.05, T * 0.005);
    if (diff > tol) {
      flags.push("vat_math_mismatch");
      reasons.push("subtotal_plus_vat_differs_from_total");
    }
  } else if (T != null && V != null && B == null) {
    const impliedBase = Math.round((T - V) * 100) / 100;
    if (impliedBase <= 0 || impliedBase > T) {
      flags.push("vat_math_mismatch");
      reasons.push("total_minus_vat_implausible");
    }
  }

  return { flags, reasons };
}

function vatPrefixMatchesCountry(vatId: string | null, country: string | null): boolean {
  if (!vatId || !country || vatId.length < 2) return true;
  if (/^\d{8}$/.test(vatId)) return true;
  return vatId.slice(0, 2).toUpperCase() === country;
}

function getGeminiKey(): string | null {
  const k = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
  return k.trim() ? k.trim() : null;
}

async function tryGeminiLayer(params: {
  rawText: string;
  baseParsed: ParsedInvoice;
  candidates: Array<{ value: number; score: number; label?: string }>;
  inferredCountry: string | null;
}): Promise<{
  merged: Partial<ParsedInvoiceExtended> | null;
  evidence: Record<string, string>;
  error?: string;
}> {
  const key = getGeminiKey();
  if (!key) {
    return { merged: null, evidence: {}, error: "no_api_key" };
  }
  const snippet = params.rawText.slice(0, 12_000);
  const system = `You extract structured invoice/receipt fields from OCR text for EU documents (MVP: SK,CZ,DE,AT,PL).
Return ONLY JSON.
Rules:
- Never invent amounts not supported by substring evidence from OCR text (allow OCR fixes O/0).
- Use null when unsure.
- Each non-null amount/string field MUST include matching phrase in evidence object (verbatim substring from OCR).
- documentType: receipt | invoice | credit_note | unknown`;

  const user = JSON.stringify({
    ocrText: snippet,
    deterministicGuess: params.baseParsed,
    candidateTotals: params.candidates.slice(0, 8),
    inferredCountryHint: params.inferredCountry,
  });

  const body = {
    contents: [{ role: "user", parts: [{ text: `${system}\n\nINPUT:\n${user}` }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  try {
    const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    const parsed = JSON.parse(txt) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res.ok || parsed.error) {
      return { merged: null, evidence: {}, error: parsed.error?.message ?? `http_${res.status}` };
    }
    const rawJson =
      parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as Record<
        string,
        unknown
      >;
    } catch {
      return { merged: null, evidence: {}, error: "json_parse" };
    }

    const evidence = (obj.evidence as Record<string, string>) ?? {};
    const merged: Partial<ParsedInvoiceExtended> = {};

    const num = (k: string): number | null => {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return null;
    };
    const str = (k: string): string | null => {
      const v = obj[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };

    const check = (field: string, val: unknown): boolean => {
      const q = evidence[field];
      if (val == null) return true;
      return typeof q === "string" && evidenceMatches(params.rawText, q);
    };

    if (check("supplierName", obj.supplierName) && str("supplierName"))
      merged.supplierName = str("supplierName")!;
    if (check("supplierTaxId", obj.supplierVATId) && str("supplierVATId"))
      merged.supplierTaxId = str("supplierVATId")!.replace(/\s/g, "");
    if (check("invoiceNumber", obj.invoiceNumber) && str("invoiceNumber"))
      merged.invoiceNumber = str("invoiceNumber")!;
    if (check("issueDate", obj.issueDate) && str("issueDate")) merged.issueDate = str("issueDate")!;
    if (check("totalAmount", obj.totalAmount) && num("totalAmount") != null)
      merged.totalAmount = num("totalAmount")!;
    if (check("vatAmount", obj.vatAmount) && num("vatAmount") != null) merged.vatAmount = num("vatAmount")!;
    if (check("currency", obj.currency) && str("currency")) merged.currency = str("currency")!.toUpperCase();
    if (check("subtotalAmount", obj.subtotalAmount) && num("subtotalAmount") != null)
      merged.subtotalAmount = num("subtotalAmount")!;
    if (check("vatRatePercent", obj.vatRatePercent) && num("vatRatePercent") != null)
      merged.vatRatePercent = num("vatRatePercent")!;

    return { merged, evidence };
  } catch (e) {
    return { merged: null, evidence: {}, error: String(e) };
  }
}

export async function mergeExpenseEnhancement(params: {
  rawText: string;
  baseParsed: ParsedInvoice;
  hints?: EnhancementHints;
}): Promise<{ parsed: ParsedInvoiceExtended; expenseExtraction: ExpenseExtractionPayload }> {
  const { rawText, baseParsed } = params;
  const hints = params.hints ?? {};

  const candidateTotals = extractCandidateTotals(rawText);
  const docGuess = classifyDocumentQuick(rawText);
  const countryInf = inferCountryRanked(rawText, baseParsed, hints);

  let parsed: ParsedInvoiceExtended = { ...baseParsed };
  if (candidateTotals.length && parsed.totalAmount == null) {
    parsed.totalAmount = candidateTotals[0].value;
  }

  const fieldConfidence: Record<string, number> = {
    supplierName: parsed.supplierName ? 0.55 : 0.35,
    totalAmount: parsed.totalAmount != null ? 0.58 : 0.25,
    issueDate: parsed.issueDate ? 0.52 : 0.3,
    supplierTaxId: parsed.supplierTaxId ? 0.62 : 0.35,
    currency: 0.5,
  };

  let geminiUsed = false;
  let geminiSkippedReason: string | null = getGeminiKey() ? null : "no_api_key";

  let aiEvidence: Record<string, string> = {};
  if (rawText.length >= 24 && rawText.length <= 120_000) {
    const gem = await tryGeminiLayer({
      rawText,
      baseParsed: parsed,
      candidates: candidateTotals,
      inferredCountry: countryInf.country,
    });
    if (gem.error && !geminiSkippedReason) geminiSkippedReason = gem.error;
    if (gem.merged && Object.keys(gem.merged).length > 0) {
      geminiUsed = true;
      geminiSkippedReason = null;
      aiEvidence = gem.evidence ?? {};
      parsed = {
        ...parsed,
        ...gem.merged,
      };
      if (gem.merged.supplierName) fieldConfidence.supplierName = clamp01(fieldConfidence.supplierName + 0.12);
      if (gem.merged.totalAmount != null) fieldConfidence.totalAmount = clamp01(fieldConfidence.totalAmount + 0.15);
    }
  } else if (rawText.length < 24) {
    geminiSkippedReason = "text_too_short";
  }

  const validationFlags: string[] = [];
  const lowConfidenceReasons: string[] = [];

  const ar = validateArithmetic(parsed);
  validationFlags.push(...ar.flags);
  lowConfidenceReasons.push(...ar.reasons);

  if (!vatPrefixMatchesCountry(parsed.supplierTaxId, countryInf.country)) {
    validationFlags.push("vat_country_inconsistent");
    lowConfidenceReasons.push("vat_id_prefix_vs_inferred_country");
  }

  if (countryInf.confidence < 0.45) {
    validationFlags.push("country_low_confidence");
    lowConfidenceReasons.push("country_inference_weak");
  }

  if (candidateTotals.length >= 2 && parsed.totalAmount != null) {
    const spread =
      Math.max(...candidateTotals.map((c) => c.value)) - Math.min(...candidateTotals.map((c) => c.value));
    if (spread > 1 && spread / Math.max(parsed.totalAmount, 1) > 0.03) {
      validationFlags.push("total_ambiguous");
      lowConfidenceReasons.push("multiple_total_candidates");
    }
  }

  if (parsed.totalAmount != null && parsed.vatAmount != null && parsed.totalAmount <= parsed.vatAmount) {
    validationFlags.push("vat_math_mismatch");
    lowConfidenceReasons.push("vat_ge_total");
  }

  const reviewFieldIds: string[] = [];
  const threshold = 0.52;
  for (const key of Object.keys(fieldConfidence)) {
    if ((fieldConfidence[key] ?? 0) < threshold) reviewFieldIds.push(key);
  }
  if (validationFlags.includes("total_ambiguous")) reviewFieldIds.push("totalAmount");
  if (validationFlags.includes("vat_math_mismatch")) reviewFieldIds.push("vatAmount", "totalAmount");
  if (validationFlags.includes("country_low_confidence")) reviewFieldIds.push("country");
  if (validationFlags.includes("vat_country_inconsistent")) reviewFieldIds.push("supplierTaxId");

  const uniqReview = [...new Set(reviewFieldIds)];

  const expenseExtraction: ExpenseExtractionPayload = {
    enrichmentVersion: ENRICHMENT_VERSION,
    legacyParserVersion: LEGACY_PARSER_VERSION,
    inferredCountry: countryInf.country,
    countryConfidence: countryInf.confidence,
    countrySignals: countryInf.signals,
    candidateTotals,
    validationFlags,
    lowConfidenceReasons,
    geminiUsed,
    geminiSkippedReason,
    fieldConfidence,
    evidenceHints: aiEvidence,
    documentTypeGuess: docGuess,
    reviewFieldIds: uniqReview,
    normalized: {
      subtotalAmount: parsed.subtotalAmount ?? null,
      vatRatePercent: parsed.vatRatePercent ?? null,
      supplierCountry: countryInf.country,
    },
  };

  return { parsed, expenseExtraction };
}
