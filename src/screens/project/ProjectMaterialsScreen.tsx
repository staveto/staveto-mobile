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
import type { Locale } from "../../i18n/translations";
import { colors, radius, spacing } from "../../theme";
import type { MaterialCategory, MaterialUnit } from "../../lib/types";
import { MATERIAL_CATEGORIES, formatMaterialTotalsDisplay, resolveMaterialCurrency } from "../../lib/materialCatalog";
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
  category: MaterialCategory;
  quantity: string;
  unit: MaterialUnit;
  unitPrice: string;
  totalPrice: string;
  currency: string;
  supplierName: string;
  notes: string;
  usedAt: Date;
  sourceSuggestionId?: string;
};

type SuggestionFormState = {
  id?: string;
  name: string;
  category: MaterialCategory;
  description: string;
  suggestedQuantity: string;
  unit: MaterialUnit;
  unitPrice: string;
  totalPrice: string;
  currency: string;
  sourceNote: string;
};

const EMPTY_USED: UsedFormState = {
  name: "",
  category: "other_material",
  quantity: "",
  unit: "pcs",
  unitPrice: "",
  totalPrice: "",
  currency: "EUR",
  supplierName: "",
  notes: "",
  usedAt: new Date(),
};

const EMPTY_SUGGESTION: SuggestionFormState = {
  name: "",
  category: "other_material",
  description: "",
  suggestedQuantity: "",
  unit: "pcs",
  unitPrice: "",
  totalPrice: "",
  currency: "EUR",
  sourceNote: "",
};

const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-GB",
  de: "de-DE",
  sk: "sk-SK",
  cs: "cs-CZ",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
};

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatMaterialDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(LOCALE_TAGS[locale] ?? "en-GB", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function unitLabel(t: (k: string) => string, unit: MaterialUnit): string {
  const key = `projectMaterials.unit.${unit}`;
  const v = t(key);
  return v === key ? unit : v;
}

function categoryLabel(t: (k: string) => string, category: MaterialCategory): string {
  const key = `materialCategory.${category}`;
  const v = t(key);
  return v === key ? category : v;
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function ProjectMaterialsScreen() {
  const route = useRoute();
  const { t, locale } = useI18n();
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

  const inputProps = {
    placeholderTextColor: colors.inputPlaceholderOnLight,
    style: styles.input,
  };

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
      category: m.category ?? "other_material",
      quantity: String(m.quantity),
      unit: m.unit,
      unitPrice: m.unitPrice != null ? String(m.unitPrice) : "",
      totalPrice: m.totalPrice != null ? String(m.totalPrice) : "",
      currency: m.currency || "EUR",
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
      category: s.category ?? "other_material",
      quantity: s.suggestedQuantity != null ? String(s.suggestedQuantity) : "",
      unit: s.unit ?? "pcs",
      unitPrice: s.estimatedUnitPrice != null ? String(s.estimatedUnitPrice) : "",
      totalPrice: s.estimatedTotalPrice != null ? String(s.estimatedTotalPrice) : "",
      currency: s.currency || "EUR",
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
      category: s.category ?? "other_material",
      description: s.description ?? "",
      suggestedQuantity: s.suggestedQuantity != null ? String(s.suggestedQuantity) : "",
      unit: s.unit ?? "pcs",
      unitPrice: s.estimatedUnitPrice != null ? String(s.estimatedUnitPrice) : "",
      totalPrice: s.estimatedTotalPrice != null ? String(s.estimatedTotalPrice) : "",
      currency: s.currency || "EUR",
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
          category: usedForm.category,
          quantity,
          unit: usedForm.unit,
          unitPrice,
          totalPrice,
          currency: resolveMaterialCurrency({ expenseCurrency: usedForm.currency }),
          supplierName: usedForm.supplierName.trim() || undefined,
          notes: usedForm.notes.trim() || undefined,
          usedAt: usedForm.usedAt,
        });
      } else {
        await createProjectMaterial(projectId, {
          name,
          category: usedForm.category,
          quantity,
          unit: usedForm.unit,
          unitPrice,
          totalPrice,
          currency: resolveMaterialCurrency({ expenseCurrency: usedForm.currency }),
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
    const unitPriceRaw = suggestionForm.unitPrice.trim();
    const unitPrice = unitPriceRaw ? parseFloat(unitPriceRaw.replace(",", ".")) : undefined;
    const totalRaw = suggestionForm.totalPrice.trim();
    const estimatedTotalPrice = totalRaw ? parseFloat(totalRaw.replace(",", ".")) : undefined;

    setSaving(true);
    try {
      if (suggestionForm.id) {
        await updateMaterialSuggestion(projectId, suggestionForm.id, {
          name,
          category: suggestionForm.category,
          description: suggestionForm.description.trim() || undefined,
          suggestedQuantity: Number.isFinite(suggestedQuantity!) ? suggestedQuantity : undefined,
          unit: suggestionForm.unit,
          estimatedUnitPrice: Number.isFinite(unitPrice!) ? unitPrice : undefined,
          estimatedTotalPrice: Number.isFinite(estimatedTotalPrice!) ? estimatedTotalPrice : undefined,
          currency: resolveMaterialCurrency({ expenseCurrency: suggestionForm.currency }),
          sourceNote: suggestionForm.sourceNote.trim() || undefined,
        });
      } else {
        await createMaterialSuggestion(projectId, {
          name,
          category: suggestionForm.category,
          description: suggestionForm.description.trim() || undefined,
          suggestedQuantity: Number.isFinite(suggestedQuantity!) ? suggestedQuantity : undefined,
          unit: suggestionForm.unit,
          estimatedUnitPrice: Number.isFinite(unitPrice!) ? unitPrice : undefined,
          estimatedTotalPrice: Number.isFinite(estimatedTotalPrice!) ? estimatedTotalPrice : undefined,
          currency: resolveMaterialCurrency({ expenseCurrency: suggestionForm.currency }),
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

  const renderCategoryPicker = (
    selected: MaterialCategory,
    onSelect: (c: MaterialCategory) => void
  ) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
      {MATERIAL_CATEGORIES.map((c) => {
        const active = selected === c;
        return (
          <TouchableOpacity
            key={c}
            style={[styles.unitChip, active && styles.unitChipActive]}
            onPress={() => onSelect(c)}
          >
            <Text style={[styles.unitChipText, active && styles.unitChipTextActive]}>
              {categoryLabel(t, c)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderUnitPicker = (
    selected: MaterialUnit,
    onSelect: (u: MaterialUnit) => void
  ) => (
    <View style={styles.unitRow}>
      {MATERIAL_UNITS.map((u) => {
        const active = selected === u;
        return (
          <TouchableOpacity
            key={u}
            style={[styles.unitChip, active && styles.unitChipActive]}
            onPress={() => onSelect(u)}
          >
            <Text style={[styles.unitChipText, active && styles.unitChipTextActive]}>
              {unitLabel(t, u)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>{t("projectMaterials.materialTotal")}</Text>
          <Text style={styles.totalValue}>{formatMaterialTotalsDisplay(totals)}</Text>
          <Text style={styles.totalMeta}>
            {t("projectOverview.materialsSuggested")}: {plannedSuggestions.length} ·{" "}
            {t("projectOverview.materialsUsed")}: {materials.length}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("projectMaterials.recommendedTitle")}</Text>
          <Text style={styles.sectionHelper}>{t("projectMaterials.recommendedHelper")}</Text>

          {plannedSuggestions.length === 0 ? (
            <Text style={styles.empty}>{t("projectMaterials.noRecommended")}</Text>
          ) : (
            plannedSuggestions.map((s) => (
              <View key={s.id} style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>{s.name}</Text>
                  {s.confidence ? (
                    <View style={styles.confidenceBadge}>
                      <Text style={styles.confidenceBadgeText}>
                        {t(`projectMaterials.confidence.${s.confidence}`)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {s.suggestedQuantity != null && s.unit ? (
                  <Text style={styles.cardMetaStrong}>
                    {s.suggestedQuantity} {unitLabel(t, s.unit)}
                  </Text>
                ) : null}
                {s.sourceNote ? (
                  <Text style={styles.cardSub} numberOfLines={2}>
                    {s.sourceNote}
                  </Text>
                ) : null}
                {s.description ? (
                  <Text style={styles.cardSub} numberOfLines={2}>
                    {s.description}
                  </Text>
                ) : null}
                <View style={styles.cardActionsRow}>
                  <TouchableOpacity style={styles.cardActionPrimary} onPress={() => openAcceptSuggestion(s)}>
                    <Text style={styles.cardActionPrimaryText}>{t("projectMaterials.accept")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEditSuggestion(s)} hitSlop={8}>
                    <Ionicons name="create-outline" size={20} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => onRejectSuggestion(s)} hitSlop={8}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {user?.id ? (
            <TouchableOpacity style={styles.addBtnFull} onPress={openAddSuggestion} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnFullText}>{t("projectMaterials.addRecommended")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={[styles.section, styles.sectionSpaced]}>
          <Text style={styles.sectionTitle}>{t("projectMaterials.usedTitle")}</Text>
          <Text style={styles.sectionHelper}>{t("projectMaterials.usedHelper")}</Text>

          {materials.length === 0 ? (
            <Text style={styles.empty}>{t("projectMaterials.noMaterialsYet")}</Text>
          ) : (
            materials.map((m) => (
              <View key={m.id} style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>{m.name}</Text>
                  {m.totalPrice != null ? (
                    <Text style={styles.cardPrice}>{formatMoney(m.totalPrice, m.currency)}</Text>
                  ) : null}
                </View>
                <Text style={styles.cardMetaStrong}>
                  {m.quantity} {unitLabel(t, m.unit)}
                </Text>
                {m.unitPrice != null ? (
                  <Text style={styles.cardSub}>
                    {t("projectMaterials.unitPrice")}: {formatMoney(m.unitPrice, m.currency)} /{" "}
                    {unitLabel(t, m.unit)}
                  </Text>
                ) : null}
                {m.supplierName ? <Text style={styles.cardSub}>{m.supplierName}</Text> : null}
                <Text style={styles.cardSub}>
                  {t("projectMaterials.dateUsed")}: {formatMaterialDate(new Date(m.usedAt), locale)}
                </Text>
                <View style={styles.cardActionsRow}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEditUsed(m)} hitSlop={8}>
                    <Ionicons name="create-outline" size={20} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => confirmDeleteUsed(m)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          {user?.id ? (
            <TouchableOpacity style={styles.addBtnFull} onPress={openAddUsed} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnFullText}>{t("projectMaterials.addMaterial")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={usedModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>
                {usedForm.id ? t("projectMaterials.editMaterial") : t("projectMaterials.addMaterial")}
              </Text>

              <FormField label={t("projectMaterials.materialName")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.name}
                  placeholder={t("projectMaterials.materialName")}
                  onChangeText={(v) => setUsedForm((p) => ({ ...p, name: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.category")}>
                {renderCategoryPicker(usedForm.category, (category) =>
                  setUsedForm((p) => ({ ...p, category }))
                )}
              </FormField>

              <FormField label={t("projectMaterials.quantity")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.quantity}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => setUsedForm((p) => recalcTotal(v, p.unitPrice, p))}
                />
              </FormField>

              <FormField label={t("projectMaterials.unit")}>
                {renderUnitPicker(usedForm.unit, (u) => setUsedForm((p) => ({ ...p, unit: u })))}
              </FormField>

              <FormField label={t("projectMaterials.unitPrice")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.unitPrice}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => setUsedForm((p) => recalcTotal(p.quantity, v, p))}
                />
              </FormField>

              <FormField label={t("projectMaterials.totalPrice")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.totalPrice}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => setUsedForm((p) => ({ ...p, totalPrice: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.currency")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.currency}
                  autoCapitalize="characters"
                  onChangeText={(v) => setUsedForm((p) => ({ ...p, currency: v.toUpperCase() }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.supplier")}>
                <TextInput
                  {...inputProps}
                  value={usedForm.supplierName}
                  placeholder={t("projectMaterials.supplier")}
                  onChangeText={(v) => setUsedForm((p) => ({ ...p, supplierName: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.dateUsed")}>
                <TouchableOpacity
                  style={[styles.input, styles.dateInput]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.dateInputText}>
                    {formatMaterialDate(usedForm.usedAt, locale)}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
                {showDatePicker ? (
                  <DateTimePicker
                    value={usedForm.usedAt}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={(_, date) => {
                      if (Platform.OS !== "ios") setShowDatePicker(false);
                      if (date) setUsedForm((p) => ({ ...p, usedAt: date }));
                    }}
                  />
                ) : null}
              </FormField>

              <FormField label={t("projectMaterials.notes")}>
                <TextInput
                  {...inputProps}
                  style={[styles.input, styles.inputMultiline]}
                  value={usedForm.notes}
                  placeholder={t("projectMaterials.notes")}
                  multiline
                  onChangeText={(v) => setUsedForm((p) => ({ ...p, notes: v }))}
                />
              </FormField>

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

              <FormField label={t("projectMaterials.materialName")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.name}
                  placeholder={t("projectMaterials.materialName")}
                  onChangeText={(v) => setSuggestionForm((p) => ({ ...p, name: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.category")}>
                {renderCategoryPicker(suggestionForm.category, (category) =>
                  setSuggestionForm((p) => ({ ...p, category }))
                )}
              </FormField>

              <FormField label={t("projectMaterials.quantity")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.suggestedQuantity}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => {
                    const q = parseFloat(v.replace(",", "."));
                    const p = parseFloat(suggestionForm.unitPrice.replace(",", "."));
                    setSuggestionForm((prev) => ({
                      ...prev,
                      suggestedQuantity: v,
                      totalPrice:
                        Number.isFinite(q) && Number.isFinite(p) ? (q * p).toFixed(2) : prev.totalPrice,
                    }));
                  }}
                />
              </FormField>

              <FormField label={t("projectMaterials.unit")}>
                {renderUnitPicker(suggestionForm.unit, (u) =>
                  setSuggestionForm((p) => ({ ...p, unit: u }))
                )}
              </FormField>

              <FormField label={t("projectMaterials.unitPrice")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.unitPrice}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => {
                    const q = parseFloat(suggestionForm.suggestedQuantity.replace(",", "."));
                    const p = parseFloat(v.replace(",", "."));
                    setSuggestionForm((prev) => ({
                      ...prev,
                      unitPrice: v,
                      totalPrice:
                        Number.isFinite(q) && Number.isFinite(p) ? (q * p).toFixed(2) : prev.totalPrice,
                    }));
                  }}
                />
              </FormField>

              <FormField label={t("projectMaterials.totalPrice")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.totalPrice}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  onChangeText={(v) => setSuggestionForm((p) => ({ ...p, totalPrice: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.currency")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.currency}
                  autoCapitalize="characters"
                  onChangeText={(v) => setSuggestionForm((p) => ({ ...p, currency: v.toUpperCase() }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.notes")}>
                <TextInput
                  {...inputProps}
                  style={[styles.input, styles.inputMultiline]}
                  value={suggestionForm.description}
                  placeholder={t("projectMaterials.notes")}
                  multiline
                  onChangeText={(v) => setSuggestionForm((p) => ({ ...p, description: v }))}
                />
              </FormField>

              <FormField label={t("projectMaterials.sourceDocument")}>
                <TextInput
                  {...inputProps}
                  value={suggestionForm.sourceNote}
                  placeholder={t("projectMaterials.sourceDocument")}
                  onChangeText={(v) => setSuggestionForm((p) => ({ ...p, sourceNote: v }))}
                />
              </FormField>

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
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  totalLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  totalValue: { fontSize: 24, fontWeight: "800", color: colors.text, marginTop: spacing.xs },
  totalMeta: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  section: { marginBottom: spacing.md },
  sectionSpaced: { marginTop: spacing.sm },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.textOnDark, marginBottom: spacing.xs },
  sectionHelper: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.onboardingHelperOnDark,
    marginBottom: spacing.sm,
  },
  empty: {
    color: colors.labelMutedOnDark,
    fontSize: 14,
    marginBottom: spacing.sm,
    fontStyle: "italic",
  },
  addBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    marginTop: spacing.xs,
  },
  addBtnFullText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  card: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 },
  cardPrice: { fontSize: 16, fontWeight: "800", color: colors.primary },
  cardMetaStrong: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 4 },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  confidenceBadge: {
    backgroundColor: "rgba(224, 103, 55, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidenceBadgeText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.formPanelBorder,
  },
  cardActionPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius - 4,
    paddingVertical: 8,
    alignItems: "center",
  },
  cardActionPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  iconBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalScroll: { flexGrow: 1, justifyContent: "flex-end" },
  modal: {
    backgroundColor: colors.formPanel,
    borderTopLeftRadius: radius + 4,
    borderTopRightRadius: radius + 4,
    padding: spacing.lg,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  field: { marginBottom: spacing.xs },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 6,
    marginTop: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#FFFFFF",
    minHeight: 48,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 },
  dateInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateInputText: { fontSize: 15, color: colors.text, fontWeight: "500" },
  unitRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  categoryScroll: { maxHeight: 88, marginBottom: spacing.xs },
  unitChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: "#FFFFFF",
  },
  unitChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitChipText: { fontSize: 12, color: colors.text, fontWeight: "500" },
  unitChipTextActive: { color: "#fff", fontWeight: "700" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
  },
  cancelBtn: { padding: spacing.sm },
  cancelText: { color: colors.textMuted, fontWeight: "600" },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
