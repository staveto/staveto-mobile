import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { getBusinessOrder, type BusinessOrderDoc } from "../../services/organizations";
import { useI18n } from "../../i18n/I18nContext";
import { colors } from "../../theme";

type StatusTone = "default" | "warning" | "danger" | "success";

function toMillis(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const timestamp = raw as { toDate?: () => Date };
    if (typeof timestamp.toDate === "function") {
      const parsed = timestamp.toDate().getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function getDaysUntil(date: unknown): number | null {
  const targetMs = toMillis(date);
  if (targetMs === null) return null;
  return Math.ceil((targetMs - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDate(date: unknown): string {
  const ts = toMillis(date);
  if (ts === null) return "—";
  return new Date(ts).toLocaleDateString();
}

function getCountdownVariant(daysLeft: number | null): "normal" | "warning" | "expired" {
  if (daysLeft === null) return "normal";
  if (daysLeft <= 0) return "expired";
  if (daysLeft <= 3) return "warning";
  return "normal";
}

function getStatusMeta(status: string | null | undefined): { labelKey: string; tone: StatusTone } {
  switch (status) {
    case "trialing":
      return { labelKey: "business.dashboard.statusTrial", tone: "default" };
    case "active":
      return { labelKey: "business.dashboard.statusActive", tone: "success" };
    case "pending_payment":
      return { labelKey: "business.dashboard.statusPaymentDue", tone: "warning" };
    case "suspended":
      return { labelKey: "business.dashboard.statusSuspended", tone: "danger" };
    default:
      return { labelKey: "business.dashboard.statusPending", tone: "default" };
  }
}

function getPlanLabel(planCode: string | undefined, t: (key: string, params?: Record<string, string>) => string): string {
  if (planCode === "business_starter") return t("business.planSelection.starterTitle");
  if (planCode === "business_team") return t("business.planSelection.teamTitle");
  if (planCode === "business_company") return t("business.planSelection.companyTitle");
  return t("business.dashboard.planUnknown");
}

export function BusinessDashboardScreen() {
  const { activeOrganization } = useActiveOrg();
  const { t } = useI18n();
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const [activeOrder, setActiveOrder] = useState<BusinessOrderDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    const orderId = activeOrganization?.activeBusinessOrderId;
    if (!orderId) {
      setActiveOrder(null);
      return;
    }
    getBusinessOrder(orderId)
      .then((order) => {
        if (!cancelled) setActiveOrder(order);
      })
      .catch(() => {
        if (!cancelled) setActiveOrder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganization?.activeBusinessOrderId]);

  const statusMeta = useMemo(() => getStatusMeta(activeOrganization?.status), [activeOrganization?.status]);
  const planCode = activeOrganization?.planCode ?? activeOrder?.planCode ?? activeOrder?.priceSnapshot?.planCode;
  const planName = getPlanLabel(planCode, t);
  const seatsLimit = activeOrganization?.seatsLimit ?? activeOrder?.requestedSeats ?? activeOrder?.priceSnapshot?.seatsIncluded ?? 0;
  const seatsUsed = activeOrganization?.seatsUsed ?? 0;
  const billingPeriod = activeOrganization?.billingPeriod ?? activeOrder?.billingPeriod ?? activeOrder?.priceSnapshot?.billingPeriod ?? "monthly";
  const amount =
    activeOrder?.priceSnapshot?.totalGross ??
    activeOrder?.paymentInstructions?.amountGross ??
    null;
  const trialEndsAt = activeOrganization?.trialEndsAt ?? null;
  const daysLeft = getDaysUntil(trialEndsAt);
  const countdownVariant = getCountdownVariant(daysLeft);
  const countdownText =
    countdownVariant === "expired"
      ? t("business.dashboard.trialExpired")
      : t("business.dashboard.trialEndsInDays", { days: String(daysLeft ?? 0) });
  const statusLabel = t(statusMeta.labelKey);

  const onPayOnlinePress = () => {
    if (activeOrganization?.status === "active") {
      Alert.alert(t("business.dashboard.manageSubscriptionTitle"), t("business.dashboard.manageSubscriptionTodoBody"));
      return;
    }
    Alert.alert(t("business.dashboard.payOnlineTitle"), t("business.dashboard.payOnlineTodoBody"));
  };

  const onBankTransferPress = () => {
    nav.navigate("BusinessOrderPending", {
      companyName: activeOrganization?.name ?? "",
      orderNumber: activeOrder?.orderNumber,
      requestedSeats: seatsLimit,
      status: activeOrder?.status ?? activeOrganization?.status ?? "pending_payment",
      variableSymbol: activeOrder?.variableSymbol,
      paymentReference: activeOrder?.paymentReference,
      billingEmail: activeOrganization?.billingEmail ?? "",
      paymentInstructions: activeOrder?.paymentInstructions,
      priceSnapshot: activeOrder?.priceSnapshot,
      planCode,
      billingPeriod,
      trialEndsAt,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.dashboard.title")}</Text>
      <Text style={styles.subtitle}>{t("business.dashboard.subtitle")}</Text>

      <View style={styles.bannerCard}>
        <Text style={styles.bannerTitle}>{t("business.dashboard.trialCardTitle")}</Text>
        <Text style={styles.bannerSubtitle}>{t("business.dashboard.trialCardSubtitle")}</Text>
        <View style={styles.bannerTopRow}>
          <Text style={styles.orgName}>{activeOrganization?.name || t("business.dashboard.companyFallback")}</Text>
          <View
            style={[
              styles.statusBadge,
              statusMeta.tone === "warning" && styles.statusBadgeWarning,
              statusMeta.tone === "danger" && styles.statusBadgeDanger,
              statusMeta.tone === "success" && styles.statusBadgeSuccess,
            ]}
          >
            <Text style={styles.statusBadgeText}>{t(statusMeta.labelKey)}</Text>
          </View>
        </View>

        <Text style={styles.bannerLine}>{t("business.dashboard.planLabel", { plan: planName })}</Text>
        <Text style={styles.bannerLine}>{t("business.dashboard.statusLabel", { status: statusLabel })}</Text>
        <Text style={styles.bannerLine}>
          {t("business.dashboard.seatsLabel", { used: String(seatsUsed), limit: String(seatsLimit) })}
        </Text>
        <Text style={styles.bannerLine}>
          {t(
            billingPeriod === "yearly"
              ? "business.dashboard.billingYearly"
              : "business.dashboard.billingMonthly"
          )}
        </Text>
        <Text style={styles.bannerLine}>
          {t("business.dashboard.amountLabel", {
            amount: amount !== null ? String(amount) : t("business.dashboard.amountUnknown"),
          })}
        </Text>
        <Text style={styles.bannerLine}>
          {t("business.dashboard.trialEndsAtLabel", { date: formatDate(trialEndsAt) })}
        </Text>
        <Text
          style={[
            styles.countdownText,
            countdownVariant === "warning" && styles.countdownWarning,
            countdownVariant === "expired" && styles.countdownExpired,
          ]}
        >
          {countdownText}
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={onPayOnlinePress} activeOpacity={0.9}>
          <Text style={styles.primaryButtonText}>
            {activeOrganization?.status === "active"
              ? t("business.dashboard.manageSubscriptionCta")
              : t("business.dashboard.payOnlineCta")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onBankTransferPress} activeOpacity={0.9}>
          <Text style={styles.secondaryButtonText}>{t("business.dashboard.bankTransferCta")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.text}>{t("business.dashboard.placeholderBody")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.onboardingHelperOnDark,
    marginBottom: 14,
  },
  bannerCard: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    backgroundColor: "#f7e7df",
  },
  bannerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 10,
  },
  orgName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#d9e7fa",
  },
  statusBadgeWarning: {
    backgroundColor: "#ffe6b3",
  },
  statusBadgeDanger: {
    backgroundColor: "#ffd4d4",
  },
  statusBadgeSuccess: {
    backgroundColor: "#d6f5e3",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
  },
  bannerLine: {
    fontSize: 14,
    color: colors.text,
    marginBottom: 6,
  },
  countdownText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 12,
  },
  countdownWarning: {
    color: "#a16207",
    fontWeight: "700",
  },
  countdownExpired: {
    color: "#b91c1c",
    fontWeight: "700",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    marginBottom: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    backgroundColor: "#fff",
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  text: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});

