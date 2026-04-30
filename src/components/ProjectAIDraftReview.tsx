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
  /** `${phaseId}:${taskId}` when refining task; phaseId only when refining phase */
  refiningKey: string | null;
  onRefinePhase: (phaseId: string, phaseIndex: number) => void;
  onRefineTask: (phaseId: string, taskId: string, phaseIndex: number, taskIndex: number) => void;
  onEditPhase: (phaseId: string) => void;
  onEditTask: (phaseId: string, taskId: string) => void;
  onDeletePhase: (phaseId: string) => void;
  onDeleteTask: (phaseId: string, taskId: string) => void;
  onAddTask: (phaseId: string) => void;
};

export function ProjectAIDraftReview({
  draft,
  editedTitle,
  onChangeTitle,
  editedProjectNumber,
  onChangeProjectNumber,
  refiningKey,
  onRefinePhase,
  onRefineTask,
  onEditPhase,
  onEditTask,
  onDeletePhase,
  onDeleteTask,
  onAddTask,
}: ProjectAIDraftReviewProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const defaultExpanded = useMemo(() => {
    const m: Record<string, boolean> = {};
    draft.phases.forEach((p) => {
      m[p.id] = true;
    });
    return m;
  }, [draft.phases]);

  const isOpen = (id: string) => (expanded[id] !== undefined ? expanded[id] : defaultExpanded[id]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [id]: !isOpen(id) }));
  };

  const summaryLine = draft.summary?.trim();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.hintCard}>
        <Ionicons name="finger-print-outline" size={18} color={colors.primary} />
        <Text style={styles.hintCardText} numberOfLines={2}>
          {t("createProject.aiDraft.tapPhaseTaskHint")}
        </Text>
      </View>

      <View style={styles.headerCard}>
        <View style={styles.headerFieldFlexLarge}>
          <Text style={styles.fieldLabel}>{t("createProject.aiDraft.projectNameLabel")}</Text>
          <TextInput
            style={styles.titleInput}
            value={editedTitle}
            onChangeText={onChangeTitle}
            placeholderTextColor={colors.inputPlaceholderOnLight}
          />
        </View>
        <View style={styles.headerFieldFlexSmall}>
          <Text style={styles.fieldLabel}>{t("createProject.aiDraft.projectNumberLabel")}</Text>
          <TextInput
            style={styles.titleInput}
            value={editedProjectNumber}
            onChangeText={onChangeProjectNumber}
            placeholder={t("createProject.aiDraft.projectNumberPlaceholder")}
            placeholderTextColor={colors.inputPlaceholderOnLight}
            autoCapitalize="characters"
          />
        </View>
      </View>

      {summaryLine ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryBody} numberOfLines={3}>
            {summaryLine}
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionHeading}>{t("createProject.aiDraft.phasesHeading")}</Text>

      {draft.phases.map((phase, pi) => {
        const open = isOpen(phase.id);
        const refiningPhase = refiningKey === phase.id;

        return (
          <View key={phase.id} style={styles.phaseCard}>
            <View style={styles.phaseHeaderRow}>
              <Pressable
                style={({ pressed }) => [styles.phaseTapArea, pressed && styles.phaseTapPressed]}
                onPress={() => onRefinePhase(phase.id, pi)}
                disabled={!!refiningKey}
                accessibilityRole="button"
                accessibilityHint={t("createProject.aiDraft.refine")}
              >
                <Text style={styles.phaseTitle} numberOfLines={4}>
                  {phase.name}
                </Text>
                {phase.description?.trim() ? (
                  <Text style={styles.phaseDesc} numberOfLines={open ? 8 : 2}>
                    {phase.description.trim()}
                  </Text>
                ) : null}
                <View style={styles.phaseTapFooter}>
                  <Text style={styles.phaseTapCue}>{t("createProject.aiDraft.refine")}</Text>
                  {refiningPhase ? (
                    <Text style={styles.dotBusy}> … </Text>
                  ) : (
                    <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                  )}
                </View>
              </Pressable>
              <TouchableOpacity
                style={styles.phaseChevronBtn}
                onPress={() => toggle(phase.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.text} />
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
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <Pressable
                        style={({ pressed }) => [styles.taskTapArea, pressed && styles.taskTapPressed]}
                        onPress={() => onRefineTask(phase.id, task.id, pi, ti)}
                        disabled={!!refiningKey}
                        accessibilityRole="button"
                      >
                        <Text style={styles.taskTitle} numberOfLines={5}>
                          {task.title}
                        </Text>
                        {task.description?.trim() ? (
                          <Text style={styles.taskDesc} numberOfLines={5}>
                            {task.description.trim()}
                          </Text>
                        ) : null}
                        <View style={styles.taskTapCueRow}>
                          <Text style={styles.taskTapCue}>{t("createProject.aiDraft.refine")}</Text>
                          {busyTask ? <Text style={styles.dotBusy}>…</Text> : null}
                          {!busyTask ? (
                            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                          ) : null}
                        </View>
                      </Pressable>
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
  hintCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(224, 103, 55, 0.35)",
    backgroundColor: "rgba(224, 103, 55, 0.09)",
  },
  hintCardText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    lineHeight: 16,
  },
  headerCard: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerFieldFlexLarge: {
    flex: 2,
    minWidth: 0,
  },
  headerFieldFlexSmall: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  titleInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 14,
    color: colors.text,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
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
  phaseCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    marginBottom: spacing.md,
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
  phaseTapFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: spacing.sm,
  },
  phaseTapCue: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  phaseChevronBtn: {
    justifyContent: "flex-start",
    paddingRight: spacing.md,
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
    borderTopColor: colors.border,
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
    borderColor: colors.border,
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
    borderTopColor: colors.border,
  },
  taskTapArea: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingRight: 4,
    borderRadius: radius - 2,
  },
  taskTapPressed: {
    backgroundColor: "rgba(0,0,0,0.045)",
  },
  taskTapCueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    justifyContent: "flex-start",
  },
  taskTapCue: {
    fontSize: 12,
    fontWeight: "700",
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
