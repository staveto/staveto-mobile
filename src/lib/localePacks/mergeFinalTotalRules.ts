import { BASE_FINAL_TOTAL_LABEL_RULES } from "./baseFinalTotalRules";
import { detectLocaleContext } from "./detectRegion";
import { EXTRA_FINAL_TOTAL_RULES_TIER1, EXTRA_FINAL_TOTAL_RULES_TIER2 } from "./extraFinalTotalRules";
import type { FinalTotalLineRule } from "./types";

function collectExtraRules(regions: readonly string[]): FinalTotalLineRule[] {
  const out: FinalTotalLineRule[] = [];
  for (const code of regions) {
    const t1 = EXTRA_FINAL_TOTAL_RULES_TIER1[code as keyof typeof EXTRA_FINAL_TOTAL_RULES_TIER1];
    const t2 = EXTRA_FINAL_TOTAL_RULES_TIER2[code as keyof typeof EXTRA_FINAL_TOTAL_RULES_TIER2];
    if (t1?.length) out.push(...t1);
    if (t2?.length) out.push(...t2);
  }
  return out;
}

/**
 * Merged final-total rules: region-specific extras first (document order), then base list.
 * Duplicate `id` keeps the first occurrence (region wins over base).
 */
export function getMergedFinalTotalLabelRules(rawText: string): readonly FinalTotalLineRule[] {
  const { regions } = detectLocaleContext(rawText);
  const extras = collectExtraRules(regions);
  const seen = new Set<string>();
  const merged: FinalTotalLineRule[] = [];
  for (const r of extras) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  for (const r of BASE_FINAL_TOTAL_LABEL_RULES) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged;
}
