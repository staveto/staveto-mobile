import React, { useMemo, useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet";
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
} from "date-fns";
import { sk } from "date-fns/locale";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";
import { toYmd, ymdToDate } from "../utils/date";
import * as tasksService from "../services/tasks";
import type { TaskWithProject } from "../services/tasks";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  onTaskPress?: (task: TaskWithProject) => void;
  onSeeAllForDate?: (dueDateYmd: string) => void;
};

const WEEKDAYS = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

export function HomeCalendarSheet({ sheetRef, onTaskPress, onSeeAllForDate }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [tasksByYmd, setTasksByYmd] = useState<Map<string, TaskWithProject[]>>(new Map());
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
      const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 2, 0);
      const startYmd = toYmd(start);
      const endYmd = toYmd(end);
      const tasks = await tasksService.listTasksWithDueDateInRange(user.id, startYmd, endYmd);
      const map = new Map<string, TaskWithProject[]>();
      for (const task of tasks) {
        const ymd = task.dueDate?.trim();
        if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        const arr = map.get(ymd) ?? [];
        arr.push(task);
        map.set(ymd, arr);
      }
      setTasksByYmd(map);
    } catch (e) {
      console.warn("[HomeCalendarSheet] Failed to load tasks:", e);
      setTasksByYmd(new Map());
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentMonth]);

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
  const taskCountForDay = (day: Date) => tasksByYmd.get(toYmd(day))?.length ?? 0;

  const handleTaskPress = useCallback(
    (task: TaskWithProject) => {
      sheetRef.current?.dismiss();
      onTaskPress?.(task);
    },
    [sheetRef, onTaskPress]
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
      enableContentPanningGesture={false}
      snapPoints={["65%", "92%"]}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
      backgroundStyle={styles.sheet}
    >
      <BottomSheetView style={styles.contentContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("home.sectionCalendar")}</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => sheetRef.current?.dismiss()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color={SHEET_ACTION} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.calendarWrap}>
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={() => setCurrentMonth((m) => subMonths(m, 1))}
                style={styles.navBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={24} color={SHEET_ACTION} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {format(currentMonth, "LLLL yyyy", { locale: sk })}
              </Text>
              <TouchableOpacity
                onPress={() => setCurrentMonth((m) => addMonths(m, 1))}
                style={styles.navBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-forward" size={24} color={SHEET_ACTION} />
              </TouchableOpacity>
            </View>
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((d) => (
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
                const hasTasks = taskCountForDay(day) > 0;
                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[
                      styles.dayCell,
                      !inMonth && styles.dayCellDisabled,
                      selected && styles.dayCellSelected,
                      today && !selected && styles.dayCellToday,
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
                      ]}
                    >
                      {format(day, "d")}
                    </Text>
                    {hasTasks && <View style={styles.dayDot} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

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
                ) : tasksForSelected.length === 0 ? (
                  <Text style={styles.emptyTasks}>{t("home.noTasksForDate")}</Text>
                ) : (
                  <>
                    {tasksForSelected.slice(0, 5).map((task) => (
                      <TouchableOpacity
                        key={`${task.projectId}-${task.id}`}
                        style={styles.taskRow}
                        onPress={() => handleTaskPress(task)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="checkbox-outline" size={18} color={SHEET_ACTION} />
                        <Text style={styles.taskTitle} numberOfLines={1}>
                          {task.title || t("tasks.noTitle")}
                        </Text>
                        <Text style={styles.taskProject} numberOfLines={1}>
                          {task.projectName ?? ""}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {tasksForSelected.length > 5 && (
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
        </ScrollView>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  contentContainer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
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
  },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
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
  dayDot: {
    position: "absolute",
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
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
  taskTitle: {
    flex: 1,
    fontSize: 14,
    color: SHEET_TEXT,
    marginLeft: spacing.sm,
  },
  taskProject: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    maxWidth: 80,
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
