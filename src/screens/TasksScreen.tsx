import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import type { TaskDoc } from "../services/tasks";
import {
  canWorkerToggleTaskStatus,
  canManageTaskPlanningFromAccess,
} from "../lib/taskPlanningPermissions";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import { colors, radius, spacing } from "../theme";

const DONE_COLOR = "#2e7d32";
const OPEN_COLOR = "#1565c0";

function showError(msg: string) {
  Alert.alert("", msg);
}

type Project = { id: string; name: string };

type TaskRow = TaskDoc & { projectId: string };

type TaskSection = {
  projectId: string;
  title: string;
  data: TaskRow[];
};

function statusLabel(status: string | undefined, t: (key: string) => string): string {
  const s = (status ?? "OPEN").toUpperCase();
  if (s === "DONE") return t("tasks.statusDone");
  return t("tasks.statusOpen");
}

function statusColors(status: string | undefined): { bg: string; fg: string } {
  const s = (status ?? "OPEN").toUpperCase();
  if (s === "DONE") return { bg: DONE_COLOR, fg: "#fff" };
  return { bg: "#e8eef8", fg: OPEN_COLOR };
}

export function TasksScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { orgId } = useAuth();
  const routeParams = route.params as {
    dueFilter?: "today" | "overdue";
    dueDateYmd?: string;
    status?: string;
    projectId?: string;
  };
  const dueFilter = routeParams?.dueFilter;
  const dueDateYmd = routeParams?.dueDateYmd;
  const statusRoute = routeParams?.status?.trim().toUpperCase();
  const filterProjectId = routeParams?.projectId?.trim();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [canManageByProjectId, setCanManageByProjectId] = useState<Map<string, boolean>>(new Map());

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [tasksList, projectsList] = await Promise.all([
        tasksService.listMyTasks(orgId),
        projectsService.listMyProjects(orgId),
      ]);
      setTasks(tasksList as TaskRow[]);
      setProjects(projectsList);

      const manageEntries = await Promise.all(
        projectsList.map(async (project) => {
          if (project.ownerId === orgId) return [project.id, true] as const;
          const access = await fetchProjectAccess(project.id, orgId, project.ownerId);
          return [project.id, canManageTaskPlanningFromAccess(access)] as const;
        })
      );
      setCanManageByProjectId(new Map(manageEntries));
    } catch (e: unknown) {
      setTasks([]);
      setProjects([]);
      setCanManageByProjectId(new Map());
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : t("common.error")));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if ((route.params as { openNew?: boolean })?.openNew) setShowNew(true);
  }, [(route.params as { openNew?: boolean })?.openNew]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name?.trim() || t("tasks.unknownProject"));
    return m;
  }, [projects, t]);

  const parseDateOnly = (dateStr?: string) => {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (filterProjectId) {
      list = list.filter((task) => task.projectId === filterProjectId);
    }
    if (dueDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(dueDateYmd)) {
      list = list.filter((task) => task.dueDate?.trim() === dueDateYmd);
    } else if (dueFilter) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      list = list.filter((task) => {
        if ((task.status ?? "").toUpperCase() === "DONE") return false;
        const date = parseDateOnly(task.dueDate);
        if (!date) return false;
        date.setHours(0, 0, 0, 0);
        if (dueFilter === "today") return date.getTime() === today.getTime();
        return date.getTime() < today.getTime();
      });
    }
    if (statusRoute) {
      list = list.filter((task) => (task.status ?? "OPEN").toUpperCase() === statusRoute);
    }
    return list;
  }, [tasks, filterProjectId, dueDateYmd, dueFilter, statusRoute]);

  const sections = useMemo((): TaskSection[] => {
    const byProject = new Map<string, TaskRow[]>();
    for (const task of filteredTasks) {
      const pid = task.projectId || "unknown";
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(task);
    }

    const sortTasks = (a: TaskRow, b: TaskRow) => {
      const oA = a.order ?? 0;
      const oB = b.order ?? 0;
      if (oA !== oB) return oA - oB;
      return (a.title || "").localeCompare(b.title || "");
    };

    return [...byProject.entries()]
      .map(([projectId, rows]) => ({
        projectId,
        title: projectNameById.get(projectId) ?? t("tasks.unknownProject"),
        data: [...rows].sort(sortTasks),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [filteredTasks, projectNameById, t]);

  const openCount = useMemo(
    () => filteredTasks.filter((tk) => (tk.status ?? "OPEN").toUpperCase() !== "DONE").length,
    [filteredTasks]
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const onCreate = async () => {
    if (!orgId || !newTitle.trim() || !selectedProjectId) return;
    setSubmitting(true);
    try {
      await tasksService.createTask(orgId, selectedProjectId, newTitle.trim());
      setShowNew(false);
      setNewTitle("");
      setSelectedProjectId(undefined);
      load();
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  const onStatusToggle = async (task: TaskRow) => {
    if (!orgId || !task.projectId) return;
    const canManage = canManageByProjectId.get(task.projectId) ?? false;
    if (!canWorkerToggleTaskStatus(task, orgId, canManage)) return;
    const s = (task.status ?? "OPEN").toUpperCase();
    const next = s === "DONE" ? "OPEN" : "DONE";
    try {
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, next);
      setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status: next } : x)));
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : t("common.error")));
    }
  };

  const openProject = (projectId: string) => {
    const name = projectNameById.get(projectId) ?? "";
    (navigation as { navigate: (n: string, p: object) => void }).navigate("ProjectOverview", {
      projectId,
      projectName: name,
    });
  };

  const openDetail = (task: TaskRow) => {
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate("TaskDetail", {
      task,
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {filteredTasks.length > 0 ? (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {t("tasks.summaryOpen", { count: String(openCount) })}
          </Text>
          {filterProjectId ? (
            <TouchableOpacity
              onPress={() =>
                (navigation as { setParams: (p: object) => void }).setParams({ projectId: undefined })
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.summaryLink}>{t("tasks.showAllProjects")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <TouchableOpacity style={styles.fab} onPress={() => setShowNew(true)}>
        <Text style={styles.fabText}>+ {t("tasks.fab")}</Text>
      </TouchableOpacity>

      {!filteredTasks.length ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("tasks.empty")}</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
            <Text style={styles.refreshBtnText}>{t("tasks.refresh")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderSectionHeader={({ section }) => (
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => openProject(section.projectId)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {section.title}
                </Text>
                <Text style={styles.sectionCount}>({section.data.length})</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          renderItem={({ item, index, section }) => {
            const isDone = (item.status ?? "").toUpperCase() === "DONE";
            const chip = statusColors(item.status);
            const showStep = section.data.length > 1;
            return (
              <TouchableOpacity
                style={[styles.card, index === section.data.length - 1 && styles.cardLastInSection]}
                onPress={() => openDetail(item)}
                activeOpacity={0.7}
              >
                <View style={styles.cardRow}>
                  {showStep ? (
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>{index + 1}</Text>
                    </View>
                  ) : null}
                  <View style={styles.cardBody}>
                    <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={2}>
                      {item.title || t("tasks.noTitle")}
                    </Text>
                    {item.phaseTitle?.trim() ? (
                      <Text style={styles.phaseLabel} numberOfLines={1}>
                        {item.phaseTitle.trim()}
                      </Text>
                    ) : null}
                    <View style={styles.row}>
                      <TouchableOpacity
                        style={[styles.statusChip, { backgroundColor: chip.bg }]}
                        onPress={() => onStatusToggle(item)}
                      >
                        <Text style={[styles.statusChipText, { color: chip.fg }]}>
                          {statusLabel(item.status, t)}
                        </Text>
                      </TouchableOpacity>
                      {item.dueDate ? (
                        <View style={styles.dueRow}>
                          <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                          <Text style={styles.metaText}>{item.dueDate}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={showNew} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("tasks.modalTitle")}</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder={t("tasks.taskPlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.label}>{t("tasks.project")}</Text>
            <View style={styles.projectList}>
              {projects.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.projectOpt, selectedProjectId === p.id && styles.projectOptActive]}
                  onPress={() => setSelectedProjectId(p.id)}
                >
                  <Text style={styles.projectOptText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowNew(false)}>
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalOk}
                onPress={onCreate}
                disabled={submitting || !newTitle.trim() || !selectedProjectId}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : t("tasks.create")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  summaryText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  summaryLink: { fontSize: 13, fontWeight: "600", color: colors.primary },
  list: { paddingHorizontal: spacing.md, paddingBottom: 80 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", flex: 1, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  sectionCount: { fontSize: 13, color: colors.textMuted },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: spacing.sm,
  },
  cardLastInSection: { marginBottom: spacing.md },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e8eef8",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepBadgeText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  cardBody: { flex: 1 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  titleDone: {
    textDecorationLine: "line-through",
    textDecorationColor: DONE_COLOR,
    color: DONE_COLOR,
  },
  phaseLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: 8 },
  statusChip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 8 },
  statusChipText: { fontSize: 12, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  fab: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 24,
    zIndex: 10,
    elevation: 4,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  emptyText: { fontSize: 16, color: colors.textMuted, marginBottom: spacing.md },
  refreshBtn: { padding: spacing.sm },
  refreshBtnText: { color: colors.primary, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    padding: spacing.lg,
    maxHeight: "80%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.sm,
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  projectList: { maxHeight: 160, marginBottom: spacing.md },
  projectOpt: {
    padding: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  projectOptActive: { borderColor: colors.primary, backgroundColor: "#e8eef8" },
  projectOptText: { color: colors.text },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md },
  modalCancel: { padding: spacing.sm },
  modalCancelText: { color: colors.textMuted },
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius },
  modalOkText: { color: "#fff", fontWeight: "700" },
});
