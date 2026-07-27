import type { Locale } from "./translations";

/** Module-level locale for non-React code (auth error mapping, etc.). */
let currentLocale: Locale = "en";

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getCurrentLocale(): Locale {
  return currentLocale;
}
