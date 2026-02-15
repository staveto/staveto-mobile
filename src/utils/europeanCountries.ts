/**
 * European countries for travel expense address disambiguation.
 * Uses English names for Google Directions API compatibility.
 */
export type CountryOption = { code: string; name: string; aliases?: string[] };

export const EUROPEAN_COUNTRIES: CountryOption[] = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic", aliases: ["Česko", "Czechia"] },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia", aliases: ["Slovensko"] },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "GB", name: "United Kingdom" },
  { code: "NO", name: "Norway" },
  { code: "CH", name: "Switzerland" },
  { code: "IS", name: "Iceland" },
  { code: "AL", name: "Albania" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "MK", name: "North Macedonia" },
  { code: "ME", name: "Montenegro" },
  { code: "RS", name: "Serbia" },
  { code: "XK", name: "Kosovo" },
  { code: "UA", name: "Ukraine" },
  { code: "MD", name: "Moldova" },
  { code: "BY", name: "Belarus" },
  { code: "TR", name: "Turkey" },
];

export function getCountryByCode(code: string): CountryOption | undefined {
  return EUROPEAN_COUNTRIES.find((c) => c.code === code);
}

/** Try to parse country code from address like "Martin, Slovensko" */
export function parseCountryFromAddress(address: string): string | null {
  const t = address.trim();
  const lastComma = t.lastIndexOf(",");
  if (lastComma < 0) return null;
  const suffix = t.slice(lastComma + 1).trim().toLowerCase();
  const found = EUROPEAN_COUNTRIES.find(
    (c) =>
      c.name.toLowerCase() === suffix ||
      c.code.toLowerCase() === suffix ||
      (c.aliases?.some((a) => a.toLowerCase() === suffix) ?? false)
  );
  return found?.code ?? null;
}

/** Build full address for API. Skips appending if address already contains a known country. */
export function buildAddressWithCountry(address: string, countryCode: string): string {
  const t = address.trim();
  if (!t) return t;
  const lastComma = t.lastIndexOf(",");
  if (lastComma >= 0) {
    const suffix = t.slice(lastComma + 1).trim().toLowerCase();
    const hasCountry = EUROPEAN_COUNTRIES.some(
      (c) =>
        c.name.toLowerCase() === suffix ||
        c.code.toLowerCase() === suffix ||
        (c.aliases?.some((a) => a.toLowerCase() === suffix) ?? false)
    );
    if (hasCountry) return t;
  }
  const country = getCountryByCode(countryCode);
  if (!country) return t;
  return `${t}, ${country.name}`;
}
