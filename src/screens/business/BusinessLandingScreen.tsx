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
        <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.85} onPress={() => nav.goBack()}>
          <Text style={styles.secondaryButtonText}>{t("business.landing.free.cta")}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.planCard, styles.proCard]}>
        <View style={styles.badgeRow}>
          <View style={styles.proBadge}>
            <Text style={styles.proBadgeText}>{t("business.landing.pro.badge")}</Text>
          </View>
        </View>
        <Text style={styles.planName}>{t("business.landing.pro.title")}</Text>
        <Text style={styles.planSubtitle}>{t("business.landing.pro.subtitle")}</Text>
        <Text style={styles.proHighlight}>{t("business.landing.pro.highlight")}</Text>
        <Text style={styles.planPrice}>{t("business.landing.pro.price")}</Text>
        <Text style={styles.planDescription}>{t("business.landing.pro.description")}</Text>
        <View style={styles.benefitChips}>
          <View style={styles.benefitChip}>
            <Text style={styles.benefitChipText}>{t("business.landing.pro.benefit.projects")}</Text>
          </View>
          <View style={styles.benefitChip}>
            <Text style={styles.benefitChipText}>{t("business.landing.pro.benefit.costs")}</Text>
          </View>
          <View style={styles.benefitChip}>
            <Text style={styles.benefitChipText}>{t("business.landing.pro.benefit.exports")}</Text>
          </View>
          <View style={styles.benefitChip}>
            <Text style={styles.benefitChipText}>{t("business.landing.pro.benefit.personal")}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.proButton}
          activeOpacity={0.85}
          onPress={() => {
            try {
              nav.navigate("Paywall", { source: "business_landing_pro" });
            } catch {
              Alert.alert(t("business.landing.pro.alertTitle"), t("business.landing.pro.alertBody"));
            }
          }}
        >
          <Text style={styles.proButtonText}>{t("business.landing.pro.cta")}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.planCard, styles.businessCard]}>
        <View style={styles.badgeRow}>
          <View style={styles.businessBadge}>
            <Text style={styles.businessBadgeText}>{t("business.landing.business.badge")}</Text>
          </View>
        </View>
        <Text style={styles.planName}>{t("business.landing.business.title")}</Text>
        <Text style={styles.planSubtitle}>{t("business.landing.business.subtitle")}</Text>
        <Text style={styles.planPrice}>{t("business.landing.business.price")}</Text>
        <Text style={styles.planDescription}>{t("business.landing.business.description")}</Text>
        <View style={styles.businessBenefitChips}>
          <View style={styles.businessBenefitChip}>
            <Text style={styles.businessBenefitChipText}>{t("business.landing.business.benefit.users")}</Text>
          </View>
          <View style={styles.businessBenefitChip}>
            <Text style={styles.businessBenefitChipText}>{t("business.landing.business.benefit.roles")}</Text>
          </View>
          <View style={styles.businessBenefitChip}>
            <Text style={styles.businessBenefitChipText}>{t("business.landing.business.benefit.teamProjects")}</Text>
          </View>
          <View style={styles.businessBenefitChip}>
            <Text style={styles.businessBenefitChipText}>{t("business.landing.business.benefit.chatMedia")}</Text>
          </View>
          <View style={styles.businessBenefitChip}>
            <Text style={styles.businessBenefitChipText}>{t("business.landing.business.benefit.attendanceReports")}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.9} onPress={() => nav.navigate("BusinessRegistration")}>
          <Text style={styles.primaryButtonText}>{t("business.landing.business.cta")}</Text>
        </TouchableOpacity>
        <Text style={styles.businessHint}>{t("business.landing.business.nextStepHint")}</Text>
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
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 24,
    paddingBottom: spacing.xl + 72,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "left",
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
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
    marginBottom: spacing.xl,
  },
  proCard: {
    borderColor: "#4f6f96",
    backgroundColor: "#eef4fc",
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  proBadge: {
    backgroundColor: "#2f4f75",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  proBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  businessBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  businessBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
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
  proHighlight: {
    fontSize: 13,
    color: "#2f4f75",
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  planDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginBottom: spacing.md,
  },
  benefitChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  benefitChip: {
    borderWidth: 1,
    borderColor: "#b8c8dd",
    backgroundColor: "#f8fbff",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  benefitChipText: {
    color: "#2f4f75",
    fontSize: 12,
    fontWeight: "600",
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
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  proButton: {
    borderColor: "#2f4f75",
    borderWidth: 1,
    borderRadius: radius,
    backgroundColor: "#2f4f75",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  proButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  businessBenefitChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  businessBenefitChip: {
    borderWidth: 1,
    borderColor: "#e8b699",
    backgroundColor: "#fff5ef",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  businessBenefitChipText: {
    color: "#8a4f2f",
    fontSize: 12,
    fontWeight: "600",
  },
  businessHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    color: "#8a4f2f",
  },
});

