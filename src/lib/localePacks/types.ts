/**
 * Region / locale pack types for international invoice & receipt parsing.
 * Packs are additive: base rules + dictionaries live elsewhere; packs extend them.
 */

export type Tier1Region = "SK" | "CZ" | "DE" | "AT" | "PL" | "US";
export type Tier2Region = "FR" | "IT" | "ES" | "NL" | "BE";
export type RegionCode = Tier1Region | Tier2Region;

/** One explicit final-total line rule (ordered lists: more specific patterns first). */
export type FinalTotalLineRule = {
  tier: number;
  id: string;
  match: (line: string) => boolean;
};

export type LocaleDetectionResult = {
  /** Best-first region codes (Tier 1 preferred when tied). */
  regions: RegionCode[];
  /** Short human-readable signals (for logs only). */
  hints: string[];
};

export type DateOrderPreference = "DMY" | "MDY" | "YMD";

export type TaxIdPattern = { id: string; pattern: RegExp; region: RegionCode };
