import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";

export function BusinessLandingScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("business.landing.title")}</Text>
      <Text style={styles.subtitle}>{t("business.landing.subtitle")}</Text>

      <View style={styles.benefitsCard}>
        <Text style={styles.benefit}>- {t("business.landing.benefit.workspace")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.teamProjects")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.projectChat")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.media")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.roles")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.attendance")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.issues")}</Text>
        <Text style={styles.benefit}>- {t("business.landing.benefit.reports")}</Text>
      </View>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => (navigation as { navigate: (name: string) => void }).navigate("BusinessRegistration")}
      >
        <Text style={styles.primaryButtonText}>{t("business.landing.registerCta")}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => {
          if ((navigation as { canGoBack: () => boolean }).canGoBack()) {
            navigation.goBack();
          }
        }}
      >
        <Text style={styles.secondaryButtonText}>{t("business.landing.personalCta")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "center",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.onboardingHelperOnDark,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  benefitsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  benefit: {
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  secondaryButton: {
    borderColor: "rgba(255,255,255,0.55)",
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textOnDark,
  },
});

