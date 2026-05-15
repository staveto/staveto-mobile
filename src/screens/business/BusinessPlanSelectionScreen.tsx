import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";

type PlanCode = "business_starter" | "business_team" | "business_company";
type BillingPeriod = "monthly" | "yearly";

const BUSINESS_PLANS: Array<{
  planCode: PlanCode;
  seatsIncluded: number;
  monthlyPrice: number;
  yearlyPrice: number;
  titleKey: string;
}> = [
  {
    planCode: "business_starter",
    seatsIncluded: 5,
    monthlyPrice: 149,
    yearlyPrice: 1490,
    titleKey: "business.planSelection.starterTitle",
  },
  {
    planCode: "business_team",
    seatsIncluded: 15,
    monthlyPrice: 329,
    yearlyPrice: 3290,
    titleKey: "business.planSelection.teamTitle",
  },
  {
    planCode: "business_company",
    seatsIncluded: 30,
    monthlyPrice: 649,
    yearlyPrice: 6490,
    titleKey: "business.planSelection.companyTitle",
  },
];

export function BusinessPlanSelectionScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode | "">("");

  const selectedPlan = useMemo(
    () => BUSINESS_PLANS.find((plan) => plan.planCode === selectedPlanCode) ?? null,
    [selectedPlanCode]
  );

  const onContinue = () => {
    if (!selectedPlan) {
      Alert.alert(
        t("business.planSelection.selectPlanTitle"),
        t("business.planSelection.selectPlanBody")
      );
      return;
    }
    nav.navigate("BusinessRegistration", {
      planCode: selectedPlan.planCode,
      billingPeriod,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.planSelection.title")}</Text>
      <Text style={styles.subtitle}>{t("business.planSelection.subtitle")}</Text>

      <View style={styles.billingToggle}>
        <TouchableOpacity
          style={[styles.billingToggleButton, billingPeriod === "monthly" && styles.billingToggleButtonActive]}
          activeOpacity={0.85}
          onPress={() => setBillingPeriod("monthly")}
        >
          <Text
            style={[styles.billingToggleText, billingPeriod === "monthly" && styles.billingToggleTextActive]}
          >
            {t("business.planSelection.billingMonthly")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.billingToggleButton, billingPeriod === "yearly" && styles.billingToggleButtonActive]}
          activeOpacity={0.85}
          onPress={() => setBillingPeriod("yearly")}
        >
          <Text style={[styles.billingToggleText, billingPeriod === "yearly" && styles.billingToggleTextActive]}>
            {t("business.planSelection.billingYearly")}
          </Text>
        </TouchableOpacity>
      </View>

      {BUSINESS_PLANS.map((plan) => {
        const selected = selectedPlanCode === plan.planCode;
        const price =
          billingPeriod === "yearly"
            ? t("business.planSelection.yearlyPrice", { price: String(plan.yearlyPrice) })
            : t("business.planSelection.monthlyPrice", { price: String(plan.monthlyPrice) });
        return (
          <TouchableOpacity
            key={plan.planCode}
            style={[styles.planCard, selected && styles.planCardSelected]}
            activeOpacity={0.88}
            onPress={() => setSelectedPlanCode(plan.planCode)}
          >
            <Text style={styles.planTitle}>{t(plan.titleKey)}</Text>
            <Text style={styles.planSeats}>
              {t("business.planSelection.planSeats", { count: String(plan.seatsIncluded) })}
            </Text>
            <Text style={styles.planPrice}>{price}</Text>
          </TouchableOpacity>
        );
      })}

      <View style={[styles.planCard, styles.enterpriseCard]}>
        <Text style={styles.planTitle}>{t("business.planSelection.enterpriseTitle")}</Text>
        <Text style={styles.planSeats}>{t("business.planSelection.enterpriseSeats")}</Text>
        <Text style={styles.planPrice}>{t("business.planSelection.enterprisePrice")}</Text>
        <Text style={styles.enterpriseHint}>{t("business.planSelection.enterpriseDisabled")}</Text>
      </View>

      <TouchableOpacity style={styles.continueButton} activeOpacity={0.9} onPress={onContinue}>
        <Text style={styles.continueButtonText}>{t("business.planSelection.continueCta")}</Text>
      </TouchableOpacity>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.onboardingHelperOnDark,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  billingToggle: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  billingToggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    paddingVertical: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.formPanel,
  },
  billingToggleButtonActive: {
    borderColor: colors.primary,
    backgroundColor: "#f7e7df",
  },
  billingToggleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  billingToggleTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  planCard: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: "#f7e7df",
  },
  planTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  planSeats: {
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  planPrice: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  enterpriseCard: {
    opacity: 0.7,
  },
  enterpriseHint: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 12,
  },
  continueButton: {
    marginTop: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  continueButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});

