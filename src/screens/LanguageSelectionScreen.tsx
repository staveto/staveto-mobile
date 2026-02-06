import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { Locale } from "../i18n/translations";

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "en", label: "🇬🇧 English" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "sk", label: "🇸🇰 Slovenčina" },
  { code: "cs", label: "🇨🇿 Čeština" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "it", label: "🇮🇹 Italiano" },
  { code: "pl", label: "🇵🇱 Polski" },
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
