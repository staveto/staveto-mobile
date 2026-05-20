import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { interpolate, translations, LOCALE_NAMES } from "./translations";
import { postDebugIngest } from "../lib/debugIngest";
import type { Locale } from "./translations";

const STORAGE_KEY = "staveto_locale";

function resolveLocale(code: string | undefined): Locale {
  const c = (code ?? "").toLowerCase().slice(0, 2);
  if (c === "es") return "es";
  if (c === "it") return "it";
  if (c === "pl") return "pl";
  if (c === "sk") return "sk";
  if (c === "cs") return "cs";
  if (c === "de") return "de";
  return "en";
}

function getDefaultLocale(): Locale {
  // Product decision: first launch should always start in English.
  return "en";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  localeNames: Record<Locale, string>;
  loaded: boolean;
};

const ctx = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getDefaultLocale);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((s) => {
      const applied =
        s && (s === "en" || s === "de" || s === "sk" || s === "cs" || s === "es" || s === "it" || s === "pl") ? s : null;
      // #region agent log
      postDebugIngest({
        hypothesisId: "H3",
        location: "I18nContext.tsx:AsyncStorage",
        message: "persisted_locale_read",
        data: { rawStorage: s ?? "(null)", appliedLocale: applied ?? "(default_en)" },
      });
      // #endregion
      if (applied) {
        setLocaleState(applied);
      }
      setLoaded(true);
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState((prev) => {
      if (__DEV__) {
        console.log("[LanguageDebug]", {
          previousLanguage: prev,
          nextLanguage: l,
          persisted: true,
          source: "I18nContext.setLocale",
        });
      }
      return l;
    });
    AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) => {
      const dict = translations[locale] ?? translations.en;
      const raw = dict[key] ?? translations.en[key] ?? key;
      if (__DEV__ && raw === key && !key.startsWith("errors.")) {
        console.warn(`[i18n] Missing key: ${locale} -> "${key}"`);
      }
      return interpolate(raw, params);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, localeNames: LOCALE_NAMES, loaded }),
    [locale, setLocale, t, loaded]
  );

  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useI18n(): I18nContextValue {
  const v = useContext(ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
