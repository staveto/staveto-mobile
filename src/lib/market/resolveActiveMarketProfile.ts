import { mergeWorkspaceLocale } from "../workspace/countryConfig";
import {
  defaultMarketConfigVersion,
  readOrganizationMarketProfile,
  readSoloMarketProfile,
} from "./marketProfileAdapters";
import type {
  OrganizationMarketInput,
  ResolvedMarketProfile,
  UserMarketInput,
} from "./marketProfileContract";

export type ResolveActiveMarketProfileInput = {
  activeWorkspaceType: "solo" | "company";
  userProfile?: UserMarketInput | null;
  organizationProfile?: OrganizationMarketInput | null;
  userPreferredLanguage?: string | null;
  /** Solo-only personal timezone override (not company market). */
  userTimezone?: string | null;
};

/**
 * Resolves active market profile for the current workspace.
 * Read-only — does not write Firestore.
 */
export function resolveActiveMarketProfile(
  input: ResolveActiveMarketProfileInput
): ResolvedMarketProfile {
  const warnings: string[] = [];

  if (input.activeWorkspaceType === "company") {
    const orgRead = readOrganizationMarketProfile(input.organizationProfile);
    warnings.push(...orgRead.warnings);

    const countryCode = orgRead.resolvedCountryCode;
    const localeDefaults = mergeWorkspaceLocale(countryCode, {
      currency: orgRead.profile.currency ?? undefined,
      timezone: orgRead.profile.timezone ?? undefined,
      defaultLanguage: orgRead.profile.defaultLanguage ?? undefined,
    });

    if (!countryCode) {
      warnings.push("company_market_incomplete_using_safe_defaults");
    }

    return {
      activeMarketSource: "company_org",
      activeCountryCode: countryCode,
      activeCurrency: orgRead.profile.currency?.trim() || localeDefaults.currency,
      activeTimezone: orgRead.profile.timezone?.trim() || localeDefaults.timezone,
      activeLocale: orgRead.profile.locale?.trim() || null,
      activeDefaultDocumentLanguage:
        orgRead.profile.defaultLanguage?.trim() || localeDefaults.defaultLanguage,
      activeTaxProfile: orgRead.profile.taxProfile ?? null,
      activeLegalProfile: orgRead.profile.legalProfile ?? null,
      marketConfigVersion: defaultMarketConfigVersion(orgRead.profile.marketConfigVersion),
      marketConfigWarnings: warnings,
    };
  }

  const soloRead = readSoloMarketProfile(input.userProfile);
  warnings.push(...soloRead.warnings);

  const countryCode = soloRead.resolvedCountryCode;
  const localeDefaults = mergeWorkspaceLocale(countryCode, {
    currency: soloRead.profile.soloCurrency ?? undefined,
    timezone: soloRead.profile.soloTimezone ?? input.userTimezone ?? undefined,
    defaultLanguage: soloRead.profile.soloDefaultLanguage ?? undefined,
  });

  return {
    activeMarketSource: "solo_user",
    activeCountryCode: countryCode,
    activeCurrency: soloRead.profile.soloCurrency?.trim() || localeDefaults.currency,
    activeTimezone:
      soloRead.profile.soloTimezone?.trim() ||
      input.userTimezone?.trim() ||
      localeDefaults.timezone,
    activeLocale: soloRead.profile.soloLocale?.trim() || null,
    activeDefaultDocumentLanguage:
      soloRead.profile.soloDefaultLanguage?.trim() || localeDefaults.defaultLanguage,
    activeTaxProfile: soloRead.profile.soloTaxProfile ?? null,
    activeLegalProfile: soloRead.profile.soloLegalProfile ?? null,
    marketConfigVersion: defaultMarketConfigVersion(soloRead.profile.soloMarketConfigVersion),
    marketConfigWarnings: warnings,
  };
}
