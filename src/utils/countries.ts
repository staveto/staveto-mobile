/**
 * ISO 3166-1 alpha-2 country codes for primary country / project location.
 * Used in onboarding and project create/edit.
 */
export const COUNTRY_CODES = [
  "SK",
  "CZ",
  "AT",
  "DE",
  "PL",
  "HU",
  "IT",
  "ES",
  "FR",
  "GB",
  "NL",
  "BE",
  "CH",
  "UA",
  "RO",
  "BG",
  "HR",
  "SI",
  "RS",
  "LT",
  "LV",
  "EE",
  "FI",
  "SE",
  "NO",
  "IE",
  "PT",
  "GR",
  "US",
  "CA",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

export const COUNTRY_NAMES: Record<string, string> = {
  SK: "Slovensko",
  CZ: "Česko",
  AT: "Rakúsko",
  DE: "Nemecko",
  PL: "Poľsko",
  HU: "Maďarsko",
  IT: "Taliansko",
  ES: "Španielsko",
  FR: "Francúzsko",
  GB: "Veľká Británia",
  NL: "Holandsko",
  BE: "Belgicko",
  CH: "Švajčiarsko",
  UA: "Ukrajina",
  RO: "Rumunsko",
  BG: "Bulharsko",
  HR: "Chorvátsko",
  SI: "Slovinsko",
  RS: "Srbsko",
  LT: "Litva",
  LV: "Lotyšsko",
  EE: "Estónsko",
  FI: "Fínsko",
  SE: "Švédsko",
  NO: "Nórsko",
  IE: "Írsko",
  PT: "Portugalsko",
  GR: "Grécko",
  US: "USA",
  CA: "Kanada",
};

/** Get device region code (ISO 3166-1 alpha-2, e.g. SK, PL). Uses expo-localization getLocales() - Localization.region was removed in v17. */
export function getDeviceRegionCode(): string {
  try {
    const { getLocales } = require("expo-localization");
    const locales = getLocales?.();
    const code = locales?.[0]?.regionCode;
    return (code && typeof code === "string") ? code : "SK";
  } catch {
    return "SK";
  }
}

/** Get device timezone (IANA, e.g. Europe/Bratislava) */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Bratislava";
  } catch {
    return "Europe/Bratislava";
  }
}
