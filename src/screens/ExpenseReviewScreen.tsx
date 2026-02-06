import React, { useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../i18n/I18nContext";
import * as expensesService from "../services/expenses";
import type { OcrParsed, OcrStatus } from "../services/invoiceOCR";
import { colors, radius, spacing } from "../theme";

type RouteParams = {
  projectId: string;
  expenseId: string;
  status: OcrStatus | "cancelled";
  parsed: OcrParsed | null;
  defaultTitle: string;
  defaultAmount: string;
  defaultDate: string;
  defaultSupplierName?: string;
  attachmentId?: string;
  storagePath?: string;
};

function toNumber(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function ExpenseReviewScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params as RouteParams;

  const parsed = params?.parsed ?? null;
  const [title, setTitle] = useState(parsed?.supplierName || params.defaultTitle || "");
  const [amount, setAmount] = useState(
    parsed?.totalAmount != null ? String(parsed.totalAmount) : params.defaultAmount || ""
  );
  const [date, setDate] = useState(parsed?.issueDate || params.defaultDate || "");
  const [supplierName, setSupplierName] = useState(parsed?.supplierName || params.defaultSupplierName || "");
  const [invoiceNumber, setInvoiceNumber] = useState(parsed?.invoiceNumber || "");
  const [vatAmount, setVatAmount] = useState(parsed?.vatAmount != null ? String(parsed.vatAmount) : "");
  const [saving, setSaving] = useState(false);

  const statusMessage = useMemo(() => {
    if (params.status === "limit") return "Denný limit OCR bol dosiahnutý. Vyplňte údaje manuálne.";
    if (params.status === "failed") return "OCR zlyhalo. Vyplňte údaje manuálne.";
    if (params.status === "cancelled") return "OCR bolo zrušené. Vyplňte údaje manuálne.";
    return null;
  }, [params.status]);

  const handleSave = async () => {
    if (!title.trim() || !amount.trim()) {
      Alert.alert(t("common.error"), t("projectOverview.enterValidAmount"));
      return;
    }
    const amountNum = toNumber(amount);
    if (amountNum === null || amountNum <= 0) {
      Alert.alert(t("common.error"), t("projectOverview.enterValidAmount"));
      return;
    }
    const expenseDate = new Date(date);
    if (Number.isNaN(expenseDate.getTime())) {
      Alert.alert(t("common.error"), t("projectOverview.expenseDatePlaceholder"));
      return;
    }

    setSaving(true);
    try {
      await expensesService.updateExpense(params.projectId, params.expenseId, {
        title: title.trim(),
        amount: amountNum,
        date: expenseDate,
        supplierName: supplierName.trim() || undefined,
        ocrStatus: params.status,
        ocrParsedAt: new Date(),
        ocrSupplierName: supplierName.trim() || null,
        ocrInvoiceNumber: invoiceNumber.trim() || null,
        ocrIssueDate: date,
        ocrTotalAmount: amountNum,
        ocrVatAmount: toNumber(vatAmount),
        ocrCurrency: "EUR",
      });
      Alert.alert(t("common.success"), t("projectOverview.expenseUpdated"));
      (navigation as { goBack: () => void }).goBack();
    } catch (error) {
      console.error("[ExpenseReview] Failed to save OCR review:", error);
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Kontrola údajov z faktúry</Text>
      {statusMessage ? <Text style={styles.statusMessage}>{statusMessage}</Text> : null}

      <Text style={styles.label}>Názov výdavku</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />

      <Text style={styles.label}>{t("expense.amount") || "Suma (EUR) *"}</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>{t("projectOverview.expenseDatePlaceholder") || "Dátum (YYYY-MM-DD)"}</Text>
      <TextInput style={styles.input} value={date} onChangeText={setDate} placeholderTextColor={colors.textMuted} />

      <Text style={styles.label}>{t("expense.supplierName") || "Meno dodávateľa"}</Text>
      <TextInput
        style={styles.input}
        value={supplierName}
        onChangeText={setSupplierName}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Číslo faktúry</Text>
      <TextInput
        style={styles.input}
        value={invoiceNumber}
        onChangeText={setInvoiceNumber}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>DPH (voliteľné)</Text>
      <TextInput
        style={styles.input}
        value={vatAmount}
        onChangeText={setVatAmount}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.textMuted}
      />

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancel} onPress={() => (navigation as { goBack: () => void }).goBack()}>
          <Text style={styles.cancelText}>{t("tasks.cancel")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.save, saving && styles.saveDisabled]} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveText}>{saving ? t("common.saving") : t("common.save")}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  statusMessage: { color: colors.textMuted, marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  cancelText: { color: colors.textMuted, fontSize: 14 },
  save: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: "#fff", fontWeight: "600" },
});
