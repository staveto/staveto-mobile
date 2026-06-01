import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { AiProjectDraft } from "../lib/aiProjectDraft";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ProjectAIDraftReviewProps = {
  draft: AiProjectDraft;
  editedTitle: string;
  onChangeTitle: (title: string) => void;
  editedProjectNumber: string;
  onChangeProjectNumber: (value: string) => void;
  /** Override default project name field label (archetype-specific). */
  projectNameLabel?: string;
  /** Override default reference number field label (archetype-specific). */
  projectNumberLabel?: string;
  /** `${phaseId}:${taskId}` when refining task; phaseId only when refining phase */
  refiningKey: string | null;
  onRefinePhase: (phaseId: string, phaseIndex: number) => void;
  onRefineTask: (phaseId: string, taskId: string, phaseIndex: number, taskIndex: number) => void;
  onEditPhase: (phaseId: string) => void;
  onEditTask: (phaseId: string, taskId: string) => void;
  onDeletePhase: (phaseId: string) => void;
  onDeleteTask: (phaseId: string, taskId: string) => void;
  onAddTask: (phaseId: string) => void;
  onToggleMaterialSuggestion?: (materialId: string) => void;
};

export function ProjectAIDraftReview({
  draft,
  editedTitle,
  onChangeTitle,
  editedProjectNumber,
  onChangeProjectNumber,
  projectNameLabel,
  projectNumberLabel,
  refiningKey,
  onRefinePhase,
  onRefineTask,
  onEditPhase,
  onEditTask,
  onDeletePhase,
  onDeleteTask,
  onAddTask,
  onToggleMaterialSuggestion,
}: ProjectAIDraftReviewProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const phaseCount = draft.phases.length;
  const taskCount = useMemo(
    () => draft.phases.reduce((sum, p) => sum + p.tasks.length, 0),
    [draft.phases]
  );
  const collapsePhasesByDefault = phaseCount > 1;

  const defaultExpanded = useMemo(() => {
    const m: Record<string, boolean> = {};
    draft.phases.forEach((p) => {
      m[p.id] = !collapsePhasesByDefault;
    });
    return m;
  }, [collapsePhasesByDefault, draft.phases]);

  const isOpen = (id: string) => (expanded[id] !== undefined ? expanded[id] : defaultExpanded[id]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [id]: !isOpen(id) }));
  };

  const summaryLine = draft.summary?.trim();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.topInfoCard}>
        <Text style={styles.topInfoTitle}>
          {t("createProject.aiDraft.structureSummary", {
            phaseCount: String(phaseCount),
            taskCount: String(taskCount),
          })}
        </Text>
        <Text style={styles.topInfoHint}>{t("createProject.aiDraft.tapPhaseTaskHint")}</Text>
      </View>

      <View style={styles.headerCard}>
        <Text style={styles.fieldLabel}>
          {projectNameLabel ?? t("createProject.aiDraft.projectNameLabel")}
        </Text>
        <TextInput
          style={styles.titleInput}
          value={editedTitle}
          onChangeText={onChangeTitle}
          placeholderTextColor={colors.inputPlaceholderOnLight}
        />
        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
          {projectNumberLabel ?? t("createProject.aiDraft.projectNumberLabel")}
        </Text>
        <TextInput
          style={styles.titleInput}
          value={editedProjectNumber}
          onChangeText={onChangeProjectNumber}
          placeholder={t("createProject.aiDraft.projectNumberPlaceholder")}
          placeholderTextColor={colors.inputPlaceholderOnLight}
          autoCapitalize="characters"
        />
      </View>

      {summaryLine ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryBody}>{summaryLine}</Text>
        </View>
      ) : null}

      {draft.materialSuggestions && draft.materialSuggestions.length > 0 ? (
        <>
          <Text style={styles.sectionHeading}>{t("createProject.aiDraft.materialsHeading")}</Text>
          <Text style={styles.materialsHint}>{t("createProject.aiDraft.materialsHint")}</Text>
          {draft.materialSuggestions.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={styles.materialRow}
              onPress={() => onToggleMaterialSuggestion?.(m.id)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={m.selected ? "checkbox" : "square-outline"}
                size={22}
                color={m.selected ? colors.primary : colors.textMuted}
              />
              <View style={styles.materialRowText}>
                <Text style={styles.materialRowTitle}>{m.name}</Text>
                <Text style={styles.materialRowMeta}>
                  {[m.suggestedQuantity, m.unit, m.currency].filter(Boolean).join(" ")}
                  {m.category ? ` · ${t(`materialCategory.${m.category}`)}` : ""}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <Text style={styles.sectionHeading}>{t("createProject.aiDraft.phasesHeading")}</Text>

      {draft.phases.map((phase, pi) => {
        const open = isOpen(phase.id);
        const refiningPhase = refiningKey === phase.id;
        const phaseTaskCount = phase.tasks.length;
        const phaseTitle = phase.name?.trim() || t("createProject.aiDraft.unnamedPhase");

        return (
          <View key={phase.id} style={styles.phaseCard}>
            <View style={styles.phaseHeaderRow}>
              <Pressable
                style={({ pressed }) => [styles.phaseTapArea, pressed && styles.phaseTapPressed]}
                onPress={() => toggle(phase.id)}
                accessibilityRole="button"
                accessibilityLabel={phaseTitle}
              >
                <Text style={styles.phaseTitle} numberOfLines={open ? 4 : 2}>
                  {phaseTitle}
                </Text>
                {!open ? (
                  <Text style={styles.phaseMeta}>
                    {t("createProject.aiDraft.phaseTaskCount", { count: String(phaseTaskCount) })}
                  </Text>
                ) : phase.description?.trim() ? (
                  <Text style={styles.phaseDesc} numberOfLines={6}>
                    {phase.description.trim()}
                  </Text>
                ) : null}
              </Pressable>
              <TouchableOpacity
                style={styles.phaseIconBtn}
                onPress={() => onRefinePhase(phase.id, pi)}
                disabled={!!refiningKey}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.aiDraft.refine")}
              >
                {refiningPhase ? (
                  <Text style={styles.dotBusy}>…</Text>
                ) : (
                  <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.phaseIconBtn}
                onPress={() => toggle(phase.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {open ? (
              <View style={styles.phaseBody}>
                <View style={styles.phaseActions}>
                  <TouchableOpacity style={styles.actionChip} onPress={() => onEditPhase(phase.id)}>
                    <Ionicons name="create-outline" size={18} color={colors.text} />
                    <Text style={styles.actionChipText}>{t("createProject.aiDraft.edit")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionChip} onPress={() => onDeletePhase(phase.id)}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                    <Text style={[styles.actionChipText, { color: colors.error }]}>
                      {t("createProject.aiDraft.delete")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {phase.tasks.map((task, ti) => {
                  const rk = `${phase.id}:${task.id}`;
                  const busyTask = refiningKey === rk;
                  const taskTitle = task.title?.trim() || t("createProject.aiDraft.unnamedTask");
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <View style={styles.taskTapArea}>
                        <Text style={styles.taskTitle} numberOfLines={3}>
                          {taskTitle}
                        </Text>
                        {task.description?.trim() ? (
                          <Text style={styles.taskDesc} numberOfLines={3}>
                            {task.description.trim()}
                          </Text>
                        ) : null}
                        <TouchableOpacity
                          style={styles.taskRefineBtn}
                          onPress={() => onRefineTask(phase.id, task.id, pi, ti)}
                          disabled={!!refiningKey}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          {busyTask ? (
                            <Text style={styles.dotBusy}>…</Text>
                          ) : (
                            <>
                              <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                              <Text style={styles.taskRefineLabel}>{t("createProject.aiDraft.refine")}</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                      <View style={styles.taskSideActions}>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => onEditTask(phase.id, task.id)}
                          accessibilityLabel={t("createProject.aiDraft.edit")}
                        >
                          <Ionicons name="create-outline" size={20} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.iconBtn}
                          onPress={() => onDeleteTask(phase.id, task.id)}
                          accessibilityLabel={t("createProject.aiDraft.delete")}
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.error} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                <TouchableOpacity style={styles.addTaskBtn} onPress={() => onAddTask(phase.id)}>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                  <Text style={styles.addTaskText}>{t("createProject.aiDraft.addTask")}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.md },
  topInfoCard: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: colors.formPanel,
  },
  topInfoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 21,
    marginBottom: 4,
  },
  topInfoHint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  headerCard: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  fieldLabelSpaced: {
    marginTop: spacing.sm,
  },
  titleInput: {
    backgroundColor: "#fff",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 14,
    color: colors.text,
  },
  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    marginBottom: spacing.sm,
  },
  summaryBody: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  materialsHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  materialRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: "#fff",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  materialRowText: { flex: 1 },
  materialRowTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  materialRowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  phaseCard: {
    backgroundColor: "#fff",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  phaseHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  phaseTapArea: {
    flex: 1,
    minWidth: 0,
    paddingLeft: spacing.md,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
  },
  phaseTapPressed: {
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  phaseMeta: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  phaseIconBtn: {
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
  },
  phaseTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  phaseDesc: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
    opacity: 0.92,
  },
  phaseBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.formPanelBorder,
  },
  phaseActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: "#fff",
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.formPanelBorder,
  },
  taskTapArea: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingRight: 4,
    borderRadius: radius - 2,
  },
  taskRefineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  taskRefineLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
  },
  taskSideActions: {
    justifyContent: "center",
    gap: 2,
    paddingLeft: 4,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
    lineHeight: 20,
  },
  taskDesc: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
    opacity: 0.9,
  },
  iconBtn: {
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  dotBusy: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  addTaskText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
});
