import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { Locale } from "../i18n/translations";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "sk", label: "Slovenčina" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
];

export function LanguageSelectionScreen() {
  const navigation = useNavigation();
  const { t, setLocale } = useI18n();

  const onSelect = (code: Locale) => {
    setLocale(code);
    (navigation as { navigate: (name: string) => void }).navigate("OnboardingIntro");
  };

  return (
    <View style={styles.container}>
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
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
  },
  list: {
    marginTop: spacing.xl,
    gap: spacing.md,
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
