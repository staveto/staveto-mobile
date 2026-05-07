import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  RefreshControl,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import * as userEquipmentService from "../../services/userEquipment";
import type { UserEquipmentDoc, UserEquipmentStatus } from "../../services/userEquipment";
import * as projectsService from "../../services/projects";
import * as userServiceRulesService from "../../services/userServiceRules";
import * as userEquipmentServiceTasks from "../../services/userEquipmentServiceTasks";
import type { ServiceRuleDoc } from "../../services/serviceRules";
import type { UserEquipmentServiceTaskDoc } from "../../services/userEquipmentServiceTasks";
import type { EquipmentStackParamList } from "../../navigation/EquipmentStack";

type Nav = NativeStackNavigationProp<EquipmentStackParamList, "EquipmentDetail">;
type R = RouteProp<EquipmentStackParamList, "EquipmentDetail">;

function categoryLabelKey(category: string): string {
  const map: Record<string, string> = {
    machine: "equipment.categoryMachine",
    tool: "equipment.categoryTool",
    vehicle: "equipment.categoryVehicle",
    building: "equipment.categoryBuilding",
    other: "equipment.categoryOther",
  };
  return map[category] ?? "equipment.categoryOther";
}

function statusLabelKey(s: UserEquipmentStatus): string {
  switch (s) {
    case "available":
      return "equipmentTab.status.available";
    case "assigned":
      return "equipmentTab.status.assigned";
    case "in_service":
      return "equipmentTab.status.inService";
    case "inactive":
      return "equipmentTab.status.inactive";
    default:
      return "equipmentTab.status.available";
  }
}

export function EquipmentDetailScreen() {
  const { t } = useI18n();
  const route = useRoute<R>();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, orgId } = useAuth();
  const uid = user?.id ?? "";
  const { equipmentId } = route.params;

  const [row, setRow] = useState<UserEquipmentDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [rules, setRules] = useState<ServiceRuleDoc[]>([]);
  const [openTasks, setOpenTasks] = useState<UserEquipmentServiceTaskDoc[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!uid || !equipmentId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const doc = await userEquipmentService.getUserEquipment(uid, equipmentId);
      setRow(doc);
      const listOwner = orgId ?? uid;
      if (doc?.assignedProjectId && listOwner) {
        const list = await projectsService.listMyProjects(listOwner);
        const p = list.find((x) => x.id === doc.assignedProjectId);
        setProjectName(p?.name ?? null);
      } else {
        setProjectName(null);
      }
      const [rulesList, tasksList] = await Promise.all([
        userServiceRulesService.listUserEquipmentServiceRules(uid, equipmentId),
        userEquipmentServiceTasks.listUserEquipmentServiceTasks(uid, equipmentId, { status: "OPEN" }),
      ]);
      setRules(rulesList);
      setOpenTasks(tasksList);
    } catch {
      setRow(null);
      setRules([]);
      setOpenTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid, equipmentId, orgId]);

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        row ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("EquipmentForm", { equipmentId: row.id })}
            style={{ marginRight: spacing.sm }}
            hitSlop={12}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>{t("equipmentTab.edit")}</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, row, t]);

  const openAssign = async () => {
    const listOwner = orgId ?? uid;
    if (!listOwner) {
      Alert.alert(t("common.error"), t("equipmentTab.assignNoOrg"));
      return;
    }
    setAssignOpen(true);
    setLoadingProjects(true);
    try {
      const list = await projectsService.listMyProjects(listOwner);
      setProjects(list.map((p) => ({ id: p.id, name: p.name })));
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  const onPickProject = async (projectId: string | null) => {
    if (!uid) return;
    try {
      await userEquipmentService.setUserEquipmentProjectAssignment(uid, equipmentId, projectId);
      setAssignOpen(false);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t("common.error"), msg || t("equipmentTab.assignFailed"));
    }
  };

  const goProjectOverview = () => {
    if (!row?.assignedProjectId) return;
    (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate("ProjectOverview", {
      projectId: row.assignedProjectId,
    });
  };

  const onCompleteTask = (task: UserEquipmentServiceTaskDoc) => {
    Alert.alert(t("equipment.completeServiceTitle"), t("equipment.completeServiceConfirm", { name: task.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.yes"),
        onPress: async () => {
          try {
            await userEquipmentServiceTasks.completeUserEquipmentServiceTask(uid, equipmentId, task.id);
            await load(true);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            Alert.alert(t("common.error"), msg);
          }
        },
      },
    ]);
  };

  if (loading && !row) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>{t("equipmentTab.notFound")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
      }
    >
      <Text style={styles.title}>{row.name}</Text>
      <View style={[styles.pill, { alignSelf: "flex-start", marginTop: spacing.sm }]}>
        <Text style={styles.pillText}>{t(statusLabelKey(row.status))}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipmentTab.sectionBasics")}</Text>
        <Row label={t("equipmentTab.fieldCategory")} value={t(categoryLabelKey(String(row.category))) + (row.kind ? ` · ${row.kind}` : "")} />
        <Row label={t("equipmentTab.fieldSerial")} value={row.serialNumber || "—"} />
        <Row label={t("equipmentTab.fieldInternalCode")} value={row.internalCode || "—"} />
        <Row label={t("equipmentTab.fieldLocation")} value={row.locationText || "—"} />
        <Row label={t("equipmentTab.fieldNotes")} value={row.notes || "—"} multiline />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipmentTab.sectionAssignment")}</Text>
        <Row
          label={t("equipmentTab.assignedProject")}
          value={
            row.assignedProjectId
              ? projectName ?? row.assignedProjectId
              : t("equipmentTab.none")
          }
        />
        <Row
          label={t("equipmentTab.assignedTo")}
          value={row.assignedToUserId ? row.assignedToUserId : t("equipmentTab.none")}
        />
        {row.assignedProjectId ? (
          <TouchableOpacity style={styles.linkBtn} onPress={goProjectOverview}>
            <Text style={styles.linkBtnText}>{t("equipmentTab.openProject")}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.rowActions}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={openAssign}>
            <Text style={styles.secondaryBtnText}>{t("equipmentTab.assignProject")}</Text>
          </TouchableOpacity>
          {row.assignedProjectId ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => onPickProject(null)}>
              <Text style={styles.secondaryBtnText}>{t("equipmentTab.unassignProject")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <TouchableOpacity
        style={styles.servicePlanCta}
        onPress={() =>
          navigation.navigate("EquipmentServiceRuleForm", {
            serviceScope: "user",
            userId: uid,
            equipmentId,
            equipmentName: row.name,
          })
        }
      >
        <Ionicons name="add-circle" size={24} color={colors.primary} />
        <Text style={styles.servicePlanCtaText}>{t("equipment.addServicePlanCta")}</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipment.servicePlans")}</Text>
        {rules.length === 0 ? (
          <Text style={styles.placeholder}>{t("equipment.noServicePlans")}</Text>
        ) : (
          rules.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.ruleRow}
              onPress={() =>
                navigation.navigate("EquipmentServiceRuleForm", {
                  serviceScope: "user",
                  userId: uid,
                  equipmentId,
                  equipmentName: row.name,
                  ruleId: r.id,
                  rule: r,
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.ruleTitle}>{r.title}</Text>
                <Text style={styles.ruleMeta}>
                  {r.intervalUnit === "weeks"
                    ? t("equipment.everyWeeks", { count: String(r.intervalValue) })
                    : t("equipment.everyMonths", { count: String(r.intervalValue) })}
                </Text>
                {r.nextDueAt ? (
                  <Text style={[styles.ruleMeta, styles.ruleNextDue]}>
                    {t("equipment.nextInspection")}:{" "}
                    {new Date(r.nextDueAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="pencil" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipment.openServiceTasks")}</Text>
        {openTasks.length === 0 ? (
          <Text style={styles.placeholder}>{t("equipment.noOpenTasks")}</Text>
        ) : (
          openTasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                {task.dueDate ? <Text style={styles.taskDue}>{task.dueDate}</Text> : null}
              </View>
              <TouchableOpacity style={styles.completeBtn} onPress={() => onCompleteTask(task)}>
                <Text style={styles.completeBtnText}>{t("equipment.completeService")}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipmentTab.sectionUsage")}</Text>
        <Text style={styles.placeholder}>{t("equipmentTab.usagePlaceholder")}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t("equipmentTab.sectionMeta")}</Text>
        <Row label={t("equipmentTab.createdAt")} value={fmtDate(row.createdAt)} />
        <Row label={t("equipmentTab.updatedAt")} value={fmtDate(row.updatedAt)} />
      </View>

      <Modal visible={assignOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("equipmentTab.pickProject")}</Text>
              <TouchableOpacity onPress={() => setAssignOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>
            {loadingProjects ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
            ) : (
              <FlatList
                data={[{ id: "__none", name: t("equipmentTab.unassignProject") }, ...projects]}
                keyExtractor={(p) => p.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.projectRow}
                    onPress={() => onPickProject(item.id === "__none" ? null : item.id)}
                  >
                    <Text style={styles.projectRowText} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, multiline && { flex: 1 }]} selectable>
        {value}
      </Text>
    </View>
  );
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  muted: { color: colors.textMuted },
  title: { fontSize: 24, fontWeight: "700", color: colors.textOnDark },
  pill: {
    backgroundColor: "rgba(255, 159, 67, 0.2)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillText: { color: colors.textOnDark, fontWeight: "600", fontSize: 13 },
  section: {
    marginTop: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: "row", marginBottom: spacing.sm, alignItems: "flex-start" },
  rowLabel: { width: 120, color: colors.text, fontSize: 14 },
  rowValue: { flex: 1, color: colors.text, fontSize: 14 },
  linkBtn: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  linkBtnText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  secondaryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryBtnText: { color: colors.primary, fontWeight: "600" },
  placeholder: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  projectRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  projectRowText: { color: colors.text, fontSize: 16 },
  servicePlanCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: "dashed",
  },
  servicePlanCtaText: { fontSize: 16, fontWeight: "600", color: colors.primary },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ruleTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  ruleMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  ruleNextDue: { color: colors.primary, fontWeight: "500" },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  taskTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  taskDue: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  completeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.primary,
  },
  completeBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
