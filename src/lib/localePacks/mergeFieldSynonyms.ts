import { detectLocaleContext } from "./detectRegion";
import { EXTRA_FIELD_SYNONYMS } from "./extraFieldSynonyms";
import type { RegionCode } from "./types";

/**
 * Merges base `FIELD_LABEL_SYNONYMS` with region-pack extras for the given document text.
 */
export function mergeFieldSynonymsForDocument<FieldKeys extends string>(
  rawText: string | null | undefined,
  base: Record<FieldKeys, readonly string[]>
): Record<FieldKeys, readonly string[]> {
  if (!rawText || typeof rawText !== "string") {
    return base;
  }
  const { regions } = detectLocaleContext(rawText);
  const merged: Record<string, string[]> = {};
  for (const key of Object.keys(base) as FieldKeys[]) {
    merged[key] = [...base[key]];
  }
  for (const code of regions) {
    const pack = EXTRA_FIELD_SYNONYMS[code as RegionCode];
    if (!pack) continue;
    for (const k of Object.keys(pack) as (keyof typeof pack)[]) {
      const add = pack[k];
      if (!add?.length) continue;
      if (!merged[k]) merged[k] = [];
      const set = new Set(merged[k].map((x) => x.toLowerCase()));
      for (const phrase of add) {
        const low = phrase.toLowerCase();
        if (!set.has(low)) {
          set.add(low);
          merged[k].push(phrase);
        }
      }
    }
  }
  return merged as Record<FieldKeys, readonly string[]>;
}
