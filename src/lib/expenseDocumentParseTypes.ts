/**
 * Types for expense document parsing: per-field candidates, rejections, debug.
 * Used by `expenseDocumentParser` and attached to `ParsedDocumentData.expenseParseDebug`.
 *
 * Kept free of imports from `parsedDocumentTypes` to avoid circular type dependencies.
 */

export type ExtractionQuality = "full_text" | "weak" | "ocr_only";

export type RejectedCandidate = {
  field: string;
  value: unknown;
  reason: string;
};

/** One field’s shortlist for debug UI / logs (no PII in keys; values may be truncated by caller). */
export type FieldDebugSnapshot = {
  selected?: unknown;
  topCandidates: Array<{ value: unknown; confidence?: number; source?: string }>;
};

export type ExpenseParseDebugSnapshot = {
  documentType: string;
  extractionQuality: ExtractionQuality;
  /** Short free-text hints (e.g. "credit_note_hint") */
  docKindNotes: string[];
  /** First ~500 chars of normalized text — may contain names; use only in dev/support. */
  rawTextPreview: string;
  /** Heuristic region list + probe hits for locale packs (debug / support). */
  localeDetection?: { regions: readonly string[]; hints: readonly string[] };
  topByField: Partial<Record<string, FieldDebugSnapshot>>;
  rejected: RejectedCandidate[];
};
