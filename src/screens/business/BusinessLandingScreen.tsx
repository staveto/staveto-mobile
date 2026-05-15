import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";

export function BusinessLandingScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const nav = navigation as unknown as {
    navigate: (name: string, params?: object) => void;
    goBack: () => void;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.landing.planChoiceTitle")}</Text>
      <Text style={styles.subtitle}>{t("business.landing.planChoiceSubtitle")}</Text>

      <View style={styles.planCard}>
        <Text style={styles.planName}>{t("business.landing.free.title")}</Text>
        <Text style={styles.planSubtitle}>{t("business.landing.free.subtitle")}</Text>
        <Text style={styles.planPrice}>{t("business.landing.free.price")}</Text>
        <Text style={styles.planDescription}>{t("business.landing.free.description")}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => nav.goBack()}>
          <Text style={styles.secondaryButtonText}>{t("business.landing.free.cta")}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.planCard}>
        <Text style={styles.planName}>{t("business.landing.pro.title")}</Text>
        <Text style={styles.planSubtitle}>{t("business.landing.pro.subtitle")}</Text>
        <Text style={styles.planPrice}>{t("business.landing.pro.price")}</Text>
        <Text style={styles.planDescription}>{t("business.landing.pro.description")}</Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            try {
              nav.navigate("Paywall", { source: "business_landing_pro" });
            } catch {
              Alert.alert(t("business.landing.pro.alertTitle"), t("business.landing.pro.alertBody"));
            }
          }}
        >
          <Text style={styles.secondaryButtonText}>{t("business.landing.pro.cta")}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.planCard, styles.businessCard]}>
        <Text style={styles.planName}>{t("business.landing.business.title")}</Text>
        <Text style={styles.planSubtitle}>{t("business.landing.business.subtitle")}</Text>
        <Text style={styles.planPrice}>{t("business.landing.business.price")}</Text>
        <Text style={styles.planDescription}>{t("business.landing.business.description")}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => nav.navigate("BusinessRegistration")}>
          <Text style={styles.primaryButtonText}>{t("business.landing.business.cta")}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "left",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.onboardingHelperOnDark,
    textAlign: "left",
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  planCard: {
    backgroundColor: colors.formPanel,
    borderColor: colors.formPanelBorder,
    borderWidth: 1,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  businessCard: {
    borderColor: colors.primary,
    backgroundColor: "#f7e7df",
  },
  planName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  planSubtitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  planPrice: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  planDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginBottom: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  secondaryButton: {
    borderColor: colors.formPanelBorder,
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: "rgba(22,34,45,0.05)",
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

