import React, { useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useI18n } from "../i18n/I18nContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as expensesService from "../services/expenses";
import { parseMoneyToNumber } from "../helpers/parseMoney";
import type { OcrParsed, OcrStatus } from "../services/invoiceOCR";
import { colors, radius, spacing } from "../theme";
import { isPlainObject } from "../utils/isPlainObject";

type RouteParams = {
  projectId: string;
  expenseId: string;
  status: OcrStatus | "cancelled";
  parsed: OcrParsed | null;
  defaultTitle: string;
  defaultAmount: string;
  defaultDate: string;
  defaultSupplierName?: string;
  defaultCurrency?: string;
  attachmentId?: string;
  storagePath?: string;
  expenseExtraction?: Record<string, unknown>;
  /** Server-truncated OCR plain text for audit (Firebase expense doc). */
  ocrRawTextTruncated?: string;
};

function parseReviewFieldIds(expenseExtraction?: Record<string, unknown>): string[] {
  const raw = expenseExtraction?.reviewFieldIds;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function buildOcrAuditSnapshot(params: RouteParams, parsed: OcrParsed | null): Record<string, unknown> | null {
  const ee = params.expenseExtraction;
  const audit: Record<string, unknown> =
    ee && isPlainObject(ee)
      ? {
          enrichmentVersion: ee.enrichmentVersion,
          legacyParserVersion: ee.legacyParserVersion,
          inferredCountry: ee.inferredCountry,
          countryConfidence: ee.countryConfidence,
          countrySignals: ee.countrySignals,
          candidateTotals: ee.candidateTotals,
          validationFlags: ee.validationFlags,
          lowConfidenceReasons: ee.lowConfidenceReasons,
          geminiUsed: ee.geminiUsed,
          geminiSkippedReason: ee.geminiSkippedReason,
          fieldConfidence: ee.fieldConfidence,
          evidenceHints: ee.evidenceHints,
          documentTypeGuess: ee.documentTypeGuess,
          reviewFieldIds: ee.reviewFieldIds,
          normalized: ee.normalized,
        }
      : {};
  audit.parsedFieldsSnapshot = parsed;
  if (params.ocrRawTextTruncated != null && params.ocrRawTextTruncated.length > 0) {
    audit.rawOcrTextTruncated = params.ocrRawTextTruncated;
    audit.rawOcrTextTruncatedLen = params.ocrRawTextTruncated.length;
  }
  const keys = Object.keys(audit).filter((k) => audit[k] !== undefined);
  return keys.length ? audit : null;
}

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
  const projectId = params?.projectId ?? "";
  const access = useProjectAccess(projectId);

  if (projectId && !access.loading && !access.canReadExpenses) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.noAccessTitle}>{t("common.noAccess") || "Nemáš prístup"}</Text>
        <Text style={styles.noAccessText}>
          {t("projectOverview.noPermission") || "Nemáš oprávnenie zobraziť túto časť projektu."}
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => (navigation as { goBack: () => void }).goBack()}>
          <Text style={styles.backButtonText}>{t("common.back") || "Späť"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const parsed = params?.parsed ?? null;
  const reviewFieldIds = useMemo(() => parseReviewFieldIds(params.expenseExtraction), [params.expenseExtraction]);

  const inputNeedsReview = (fieldId: string) => reviewFieldIds.includes(fieldId);

  const ocr = parsed as Record<string, unknown> | null;
  const amountCandidate = ocr?.totalAmount ?? ocr?.total ?? ocr?.grandTotal ?? ocr?.amount ?? ocr?.sum ?? ocr?.amountCents;
  const isCents = amountCandidate === ocr?.amountCents;
  let parsedAmount: number | null =
    typeof amountCandidate === "number" && Number.isFinite(amountCandidate)
      ? isCents ? (amountCandidate as number) / 100 : (amountCandidate as number)
      : parseMoneyToNumber(amountCandidate);
  if (parsedAmount == null && typeof ocr?.amountCents === "number" && ocr.amountCents > 0) {
    parsedAmount = (ocr.amountCents as number) / 100;
  }
  const validAmount = parsedAmount != null && parsedAmount > 0 && parsedAmount <= 999_999.99;
  /** OCR must not pre-fill title; only optional prior form value from navigation. */
  const [title, setTitle] = useState(params.defaultTitle?.trim() || "");
  const [amount, setAmount] = useState(validAmount ? String(parsedAmount) : params.defaultAmount || "");
  const [date, setDate] = useState(parsed?.issueDate || params.defaultDate || "");
  const [supplierName, setSupplierName] = useState(parsed?.supplierName || params.defaultSupplierName || "");
  const [invoiceNumber, setInvoiceNumber] = useState(parsed?.invoiceNumber || "");
  const [vatAmount, setVatAmount] = useState(parsed?.vatAmount != null ? String(parsed.vatAmount) : "");
  const [saving, setSaving] = useState(false);

  const statusMessage = useMemo(() => {
    if (params.status === "limit") return t("expense.ocrLimit");
    if (params.status === "failed") return t("expense.ocrFailed");
    if (params.status === "cancelled") return t("expense.ocrCancelled");
    return null;
  }, [params.status, t]);

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
      const resolvedCurrency = params.parsed?.currency ?? params.defaultCurrency ?? "EUR";
      const effectiveCurrency = resolvedCurrency === "UNKNOWN" ? "EUR" : resolvedCurrency;
      const ocrAuditSnapshot = buildOcrAuditSnapshot(params, parsed);
      await expensesService.updateExpense(params.projectId, params.expenseId, {
        title: title.trim(),
        amount: amountNum,
        currency: effectiveCurrency,
        date: expenseDate,
        supplierName: supplierName.trim() || undefined,
        ocrStatus: params.status,
        ocrParsedAt: new Date(),
        ocrSupplierName: supplierName.trim() || null,
        ocrInvoiceNumber: invoiceNumber.trim() || null,
        ocrIssueDate: date,
        ocrTotalAmount: amountNum,
        ocrVatAmount: toNumber(vatAmount),
        ocrCurrency: effectiveCurrency,
        ...(ocrAuditSnapshot ? { ocrAuditSnapshot } : {}),
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

  const debugMatched = parsed?.matchedLine;
  const debugConfidence = parsed?.confidence?.total ?? parsed?.confidence?.overall;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("expense.invoiceReviewTitle")}</Text>
      {reviewFieldIds.length > 0 ? (
        <Text style={styles.reviewBanner}>{t("expense.reviewLowConfidenceBanner")}</Text>
      ) : null}
      {inputNeedsReview("country") ? (
        <Text style={styles.countryHint}>{t("expense.reviewCountryHint")}</Text>
      ) : null}
      {inputNeedsReview("supplierTaxId") ? (
        <Text style={styles.countryHint}>{t("expense.reviewSupplierTaxHint")}</Text>
      ) : null}
      {statusMessage ? <Text style={styles.statusMessage}>{statusMessage}</Text> : null}
      {debugMatched != null && (
        <Text style={styles.debugMatched} numberOfLines={2}>
          {debugConfidence != null ? `Confidence: ${(debugConfidence * 100).toFixed(0)}% · ` : ""}
          Matched: {debugMatched}
        </Text>
      )}

      <Text style={styles.label}>Názov výdavku</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />

      <Text style={styles.label}>{t("expense.amount") || "Suma (EUR) *"}</Text>
      <TextInput
        style={[styles.input, inputNeedsReview("totalAmount") && styles.inputNeedsReview]}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>{t("projectOverview.expenseDatePlaceholder") || "Dátum (YYYY-MM-DD)"}</Text>
      <TextInput
        style={[styles.input, inputNeedsReview("issueDate") && styles.inputNeedsReview]}
        value={date}
        onChangeText={setDate}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>{t("expense.supplierName") || "Meno dodávateľa"}</Text>
      <TextInput
        style={[styles.input, inputNeedsReview("supplierName") && styles.inputNeedsReview]}
        value={supplierName}
        onChangeText={setSupplierName}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>{t("expense.invoiceNumberShort")}</Text>
      <TextInput
        style={[styles.input, inputNeedsReview("invoiceNumber") && styles.inputNeedsReview]}
        value={invoiceNumber}
        onChangeText={setInvoiceNumber}
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>{t("expense.vatOptionalShort")}</Text>
      <TextInput
        style={[styles.input, inputNeedsReview("vatAmount") && styles.inputNeedsReview]}
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
  reviewBanner: {
    fontSize: 13,
    color: colors.labelOnDark,
    backgroundColor: "rgba(224,103,55,0.15)",
    padding: spacing.sm,
    borderRadius: radius / 2,
    marginBottom: spacing.md,
  },
  countryHint: {
    fontSize: 13,
    color: colors.labelMutedOnDark,
    marginBottom: spacing.sm,
  },
  inputNeedsReview: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  centered: { justifyContent: "center", alignItems: "center", padding: spacing.xl },
  noAccessTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  noAccessText: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginBottom: spacing.lg },
  backButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
  },
  backButtonText: { color: "#fff", fontWeight: "600" },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  statusMessage: { color: colors.textMuted, marginBottom: spacing.md },
  debugMatched: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm, fontStyle: "italic" },
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
