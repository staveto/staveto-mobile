import React, { useCallback } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { Locale } from "../i18n/translations";
import { LOCALE_NAMES, ONBOARDING_LOCALE_ORDER } from "../i18n/translations";

export const LANGUAGE_SELECTION_DONE_KEY = "language_selection_done";

type Props = { onComplete?: () => void };

export function LanguageSelectionScreen({ onComplete }: Props) {
  const navigation = useNavigation();
  const { t, locale, setLocale } = useI18n();

  const onSelect = useCallback(
    (code: Locale) => {
      const prev = locale;
      if (__DEV__) {
        console.log("[LanguageDebug]", {
          previousLanguage: prev,
          nextLanguage: code,
          persisted: true,
          source: "LanguageSelectionScreen",
        });
      }
      setLocale(code);
      AsyncStorage.setItem(LANGUAGE_SELECTION_DONE_KEY, "1").catch(() => {});
      if (onComplete) {
        onComplete();
      } else {
        (navigation as { navigate: (name: string) => void }).navigate("OnboardingIntro");
      }
    },
    [locale, setLocale, onComplete, navigation]
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Staveto logo"
      />
      <Text style={styles.title}>{t("languageSelect.title")}</Text>
      <Text style={styles.subtitle}>{t("languageSelect.subtitle")}</Text>
      <View style={styles.list}>
        {ONBOARDING_LOCALE_ORDER.map((code) => {
          const active = locale === code;
          return (
            <Pressable
              key={code}
              style={[styles.button, active && styles.buttonActive]}
              onPress={() => onSelect(code)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.buttonText}>{LOCALE_NAMES[code]}</Text>
            </Pressable>
          );
        })}
      </View>
      {!onComplete ? (
        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => (navigation as { navigate: (name: string) => void }).navigate("Login")}
        >
          <Text style={styles.loginLinkText}>{t("register.haveAccount")}</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: "center",
    paddingBottom: spacing.xl * 2,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: "#fff",
    textAlign: "center",
  },
  logo: {
    width: 160,
    height: 80,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  list: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  loginLink: {
    marginTop: spacing.xl,
    alignItems: "center",
  },
  loginLinkText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
  },
  button: {
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  buttonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
});
