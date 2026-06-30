import {
  DEFAULT_MARKET_CONFIG_VERSION,
  LEGACY_SOLO_COUNTRY_FIELD,
  type OrganizationMarketInput,
  type OrganizationMarketProfile,
  type SoloMarketProfile,
  type UserMarketInput,
} from "./marketProfileContract";
import { normalizeCountryCode } from "../workspace/countryConfig";

export type ReadSoloMarketResult = {
  profile: SoloMarketProfile;
  resolvedCountryCode: string | null;
  warnings: string[];
};

export type ReadOrganizationMarketResult = {
  profile: OrganizationMarketProfile;
  resolvedCountryCode: string | null;
  warnings: string[];
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickCountryCode(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Reads solo market fields from a user profile.
 * Never derives country from preferredLanguage or UI locale.
 */
export function readSoloMarketProfile(
  userProfile: UserMarketInput | null | undefined
): ReadSoloMarketResult {
  const warnings: string[] = [];
  const profile: SoloMarketProfile = {
    soloCountryCode: userProfile?.soloCountryCode?.trim() || null,
    soloCurrency: userProfile?.soloCurrency?.trim() || null,
    soloTimezone: userProfile?.soloTimezone?.trim() || null,
    soloLocale: userProfile?.soloLocale?.trim() || null,
    soloDefaultLanguage: userProfile?.soloDefaultLanguage?.trim() || null,
    soloTaxProfile: userProfile?.soloTaxProfile ?? null,
    soloLegalProfile: userProfile?.soloLegalProfile ?? null,
    soloMarketConfigVersion: userProfile?.soloMarketConfigVersion ?? null,
  };

  let resolvedCountryCode = pickCountryCode(profile.soloCountryCode);

  if (!resolvedCountryCode && nonEmpty(userProfile?.primaryCountry)) {
    resolvedCountryCode = pickCountryCode(userProfile!.primaryCountry);
    if (resolvedCountryCode) {
      warnings.push(`legacy_${LEGACY_SOLO_COUNTRY_FIELD}_fallback`);
    }
  }

  if (!resolvedCountryCode) {
    warnings.push("solo_country_missing");
  }

  if (nonEmpty(userProfile?.preferredLanguage) && !resolvedCountryCode) {
    warnings.push("preferred_language_not_used_as_country");
  }

  return { profile, resolvedCountryCode, warnings };
}

/**
 * Reads company market fields from an organization doc.
 * Never uses user.primaryCountry, soloCountryCode, or preferredLanguage.
 */
export function readOrganizationMarketProfile(
  org: OrganizationMarketInput | null | undefined
): ReadOrganizationMarketResult {
  const warnings: string[] = [];
  const profile: OrganizationMarketProfile = {
    countryCode: org?.countryCode?.trim() || null,
    currency: org?.currency?.trim() || null,
    timezone: org?.timezone?.trim() || null,
    locale: org?.locale?.trim() || null,
    defaultLanguage: org?.defaultLanguage?.trim() || null,
    taxProfile: org?.taxProfile ?? null,
    legalProfile: org?.legalProfile ?? null,
    marketConfigVersion: org?.marketConfigVersion ?? null,
  };

  const resolvedCountryCode = pickCountryCode(
    profile.countryCode,
    org?.legalProfile?.countryCode,
    org?.country,
    org?.profile?.countryCode,
    org?.profile?.country
  );

  if (!resolvedCountryCode) {
    warnings.push("company_country_missing");
  }

  return { profile, resolvedCountryCode, warnings };
}

export function isSoloMarketComplete(userProfile: UserMarketInput | null | undefined): boolean {
  const { resolvedCountryCode } = readSoloMarketProfile(userProfile);
  return Boolean(resolvedCountryCode);
}

export function isCompanyMarketComplete(
  org: OrganizationMarketInput | null | undefined
): boolean {
  const { resolvedCountryCode } = readOrganizationMarketProfile(org);
  return Boolean(resolvedCountryCode);
}

export function defaultMarketConfigVersion(
  profileVersion: number | null | undefined
): number {
  return typeof profileVersion === "number" && profileVersion > 0
    ? profileVersion
    : DEFAULT_MARKET_CONFIG_VERSION;
}
