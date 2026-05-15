import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { updateBusinessOrderPlan } from "../../services/businessPayments";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { colors, radius, spacing } from "../../theme";

type PlanCode = "business_starter" | "business_team" | "business_company";
type BillingPeriod = "monthly" | "yearly";

type SelectionMode = "registration" | "changePlan";
type RouteParams = {
  mode?: SelectionMode;
  orgId?: string;
  orderId?: string;
  currentPlanCode?: PlanCode;
  currentBillingPeriod?: BillingPeriod;
};

const PLANS: Array<{
  planCode: PlanCode;
  titleKey: string;
  seatsIncluded: number;
  monthlyPrice: number;
  yearlyPrice: number;
}> = [
  {
    planCode: "business_starter",
    titleKey: "business.planSelection.starterTitle",
    seatsIncluded: 5,
    monthlyPrice: 149,
    yearlyPrice: 1490,
  },
  {
    planCode: "business_team",
    titleKey: "business.planSelection.teamTitle",
    seatsIncluded: 15,
    monthlyPrice: 329,
    yearlyPrice: 3290,
  },
  {
    planCode: "business_company",
    titleKey: "business.planSelection.companyTitle",
    seatsIncluded: 30,
    monthlyPrice: 649,
    yearlyPrice: 6490,
  },
];

function getErrorDetails(error: unknown): { code: string; message: string } {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  return { code, message };
}

export function BusinessPlanSelectionScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useI18n();
  const { refresh } = useActiveOrg();
  const params = ((route as { params?: RouteParams }).params ?? {}) as RouteParams;
  const mode: SelectionMode = params.mode === "changePlan" ? "changePlan" : "registration";
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode>(
    params.currentPlanCode ?? "business_starter"
  );
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    params.currentBillingPeriod === "yearly" ? "yearly" : "monthly"
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedPlan = useMemo(
    () => PLANS.find((row) => row.planCode === selectedPlanCode) ?? PLANS[0],
    [selectedPlanCode]
  );

  const onSubmit = async () => {
    if (mode === "registration") {
      (navigation as unknown as { navigate: (name: string, p?: object) => void }).navigate(
        "BusinessRegistration",
        {
          planCode: selectedPlanCode,
          billingPeriod,
        }
      );
      return;
    }

    const orgId = params.orgId?.trim();
    const orderId = params.orderId?.trim();
    if (!orgId || !orderId) {
      Alert.alert(
        t("business.dashboard.paymentStartFailedTitle"),
        t("business.dashboard.selectPlanFirstBody")
      );
      return;
    }

    setSubmitting(true);
    try {
      await updateBusinessOrderPlan({
        orgId,
        orderId,
        planCode: selectedPlanCode,
        billingPeriod,
      });
      await refresh();
      Alert.alert(t("business.dashboard.planUpdatedTitle"), t("business.dashboard.planUpdatedBody"));
      (navigation as unknown as { navigate: (name: string) => void }).navigate("BusinessDashboard");
    } catch (error) {
      const details = getErrorDetails(error);
      Alert.alert(
        t("business.dashboard.paymentStartFailedTitle"),
        `${details.code}\n${details.message}`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {mode === "changePlan"
          ? t("business.planSelection.changePlanTitle")
          : t("business.planSelection.title")}
      </Text>
      <Text style={styles.subtitle}>
        {mode === "changePlan"
          ? t("business.planSelection.changePlanSubtitle")
          : t("business.planSelection.subtitle")}
      </Text>

      <View style={styles.periodSwitch}>
        <TouchableOpacity
          style={[styles.periodButton, billingPeriod === "monthly" && styles.periodButtonActive]}
          onPress={() => setBillingPeriod("monthly")}
        >
          <Text
            style={[styles.periodButtonText, billingPeriod === "monthly" && styles.periodButtonTextActive]}
          >
            {t("business.planSelection.billingMonthly")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.periodButton, billingPeriod === "yearly" && styles.periodButtonActive]}
          onPress={() => setBillingPeriod("yearly")}
        >
          <Text
            style={[styles.periodButtonText, billingPeriod === "yearly" && styles.periodButtonTextActive]}
          >
            {t("business.planSelection.billingYearly")}
          </Text>
        </TouchableOpacity>
      </View>

      {PLANS.map((plan) => {
        const selected = plan.planCode === selectedPlanCode;
        const price = billingPeriod === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
        return (
          <TouchableOpacity
            key={plan.planCode}
            style={[styles.planCard, selected && styles.planCardSelected]}
            onPress={() => setSelectedPlanCode(plan.planCode)}
          >
            <Text style={styles.planTitle}>{t(plan.titleKey)}</Text>
            <Text style={styles.planMeta}>
              {t("business.planSelection.planSeats", { count: String(plan.seatsIncluded) })}
            </Text>
            <Text style={styles.planPrice}>
              {billingPeriod === "yearly"
                ? t("business.planSelection.yearlyPrice", { price: String(price) })
                : t("business.planSelection.monthlyPrice", { price: String(price) })}
            </Text>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={styles.submitButton} disabled={submitting} onPress={onSubmit}>
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>
            {mode === "changePlan"
              ? t("business.planSelection.savePlanCta")
              : t("business.planSelection.continueCta")}
          </Text>
        )}
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
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  subtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    color: colors.onboardingHelperOnDark,
    lineHeight: 20,
    fontSize: 14,
  },
  periodSwitch: {
    flexDirection: "row",
    marginBottom: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    overflow: "hidden",
  },
  periodButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.formPanel,
  },
  periodButtonActive: {
    backgroundColor: colors.primary,
  },
  periodButtonText: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 14,
  },
  periodButtonTextActive: {
    color: "#fff",
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
  },
  planTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  planMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
  },
  planPrice: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 15,
  },
  submitButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});

