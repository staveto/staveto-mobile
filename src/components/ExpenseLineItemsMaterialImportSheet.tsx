import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { ParsedDocumentLineItem } from "../lib/parsedDocumentTypes";
import type { MaterialConfidence, MaterialUnit } from "../lib/types";
import {
  createMaterialSuggestion,
  createProjectMaterial,
  findExistingMaterialNamesForAttachment,
} from "../services/projectMaterials";

export type ExpenseMaterialImportContext = {
  projectId: string;
  expenseId: string;
  attachmentId: string;
  currency: string;
  supplierName?: string;
  expenseTitle?: string;
  expenseDate?: string;
  items: ParsedDocumentLineItem[];
};

type ImportMode = "recommended" | "used";

type EditableRow = {
  key: string;
  selected: boolean;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
  confidence?: number;
  editing: boolean;
};

type Props = {
  visible: boolean;
  context: ExpenseMaterialImportContext | null;
  onDismiss: () => void;
  onImported?: (count: number) => void;
};

const IMPORT_NOTE_PREFIX = "expense_attachment:";

function normalizeMaterialUnit(unit?: string): MaterialUnit {
  if (!unit?.trim()) return "pcs";
  const u = unit.trim().toLowerCase().replace("m²", "m2").replace("m³", "m3");
  if (u === "m2") return "m2";
  if (u === "m") return "m";
  if (u === "kg") return "kg";
  if (u === "l" || u === "lt") return "l";
  if (u === "pack" || u === "bal") return "pack";
  if (u === "hod" || u === "h" || u === "hour") return "hour";
  if (u === "ks" || u === "pc" || u === "pcs" || u === "st" || u === "stk") return "pcs";
  return "other";
}

function toMaterialConfidence(score?: number): MaterialConfidence | undefined {
  if (score == null || !Number.isFinite(score)) return undefined;
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function parseDecimal(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (!t) return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function rowFromItem(item: ParsedDocumentLineItem, index: number, defaultSelected: boolean): EditableRow {
  return {
    key: `${index}-${(item.description ?? "item").slice(0, 24)}`,
    selected: defaultSelected,
    description: item.description?.trim() ?? "",
    quantity: item.quantity != null ? String(item.quantity) : "",
    unit: item.unit?.trim() ?? "",
    unitPrice: item.unitPrice != null ? String(item.unitPrice) : "",
    total: item.total != null ? String(item.total) : "",
    confidence: item.confidence,
    editing: false,
  };
}

export function ExpenseLineItemsMaterialImportSheet({
  visible,
  context,
  onDismiss,
  onImported,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ImportMode>("recommended");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const existingNamesRef = React.useRef<{ suggestionNames: Set<string>; materialNames: Set<string> }>({
    suggestionNames: new Set(),
    materialNames: new Set(),
  });

  const confidenceLabel = useCallback(
    (score?: number) => {
      const c = toMaterialConfidence(score);
      if (c === "high") return t("projectMaterials.confidence.high");
      if (c === "medium") return t("projectMaterials.confidence.medium");
      if (c === "low") return t("projectMaterials.confidence.low");
      return t("expenseMaterialImport.confidenceUnknown");
    },
    [t]
  );

  useEffect(() => {
    if (!visible || !context) return;
    setMode("recommended");
    const initial = context.items.map((item, i) =>
      rowFromItem(item, i, (item.confidence ?? 0) >= 0.6)
    );
    setRows(initial);
    void findExistingMaterialNamesForAttachment(context.projectId, context.attachmentId)
      .then((existing) => {
        existingNamesRef.current = {
          suggestionNames: existing.suggestionNames,
          materialNames: existing.materialNames,
        };
        setAlreadyImported(existing.suggestionCount + existing.materialCount > 0);
      })
      .catch(() => setAlreadyImported(false));
  }, [visible, context]);

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);

  const toggleRow = (key: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  };

  const toggleEdit = (key: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, editing: !r.editing } : r)));
  };

  const updateRow = (key: string, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const buildSourceNote = (ctx: ExpenseMaterialImportContext) => {
    const parts = [t("expenseMaterialImport.importedNote")];
    if (ctx.supplierName?.trim()) parts.push(ctx.supplierName.trim());
    if (ctx.expenseTitle?.trim()) parts.push(ctx.expenseTitle.trim());
    return parts.join(" · ");
  };

  const handleImport = async () => {
    if (!context) return;
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      Alert.alert(t("common.error"), t("expenseMaterialImport.noItemsSelected"));
      return;
    }

    if (mode === "used") {
      const missingQty = selected.filter((r) => {
        const q = parseDecimal(r.quantity);
        return q == null || q <= 0;
      });
      if (missingQty.length > 0) {
        Alert.alert(t("common.error"), t("expenseMaterialImport.quantityRequired"));
        return;
      }
    }

    setSaving(true);
    let created = 0;
    const importedNames = new Set<string>();
    const existing = existingNamesRef.current;
    try {
      for (const row of selected) {
        const name = row.description.trim();
        if (!name) continue;
        const nameKey = name.toLowerCase();
        if (importedNames.has(nameKey)) continue;
        if (existing.suggestionNames.has(nameKey) || existing.materialNames.has(nameKey)) continue;
        importedNames.add(nameKey);

        const quantity = parseDecimal(row.quantity);
        const unitPrice = parseDecimal(row.unitPrice);
        const totalPrice = parseDecimal(row.total);
        const unit = normalizeMaterialUnit(row.unit);
        const confidence = toMaterialConfidence(row.confidence);
        const sourceNote = buildSourceNote(context);

        if (mode === "recommended") {
          await createMaterialSuggestion(context.projectId, {
            name,
            suggestedQuantity: quantity,
            unit,
            estimatedUnitPrice: unitPrice,
            estimatedTotalPrice: totalPrice,
            currency: context.currency || "EUR",
            source: "ai",
            confidence,
            sourceDocumentId: context.attachmentId,
            sourceNote,
          });
        } else {
          const qty = quantity ?? 0;
          await createProjectMaterial(context.projectId, {
            name,
            quantity: qty,
            unit,
            unitPrice,
            totalPrice,
            currency: context.currency || "EUR",
            supplierName: context.supplierName?.trim() || undefined,
            usedAt: context.expenseDate ? new Date(context.expenseDate) : new Date(),
            notes: `${IMPORT_NOTE_PREFIX}${context.attachmentId} · ${sourceNote}`,
          });
        }
        created += 1;
      }

      if (created === 0) {
        Alert.alert(t("common.error"), t("expenseMaterialImport.noItemsSelected"));
        return;
      }

      Alert.alert(t("common.success"), t("expenseMaterialImport.itemsImported", { count: String(created) }));
      onImported?.(created);
      onDismiss();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.unknown");
      if (/permission|oprávnen|insufficient/i.test(msg)) {
        Alert.alert(t("common.error"), t("expenseMaterialImport.couldNotAdd"));
      } else {
        Alert.alert(t("common.error"), msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!context) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("expenseMaterialImport.title")}</Text>
          <Text style={styles.subtitle}>{t("expenseMaterialImport.subtitle")}</Text>
          {alreadyImported ? (
            <Text style={styles.warning}>{t("expenseMaterialImport.alreadyImported")}</Text>
          ) : null}

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeChip, mode === "recommended" && styles.modeChipActive]}
              onPress={() => setMode("recommended")}
            >
              <Text style={[styles.modeChipText, mode === "recommended" && styles.modeChipTextActive]}>
                {t("expenseMaterialImport.modeRecommended")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeChip, mode === "used" && styles.modeChipActive]}
              onPress={() => setMode("used")}
            >
              <Text style={[styles.modeChipText, mode === "used" && styles.modeChipTextActive]}>
                {t("expenseMaterialImport.modeUsed")}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>{t("expenseMaterialImport.selectItemsHint")}</Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {rows.map((row) => (
              <View key={row.key} style={styles.rowCard}>
                <TouchableOpacity style={styles.rowHeader} onPress={() => toggleRow(row.key)} activeOpacity={0.85}>
                  <Ionicons
                    name={row.selected ? "checkbox" : "square-outline"}
                    size={22}
                    color={row.selected ? colors.primary : colors.textMuted}
                  />
                  <View style={styles.rowHeaderText}>
                    <Text style={styles.rowTitle} numberOfLines={row.editing ? undefined : 2}>
                      {row.description || "—"}
                    </Text>
                    {!row.editing ? (
                      <Text style={styles.rowMeta}>
                        {[row.quantity && `${row.quantity} ${row.unit}`.trim(), row.unitPrice && `@ ${row.unitPrice}`, row.total]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.confidenceBadge}>
                    <Text style={styles.confidenceText}>{confidenceLabel(row.confidence)}</Text>
                  </View>
                </TouchableOpacity>

                {row.editing ? (
                  <View style={styles.editBlock}>
                    <TextInput
                      style={styles.input}
                      value={row.description}
                      onChangeText={(v) => updateRow(row.key, { description: v })}
                      placeholder={t("projectMaterials.materialName")}
                      placeholderTextColor={colors.inputPlaceholderOnLight}
                    />
                    <View style={styles.editRow}>
                      <TextInput
                        style={[styles.input, styles.inputSmall]}
                        value={row.quantity}
                        onChangeText={(v) => updateRow(row.key, { quantity: v })}
                        placeholder={t("projectMaterials.quantity")}
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.inputPlaceholderOnLight}
                      />
                      <TextInput
                        style={[styles.input, styles.inputSmall]}
                        value={row.unit}
                        onChangeText={(v) => updateRow(row.key, { unit: v })}
                        placeholder={t("projectMaterials.unit")}
                        placeholderTextColor={colors.inputPlaceholderOnLight}
                      />
                    </View>
                    <View style={styles.editRow}>
                      <TextInput
                        style={[styles.input, styles.inputSmall]}
                        value={row.unitPrice}
                        onChangeText={(v) => updateRow(row.key, { unitPrice: v })}
                        placeholder={t("projectMaterials.unitPrice")}
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.inputPlaceholderOnLight}
                      />
                      <TextInput
                        style={[styles.input, styles.inputSmall]}
                        value={row.total}
                        onChangeText={(v) => updateRow(row.key, { total: v })}
                        placeholder={t("projectMaterials.totalPrice")}
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.inputPlaceholderOnLight}
                      />
                    </View>
                  </View>
                ) : null}

                <TouchableOpacity style={styles.editBtn} onPress={() => toggleEdit(row.key)}>
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                  <Text style={styles.editBtnText}>{t("projectMaterials.editMaterial")}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} disabled={saving}>
              <Text style={styles.skipText}>{t("expenseMaterialImport.skip")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.importBtn, (saving || selectedCount === 0) && styles.importBtnDisabled]}
              onPress={handleImport}
              disabled={saving || selectedCount === 0}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.importBtnText}>
                  {t("expenseMaterialImport.addSelected")} ({selectedCount})
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.formPanel,
    borderTopLeftRadius: radius + 4,
    borderTopRightRadius: radius + 4,
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.formPanelBorder,
    marginBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
  warning: { fontSize: 13, color: colors.primary, marginBottom: spacing.sm },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  modeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeChipText: { fontSize: 13, fontWeight: "600", color: colors.text, textAlign: "center" },
  modeChipTextActive: { color: "#fff" },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  list: { maxHeight: 340 },
  listContent: { paddingBottom: spacing.sm },
  rowCard: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: "#fff",
  },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  rowHeaderText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  confidenceBadge: {
    backgroundColor: "rgba(224, 103, 55, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidenceText: { fontSize: 10, fontWeight: "700", color: colors.primary },
  editBlock: { marginTop: spacing.sm },
  editRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius - 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
    marginTop: spacing.xs,
  },
  inputSmall: { flex: 1, marginTop: 0 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs, alignSelf: "flex-start" },
  editBtnText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.formPanelBorder,
  },
  skipBtn: { padding: spacing.sm },
  skipText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  importBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  importBtnDisabled: { opacity: 0.55 },
  importBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
