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

/** Slovak (fallback when locale unknown) */
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

type SupportedLocale = "en" | "sk" | "de" | "cs" | "es" | "it" | "pl";

/** Country names per app locale – used in onboarding and project create. Intl.DisplayNames may fail on RN. */
const COUNTRY_NAMES_BY_LOCALE: Record<SupportedLocale, Record<string, string>> = {
  en: {
    SK: "Slovakia", CZ: "Czechia", AT: "Austria", DE: "Germany", PL: "Poland", HU: "Hungary",
    IT: "Italy", ES: "Spain", FR: "France", GB: "United Kingdom", NL: "Netherlands", BE: "Belgium",
    CH: "Switzerland", UA: "Ukraine", RO: "Romania", BG: "Bulgaria", HR: "Croatia", SI: "Slovenia",
    RS: "Serbia", LT: "Lithuania", LV: "Latvia", EE: "Estonia", FI: "Finland", SE: "Sweden",
    NO: "Norway", IE: "Ireland", PT: "Portugal", GR: "Greece", US: "United States", CA: "Canada",
  },
  sk: {
    SK: "Slovensko", CZ: "Česko", AT: "Rakúsko", DE: "Nemecko", PL: "Poľsko", HU: "Maďarsko",
    IT: "Taliansko", ES: "Španielsko", FR: "Francúzsko", GB: "Veľká Británia", NL: "Holandsko", BE: "Belgicko",
    CH: "Švajčiarsko", UA: "Ukrajina", RO: "Rumunsko", BG: "Bulharsko", HR: "Chorvátsko", SI: "Slovinsko",
    RS: "Srbsko", LT: "Litva", LV: "Lotyšsko", EE: "Estónsko", FI: "Fínsko", SE: "Švédsko",
    NO: "Nórsko", IE: "Írsko", PT: "Portugalsko", GR: "Grécko", US: "USA", CA: "Kanada",
  },
  de: {
    SK: "Slowakei", CZ: "Tschechien", AT: "Österreich", DE: "Deutschland", PL: "Polen", HU: "Ungarn",
    IT: "Italien", ES: "Spanien", FR: "Frankreich", GB: "Vereinigtes Königreich", NL: "Niederlande", BE: "Belgien",
    CH: "Schweiz", UA: "Ukraine", RO: "Rumänien", BG: "Bulgarien", HR: "Kroatien", SI: "Slowenien",
    RS: "Serbien", LT: "Litauen", LV: "Lettland", EE: "Estland", FI: "Finnland", SE: "Schweden",
    NO: "Norwegen", IE: "Irland", PT: "Portugal", GR: "Griechenland", US: "Vereinigte Staaten", CA: "Kanada",
  },
  cs: {
    SK: "Slovensko", CZ: "Česko", AT: "Rakousko", DE: "Německo", PL: "Polsko", HU: "Maďarsko",
    IT: "Itálie", ES: "Španělsko", FR: "Francie", GB: "Velká Británie", NL: "Nizozemsko", BE: "Belgie",
    CH: "Švýcarsko", UA: "Ukrajina", RO: "Rumunsko", BG: "Bulharsko", HR: "Chorvatsko", SI: "Slovinsko",
    RS: "Srbsko", LT: "Litva", LV: "Lotyšsko", EE: "Estonsko", FI: "Finsko", SE: "Švédsko",
    NO: "Norsko", IE: "Irsko", PT: "Portugalsko", GR: "Řecko", US: "USA", CA: "Kanada",
  },
  es: {
    SK: "Eslovaquia", CZ: "Chequia", AT: "Austria", DE: "Alemania", PL: "Polonia", HU: "Hungría",
    IT: "Italia", ES: "España", FR: "Francia", GB: "Reino Unido", NL: "Países Bajos", BE: "Bélgica",
    CH: "Suiza", UA: "Ucrania", RO: "Rumanía", BG: "Bulgaria", HR: "Croacia", SI: "Eslovenia",
    RS: "Serbia", LT: "Lituania", LV: "Letonia", EE: "Estonia", FI: "Finlandia", SE: "Suecia",
    NO: "Noruega", IE: "Irlanda", PT: "Portugal", GR: "Grecia", US: "Estados Unidos", CA: "Canadá",
  },
  it: {
    SK: "Slovacchia", CZ: "Repubblica Ceca", AT: "Austria", DE: "Germania", PL: "Polonia", HU: "Ungheria",
    IT: "Italia", ES: "Spagna", FR: "Francia", GB: "Regno Unito", NL: "Paesi Bassi", BE: "Belgio",
    CH: "Svizzera", UA: "Ucraina", RO: "Romania", BG: "Bulgaria", HR: "Croazia", SI: "Slovenia",
    RS: "Serbia", LT: "Lituania", LV: "Lettonia", EE: "Estonia", FI: "Finlandia", SE: "Svezia",
    NO: "Norvegia", IE: "Irlanda", PT: "Portogallo", GR: "Grecia", US: "Stati Uniti", CA: "Canada",
  },
  pl: {
    SK: "Słowacja", CZ: "Czechy", AT: "Austria", DE: "Niemcy", PL: "Polska", HU: "Węgry",
    IT: "Włochy", ES: "Hiszpania", FR: "Francja", GB: "Wielka Brytania", NL: "Holandia", BE: "Belgia",
    CH: "Szwajcaria", UA: "Ukraina", RO: "Rumunia", BG: "Bułgaria", HR: "Chorwacja", SI: "Słowenia",
    RS: "Serbia", LT: "Litwa", LV: "Łotwa", EE: "Estonia", FI: "Finlandia", SE: "Szwecja",
    NO: "Norwegia", IE: "Irlandia", PT: "Portugalia", GR: "Grecja", US: "Stany Zjednoczone", CA: "Kanada",
  },
};

/**
 * Localized country name for selected app language.
 * Uses explicit translations (reliable on RN). Falls back to Intl.DisplayNames, then Slovak.
 */
export function getLocalizedCountryName(countryCode: string, appLocale?: string): string {
  const code = String(countryCode || "").toUpperCase();
  if (!code) return "";
  const locale = (String(appLocale || "en").toLowerCase().slice(0, 2) || "en") as SupportedLocale;
  const localeMap = COUNTRY_NAMES_BY_LOCALE[locale] ?? COUNTRY_NAMES_BY_LOCALE.en;
  const name = localeMap[code];
  if (name) return name;
  try {
    const localeTag = locale === "en" ? "en-US" : `${locale}-${locale.toUpperCase()}`;
    const displayNames = new Intl.DisplayNames([localeTag], { type: "region" });
    const localized = displayNames.of(code);
    if (localized) return localized;
  } catch {
    // ignore
  }
  return COUNTRY_NAMES[code] ?? code;
}

/** Country calling codes for phone input dropdown. Uses libphonenumber-js. */
export function getCountryCallingCode(countryCode: string): string {
  try {
    const { getCountryCallingCode } = require("libphonenumber-js");
    return getCountryCallingCode(countryCode as any) || "";
  } catch {
    return "";
  }
}

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
