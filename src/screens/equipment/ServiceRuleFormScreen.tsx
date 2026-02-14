import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { colors, radius, spacing } from "../../theme";

let DateTimePicker: any = null;
try {
  DateTimePicker = require("@react-native-community/datetimepicker");
} catch (e) {
  console.warn("@react-native-community/datetimepicker not installed.");
}
import * as serviceRulesService from "../../services/serviceRules";
import * as serviceTasksService from "../../services/serviceTasks";

function genId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

export function ServiceRuleFormScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { projectId, projectName, equipmentId, equipmentName, ruleId, rule: ruleParam } = (route.params as {
    projectId?: string;
    projectName?: string;
    equipmentId?: string;
    equipmentName?: string;
    ruleId?: string;
    rule?: import("../../services/serviceRules").ServiceRuleDoc;
  }) ?? {};

  const isEdit = !!ruleId;

  const [title, setTitle] = useState("");
  const [intervalUnit, setIntervalUnit] = useState<"weeks" | "months">("weeks");
  const [intervalValue, setIntervalValue] = useState("10");
  const [startFromDate, setStartFromDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [checklistItems, setChecklistItems] = useState<{ id: string; title: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const goBack = () => navigation.goBack();

  useEffect(() => {
    if (!isEdit || !projectId || !ruleId) return;
    const loadRule = async () => {
      setLoading(true);
      try {
        const r = ruleParam ?? (await serviceRulesService.getServiceRule(projectId, ruleId));
        if (r) {
          setTitle(r.title);
          setIntervalUnit(r.intervalUnit);
          setIntervalValue(String(r.intervalValue));
          setStartFromDate(r.startFrom ? new Date(r.startFrom) : new Date());
          setChecklistItems(
            (r.checklistTemplate ?? []).map((i) => ({ id: i.id || genId(), title: i.title }))
          );
        }
      } catch (e: any) {
        Alert.alert("Chyba", e.message || "Nepodarilo sa načítať servisný plán.");
      } finally {
        setLoading(false);
      }
    };
    loadRule();
  }, [isEdit, projectId, ruleId]);

  const addChecklistItem = () => {
    setChecklistItems((prev) => [...prev, { id: genId(), title: "" }]);
  };

  const updateChecklistItem = (id: string, title: string) => {
    setChecklistItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i)));
  };

  const removeChecklistItem = (id: string) => {
    setChecklistItems((prev) => prev.filter((i) => i.id !== id));
  };

  const onSave = async () => {
    if (!projectId || !equipmentId) return;
    if (!title.trim()) {
      Alert.alert("Chyba", "Názov servisného plánu je povinný.");
      return;
    }
    const val = parseInt(intervalValue, 10);
    if (isNaN(val) || val < 1) {
      Alert.alert("Chyba", "Interval musí byť kladné číslo.");
      return;
    }
    setSubmitting(true);
    try {
      const checklist = checklistItems.filter((i) => i.title.trim()).map((i) => ({ id: i.id, title: i.title.trim() }));
      if (isEdit && ruleId) {
        await serviceRulesService.updateServiceRule(projectId, ruleId, {
          title: title.trim(),
          intervalUnit,
          intervalValue: val,
          startFrom: startFromDate,
          checklistTemplate: checklist,
        });
        goBack();
      } else {
        const rule = await serviceRulesService.createServiceRule(projectId, equipmentId, {
          title: title.trim(),
          intervalUnit,
          intervalValue: val,
          startFrom: startFromDate,
          checklistTemplate: checklist,
        });
        const dueAt = new Date(rule.nextDueAt);
        await serviceTasksService.createServiceTaskFromRule(projectId, rule, dueAt);
        goBack();
      }
    } catch (e: any) {
      Alert.alert("Chyba", e.message || "Nepodarilo sa uložiť servisný plán.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? "Upraviť servisný plán" : "Pridať servisný plán"}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.lg }]}>
        {equipmentName && (
          <Text style={styles.equipmentLabel}>Zariadenie: {equipmentName}</Text>
        )}

        <Text style={styles.label}>Názov *</Text>
        <TextInput
          style={styles.input}
          placeholder="Napr. Výmena oleja"
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Interval</Text>
        <View style={styles.intervalRow}>
          <TextInput
            style={[styles.input, styles.intervalInput]}
            placeholder="10"
            placeholderTextColor={colors.textMuted}
            value={intervalValue}
            onChangeText={setIntervalValue}
            keyboardType="number-pad"
          />
          <View style={styles.unitRow}>
            <TouchableOpacity
              style={[styles.unitChip, intervalUnit === "weeks" && styles.unitChipActive]}
              onPress={() => setIntervalUnit("weeks")}
            >
              <Text style={[styles.unitChipText, intervalUnit === "weeks" && styles.unitChipTextActive]}>týždne</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.unitChip, intervalUnit === "months" && styles.unitChipActive]}
              onPress={() => setIntervalUnit("months")}
            >
              <Text style={[styles.unitChipText, intervalUnit === "months" && styles.unitChipTextActive]}>mesiace</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.label}>Začiatok intervalu</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => setShowStartDatePicker(true)}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          <Text style={styles.dateButtonText}>{format(startFromDate, "d.M.yyyy")}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.label}>Checklist (voliteľné)</Text>
        {checklistItems.map((item) => (
          <View key={item.id} style={styles.checklistRow}>
            <TextInput
              style={[styles.input, styles.checklistInput]}
              placeholder="Položka"
              placeholderTextColor={colors.textMuted}
              value={item.title}
              onChangeText={(t) => updateChecklistItem(item.id, t)}
            />
            <TouchableOpacity onPress={() => removeChecklistItem(item.id)}>
              <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addChecklist} onPress={addChecklistItem}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.addChecklistText}>Pridať položku</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Uložiť</Text>}
        </TouchableOpacity>
      </ScrollView>

      {showStartDatePicker && DateTimePicker && (
        <>
          {Platform.OS === "ios" ? (
            <Modal visible={showStartDatePicker} transparent animationType="slide">
              <TouchableOpacity
                style={styles.datePickerOverlay}
                activeOpacity={1}
                onPress={() => setShowStartDatePicker(false)}
              >
                <View style={styles.datePickerModal}>
                  <Text style={styles.datePickerTitle}>Začiatok intervalu</Text>
                  <View style={styles.datePickerContent}>
                    <DateTimePicker.default
                      value={startFromDate}
                      mode="date"
                      display="spinner"
                      onChange={(_event: unknown, selectedDate?: Date) => {
                        if (selectedDate) setStartFromDate(selectedDate);
                      }}
                    />
                  </View>
                  <View style={styles.datePickerButtons}>
                    <TouchableOpacity style={styles.datePickerCancel} onPress={() => setShowStartDatePicker(false)}>
                      <Text style={styles.datePickerCancelText}>Zrušiť</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.datePickerOk}
                      onPress={() => setShowStartDatePicker(false)}
                    >
                      <Text style={styles.datePickerOkText}>Vybrať</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            </Modal>
          ) : (
            <DateTimePicker.default
              value={startFromDate}
              mode="date"
              display="default"
              onChange={(_event: unknown, selectedDate?: Date) => {
                setShowStartDatePicker(false);
                if (selectedDate) setStartFromDate(selectedDate);
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { marginRight: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md },
  equipmentLabel: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  label: { fontSize: 14, fontWeight: "600", color: colors.textOnDark, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  intervalRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  intervalInput: { flex: 0, width: 80 },
  unitRow: { flexDirection: "row", gap: spacing.sm },
  unitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unitChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "20" },
  unitChipText: { fontSize: 14, color: colors.text },
  unitChipTextActive: { color: colors.primary, fontWeight: "600" },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateButtonText: { fontSize: 16, color: colors.text },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  datePickerModal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    padding: spacing.md,
  },
  datePickerTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  datePickerContent: { alignItems: "center" },
  datePickerButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.md },
  datePickerCancel: { padding: spacing.sm },
  datePickerCancelText: { fontSize: 16, color: colors.textMuted },
  datePickerOk: { padding: spacing.sm },
  datePickerOkText: { fontSize: 16, color: colors.primary, fontWeight: "600" },
  checklistRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  checklistInput: { flex: 1 },
  addChecklist: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  addChecklistText: { fontSize: 14, color: colors.primary, fontWeight: "500" },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    marginTop: spacing.lg,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
