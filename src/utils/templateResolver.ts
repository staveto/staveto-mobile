/**
 * Resolves catalog template ID by project country for new project creation.
 * Used only when creating new projects - does not affect reads of existing projects.
 * Fallback: eu-construction-v1 if countryCode is missing, unsupported, or template unavailable.
 */

export const FALLBACK_TEMPLATE_ID = "eu-construction-v1";

const COUNTRY_TO_TEMPLATE: Record<string, string> = {
  SK: "eu-construction-v1",
  CZ: "cz-construction-v1",
  DE: "de-construction-v1",
  ES: "es-construction-v1",
  PL: "pl-construction-v1",
  IT: "it-construction-v1",
};

/**
 * Resolve template ID for new project creation based on countryCode.
 * Returns eu-construction-v1 for SK, unsupported countries, or when countryCode is empty.
 */
export function resolveTemplateIdForCountry(countryCode: string | undefined | null): string {
  if (!countryCode || !countryCode.trim()) {
    return FALLBACK_TEMPLATE_ID;
  }
  const code = countryCode.trim().toUpperCase();
  return COUNTRY_TO_TEMPLATE[code] ?? FALLBACK_TEMPLATE_ID;
}
