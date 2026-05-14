import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
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
};

export function BusinessOrderPendingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const params = ((route as { params?: PendingRouteParams }).params ?? {}) as PendingRouteParams;

  const paymentLines = [
    `Firma: ${params.companyName || "—"}`,
    `Objednávka: ${params.orderNumber || "—"}`,
    `Počet licencií: ${params.requestedSeats ?? "—"}`,
    `Status: ${params.status || "pending_payment"}`,
    `Variabilný symbol: ${params.variableSymbol || "—"}`,
    `Payment reference: ${params.paymentReference || "—"}`,
    `Billing email: ${params.billingEmail || "—"}`,
  ];

  const copyPaymentInfo = async () => {
    try {
      await Clipboard.setStringAsync(paymentLines.join("\n"));
      Alert.alert("Skopírované", "Platobné údaje boli skopírované.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("Chyba", message || "Nepodarilo sa skopírovať údaje.");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Objednávka prijatá</Text>
      <Text style={styles.subtitle}>Staveto Business čaká na úhradu</Text>

      <View style={styles.card}>
        <Row label="Firma" value={params.companyName || "—"} />
        <Row label="Objednávka" value={params.orderNumber || "—"} />
        <Row label="Počet licencií" value={String(params.requestedSeats ?? "—")} />
        <Row label="Status" value={params.status || "pending_payment"} />
        {(params.countryCode === "SK" || params.countryCode === "CZ") && params.variableSymbol ? (
          <Row label="Variabilný symbol" value={params.variableSymbol} />
        ) : null}
        <Row label="Payment reference" value={params.paymentReference || "—"} />
        <Row label="Billing email" value={params.billingEmail || "—"} />
      </View>

      <Text style={styles.infoText}>
        Po prijatí platby vám aktivujeme Staveto Business.
      </Text>

      <TouchableOpacity style={styles.primaryButton} onPress={copyPaymentInfo}>
        <Text style={styles.primaryButtonText}>Kopírovať platobné údaje</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
        <Text style={styles.secondaryButtonText}>Späť do Staveta</Text>
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

