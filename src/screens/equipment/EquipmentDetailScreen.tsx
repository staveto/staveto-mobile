import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../../theme";
import * as equipmentService from "../../services/equipment";
import * as serviceRulesService from "../../services/serviceRules";
import * as tasksService from "../../services/tasks";
import type { EquipmentDoc } from "../../services/equipment";
import type { ServiceRuleDoc } from "../../services/serviceRules";
import type { TaskDoc } from "../../services/tasks";

export function EquipmentDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { projectId, projectName, equipmentId } = (route.params as {
    projectId?: string;
    projectName?: string;
    equipmentId?: string;
  }) ?? {};

  const [equipment, setEquipment] = useState<EquipmentDoc | null>(null);
  const [rules, setRules] = useState<ServiceRuleDoc[]>([]);
  const [openTasks, setOpenTasks] = useState<TaskDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!projectId || !equipmentId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [eq, rulesList, tasksList] = await Promise.all([
        equipmentService.getEquipment(projectId, equipmentId),
        serviceRulesService.listServiceRulesByEquipment(projectId, equipmentId),
        tasksService.listTasksByProject(projectId),
      ]);
      setEquipment(eq ?? null);
      setRules(rulesList);
      const serviceTasks = tasksList.filter(
        (t) => t.equipmentId === equipmentId && t.serviceRuleId && t.status !== "DONE"
      );
      setOpenTasks(serviceTasks);
    } catch (e: any) {
      console.error("[EquipmentDetail] Error:", e);
      Alert.alert("Chyba", e.message || "Nepodarilo sa načítať zariadenie.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, equipmentId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goBack = () => navigation.goBack();

  const onArchive = () => {
    if (!projectId || !equipmentId) return;
    Alert.alert(
      "Archivovať zariadenie",
      `Naozaj chcete archivovať "${equipment?.name}"? Zariadenie sa skryje zo zoznamu, ale zostane v databáze.`,
      [
        { text: "Zrušiť", style: "cancel" },
        {
          text: "Archivovať",
          style: "destructive",
          onPress: async () => {
            try {
              await equipmentService.archiveEquipment(projectId, equipmentId);
              goBack();
            } catch (e: any) {
              Alert.alert("Chyba", e.message || "Nepodarilo sa archivovať zariadenie.");
            }
          },
        },
      ]
    );
  };

  if (loading && !equipment) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!equipment) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.notFound}>Zariadenie nebolo nájdené</Text>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Text style={styles.backButtonText}>Späť</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{equipment.name}</Text>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() =>
            (navigation as any).navigate("EquipmentForm", {
              projectId,
              projectName,
              equipmentId,
              equipment,
            })
          }
        >
          <Ionicons name="pencil" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.qrBtn}
          onPress={() =>
            (navigation as any).navigate("EquipmentQr", {
              qrToken: equipment.qrToken,
              name: equipment.name,
              labelCode: equipment.labelCode,
            })
          }
        >
          <Ionicons name="qr-code-outline" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={onArchive}>
          <Ionicons name="trash-outline" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Informácie</Text>
          {equipment.labelCode && <Text style={styles.infoRow}><Text style={styles.infoLabel}>Kód:</Text> {equipment.labelCode}</Text>}
          {equipment.model && <Text style={styles.infoRow}><Text style={styles.infoLabel}>Model:</Text> {equipment.model}</Text>}
          {equipment.serialNumber && <Text style={styles.infoRow}><Text style={styles.infoLabel}>Sériové č.</Text> {equipment.serialNumber}</Text>}
          {equipment.location && <Text style={styles.infoRow}><Text style={styles.infoLabel}>Umiestnenie:</Text> {equipment.location}</Text>}
        </View>

        <TouchableOpacity
          style={styles.servicePlanCta}
          onPress={() =>
            (navigation as any).navigate("ServiceRuleForm", {
              projectId,
              projectName,
              equipmentId,
              equipmentName: equipment.name,
            })
          }
        >
          <Ionicons name="add-circle" size={24} color={colors.primary} />
          <Text style={styles.servicePlanCtaText}>+ Servisný plán</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Servisné plány</Text>
          {rules.length === 0 ? (
            <Text style={styles.emptyText}>Žiadne servisné plány</Text>
          ) : (
            rules.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.ruleRow}
                onPress={() =>
                  (navigation as any).navigate("ServiceRuleForm", {
                    projectId,
                    projectName,
                    equipmentId,
                    equipmentName: equipment.name,
                    ruleId: r.id,
                    rule: r,
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.ruleRowContent}>
                  <Text style={styles.ruleTitle}>{r.title}</Text>
                  <Text style={styles.ruleMeta}>Každých {r.intervalValue} {r.intervalUnit === "weeks" ? "týždňov" : "mesiacov"}</Text>
                  {r.startFrom && (
                    <Text style={styles.ruleMeta}>Od: {new Date(r.startFrom).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" })}</Text>
                  )}
                </View>
                <Ionicons name="pencil" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Otvorené servisné úlohy</Text>
          {openTasks.length === 0 ? (
            <Text style={styles.emptyText}>Žiadne otvorené úlohy</Text>
          ) : (
            openTasks.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={styles.taskRow}
                onPress={() =>
                  (navigation as any).navigate("ProjectOverview", {
                    projectId,
                    projectName,
                  })
                }
              >
                <Text style={styles.taskTitle}>{t.title}</Text>
                {t.dueDate && <Text style={styles.taskDue}>{t.dueDate}</Text>}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
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
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "600", color: colors.textOnDark },
  editBtn: { padding: spacing.xs },
  qrBtn: { padding: spacing.xs },
  menuBtn: { padding: spacing.xs },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  infoRow: { fontSize: 14, color: colors.text, marginTop: 4 },
  infoLabel: { fontWeight: "600", color: colors.textMuted },
  servicePlanCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: "dashed",
  },
  servicePlanCtaText: { fontSize: 16, fontWeight: "600", color: colors.primary },
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.textOnDark, marginBottom: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textMuted },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ruleRowContent: { flex: 1 },
  ruleTitle: { fontSize: 15, fontWeight: "500", color: colors.text },
  ruleMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  taskRow: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskTitle: { fontSize: 15, color: colors.text },
  taskDue: { fontSize: 13, color: colors.textMuted },
  notFound: { fontSize: 16, color: colors.textMuted },
  backButton: { marginTop: spacing.lg, padding: spacing.md },
  backButtonText: { color: colors.primary, fontSize: 16 },
});
