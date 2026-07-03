import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import type { Locale } from "../i18n/translations";

const SUPPORTED: Locale[] = ["en", "de", "sk", "cs", "es", "it", "pl"];

function toSupportedLocale(value: string | null | undefined): Locale | null {
  const normalized = value?.trim().toLowerCase().slice(0, 2);
  if (!normalized) return null;
  return SUPPORTED.includes(normalized as Locale) ? (normalized as Locale) : null;
}

/** Applies users/{uid}.preferredLanguage to I18n on login (UI language ≠ workspace country). */
export function UserPreferredLocaleSync() {
  const { user } = useAuth();
  const { locale, setLocale, loaded } = useI18n();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const preferred = toSupportedLocale(user?.preferredLanguage);
    if (!preferred) return;
    const key = `${user?.preferredLanguage ?? ""}:${preferred}`;
    if (appliedRef.current === key && locale === preferred) return;
    appliedRef.current = key;
    if (locale !== preferred) {
      setLocale(preferred);
    }
  }, [loaded, locale, setLocale, user?.preferredLanguage]);

  return null;
}
