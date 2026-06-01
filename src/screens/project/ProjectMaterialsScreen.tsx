import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import type { MaterialUnit } from "../../lib/types";
import {
  MATERIAL_UNITS,
  calculateMaterialTotals,
  createMaterialSuggestion,
  createProjectMaterial,
  deleteProjectMaterial,
  listMaterialSuggestions,
  listProjectMaterials,
  rejectMaterialSuggestion,
  updateMaterialSuggestion,
  updateProjectMaterial,
  type MaterialSuggestionDoc,
  type ProjectMaterialDoc,
} from "../../services/projectMaterials";

type RouteParams = { projectId: string; projectName?: string };

type UsedFormState = {
  id?: string;
  name: string;
  quantity: string;
  unit: MaterialUnit;
  unitPrice: string;
  totalPrice: string;
  supplierName: string;
  notes: string;
  usedAt: Date;
  sourceSuggestionId?: string;
};

type SuggestionFormState = {
  id?: string;
  name: string;
  description: string;
  suggestedQuantity: string;
  unit: MaterialUnit;
  sourceNote: string;
};

const EMPTY_USED: UsedFormState = {
  name: "",
  quantity: "",
  unit: "pcs",
  unitPrice: "",
  totalPrice: "",
  supplierName: "",
  notes: "",
  usedAt: new Date(),
};

const EMPTY_SUGGESTION: SuggestionFormState = {
  name: "",
  description: "",
  suggestedQuantity: "",
  unit: "pcs",
  sourceNote: "",
};

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function unitLabel(t: (k: string) => string, unit: MaterialUnit): string {
  const key = `projectMaterials.unit.${unit}`;
  const v = t(key);
  return v === key ? unit : v;
}

export function ProjectMaterialsScreen() {
  const route = useRoute();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId } = route.params as RouteParams;

  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<MaterialSuggestionDoc[]>([]);
  const [materials, setMaterials] = useState<ProjectMaterialDoc[]>([]);
  const [usedModalOpen, setUsedModalOpen] = useState(false);
  const [suggestionModalOpen, setSuggestionModalOpen] = useState(false);
  const [usedForm, setUsedForm] = useState<UsedFormState>(EMPTY_USED);
  const [suggestionForm, setSuggestionForm] = useState<SuggestionFormState>(EMPTY_SUGGESTION);
  const [saving, setSaving] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const plannedSuggestions = useMemo(
    () => suggestions.filter((s) => s.status === "planned"),
    [suggestions]
  );
  const totals = useMemo(() => calculateMaterialTotals(materials), [materials]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sug, mat] = await Promise.all([
        listMaterialSuggestions(projectId),
        listProjectMaterials(projectId),
      ]);
      setSuggestions(sug);
      setMaterials(mat);
    } catch {
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const recalcTotal = (qty: string, unitPrice: string, prev: UsedFormState): UsedFormState => {
    const q = parseFloat(qty.replace(",", "."));
    const p = parseFloat(unitPrice.replace(",", "."));
    if (Number.isFinite(q) && Number.isFinite(p)) {
      return { ...prev, quantity: qty, unitPrice, totalPrice: (q * p).toFixed(2) };
    }
    return { ...prev, quantity: qty, unitPrice };
  };

  const openAddUsed = () => {
    setUsedForm({ ...EMPTY_USED, usedAt: new Date() });
    setUsedModalOpen(true);
  };

  const openEditUsed = (m: ProjectMaterialDoc) => {
    setUsedForm({
      id: m.id,
      name: m.name,
      quantity: String(m.quantity),
      unit: m.unit,
      unitPrice: m.unitPrice != null ? String(m.unitPrice) : "",
      totalPrice: m.totalPrice != null ? String(m.totalPrice) : "",
      supplierName: m.supplierName ?? "",
      notes: m.notes ?? "",
      usedAt: new Date(m.usedAt),
      sourceSuggestionId: m.sourceSuggestionId,
    });
    setUsedModalOpen(true);
  };

  const openAcceptSuggestion = (s: MaterialSuggestionDoc) => {
    setUsedForm({
      ...EMPTY_USED,
      name: s.name,
      quantity: s.suggestedQuantity != null ? String(s.suggestedQuantity) : "",
      unit: s.unit ?? "pcs",
      unitPrice: s.estimatedUnitPrice != null ? String(s.estimatedUnitPrice) : "",
      totalPrice: s.estimatedTotalPrice != null ? String(s.estimatedTotalPrice) : "",
      notes: s.description ?? s.sourceNote ?? "",
      usedAt: new Date(),
      sourceSuggestionId: s.id,
    });
    setUsedModalOpen(true);
  };

  const openAddSuggestion = () => {
    setSuggestionForm(EMPTY_SUGGESTION);
    setSuggestionModalOpen(true);
  };

  const openEditSuggestion = (s: MaterialSuggestionDoc) => {
    setSuggestionForm({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      suggestedQuantity: s.suggestedQuantity != null ? String(s.suggestedQuantity) : "",
      unit: s.unit ?? "pcs",
      sourceNote: s.sourceNote ?? "",
    });
    setSuggestionModalOpen(true);
  };

  const saveUsed = async () => {
    const name = usedForm.name.trim();
    const quantity = parseFloat(usedForm.quantity.replace(",", "."));
    if (!name) {
      Alert.alert(t("common.error"), t("projectMaterials.materialName"));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert(t("common.error"), t("projectMaterials.quantity"));
      return;
    }
    const unitPriceRaw = usedForm.unitPrice.trim();
    const unitPrice = unitPriceRaw ? parseFloat(unitPriceRaw.replace(",", ".")) : undefined;
    const totalRaw = usedForm.totalPrice.trim();
    const totalPrice = totalRaw ? parseFloat(totalRaw.replace(",", ".")) : undefined;

    setSaving(true);
    try {
      if (usedForm.id) {
        await updateProjectMaterial(projectId, usedForm.id, {
          name,
          quantity,
          unit: usedForm.unit,
          unitPrice,
          totalPrice,
          supplierName: usedForm.supplierName.trim() || undefined,
          notes: usedForm.notes.trim() || undefined,
          usedAt: usedForm.usedAt,
        });
      } else {
        await createProjectMaterial(projectId, {
          name,
          quantity,
          unit: usedForm.unit,
          unitPrice,
          totalPrice,
          supplierName: usedForm.supplierName.trim() || undefined,
          notes: usedForm.notes.trim() || undefined,
          usedAt: usedForm.usedAt,
          sourceSuggestionId: usedForm.sourceSuggestionId,
        });
      }
      setUsedModalOpen(false);
      await load();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("common.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const saveSuggestion = async () => {
    const name = suggestionForm.name.trim();
    if (!name) {
      Alert.alert(t("common.error"), t("projectMaterials.materialName"));
      return;
    }
    const qtyRaw = suggestionForm.suggestedQuantity.trim();
    const suggestedQuantity = qtyRaw ? parseFloat(qtyRaw.replace(",", ".")) : undefined;

    setSaving(true);
    try {
      if (suggestionForm.id) {
        await updateMaterialSuggestion(projectId, suggestionForm.id, {
          name,
          description: suggestionForm.description.trim() || undefined,
          suggestedQuantity: Number.isFinite(suggestedQuantity!) ? suggestedQuantity : undefined,
          unit: suggestionForm.unit,
          sourceNote: suggestionForm.sourceNote.trim() || undefined,
        });
      } else {
        await createMaterialSuggestion(projectId, {
          name,
          description: suggestionForm.description.trim() || undefined,
          suggestedQuantity: Number.isFinite(suggestedQuantity!) ? suggestedQuantity : undefined,
          unit: suggestionForm.unit,
          sourceNote: suggestionForm.sourceNote.trim() || undefined,
          source: "manual",
        });
      }
      setSuggestionModalOpen(false);
      await load();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("common.unknown"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteUsed = (m: ProjectMaterialDoc) => {
    Alert.alert(t("projectMaterials.delete"), t("projectMaterials.confirmDelete"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("projectMaterials.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteProjectMaterial(projectId, m.id);
            await load();
          } catch {
            Alert.alert(t("common.error"), t("common.unknown"));
          }
        },
      },
    ]);
  };

  const onRejectSuggestion = (s: MaterialSuggestionDoc) => {
    Alert.alert(t("projectMaterials.reject"), s.name, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("projectMaterials.reject"),
        style: "destructive",
        onPress: async () => {
          try {
            await rejectMaterialSuggestion(projectId, s.id);
            await load();
          } catch {
            Alert.alert(t("common.error"), t("common.unknown"));
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{t("projectMaterials.materialTotal")}</Text>
          <Text style={styles.totalValue}>{formatMoney(totals.totalPrice, totals.currency)}</Text>
          <Text style={styles.totalMeta}>
            {t("projectOverview.materialsSuggested")}: {plannedSuggestions.length} ·{" "}
            {t("projectOverview.materialsUsed")}: {materials.length}
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("projectMaterials.recommendedTitle")}</Text>
          {user?.id ? (
            <TouchableOpacity style={styles.addBtn} onPress={openAddSuggestion}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addBtnText}>{t("projectMaterials.addRecommended")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {plannedSuggestions.length === 0 ? (
          <Text style={styles.empty}>{t("projectMaterials.noRecommended")}</Text>
        ) : (
          plannedSuggestions.map((s) => (
            <View key={s.id} style={styles.card}>
              <Text style={styles.cardTitle}>{s.name}</Text>
              {s.suggestedQuantity != null && s.unit ? (
                <Text style={styles.cardMeta}>
                  {s.suggestedQuantity} {unitLabel(t, s.unit)}
                </Text>
              ) : null}
              {s.confidence ? (
                <Text style={styles.badge}>
                  {t("projectMaterials.confidence")}: {t(`projectMaterials.confidence.${s.confidence}`)}
                </Text>
              ) : null}
              {s.sourceNote ? <Text style={styles.cardSub}>{s.sourceNote}</Text> : null}
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => openAcceptSuggestion(s)} style={styles.actionBtn}>
                  <Text style={styles.actionAccept}>{t("projectMaterials.accept")}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openEditSuggestion(s)} style={styles.actionBtn}>
                  <Text style={styles.actionLink}>{t("projectMaterials.editMaterial")}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onRejectSuggestion(s)} style={styles.actionBtn}>
                  <Text style={styles.actionReject}>{t("projectMaterials.reject")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionTitle}>{t("projectMaterials.usedTitle")}</Text>
          {user?.id ? (
            <TouchableOpacity style={styles.addBtn} onPress={openAddUsed}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addBtnText}>{t("projectMaterials.addMaterial")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {materials.length === 0 ? (
          <Text style={styles.empty}>{t("projectMaterials.noMaterialsYet")}</Text>
        ) : (
          materials.map((m) => (
            <TouchableOpacity key={m.id} style={styles.card} onPress={() => openEditUsed(m)} activeOpacity={0.85}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{m.name}</Text>
                {m.totalPrice != null ? (
                  <Text style={styles.cardPrice}>{formatMoney(m.totalPrice, m.currency)}</Text>
                ) : null}
              </View>
              <Text style={styles.cardMeta}>
                {m.quantity} {unitLabel(t, m.unit)}
                {m.supplierName ? ` · ${m.supplierName}` : ""}
              </Text>
              <TouchableOpacity
                onPress={() => confirmDeleteUsed(m)}
                hitSlop={8}
                style={styles.deleteLink}
              >
                <Text style={styles.actionReject}>{t("projectMaterials.delete")}</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={usedModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>
                {usedForm.id ? t("projectMaterials.editMaterial") : t("projectMaterials.addMaterial")}
              </Text>
              <Text style={styles.label}>{t("projectMaterials.materialName")}</Text>
              <TextInput
                style={styles.input}
                value={usedForm.name}
                onChangeText={(v) => setUsedForm((p) => ({ ...p, name: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.quantity")}</Text>
              <TextInput
                style={styles.input}
                value={usedForm.quantity}
                keyboardType="decimal-pad"
                onChangeText={(v) => setUsedForm((p) => recalcTotal(v, p.unitPrice, p))}
              />
              <Text style={styles.label}>{t("projectMaterials.unit")}</Text>
              <View style={styles.unitRow}>
                {MATERIAL_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitChip, usedForm.unit === u && styles.unitChipActive]}
                    onPress={() => setUsedForm((p) => ({ ...p, unit: u }))}
                  >
                    <Text style={[styles.unitChipText, usedForm.unit === u && styles.unitChipTextActive]}>
                      {unitLabel(t, u)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{t("projectMaterials.unitPrice")}</Text>
              <TextInput
                style={styles.input}
                value={usedForm.unitPrice}
                keyboardType="decimal-pad"
                onChangeText={(v) => setUsedForm((p) => recalcTotal(p.quantity, v, p))}
              />
              <Text style={styles.label}>{t("projectMaterials.totalPrice")}</Text>
              <TextInput
                style={styles.input}
                value={usedForm.totalPrice}
                keyboardType="decimal-pad"
                onChangeText={(v) => setUsedForm((p) => ({ ...p, totalPrice: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.supplier")}</Text>
              <TextInput
                style={styles.input}
                value={usedForm.supplierName}
                onChangeText={(v) => setUsedForm((p) => ({ ...p, supplierName: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.dateUsed")}</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
                <Text>{usedForm.usedAt.toLocaleDateString()}</Text>
              </TouchableOpacity>
              {showDatePicker ? (
                <DateTimePicker
                  value={usedForm.usedAt}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, date) => {
                    setShowDatePicker(Platform.OS === "ios");
                    if (date) setUsedForm((p) => ({ ...p, usedAt: date }));
                  }}
                />
              ) : null}
              <Text style={styles.label}>{t("projectMaterials.notes")}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={usedForm.notes}
                multiline
                onChangeText={(v) => setUsedForm((p) => ({ ...p, notes: v }))}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setUsedModalOpen(false)}>
                  <Text style={styles.cancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveUsed} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>{t("projectMaterials.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={suggestionModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>
                {suggestionForm.id ? t("projectMaterials.editMaterial") : t("projectMaterials.addRecommended")}
              </Text>
              <Text style={styles.label}>{t("projectMaterials.materialName")}</Text>
              <TextInput
                style={styles.input}
                value={suggestionForm.name}
                onChangeText={(v) => setSuggestionForm((p) => ({ ...p, name: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.quantity")}</Text>
              <TextInput
                style={styles.input}
                value={suggestionForm.suggestedQuantity}
                keyboardType="decimal-pad"
                onChangeText={(v) => setSuggestionForm((p) => ({ ...p, suggestedQuantity: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.unit")}</Text>
              <View style={styles.unitRow}>
                {MATERIAL_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitChip, suggestionForm.unit === u && styles.unitChipActive]}
                    onPress={() => setSuggestionForm((p) => ({ ...p, unit: u }))}
                  >
                    <Text
                      style={[styles.unitChipText, suggestionForm.unit === u && styles.unitChipTextActive]}
                    >
                      {unitLabel(t, u)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{t("projectMaterials.notes")}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={suggestionForm.description}
                multiline
                onChangeText={(v) => setSuggestionForm((p) => ({ ...p, description: v }))}
              />
              <Text style={styles.label}>{t("projectMaterials.sourceDocument")}</Text>
              <TextInput
                style={styles.input}
                value={suggestionForm.sourceNote}
                onChangeText={(v) => setSuggestionForm((p) => ({ ...p, sourceNote: v }))}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSuggestionModalOpen(false)}>
                  <Text style={styles.cancelText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveSuggestion} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>{t("projectMaterials.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  totalCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  totalLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  totalValue: { fontSize: 24, fontWeight: "800", color: colors.text, marginTop: spacing.xs },
  totalMeta: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text, flex: 1 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius,
  },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 12 },
  empty: { color: colors.textMuted, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text, flex: 1 },
  cardPrice: { fontSize: 15, fontWeight: "700", color: colors.primary },
  cardMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  badge: { fontSize: 11, color: colors.primary, marginTop: 4, fontWeight: "600" },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { paddingVertical: 4 },
  actionAccept: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  actionLink: { color: colors.text, fontWeight: "600", fontSize: 13 },
  actionReject: { color: "#c0392b", fontWeight: "600", fontSize: 13 },
  deleteLink: { marginTop: spacing.sm, alignSelf: "flex-start" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalScroll: { flexGrow: 1, justifyContent: "flex-end" },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius + 4,
    borderTopRightRadius: radius + 4,
    padding: spacing.lg,
    maxHeight: "92%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  unitRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  unitChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unitChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitChipText: { fontSize: 12, color: colors.text },
  unitChipTextActive: { color: "#fff", fontWeight: "600" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { padding: spacing.sm },
  cancelText: { color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    minWidth: 100,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700" },
});
