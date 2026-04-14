/**
 * Detects mock / QA placeholder OCR strings. Must never drive production autofill.
 * Keep logic aligned with `src/utils/ocrPlaceholderGuards.ts` in the mobile app.
 */
export function isPlaceholderOrMockOcrText(text: string | null | undefined): boolean {
  if (text == null || typeof text !== "string") return false;
  const t = text;
  const lower = t.toLowerCase();
  /** QA fixture / mock HTTP handlers often start with `STUB Faktúra…` */
  if (/stub\s+fakt[úu]?ra/i.test(t) || /stub\s+fakt[úu]?ra/i.test(lower)) return true;
  if (/\bstub\b/i.test(t)) return true;
  if (/test\s+s\.?\s*r\.?\s*o\.?/i.test(t)) return true;
  if (/dodávateľ\s+test\b/i.test(lower) || /dodavatel\s+test\b/i.test(lower)) return true;
  if (/supplier\s+test\b/i.test(lower)) return true;
  if (/mock\s+fakt/i.test(lower) || /fake\s+invoice/i.test(lower)) return true;
  return false;
}
