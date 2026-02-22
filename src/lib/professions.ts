/**
 * Profession taxonomy for user profile.
 * Stable codes stored in Firestore; labels localized via professions.<CODE>.
 */
export const PROFESSION_CODES = [
  "GENERAL_CONTRACTOR",
  "ARCHITECT",
  "PROJECT_MANAGER",
  "PLUMBER",
  "ELECTRICIAN",
  "HVAC",
  "CARPENTER",
  "MASON",
  "PAINTER",
  "TILER",
  "ROOFER",
  "DRYWALL",
  "FLOORING",
  "WINDOW_DOOR",
  "INSULATION",
  "LANDSCAPING",
  "CLEANING",
  "SURVEYOR",
  "ENGINEER",
  "OTHER",
] as const;

export type ProfessionCode = (typeof PROFESSION_CODES)[number];

/** Normalize string for alias lookup: trim, lower, remove diacritics */
function normalizeForAlias(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Alias map: normalized key -> profession code (for migration from free text) */
const ALIAS_MAP: Record<string, ProfessionCode> = {
  vodar: "PLUMBER",
  instalater: "PLUMBER",
  instalatér: "PLUMBER",
  plumber: "PLUMBER",
  elektrikar: "ELECTRICIAN",
  elektrikár: "ELECTRICIAN",
  electrician: "ELECTRICIAN",
  kurar: "HVAC",
  kúrar: "HVAC",
  hvac: "HVAC",
  topenar: "HVAC",
  topenár: "HVAC",
  murar: "MASON",
  murár: "MASON",
  mason: "MASON",
  maliar: "PAINTER",
  painter: "PAINTER",
  tesar: "CARPENTER",
  tesár: "CARPENTER",
  carpenter: "CARPENTER",
  stavebny: "GENERAL_CONTRACTOR",
  stavbyveduci: "GENERAL_CONTRACTOR",
  stavbyvedúci: "GENERAL_CONTRACTOR",
  "general contractor": "GENERAL_CONTRACTOR",
  architekt: "ARCHITECT",
  architect: "ARCHITECT",
  projektovy: "PROJECT_MANAGER",
  projektový: "PROJECT_MANAGER",
  "project manager": "PROJECT_MANAGER",
  obklady: "TILER",
  tiler: "TILER",
  strechar: "ROOFER",
  strechár: "ROOFER",
  roofer: "ROOFER",
  sádrokarton: "DRYWALL",
  drywall: "DRYWALL",
  podlahy: "FLOORING",
  flooring: "FLOORING",
  okna: "WINDOW_DOOR",
  dvere: "WINDOW_DOOR",
  "window door": "WINDOW_DOOR",
  izolacie: "INSULATION",
  izolácie: "INSULATION",
  insulation: "INSULATION",
  zahradkar: "LANDSCAPING",
  záhradkár: "LANDSCAPING",
  landscaping: "LANDSCAPING",
  upratovanie: "CLEANING",
  cleaning: "CLEANING",
  geodet: "SURVEYOR",
  geodét: "SURVEYOR",
  surveyor: "SURVEYOR",
  inzinier: "ENGINEER",
  inžinier: "ENGINEER",
  engineer: "ENGINEER",
};

/**
 * Migration: map existing free-text profession to code.
 * Returns null when empty (user must pick).
 */
export function mapExistingFreeTextToCodeForMigration(
  text: string | null | undefined
): { code: ProfessionCode; otherText: string | null } | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const normalized = normalizeForAlias(raw);
  const code = ALIAS_MAP[normalized] ?? null;
  if (code) return { code, otherText: null };
  return { code: "OTHER", otherText: raw };
}

/**
 * For save: when user explicitly selects OTHER with custom text.
 * If otherText is empty when saving OTHER, returns { code: "OTHER", otherText: null }.
 */
export function toSavePayload(
  code: ProfessionCode | null,
  otherText: string
): { primaryProfessionCode: ProfessionCode; primaryProfessionOtherText: string | null } | null {
  if (!code) return null;
  if (code === "OTHER") {
    return { primaryProfessionCode: "OTHER", primaryProfessionOtherText: otherText.trim() || null };
  }
  return { primaryProfessionCode: code, primaryProfessionOtherText: null };
}
