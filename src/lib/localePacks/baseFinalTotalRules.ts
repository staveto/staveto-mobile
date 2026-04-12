import type { FinalTotalLineRule } from "./types";

/**
 * Language-agnostic + core EU/EN final-total line detectors.
 * Region packs prepend additional rules in `mergeFinalTotalRules.ts`.
 */
export const BASE_FINAL_TOTAL_LABEL_RULES: readonly FinalTotalLineRule[] = [
  { tier: 2, id: "celkom_k_uhrade", match: (l) => /\bcelkom\s+k\s*[úu]hrad[ěe]\b/i.test(l) },
  { tier: 2, id: "celkem_k_uhrade", match: (l) => /\bcelkem\s+k\s*[úu]hrad[ěe]\b/i.test(l) },
  { tier: 1, id: "k_uhrade", match: (l) => /\bk\s*[úu]hrad[ěe]\b/i.test(l) },
  { tier: 3, id: "na_uhradu", match: (l) => /\bna\s*[úu]hradu\b/i.test(l) },
  {
    tier: 4,
    id: "spolu",
    match: (l) =>
      /\bspolu\b/i.test(l) &&
      !/\bspolu\s+(za\s+)?(dph|vat|daň|dan)\b/i.test(l) &&
      !/\b(dph|vat)\s+spolu\b/i.test(l),
  },
  {
    tier: 5,
    id: "celkom_celkem",
    match: (l) =>
      /\b(celkom|celkem)\b/i.test(l) &&
      !/\bcelkom\s+bez\b/i.test(l) &&
      !/\bcelkem\s+bez\b/i.test(l) &&
      !/\bcelkom\s+dph\b/i.test(l) &&
      !/\bcelkem\s+dph\b/i.test(l),
  },
  { tier: 6, id: "total_due", match: (l) => /\b(total|amount|balance)\s*due\b/i.test(l) },
  { tier: 7, id: "grand_total", match: (l) => /\bgrand\s*total\b/i.test(l) },
  { tier: 8, id: "zu_zahlen", match: (l) => /\bzu\s+zahlen\b/i.test(l) },
  { tier: 9, id: "brutto", match: (l) => /\bbrutto\b/i.test(l) },
];
