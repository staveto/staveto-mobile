import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme";
import type { ProjectDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";
import { formatPhaseNameForWorker } from "../lib/formatPhaseNameForWorker";
import {
  filterTasksBySearch,
  getRecommendedWorkPhotoTasks,
  groupWorkPhotoTasksByPhase,
  isWorkPhotoTaskDone,
  workPhotoStatusLabel,
  workPhotoTaskStatusKind,
  type WorkPhotoFlowSelection,
} from "../lib/workPhotoTaskPicker";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";
const CARD_BG = "rgba(255,255,255,0.08)";
const CARD_BORDER = "rgba(255,255,255,0.14)";

type SheetStep = "context" | "tasks";

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  project: ProjectDoc | null;
  tasks: TaskDoc[];
  loading?: boolean;
  userId?: string | null;
  activeTimerTaskId?: string | null;
  onSelect: (selection: WorkPhotoFlowSelection) => void;
  onDocumentProblem: () => void;
  t: (key: string, params?: Record<string, string>) => string;
};

function formatDueHint(dueDate: string | undefined, t: (key: string) => string): string | null {
  if (!dueDate?.trim()) return null;
  return dueDate.trim();
}

function TaskRow({
  task,
  t,
  onPress,
  muted = false,
}: {
  task: TaskDoc;
  t: Props["t"];
  onPress: () => void;
  muted?: boolean;
}) {
  const statusLabel = workPhotoStatusLabel(task.status, t);
  const phaseHint = formatPhaseNameForWorker(task.phaseTitle ?? task.phaseId, t);
  const dueHint = formatDueHint(task.dueDate, t);
  const statusKind = workPhotoTaskStatusKind(task.status);

  return (
    <TouchableOpacity style={[styles.taskRow, muted && styles.taskRowMuted]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.taskRowBody}>
        <Text style={[styles.taskTitle, muted && styles.taskTitleMuted]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.taskMetaRow}>
          <View style={[styles.statusBadge, statusKind === "done" && styles.statusBadgeDone, statusKind === "blocked" && styles.statusBadgeBlocked]}>
            <Text style={styles.statusBadgeText}>{statusLabel}</Text>
          </View>
          {phaseHint ? <Text style={styles.taskMetaText} numberOfLines={1}>{phaseHint}</Text> : null}
          {dueHint ? <Text style={styles.taskMetaText}>{dueHint}</Text> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={muted ? "rgba(255,255,255,0.35)" : SHEET_ACTION} />
    </TouchableOpacity>
  );
}

/** Context + task picker for work photos (dark bottom sheet). */
export function QuickWorkPhotoTaskSheet({
  sheetRef,
  project,
  tasks,
  loading = false,
  userId,
  activeTimerTaskId,
  onSelect,
  onDocumentProblem,
  t,
}: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<SheetStep>("context");
  const [search, setSearch] = useState("");
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const snapPoints = useMemo(() => ["55%", "88%"], []);
  const scrollBottomPad = Math.max(insets.bottom, 20) + spacing.xl;

  const resetSheet = useCallback(() => {
    setStep("context");
    setSearch("");
    setCompletedExpanded(false);
  }, []);

  const dismissAnd = useCallback(
    (selection: WorkPhotoFlowSelection) => {
      sheetRef.current?.dismiss();
      resetSheet();
      onSelect(selection);
    },
    [onSelect, resetSheet, sheetRef]
  );

  const pickTask = useCallback(
    (task: TaskDoc) => {
      dismissAnd({
        kind: "task",
        taskId: task.id,
        phaseId: task.phaseId ?? null,
      });
    },
    [dismissAnd]
  );

  const filteredTasks = useMemo(() => filterTasksBySearch(tasks, search), [tasks, search]);
  const openTasks = useMemo(() => filteredTasks.filter((task) => !isWorkPhotoTaskDone(task)), [filteredTasks]);
  const doneTasks = useMemo(() => filteredTasks.filter((task) => isWorkPhotoTaskDone(task)), [filteredTasks]);

  const recommended = useMemo(
    () =>
      getRecommendedWorkPhotoTasks(tasks, {
        userId,
        activeTimerTaskId,
        limit: 5,
      }).filter((task) => !search.trim() || filterTasksBySearch([task], search).length > 0),
    [tasks, userId, activeTimerTaskId, search]
  );

  const recommendedIds = useMemo(() => new Set(recommended.map((task) => task.id)), [recommended]);

  const openGroups = useMemo(() => {
    const rest = openTasks.filter((task) => !recommendedIds.has(task.id));
    return groupWorkPhotoTasksByPhase(rest, t);
  }, [openTasks, recommendedIds, t]);

  const renderContextStep = () => (
    <>
      <Text style={styles.title}>{t("workPhoto.belongsToTitle")}</Text>
      {project?.name ? (
        <Text style={styles.projectName} numberOfLines={2}>
          {project.name}
        </Text>
      ) : null}

      <TouchableOpacity
        style={styles.optionCard}
        onPress={() => dismissAnd({ kind: "general" })}
        activeOpacity={0.85}
      >
        <View style={[styles.optionIcon, { backgroundColor: "rgba(139,92,246,0.25)" }]}>
          <Ionicons name="image-outline" size={26} color="#c4b5fd" />
        </View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>{t("workPhoto.generalProjectPhoto")}</Text>
          <Text style={styles.optionDesc}>{t("workPhoto.generalProjectPhotoDesc")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={SHEET_ACTION} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.optionCard}
        onPress={() => setStep("tasks")}
        activeOpacity={0.85}
      >
        <View style={[styles.optionIcon, { backgroundColor: "rgba(59,130,246,0.25)" }]}>
          <Ionicons name="checkbox-outline" size={26} color="#93c5fd" />
        </View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>{t("workPhoto.selectTaskTitle")}</Text>
          <Text style={styles.optionDesc}>{t("workPhoto.selectTaskDesc")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={SHEET_ACTION} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.optionCard}
        onPress={() => {
          sheetRef.current?.dismiss();
          resetSheet();
          onDocumentProblem();
        }}
        activeOpacity={0.85}
      >
        <View style={[styles.optionIcon, { backgroundColor: "rgba(239,68,68,0.22)" }]}>
          <Ionicons name="warning-outline" size={26} color="#fca5a5" />
        </View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>{t("home.reportProblem")}</Text>
          <Text style={styles.optionDesc}>{t("workPhoto.documentProblemDesc")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={SHEET_ACTION} />
      </TouchableOpacity>
    </>
  );

  const renderTaskPicker = () => (
    <>
      <TouchableOpacity style={styles.backBtn} onPress={() => setStep("context")}>
        <Ionicons name="chevron-back" size={20} color={SHEET_ACTION} />
        <Text style={styles.backBtnText}>{t("common.back")}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t("workPhoto.selectTaskTitle")}</Text>
      {project?.name ? (
        <Text style={styles.projectName} numberOfLines={2}>
          {project.name}
        </Text>
      ) : null}

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder={t("workPhoto.searchTask")}
        placeholderTextColor="rgba(255,255,255,0.4)"
      />

      <ScrollView
        style={styles.list}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <TouchableOpacity
          style={styles.shortcutRow}
          onPress={() => dismissAnd({ kind: "general" })}
          activeOpacity={0.7}
        >
          <Ionicons name="images-outline" size={20} color={SHEET_ACTION} style={styles.shortcutIcon} />
          <Text style={styles.shortcutText}>{t("workPhoto.generalProjectPhoto")}</Text>
          <Ionicons name="chevron-forward" size={18} color={SHEET_ACTION} />
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={SHEET_ACTION} style={styles.loader} />
        ) : (
          <>
            {recommended.length > 0 && !search.trim() ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t("workPhoto.recommendedTasks")}</Text>
                {recommended.map((task) => (
                  <TaskRow key={`rec-${task.id}`} task={task} t={t} onPress={() => pickTask(task)} />
                ))}
              </View>
            ) : null}

            {openGroups.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t("workPhoto.moreTasks")}</Text>
                {openGroups.map((group) => (
                  <View key={group.phaseKey}>
                    <Text style={styles.phaseLabel}>{group.phaseLabel}</Text>
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} t={t} onPress={() => pickTask(task)} />
                    ))}
                  </View>
                ))}
              </View>
            ) : null}

            {!loading && openTasks.length === 0 && doneTasks.length === 0 ? (
              <Text style={styles.emptyText}>{t("workPhoto.noTasksFound")}</Text>
            ) : null}

            {doneTasks.length > 0 ? (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.collapsedHeader}
                  onPress={() => setCompletedExpanded((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionLabelMuted}>
                    {t("workPhoto.completedTasks")} ({doneTasks.length})
                  </Text>
                  <Ionicons
                    name={completedExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="rgba(255,255,255,0.5)"
                  />
                </TouchableOpacity>
                {completedExpanded
                  ? doneTasks.map((task) => (
                      <TaskRow key={task.id} task={task} t={t} onPress={() => pickTask(task)} muted />
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      bottomInset={insets.bottom}
      onDismiss={resetSheet}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      )}
      backgroundStyle={{ backgroundColor: SHEET_BG }}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPad }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === "context" ? renderContextStep() : renderTaskPicker()}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: SHEET_TEXT,
    marginBottom: spacing.xs,
  },
  projectName: {
    fontSize: 13,
    color: "rgba(255,255,255,0.55)",
    marginBottom: spacing.md,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: SHEET_TEXT,
    marginBottom: 4,
  },
  optionDesc: {
    fontSize: 13,
    color: "rgba(255,255,255,0.65)",
    lineHeight: 18,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
  },
  backBtnText: {
    color: SHEET_ACTION,
    fontSize: 15,
    marginLeft: 2,
  },
  searchInput: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    color: SHEET_TEXT,
    marginBottom: spacing.md,
  },
  list: {
    maxHeight: 420,
  },
  shortcutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  shortcutIcon: {
    marginRight: spacing.sm,
  },
  shortcutText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: SHEET_TEXT,
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: SHEET_ACTION,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  sectionLabelMuted: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
  },
  phaseLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.72)",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  taskRowMuted: {
    opacity: 0.72,
  },
  taskRowBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: SHEET_TEXT,
  },
  taskTitleMuted: {
    color: "rgba(255,255,255,0.75)",
  },
  taskMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  statusBadge: {
    backgroundColor: "rgba(59,130,246,0.35)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeDone: {
    backgroundColor: "rgba(107,114,128,0.45)",
  },
  statusBadgeBlocked: {
    backgroundColor: "rgba(239,68,68,0.35)",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: SHEET_TEXT,
  },
  taskMetaText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
  },
  collapsedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loader: {
    marginVertical: spacing.lg,
  },
  emptyText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    padding: spacing.lg,
    textAlign: "center",
  },
});

export type { WorkPhotoFlowSelection };
