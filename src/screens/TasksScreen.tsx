import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import { colors, radius, spacing } from "../theme";

const DONE_COLOR = "#2e7d32";

function showError(msg: string) {
  Alert.alert("", msg);
}

type Task = { id: string; projectId: string; title: string; status?: string; dueDate?: string };
type Project = { id: string; name: string };

export function TasksScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { orgId } = useAuth();
  const routeParams = route.params as {
    dueFilter?: "today" | "overdue";
    dueDateYmd?: string;
    /** When set (e.g. from Home), list only tasks in this status */
    status?: string;
  };
  const dueFilter = routeParams?.dueFilter;
  const dueDateYmd = routeParams?.dueDateYmd;
  const statusRoute = routeParams?.status?.trim().toUpperCase();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [tasksList, projectsList] = await Promise.all([
        tasksService.listMyTasks(orgId),
        projectsService.listMyProjects(orgId),
      ]);
      
      // Sort tasks by dueDate (ascending - earliest first)
      // Tasks without dueDate go to the end
      const sortedTasks = [...(tasksList as Task[])].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1; // Tasks without date go to end
        if (!b.dueDate) return -1; // Tasks without date go to end
        return a.dueDate.localeCompare(b.dueDate); // Sort by date ascending
      });
      
      setTasks(sortedTasks);
      setProjects(projectsList);
    } catch (e: unknown) {
      setTasks([]);
      setProjects([]);
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Sieťová chyba."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if ((route.params as { openNew?: boolean })?.openNew) setShowNew(true);
  }, [(route.params as { openNew?: boolean })?.openNew]);

  const parseDateOnly = (dateStr?: string) => {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const filteredTasks = (() => {
    let list = tasks;
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
        if (dueFilter === "today") {
          return date.getTime() === today.getTime();
        }
        return date.getTime() < today.getTime();
      });
    }
    if (statusRoute) {
      list = list.filter((task) => (task.status ?? "OPEN").toUpperCase() === statusRoute);
    }
    return list;
  })();

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

  const onStatusCycle = async (task: Task) => {
    if (!orgId || !task.projectId) return;
    const s = (task.status ?? "OPEN").toUpperCase();
    const next = s === "OPEN" ? "DOING" : s === "DOING" ? "DONE" : "OPEN";
    try {
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, next);
      setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status: next } : x)));
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Chyba."));
    }
  };

  const openDetail = (t: Task) => {
    (navigation.getParent() as { navigate: (n: string, p: object) => void } | undefined)?.navigate("TaskDetail", { task: t });
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
        <FlatList
          data={filteredTasks}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => {
            const isDone = (item.status ?? "").toUpperCase() === "DONE";
            return (
              <TouchableOpacity style={styles.card} onPress={() => openDetail(item)} activeOpacity={0.7}>
                <Text style={[styles.title, isDone && styles.titleDone]}>{item.title || t("tasks.noTitle")}</Text>
                <View style={styles.row}>
                  {item.status ? (
                    <TouchableOpacity
                      style={[styles.statusChip, isDone && styles.statusChipDone]}
                      onPress={() => onStatusCycle(item)}
                    >
                      <Text style={[styles.statusChipText, isDone && styles.statusChipTextDone]}>{item.status}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.dueDate ? <Text style={styles.metaText}>{item.dueDate}</Text> : null}
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
                <TouchableOpacity key={p.id} style={[styles.projectOpt, selectedProjectId === p.id && styles.projectOptActive]} onPress={() => setSelectedProjectId(p.id)}>
                  <Text style={styles.projectOptText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowNew(false)}>
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={onCreate} disabled={submitting || !newTitle.trim() || !selectedProjectId}>
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
  list: { padding: spacing.md, paddingBottom: 60 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  titleDone: {
    textDecorationLine: "line-through",
    textDecorationColor: DONE_COLOR,
    color: DONE_COLOR,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  statusChip: { backgroundColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 8 },
  statusChipDone: { backgroundColor: DONE_COLOR },
  statusChipText: { fontSize: 12, color: colors.text },
  statusChipTextDone: { color: "#fff", fontWeight: "600" },
  metaText: { fontSize: 13, color: colors.textMuted },
  emptyText: { fontSize: 16, color: colors.textMuted },
  refreshBtn: { marginTop: spacing.md },
  refreshBtnText: { color: colors.primary, fontWeight: "600" },
  fab: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    zIndex: 1,
  },
  fabText: { color: "#fff", fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  projectList: { maxHeight: 120, marginBottom: spacing.lg },
  projectOpt: { padding: spacing.sm, borderRadius: radius },
  projectOptActive: { backgroundColor: colors.primary },
  projectOptText: { color: colors.text, fontSize: 14 },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md },
  modalCancel: { padding: spacing.sm },
  modalCancelText: { color: colors.textMuted },
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius },
  modalOkText: { color: "#fff", fontWeight: "600" },
});
