import React, { useMemo, useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
  isToday,
  isBefore,
  parseISO,
} from "date-fns";
import {
  sk,
  enUS,
  de,
  cs,
  es,
  it,
  pl,
  type Locale as DateFnsLocale,
} from "date-fns/locale";
import { useI18n } from "../i18n/I18nContext";
import type { Locale } from "../i18n/translations";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";
import { toYmd, ymdToDate, normalizeDueDateToYmd } from "../utils/date";
import { normalizeStatusValue } from "../helpers/taskStatusMapping";
import * as tasksService from "../services/tasks";
import * as problemsService from "../services/problems";
import type { TaskWithProject } from "../services/tasks";
import type { ProblemWithProject } from "../services/problems";
import { ICON_HIT_SLOP } from "../utils/accessibility";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";

/** Farba podľa typu – legenda pre všetky typy projektov + problémy + overdue + completed */
const COLOR_BY_TYPE: Record<string, string> = {
  MANAGEMENT: "#6b7280",
  RESIDENTIAL: "#8b5cf6",
  TRADE: "#f59e0b",
  BUILD: colors.primary,
  MAINTENANCE: "#60a5fa",
  problem: "#ef4444",
  overdue: "#ef4444",
  completed: "#22c55e",
  /** Spätná kompatibilita */
  COLOR_SERVICE: "#60a5fa",
  COLOR_CONSTRUCTION: colors.primary,
};

const COLOR_SERVICE = COLOR_BY_TYPE.MAINTENANCE;
const COLOR_CONSTRUCTION = COLOR_BY_TYPE.BUILD;

const CALENDAR_PADDING = spacing.md * 2;
const DAY_CELL_SIZE = Math.max(36, Math.floor((Dimensions.get("window").width - CALENDAR_PADDING) / 7));

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  onTaskPress?: (task: TaskWithProject) => void;
  onProblemPress?: (problem: ProblemWithProject) => void;
  onSeeAllForDate?: (dueDateYmd: string) => void;
  /** When changed, triggers a refresh of tasks/problems (e.g. after returning from TaskDetail) */
  refreshTrigger?: number;
};

const LOCALE_MAP: Record<Locale, DateFnsLocale> = {
  en: enUS,
  sk,
  de,
  cs,
  es,
  it,
  pl,
};

/** Skratky dní v týždni (Po–Ne) podľa jazyka */
const WEEKDAYS_BY_LOCALE: Record<Locale, string[]> = {
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  sk: ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  cs: ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"],
  es: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"],
  it: ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
};

const PROJECT_TYPES = ["MANAGEMENT", "RESIDENTIAL", "TRADE", "BUILD", "MAINTENANCE"] as const;

export function HomeCalendarSheet({ sheetRef, onTaskPress, onProblemPress, onSeeAllForDate, refreshTrigger }: Props) {
  const { t, locale } = useI18n();
  const dateFnsLocale = LOCALE_MAP[locale] ?? enUS;
  const weekdays = WEEKDAYS_BY_LOCALE[locale] ?? WEEKDAYS_BY_LOCALE.en;
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [tasksByYmd, setTasksByYmd] = useState<Map<string, TaskWithProject[]>>(new Map());
  const [problemsByYmd, setProblemsByYmd] = useState<Map<string, ProblemWithProject[]>>(new Map());
  const [loading, setLoading] = useState(false);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const loadTasks = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const start = subMonths(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1), 2);
      const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 2, 0);
      const startYmd = toYmd(start);
      const endYmd = toYmd(end);
      const [tasks, problems] = await Promise.all([
        tasksService.listTasksWithDueDateInRange(user.id, startYmd, endYmd),
        problemsService.listProblemsWithDueDateInRange(user.id, startYmd, endYmd),
      ]);
      const taskMap = new Map<string, TaskWithProject[]>();
      for (const task of tasks) {
        const ymd = task.dueDate?.trim();
        if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        const arr = taskMap.get(ymd) ?? [];
        arr.push(task);
        taskMap.set(ymd, arr);
      }
      const problemMap = new Map<string, ProblemWithProject[]>();
      for (const p of problems) {
        const ymd = normalizeDueDateToYmd(p.dueDate);
        if (!ymd) continue;
        const arr = problemMap.get(ymd) ?? [];
        arr.push(p);
        problemMap.set(ymd, arr);
      }
      setTasksByYmd(taskMap);
      setProblemsByYmd(problemMap);
    } catch (e) {
      console.warn("[HomeCalendarSheet] Failed to load tasks/problems:", e);
      setTasksByYmd(new Map());
      setProblemsByYmd(new Map());
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentMonth, refreshTrigger]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        onPress={() => sheetRef.current?.dismiss()}
      />
    ),
    [sheetRef]
  );

  const selectedYmd = selectedDate ? toYmd(selectedDate) : null;
  const tasksForSelected = selectedYmd ? (tasksByYmd.get(selectedYmd) ?? []) : [];
  const problemsForSelected = selectedYmd ? (problemsByYmd.get(selectedYmd) ?? []) : [];

  const todayYmd = toYmd(new Date());
  const isTaskOverdue = (t: TaskWithProject) =>
    !!t.dueDate && t.dueDate < todayYmd && normalizeStatusValue(t.status) !== "DONE";
  const isTaskCompletedPastDue = (t: TaskWithProject) =>
    !!t.dueDate && t.dueDate < todayYmd && normalizeStatusValue(t.status) === "DONE";
  const getTasksForDay = (day: Date) => tasksByYmd.get(toYmd(day)) ?? [];
  const getProblemsForDay = (day: Date) => problemsByYmd.get(toYmd(day)) ?? [];
  const hasOverdueOnDay = (day: Date) =>
    getTasksForDay(day).some(isTaskOverdue);
  const hasCompletedPastDueOnDay = (day: Date) =>
    getTasksForDay(day).some(isTaskCompletedPastDue);
  const getTaskType = (t: TaskWithProject) =>
    t.projectType === "MAINTENANCE" || !!t.equipmentId || !!t.serviceRuleId ? "MAINTENANCE" : (t.projectType ?? "BUILD");
  const hasTypeOnDay = (day: Date, type: string) => {
    if (type === "problem") return getProblemsForDay(day).length > 0;
    if (type === "overdue") return hasOverdueOnDay(day);
    if (type === "completed") return hasCompletedPastDueOnDay(day);
    return getTasksForDay(day).some((t) => getTaskType(t) === type);
  };
  const legendTypesInMonth = useMemo(
    () =>
      [...PROJECT_TYPES, "problem", "overdue", "completed"].filter((type) =>
        days.some((day) => isSameMonth(day, currentMonth) && hasTypeOnDay(day, type))
      ),
    [days, currentMonth, tasksByYmd, problemsByYmd]
  );

  const handleTaskPress = useCallback(
    (task: TaskWithProject) => {
      sheetRef.current?.dismiss();
      onTaskPress?.(task);
    },
    [sheetRef, onTaskPress]
  );

  const handleProblemPress = useCallback(
    (problem: ProblemWithProject) => {
      sheetRef.current?.dismiss();
      onProblemPress?.(problem);
    },
    [sheetRef, onProblemPress]
  );

  const handleSeeAll = useCallback(() => {
    sheetRef.current?.dismiss();
    if (selectedYmd && onSeeAllForDate) {
      onSeeAllForDate(selectedYmd);
    }
  }, [sheetRef, selectedYmd, onSeeAllForDate]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      enableContentPanningGesture
      snapPoints={["65%", "92%"]}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
      backgroundStyle={styles.sheet}
    >
      <BottomSheetScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.header}>
          <Text style={styles.title} maxFontSizeMultiplier={1.2} numberOfLines={1} accessibilityRole="header">
            {t("home.sectionCalendar")}
          </Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => sheetRef.current?.dismiss()}
            activeOpacity={0.7}
            hitSlop={ICON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
          >
            <Ionicons name="close" size={24} color={SHEET_ACTION} />
          </TouchableOpacity>
        </View>

        <View style={styles.calendarWrap}>
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={() => setCurrentMonth((m) => subMonths(m, 1))}
                style={styles.navBtn}
                activeOpacity={0.7}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={t("home.sectionCalendar")}
              >
                <Ionicons name="chevron-back" size={24} color={SHEET_ACTION} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {format(currentMonth, "LLLL yyyy", { locale: dateFnsLocale })}
              </Text>
              <TouchableOpacity
                onPress={() => setCurrentMonth((m) => addMonths(m, 1))}
                style={styles.navBtn}
                activeOpacity={0.7}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={t("home.sectionCalendar")}
              >
                <Ionicons name="chevron-forward" size={24} color={SHEET_ACTION} />
              </TouchableOpacity>
            </View>
            <View style={styles.weekdayRow}>
              {weekdays.map((d) => (
                <Text key={d} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={styles.daysGrid}>
              {days.map((day) => {
                const inMonth = isSameMonth(day, currentMonth);
                const selected = selectedDate && isSameDay(day, selectedDate);
                const today = isToday(day);
                const hasOverdue = hasOverdueOnDay(day);
                const hasCompleted = hasCompletedPastDueOnDay(day);
                let typesPresent = [...PROJECT_TYPES, "problem", "overdue", "completed"].filter((t) => hasTypeOnDay(day, t));
                if (hasOverdue) {
                  typesPresent = ["overdue", ...typesPresent.filter((t) => t !== "overdue")];
                } else if (hasCompleted) {
                  typesPresent = ["completed", ...typesPresent.filter((t) => t !== "completed")];
                }
                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[
                      styles.dayCell,
                      !inMonth && styles.dayCellDisabled,
                      selected && styles.dayCellSelected,
                      today && !selected && !hasOverdue && !hasCompleted && styles.dayCellToday,
                      hasOverdue && !selected && styles.dayCellOverdue,
                      hasCompleted && !selected && !hasOverdue && styles.dayCellCompleted,
                    ]}
                    onPress={() => setSelectedDate(day)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        !inMonth && styles.dayTextDisabled,
                        selected && styles.dayTextSelected,
                        today && !selected && styles.dayTextToday,
                        hasOverdue && !selected && styles.dayTextOverdue,
                        hasCompleted && !selected && !hasOverdue && styles.dayTextCompleted,
                      ]}
                    >
                      {format(day, "d")}
                    </Text>
                    <View style={styles.dayDotsRow}>
                      {typesPresent.slice(0, 6).map((t) => (
                        <View
                          key={t}
                          style={[
                            styles.dayDot,
                            t === "overdue" && styles.dayDotOverdue,
                            t === "completed" && styles.dayDotCompleted,
                            { backgroundColor: t === "overdue" ? COLOR_BY_TYPE.overdue : t === "completed" ? COLOR_BY_TYPE.completed : (COLOR_BY_TYPE[t] ?? "#888") },
                          ]}
                        />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
        </View>

        {legendTypesInMonth.length > 0 && (
          <View style={styles.legendRow}>
                {legendTypesInMonth.map((pt) => (
              <View key={pt} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLOR_BY_TYPE[pt] ?? "#888" }]} />
                <Text style={styles.legendText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                  {pt === "problem" ? t("home.legendProblem") : pt === "overdue" ? t("home.legendOverdue") : pt === "completed" ? t("home.legendCompleted") : t(`projectType.${pt}`)}
                </Text>
              </View>
            ))}
          </View>
        )}

          <View style={styles.taskListSection}>
            <Text style={styles.taskListTitle}>
              {selectedYmd
                ? t("home.tasksForDate", { date: selectedYmd })
                : t("home.selectDayForTasks")}
            </Text>
            {selectedYmd && (
              <>
                {loading ? (
                  <Text style={styles.loadingText}>{t("common.saving")}</Text>
                ) : tasksForSelected.length === 0 && problemsForSelected.length === 0 ? (
                  <Text style={styles.emptyTasks}>{t("home.noTasksForDate")}</Text>
                ) : (
                  <>
                    {problemsForSelected
                      .slice(0, 5)
                      .map((p) => (
                        <TouchableOpacity
                          key={`problem-${p.projectId}-${p.id}`}
                          style={styles.taskRow}
                          onPress={() => handleProblemPress(p)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="warning-outline" size={18} color={COLOR_BY_TYPE.problem} />
                          <Text style={styles.taskTitle} numberOfLines={1}>
                            {p.shortDescription || t("problems.noDescription")}
                          </Text>
                          <Text style={styles.taskProject} numberOfLines={1}>
                            {p.projectName ?? ""}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    {tasksForSelected.length > 0 &&
                      tasksForSelected
                        .slice(0, 5 - problemsForSelected.length)
                        .map((task) => {
                          const overdue = isTaskOverdue(task);
                          const completedPastDue = isTaskCompletedPastDue(task);
                          return (
                          <TouchableOpacity
                            key={`task-${task.projectId}-${task.id}`}
                            style={[styles.taskRow, overdue && styles.taskRowOverdue, completedPastDue && styles.taskRowCompleted]}
                            onPress={() => handleTaskPress(task)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="checkbox-outline" size={18} color={overdue ? COLOR_BY_TYPE.overdue : completedPastDue ? COLOR_BY_TYPE.completed : SHEET_ACTION} />
                            <Text style={[styles.taskTitle, overdue && styles.taskTitleOverdue, completedPastDue && styles.taskTitleCompleted]} numberOfLines={1}>
                              {task.title || t("tasks.noTitle")}
                            </Text>
                            <Text style={[styles.taskProject, overdue && styles.taskProjectOverdue, completedPastDue && styles.taskProjectCompleted]} numberOfLines={1}>
                              {task.projectName ?? ""}
                            </Text>
                          </TouchableOpacity>
                        );})}
                    {(tasksForSelected.length + problemsForSelected.length) > 5 && (
                      <TouchableOpacity
                        style={styles.seeAllBtn}
                        onPress={handleSeeAll}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.seeAllText}>{t("home.seeAll")}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </>
            )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: SHEET_TEXT,
  },
  closeBtn: {
    padding: spacing.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  navBtn: {
    padding: spacing.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SHEET_TEXT,
    textTransform: "capitalize",
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    minHeight: DAY_CELL_SIZE * 6,
  },
  dayCell: {
    width: DAY_CELL_SIZE,
    height: DAY_CELL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  dayCellDisabled: {
    opacity: 0.3,
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dayCellOverdue: {
    backgroundColor: "rgba(239, 68, 68, 0.75)",
    borderWidth: 2,
    borderColor: "#ef4444",
  },
  dayCellCompleted: {
    backgroundColor: "rgba(34, 197, 94, 0.5)",
    borderWidth: 2,
    borderColor: "#22c55e",
  },
  dayText: {
    fontSize: 14,
    color: SHEET_TEXT,
  },
  dayTextDisabled: {
    color: "rgba(255,255,255,0.5)",
  },
  dayTextSelected: {
    color: "#fff",
    fontWeight: "700",
  },
  dayTextToday: {
    color: colors.primary,
    fontWeight: "600",
  },
  dayTextOverdue: {
    color: "#ef4444",
    fontWeight: "700",
  },
  dayTextCompleted: {
    color: "#22c55e",
    fontWeight: "700",
  },
  dayDotsRow: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  dayDotOverdue: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayDotCompleted: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
  },
  taskListSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  taskListTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: SHEET_TEXT,
    marginBottom: spacing.sm,
  },
  loadingText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
  },
  emptyTasks: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    marginBottom: spacing.xs,
  },
  taskRowOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: "#ef4444",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  taskRowCompleted: {
    borderLeftWidth: 3,
    borderLeftColor: "#22c55e",
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
    color: SHEET_TEXT,
    marginLeft: spacing.sm,
  },
  taskTitleOverdue: {
    color: "#ef4444",
    fontWeight: "600",
  },
  taskTitleCompleted: {
    color: "#22c55e",
    fontWeight: "600",
  },
  taskProject: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    maxWidth: 80,
  },
  taskProjectOverdue: {
    color: "#ef4444",
  },
  taskProjectCompleted: {
    color: "#22c55e",
  },
  seeAllBtn: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: SHEET_ACTION,
  },
});
