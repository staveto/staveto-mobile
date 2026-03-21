import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { Locale } from "../i18n/translations";

const LANGUAGE_SELECTION_DONE_KEY = "language_selection_done";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "en", label: "🇬🇧 English" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "sk", label: "🇸🇰 Slovenčina" },
  { code: "cs", label: "🇨🇿 Čeština" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "it", label: "🇮🇹 Italiano" },
  { code: "pl", label: "🇵🇱 Polski" },
];

type Props = { onComplete?: () => void };

export function LanguageSelectionScreen({ onComplete }: Props) {
  const navigation = useNavigation();
  const { t, setLocale } = useI18n();

  const onSelect = (code: Locale) => {
    setLocale(code);
    AsyncStorage.setItem(LANGUAGE_SELECTION_DONE_KEY, "1").catch(() => {});
    if (onComplete) {
      onComplete();
    } else {
      (navigation as { navigate: (name: string) => void }).navigate("OnboardingIntro");
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Staveto logo"
      />
      <Text style={styles.title}>{t("languageSelect.title")}</Text>
      <Text style={styles.subtitle}>{t("languageSelect.subtitle")}</Text>
      <View style={styles.list}>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={styles.button}
            onPress={() => onSelect(lang.code)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{lang.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!onComplete && (
        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => (navigation as { navigate: (name: string) => void }).navigate("Login")}
        >
          <Text style={styles.loginLinkText}>{t("register.haveAccount")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
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
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
});
