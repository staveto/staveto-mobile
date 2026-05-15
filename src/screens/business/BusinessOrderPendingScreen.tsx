import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";

type PendingRouteParams = {
  companyName?: string;
  orderNumber?: string;
  requestedSeats?: number;
  status?: string;
  countryCode?: string;
  variableSymbol?: string;
  paymentReference?: string;
  billingEmail?: string;
  planCode?: string;
  billingPeriod?: string;
  trialEndsAt?: unknown;
  priceSnapshot?: {
    planCode?: string;
    planName?: string;
    billingPeriod?: string;
    seatsIncluded?: number;
    totalGross?: number;
    currency?: string;
  };
  paymentInstructions?: {
    method?: string;
    beneficiaryName?: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    currency?: string;
    amountGross?: number;
    variableSymbol?: string;
    paymentReference?: string;
    dueDays?: number;
  };
};

export function BusinessOrderPendingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const params = ((route as { params?: PendingRouteParams }).params ?? {}) as PendingRouteParams;
  const amount =
    params.priceSnapshot?.totalGross ??
    params.paymentInstructions?.amountGross ??
    null;

  const onPayOnlinePress = () => {
    Alert.alert(
      t("business.dashboard.payOnlineTitle"),
      t("business.dashboard.payOnlineTodoBody")
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.pending.title")}</Text>
      <Text style={styles.subtitle}>{t("business.pending.subtitle")}</Text>

      <View style={styles.card}>
        <Row label={t("business.pending.company")} value={params.companyName || "—"} />
        <Row label={t("business.pending.orderNumber")} value={params.orderNumber || "—"} />
        <Row label={t("business.pending.status")} value={params.status || "pending_payment"} />
        <Row label={t("business.pending.seats")} value={String(params.requestedSeats ?? "—")} />
        <Row
          label={t("business.pending.amount")}
          value={
            amount !== null
              ? `${amount} ${params.priceSnapshot?.currency || params.paymentInstructions?.currency || "EUR"}`
              : "—"
          }
        />
        <Row
          label={t("business.pending.billingPeriod")}
          value={params.billingPeriod || params.priceSnapshot?.billingPeriod || "—"}
        />
        <Row
          label={t("business.pending.variableSymbol")}
          value={params.paymentInstructions?.variableSymbol || params.variableSymbol || "—"}
        />
        <Row
          label={t("business.pending.paymentReference")}
          value={params.paymentInstructions?.paymentReference || params.paymentReference || "—"}
        />
        <Row label={t("business.pending.billingEmail")} value={params.billingEmail || "—"} />
        <Row label={t("business.pending.beneficiary")} value={params.paymentInstructions?.beneficiaryName || "—"} />
        <Row label={t("business.pending.iban")} value={params.paymentInstructions?.iban || "—"} />
        <Row label={t("business.pending.bic")} value={params.paymentInstructions?.bic || "—"} />
        <Row label={t("business.pending.bankName")} value={params.paymentInstructions?.bankName || "—"} />
      </View>

      <Text style={styles.infoText}>{t("business.pending.infoText")}</Text>

      <TouchableOpacity style={styles.primaryButton} onPress={onPayOnlinePress}>
        <Text style={styles.primaryButtonText}>{t("business.dashboard.payOnlineCta")}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => (navigation as { navigate: (name: string) => void }).navigate("BusinessDashboard")}
      >
        <Text style={styles.secondaryButtonText}>{t("business.pending.backToBusinessCta")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.card,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  row: {
    marginBottom: spacing.sm,
  },
  rowLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  infoText: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
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
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
});

