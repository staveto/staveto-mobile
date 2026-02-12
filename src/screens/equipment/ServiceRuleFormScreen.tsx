import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../../theme";
import * as serviceRulesService from "../../services/serviceRules";
import * as serviceTasksService from "../../services/serviceTasks";

function genId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11);
}

export function ServiceRuleFormScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { projectId, projectName, equipmentId, equipmentName } = (route.params as {
    projectId?: string;
    projectName?: string;
    equipmentId?: string;
    equipmentName?: string;
  }) ?? {};

  const [title, setTitle] = useState("");
  const [intervalUnit, setIntervalUnit] = useState<"weeks" | "months">("weeks");
  const [intervalValue, setIntervalValue] = useState("10");
  const [checklistItems, setChecklistItems] = useState<{ id: string; title: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const goBack = () => navigation.goBack();

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
      const rule = await serviceRulesService.createServiceRule(projectId, equipmentId, {
        title: title.trim(),
        intervalUnit,
        intervalValue: val,
        checklistTemplate: checklistItems.filter((i) => i.title.trim()).map((i) => ({ id: i.id, title: i.title.trim() })),
      });
      const dueAt = new Date(rule.nextDueAt);
      await serviceTasksService.createServiceTaskFromRule(projectId, rule, dueAt);
      goBack();
    } catch (e: any) {
      Alert.alert("Chyba", e.message || "Nepodarilo sa uložiť servisný plán.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pridať servisný plán</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
