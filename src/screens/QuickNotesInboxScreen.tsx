import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
  Pressable,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import * as quickNotesService from "../services/quickNotes";
import type { QuickNote, QuickNoteAttachment } from "../services/quickNotes";
import type { ProjectDoc } from "../services/projects";
import * as dashboardService from "../services/dashboard";
import { QuickNoteModal } from "../components/QuickNoteModal";
import { getCurrentPositionSafe } from "../lib/location";
import { showToast } from "../helpers/toast";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateYmd(ymd: string): string {
  const today = new Date().toISOString().split("T")[0];
  if (ymd === today) return "Dnes";
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (ymd === yesterday) return "Včera";
  try {
    const [y, m, d] = ymd.split("-");
    return `${d}.${m}.${y}`;
  } catch {
    return ymd;
  }
}

type InboxTab = "pending" | "processed" | "archived";

type PickerIntent = "assign" | "task" | "diary" | "problem";

function navigateInTree(nav: { getParent?: () => unknown; navigate?: (n: string, p?: object) => void }, routeName: string, params?: object) {
  let cur: unknown = nav;
  for (let i = 0; i < 10 && cur && typeof cur === "object"; i++) {
    const n = cur as { getState?: () => { routeNames?: string[] }; navigate?: (name: string, p?: object) => void };
    const names = n.getState?.()?.routeNames;
    if (names?.includes(routeName)) {
      n.navigate?.(routeName, params);
      return;
    }
    cur = (cur as { getParent?: () => unknown }).getParent?.();
  }
  (nav as { navigate?: (name: string, p?: object) => void }).navigate?.(routeName, params);
}

export function QuickNotesInboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [tab, setTab] = useState<InboxTab>("pending");
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [picker, setPicker] = useState<{ note: QuickNote; intent: PickerIntent } | null>(null);
  const [actionNote, setActionNote] = useState<QuickNote | null>(null);

  const loadProjects = useCallback(async () => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    try {
      const data = await dashboardService.loadDashboardData(orgId, { forceServerRead: false });
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, [orgId]);

  const loadNotes = useCallback(
    async (isRefresh = false) => {
      if (!user?.id) {
        setNotes([]);
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const all = await quickNotesService.listQuickNotes(user.id);
        let list: QuickNote[] = [];
        if (tab === "pending") list = all.filter((n) => n.status === "open").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        else if (tab === "processed") list = all.filter((n) => n.status === "processed").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        else list = all.filter((n) => n.status === "archived").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setNotes(list);
      } catch (e) {
        if (__DEV__) console.warn("[QuickNotesInbox] load failed:", e);
        setNotes([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id, tab]
  );

  useFocusEffect(
    useCallback(() => {
      void loadProjects();
      void loadNotes(false);
    }, [loadNotes, loadProjects])
  );

  useEffect(() => {
    if (!user?.id) return;
    void loadNotes(false);
  }, [tab, user?.id, loadNotes]);

  const onRefresh = useCallback(() => {
    void loadProjects();
    void loadNotes(true);
  }, [loadNotes, loadProjects]);

  const handleDelete = useCallback(
    (note: QuickNote) => {
      Alert.alert(
        t("common.delete"),
        t("quickNotes.confirmDelete"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
              if (!user?.id) return;
              await quickNotesService.deleteQuickNote(user.id, note.id);
              setNotes((prev) => prev.filter((n) => n.id !== note.id));
            },
          },
        ]
      );
    },
    [user?.id, t]
  );

  const handleAddNote = useCallback(
    async (text: string, attachments?: QuickNoteAttachment[]) => {
      if (!user?.id) return;
      let latitude: number | null = null;
      let longitude: number | null = null;
      try {
        const pos = await getCurrentPositionSafe();
        if (pos) {
          latitude = pos.lat;
          longitude = pos.lng;
        }
      } catch {
        /* ignore */
      }
      await quickNotesService.addQuickNote(user.id, text, attachments, {
        sourceScreen: "inbox",
        createdByUserId: user.id,
        latitude,
        longitude,
      });
      await loadNotes(true);
    },
    [user?.id, loadNotes]
  );

  const effectiveProjectLabel = useCallback(
    (note: QuickNote) => {
      if (note.sourceProjectId && note.sourceProjectName) return note.sourceProjectName;
      if (note.sourceProjectId) return note.sourceProjectId;
      return null;
    },
    []
  );

  const openProjectPicker = useCallback((note: QuickNote, intent: PickerIntent) => {
    setProjectSearch("");
    setPicker({ note, intent });
  }, []);

  const onPickProject = useCallback(
    async (project: ProjectDoc) => {
      if (!user?.id || !picker) return;
      const { note, intent } = picker;
      try {
        await quickNotesService.assignQuickNoteToProject(user.id, note.id, project.id, project.name ?? null);
      } catch {
        showToast(t("common.error"));
        return;
      }
      setPicker(null);
      await loadNotes(true);
      if (intent === "assign") {
        showToast(t("quickNotes.assignedOk"));
        return;
      }
      const name = project.name ?? "";
      const ptype = project.projectType ?? "BUILD";
      if (intent === "task") {
        (navigation as { navigate: (n: string, p: object) => void }).navigate("ProjectOverview", {
          projectId: project.id,
          projectName: name,
          openNewTask: true,
          initialNewTaskTitle: note.text.trim().slice(0, 500),
          processQuickNoteId: note.id,
        });
      } else if (intent === "diary") {
        (navigation as { navigate: (n: string, p: object) => void }).navigate("ProjectOverview", {
          projectId: project.id,
          projectName: name,
          openDiaryModal: true,
          diaryInputMode: "text",
          initialDiaryWorkDescription: note.text.trim(),
          processQuickNoteId: note.id,
        });
      } else if (intent === "problem") {
        navigateInTree(navigation as never, "CreateProblem", {
          projectId: project.id,
          projectName: name,
          projectType: ptype,
          initialDescription: note.text.trim(),
          processQuickNoteId: note.id,
        });
      }
    },
    [user?.id, picker, loadNotes, navigation, t]
  );

  const startConversion = useCallback(
    (note: QuickNote, intent: "task" | "diary" | "problem") => {
      if (!note.sourceProjectId) {
        openProjectPicker(note, intent);
        return;
      }
      const p = projects.find((x) => x.id === note.sourceProjectId);
      const name = note.sourceProjectName ?? p?.name ?? "";
      const ptype = p?.projectType ?? "BUILD";
      if (intent === "task") {
        (navigation as { navigate: (n: string, p: object) => void }).navigate("ProjectOverview", {
          projectId: note.sourceProjectId,
          projectName: name,
          openNewTask: true,
          initialNewTaskTitle: note.text.trim().slice(0, 500),
          processQuickNoteId: note.id,
        });
      } else if (intent === "diary") {
        (navigation as { navigate: (n: string, p: object) => void }).navigate("ProjectOverview", {
          projectId: note.sourceProjectId,
          projectName: name,
          openDiaryModal: true,
          diaryInputMode: "text",
          initialDiaryWorkDescription: note.text.trim(),
          processQuickNoteId: note.id,
        });
      } else {
        navigateInTree(navigation as never, "CreateProblem", {
          projectId: note.sourceProjectId,
          projectName: name,
          projectType: ptype,
          initialDescription: note.text.trim(),
          processQuickNoteId: note.id,
        });
      }
    },
    [navigation, projects, openProjectPicker]
  );

  const markDone = useCallback(
    async (note: QuickNote) => {
      if (!user?.id) return;
      await quickNotesService.markQuickNoteProcessed(user.id, note.id);
      await loadNotes(true);
      showToast(t("quickNotes.markedDoneOk"));
    },
    [user?.id, loadNotes, t]
  );

  const markArchived = useCallback(
    async (note: QuickNote) => {
      if (!user?.id) return;
      await quickNotesService.markQuickNoteArchived(user.id, note.id);
      await loadNotes(true);
    },
    [user?.id, loadNotes]
  );

  const reopen = useCallback(
    async (note: QuickNote) => {
      if (!user?.id) return;
      await quickNotesService.reopenQuickNote(user.id, note.id);
      setTab("pending");
      await loadNotes(true);
    },
    [user?.id, loadNotes]
  );

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const openProcessMenu = useCallback((note: QuickNote) => {
    setActionNote(note);
  }, []);

  const closeProcessMenu = useCallback(() => setActionNote(null), []);

  const renderItem = useCallback(
    ({ item }: { item: QuickNote }) => {
      const projLabel = effectiveProjectLabel(item);
      const hint =
        !item.sourceProjectId && item.suggestedProjectName
          ? t("quickNotes.hintSuggestedProject", { name: item.suggestedProjectName })
          : null;
      const hasLoc = item.latitude != null && item.longitude != null;

      return (
        <View style={styles.noteCard}>
          <View style={styles.noteTopRow}>
            <View style={styles.noteContent}>
              {item.attachments && item.attachments.length > 0 && (
                <View style={styles.noteThumbs}>
                  {item.attachments.map((a, i) =>
                    a.kind === "image" ? (
                      <Image key={`${a.uri}-${i}`} source={{ uri: a.uri }} style={styles.noteThumb} />
                    ) : (
                      <View key={`${a.uri}-${i}`} style={[styles.noteThumb, styles.noteThumbVideo]}>
                        <Ionicons name="videocam" size={22} color="#fff" />
                      </View>
                    )
                  )}
                </View>
              )}
              <Text style={styles.noteText}>
                {item.text.trim()
                  ? item.text
                  : item.attachments?.length
                    ? t("quickNotes.mediaOnly")
                    : ""}
              </Text>
              <Text style={styles.noteMeta}>
                {formatDateYmd(item.dateYmd)} • {formatTime(item.createdAt)}
              </Text>
              <View style={styles.chipRow}>
                <View style={[styles.chip, projLabel ? styles.chipProject : styles.chipMuted]}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {projLabel ?? t("quickNotes.noProject")}
                  </Text>
                </View>
                {hasLoc ? (
                  <View style={styles.chipLoc}>
                    <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.chipLocText}>{t("quickNotes.locationSaved")}</Text>
                  </View>
                ) : null}
              </View>
              {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
            </View>
          </View>
          {tab === "pending" ? (
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => openProcessMenu(item)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>{t("quickNotes.process")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconGhost}
                onPress={() => handleDelete(item)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel={t("common.delete")}
              >
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => reopen(item)}>
                <Text style={styles.secondaryBtnText}>{t("quickNotes.reopen")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconGhost}
                onPress={() => handleDelete(item)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    },
    [effectiveProjectLabel, handleDelete, openProcessMenu, t, tab, reopen]
  );

  const ListEmpty = (
    <View style={styles.empty}>
      <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>
        {tab === "pending"
          ? t("quickNotes.emptyPending")
          : tab === "processed"
            ? t("quickNotes.emptyProcessed")
            : t("quickNotes.emptyArchived")}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.title}>{t("quickNotes.inboxScreenTitle")}</Text>
          <Text style={styles.subtitle}>{t("quickNotes.inboxSubtitle")}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === "pending" && styles.tabBtnActive]} onPress={() => setTab("pending")}>
          <Text style={[styles.tabText, tab === "pending" && styles.tabTextActive]}>{t("quickNotes.tabPending")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === "processed" && styles.tabBtnActive]} onPress={() => setTab("processed")}>
          <Text style={[styles.tabText, tab === "processed" && styles.tabTextActive]}>{t("quickNotes.tabProcessed")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === "archived" && styles.tabBtnActive]} onPress={() => setTab("archived")}>
          <Text style={[styles.tabText, tab === "archived" && styles.tabTextActive]}>{t("quickNotes.tabArchived")}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={notes.length === 0 ? styles.listEmpty : styles.list}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        />
      )}

      <QuickNoteModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={() => {}}
        onSubmit={handleAddNote}
        placeholder={t("quickNotes.placeholder")}
        saveLabel={t("quickNotes.save")}
      />

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setPicker(null)}>
          <Pressable style={[styles.pickerSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.pickerTitle}>{t("home.selectProjectModal")}</Text>
            <TextInput
              style={styles.pickerSearch}
              value={projectSearch}
              onChangeText={setProjectSearch}
              placeholder={t("time.searchProject")}
              placeholderTextColor={colors.textMuted}
            />
            <FlatList
              data={filteredProjects}
              keyExtractor={(p) => p.id}
              style={styles.pickerList}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.pickerEmpty}>{orgId ? t("time.noProjectsMatch") : t("common.error")}</Text>
              }
              renderItem={({ item: p }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => void onPickProject(p)}>
                  <Text style={styles.pickerRowText} numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setPicker(null)}>
              <Text style={styles.pickerCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!actionNote} transparent animationType="slide" onRequestClose={closeProcessMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeProcessMenu}>
          <Pressable style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.menuTitle}>{t("quickNotes.processSheetTitle")}</Text>
            {actionNote ? (
              <Text style={styles.menuPreview} numberOfLines={3}>
                {actionNote.text.trim() || t("quickNotes.mediaOnly")}
              </Text>
            ) : null}
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) openProjectPicker(n, "assign");
              }}
            >
              <Ionicons name="folder-open-outline" size={22} color={colors.primary} />
              <Text style={styles.menuRowText}>{t("quickNotes.assignProject")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) startConversion(n, "task");
              }}
            >
              <Ionicons name="checkbox-outline" size={22} color={colors.primary} />
              <Text style={styles.menuRowText}>{t("quickNotes.createTask")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) startConversion(n, "diary");
              }}
            >
              <Ionicons name="book-outline" size={22} color={colors.primary} />
              <Text style={styles.menuRowText}>{t("quickNotes.addDiary")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) startConversion(n, "problem");
              }}
            >
              <Ionicons name="warning-outline" size={22} color={colors.primary} />
              <Text style={styles.menuRowText}>{t("quickNotes.reportProblem")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) void markDone(n);
              }}
            >
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
              <Text style={styles.menuRowText}>{t("quickNotes.markDone")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) void markArchived(n);
              }}
            >
              <Ionicons name="archive-outline" size={22} color={colors.textMuted} />
              <Text style={styles.menuRowText}>{t("quickNotes.archive")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowDanger]}
              onPress={() => {
                const n = actionNote;
                closeProcessMenu();
                if (n) handleDelete(n);
              }}
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.menuRowText, styles.menuRowDangerText]}>{t("common.delete")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCloseBtn} onPress={closeProcessMenu}>
              <Text style={styles.menuCloseText}>{t("common.close")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.sm,
  },
  headerTitles: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textOnDark,
    opacity: 0.85,
    marginTop: 2,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    color: colors.textOnDark,
    opacity: 0.9,
  },
  tabTextActive: {
    color: "#fff",
    fontWeight: "600",
    opacity: 1,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  listEmpty: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  noteCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteTopRow: {
    flexDirection: "row",
  },
  noteContent: {
    flex: 1,
  },
  noteThumbs: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  noteThumb: {
    width: 56,
    height: 56,
    borderRadius: radius,
    backgroundColor: colors.border,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  noteThumbVideo: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  noteText: {
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  noteMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    alignItems: "center",
  },
  chip: {
    maxWidth: "100%",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipProject: {
    borderColor: colors.primary,
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  chipMuted: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
  },
  chipLoc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chipLocText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  hintText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  iconGhost: {
    padding: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    padding: spacing.lg,
    maxHeight: "72%",
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerSearch: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.sm,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerList: {
    maxHeight: 320,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerRowText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    marginRight: spacing.sm,
  },
  pickerEmpty: {
    padding: spacing.lg,
    color: colors.textMuted,
    textAlign: "center",
  },
  pickerCancel: {
    marginTop: spacing.md,
    alignItems: "center",
    padding: spacing.sm,
  },
  pickerCancelText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: "600",
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  menuPreview: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuRowDanger: {
    borderBottomWidth: 0,
  },
  menuRowText: {
    fontSize: 16,
    color: colors.text,
    flex: 1,
  },
  menuRowDangerText: {
    color: colors.error,
  },
  menuCloseBtn: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  menuCloseText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: "600",
  },
});
