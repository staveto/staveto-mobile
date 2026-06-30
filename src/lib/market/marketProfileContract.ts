/**
 * Unified market + language contract (web + mobile must stay aligned).
 * Phase 1.5A-1 — foundation only; no tax engine or Firestore migrations.
 */

export type SupportedCountryCode = "SK" | "CZ" | "DE" | "AT" | "CH";

export type SupportedLanguageCode = "sk" | "en" | "de" | "cs" | "fr" | "it";

export type MarketSource = "solo_user" | "company_org";

export const USER_UI_LANGUAGE_FIELD = "preferredLanguage" as const;

/** Legacy solo country field — company workspace must never read this. */
export const LEGACY_SOLO_COUNTRY_FIELD = "primaryCountry" as const;

export const DEFAULT_MARKET_CONFIG_VERSION = 1;

export type TaxProfile = {
  countryCode?: SupportedCountryCode | string;
  taxLabel?: string;
  vatLabel?: string;
  vatMode?: "auto" | "with_vat" | "without_vat";
  complianceStatus: "needs_legal_review";
};

export type LegalProfile = {
  countryCode?: SupportedCountryCode | string;
  companyRegistrationNumberLabel?: string;
  taxIdLabel?: string;
  vatIdLabel?: string;
  requiredFields?: string[];
  optionalFields?: string[];
  complianceStatus: "needs_legal_review";
};

export type SoloMarketProfile = {
  soloCountryCode?: string | null;
  soloCurrency?: string | null;
  soloTimezone?: string | null;
  soloLocale?: string | null;
  soloDefaultLanguage?: string | null;
  soloTaxProfile?: TaxProfile | null;
  soloLegalProfile?: LegalProfile | null;
  soloMarketConfigVersion?: number | null;
};

export type OrganizationMarketProfile = {
  countryCode?: string | null;
  currency?: string | null;
  timezone?: string | null;
  locale?: string | null;
  defaultLanguage?: string | null;
  taxProfile?: TaxProfile | null;
  legalProfile?: LegalProfile | null;
  marketConfigVersion?: number | null;
};

export type ResolvedMarketProfile = {
  activeMarketSource: MarketSource;
  activeCountryCode: string | null;
  activeCurrency: string;
  activeTimezone: string;
  activeLocale: string | null;
  activeDefaultDocumentLanguage: string | null;
  activeTaxProfile: TaxProfile | null;
  activeLegalProfile: LegalProfile | null;
  marketConfigVersion: number;
  marketConfigWarnings: string[];
};

/** Loose user doc input for adapters (Firestore + in-memory). */
export type UserMarketInput = SoloMarketProfile & {
  preferredLanguage?: string | null;
  /** @deprecated Legacy solo fallback only — never for company workspace. */
  primaryCountry?: string | null;
  timezone?: string | null;
};

/** Loose organization doc input for adapters (legacy field names allowed). */
export type OrganizationMarketInput = OrganizationMarketProfile & {
  country?: string | null;
  profile?: {
    country?: string | null;
    countryCode?: string | null;
  } | null;
};
