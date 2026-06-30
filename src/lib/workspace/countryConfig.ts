export type CountryConfig = {
  countryCode: string;
  currency: string;
  timezone: string;
  defaultLanguage: string;
};

const COUNTRY_CONFIG: Record<string, CountryConfig> = {
  SK: { countryCode: "SK", currency: "EUR", timezone: "Europe/Bratislava", defaultLanguage: "sk" },
  CZ: { countryCode: "CZ", currency: "CZK", timezone: "Europe/Prague", defaultLanguage: "cs" },
  AT: { countryCode: "AT", currency: "EUR", timezone: "Europe/Vienna", defaultLanguage: "de" },
  DE: { countryCode: "DE", currency: "EUR", timezone: "Europe/Berlin", defaultLanguage: "de" },
  CH: { countryCode: "CH", currency: "CHF", timezone: "Europe/Zurich", defaultLanguage: "de" },
};

const SOLO_FALLBACK: CountryConfig = {
  countryCode: "SK",
  currency: "EUR",
  timezone: "Europe/Bratislava",
  defaultLanguage: "sk",
};

export function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code?.trim()) return null;
  return code.trim().toUpperCase();
}

export function resolveCountryConfig(countryCode: string | null | undefined): CountryConfig {
  const normalized = normalizeCountryCode(countryCode);
  if (normalized && COUNTRY_CONFIG[normalized]) return COUNTRY_CONFIG[normalized];
  return SOLO_FALLBACK;
}

export function mergeWorkspaceLocale(
  countryCode: string | null | undefined,
  overrides?: Partial<Pick<CountryConfig, "currency" | "timezone" | "defaultLanguage">>
): CountryConfig {
  const base = resolveCountryConfig(countryCode);
  return {
    ...base,
    currency: overrides?.currency?.trim() || base.currency,
    timezone: overrides?.timezone?.trim() || base.timezone,
    defaultLanguage: overrides?.defaultLanguage?.trim() || base.defaultLanguage,
  };
}
