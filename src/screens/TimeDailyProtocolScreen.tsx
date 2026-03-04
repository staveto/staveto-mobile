/**
 * Daily protocol (Tagesprotokoll) for Time Tracking.
 * Month calendar with markers on days that have entries.
 * Tap a day to see entries with Start/End location buttons.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  addMonths,
  subMonths,
} from "date-fns";
import { enUS, sk, de, cs, es, it, pl, type Locale as DateFnsLocale } from "date-fns/locale";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import type { Locale } from "../i18n/translations";
import * as timeTracking from "../services/timeTracking";
import type { TimeEntryDoc } from "../services/timeTracking";
import { openLatLngInMaps } from "../lib/maps";
import { toYmd } from "../utils/date";
import { colors, spacing } from "../theme";

const LOCALE_MAP: Record<Locale, DateFnsLocale> = {
  en: enUS,
  sk,
  de,
  cs,
  es,
  it,
  pl,
};

const WEEKDAYS: Record<Locale, string[]> = {
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  sk: ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  cs: ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"],
  es: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"],
  it: ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
};

const CALENDAR_PADDING = spacing.md * 2;
const DAY_CELL_SIZE = Math.max(36, Math.floor((Dimensions.get("window").width - CALENDAR_PADDING) / 7));

type DaySummary = { totalMinutes: number; countEntries: number };

function formatMinutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

function formatTimeRange(startedAt: string, endedAt: string): string {
  try {
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const sh = start.getHours();
    const sm = start.getMinutes();
    const eh = end.getHours();
    const em = end.getMinutes();
    return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}–${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
  } catch {
    return "–";
  }
}

function hasValidGps(gps: { lat?: number; lng?: number } | null | undefined): boolean {
  return !!gps && typeof gps.lat === "number" && typeof gps.lng === "number" && !isNaN(gps.lat) && !isNaN(gps.lng);
}

export function TimeDailyProtocolScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const dateFnsLocale = LOCALE_MAP[locale] ?? enUS;
  const weekdays = WEEKDAYS[locale] ?? WEEKDAYS.en;

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [entries, setEntries] = useState<TimeEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userId = user?.id ?? "";

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!userId) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await timeTracking.listTimeEntriesForMonth(
          userId,
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1
        );
        setEntries(list);
      } catch (err) {
        console.warn("[TimeDailyProtocol] Load error:", err);
        setEntries([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId, currentMonth]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const daySummaries = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const e of entries) {
      const dayKey = toYmd(new Date(e.startedAt));
      const existing = map.get(dayKey);
      const mins = e.durationMinutes ?? 0;
      if (existing) {
        existing.totalMinutes += mins;
        existing.countEntries += 1;
      } else {
        map.set(dayKey, { totalMinutes: mins, countEntries: 1 });
      }
    }
    return map;
  }, [entries]);

  const selectedYmd = selectedDate ? toYmd(selectedDate) : null;
  const entriesForDay = useMemo(() => {
    if (!selectedYmd) return [];
    return entries
      .filter((e) => toYmd(new Date(e.startedAt)) === selectedYmd)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }, [entries, selectedYmd]);

  const totalForDay = entriesForDay.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

  const goPrevMonth = useCallback(() => {
    setCurrentMonth((m) => subMonths(m, 1));
    setSelectedDate(null);
  }, []);

  const goNextMonth = useCallback(() => {
    setCurrentMonth((m) => addMonths(m, 1));
    setSelectedDate(null);
  }, []);

  const handleLocationPress = useCallback((lat: number, lng: number) => {
    openLatLngInMaps(lat, lng);
  }, []);

  const stackNav = navigation as { goBack: () => void };

  if (loading && entries.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => stackNav.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("time.dailyProtocol.title")}</Text>
        </View>

        <View style={styles.monthRow}>
          <TouchableOpacity onPress={goPrevMonth} style={styles.monthArrow} hitSlop={12}>
            <Ionicons name="chevron-back" size={28} color={colors.textOnDark} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{format(currentMonth, "LLLL yyyy", { locale: dateFnsLocale })}</Text>
          <TouchableOpacity onPress={goNextMonth} style={styles.monthArrow} hitSlop={12}>
            <Ionicons name="chevron-forward" size={28} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t("time.dailyProtocol.totalHours")}</Text>
            <Text style={styles.kpiValue}>{formatMinutesToHours(totalMinutes)}</Text>
          </View>
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
            const dayKey = toYmd(day);
            const summary = daySummaries.get(dayKey);
            const hasEntries = !!summary && summary.totalMinutes > 0;
            const hasLongDay = !!summary && summary.totalMinutes > 480;

            return (
              <TouchableOpacity
                key={day.toISOString()}
                style={[
                  styles.dayCell,
                  { width: DAY_CELL_SIZE, height: DAY_CELL_SIZE },
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
                {hasEntries && (
                  <View style={styles.dotRow}>
                    <View style={[styles.dot, hasLongDay && styles.dotThick]} />
                    {hasLongDay && <View style={[styles.dot, styles.dotThick]} />}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.detailSection}>
          <Text style={styles.detailTitle}>
            {selectedYmd
              ? t("time.dailyProtocol.selectedDay", {
                  weekday: format(selectedDate!, "EEE", { locale: dateFnsLocale }),
                  month: format(selectedDate!, "MMM", { locale: dateFnsLocale }),
                  day: format(selectedDate!, "d", { locale: dateFnsLocale }),
                })
              : t("time.dailyProtocol.selectDay")}
          </Text>

          {selectedYmd && (
            <>
              <Text style={styles.totalForDay}>
                {t("time.dailyProtocol.totalForDay")}: {formatMinutesToHours(totalForDay)}
              </Text>

              {entriesForDay.length === 0 ? (
                <Text style={styles.emptyText}>{t("time.dailyProtocol.emptyDay")}</Text>
              ) : (
                entriesForDay.map((entry) => (
                  <View key={entry.id} style={styles.entryCard}>
                    <Text style={styles.entryProject} numberOfLines={1}>
                      {entry.projectNameSnapshot || "Project"}
                    </Text>
                    <Text style={styles.entryTime}>
                      {formatTimeRange(entry.startedAt, entry.endedAt)} • {formatMinutesToHours(entry.durationMinutes ?? 0)}
                    </Text>
                    <View style={styles.locationRow}>
                      <TouchableOpacity
                        style={[
                          styles.locationBtn,
                          !hasValidGps(entry.gpsStart) && styles.locationBtnDisabled,
                        ]}
                        onPress={() =>
                          hasValidGps(entry.gpsStart) &&
                          entry.gpsStart &&
                          handleLocationPress(entry.gpsStart!.lat!, entry.gpsStart!.lng!)
                        }
                        disabled={!hasValidGps(entry.gpsStart)}
                      >
                        <Ionicons
                          name="location"
                          size={16}
                          color={hasValidGps(entry.gpsStart) ? colors.primary : colors.textMuted}
                        />
                        <Text
                          style={[
                            styles.locationBtnText,
                            !hasValidGps(entry.gpsStart) && styles.locationBtnTextDisabled,
                          ]}
                        >
                          {hasValidGps(entry.gpsStart)
                            ? t("time.dailyProtocol.startLocation")
                            : t("time.dailyProtocol.locationMissing")}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.locationBtn,
                          !hasValidGps(entry.gpsEnd) && styles.locationBtnDisabled,
                        ]}
                        onPress={() =>
                          hasValidGps(entry.gpsEnd) &&
                          entry.gpsEnd &&
                          handleLocationPress(entry.gpsEnd!.lat!, entry.gpsEnd!.lng!)
                        }
                        disabled={!hasValidGps(entry.gpsEnd)}
                      >
                        <Ionicons
                          name="location"
                          size={16}
                          color={hasValidGps(entry.gpsEnd) ? colors.primary : colors.textMuted}
                        />
                        <Text
                          style={[
                            styles.locationBtnText,
                            !hasValidGps(entry.gpsEnd) && styles.locationBtnTextDisabled,
                          ]}
                        >
                          {hasValidGps(entry.gpsEnd)
                            ? t("time.dailyProtocol.endLocation")
                            : t("time.dailyProtocol.locationMissing")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
    flex: 1,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
  },
  monthArrow: {
    padding: spacing.sm,
  },
  monthText: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  kpiCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.primary,
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  weekday: {
    width: DAY_CELL_SIZE,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.xl,
  },
  dayCell: {
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    margin: 1,
  },
  dayCellDisabled: {
    opacity: 0.35,
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayCellToday: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dayText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  dayTextDisabled: {
    color: colors.textMuted,
  },
  dayTextSelected: {
    color: colors.textOnDark,
  },
  dayTextToday: {
    color: colors.textOnDark,
  },
  dotRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  dotThick: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  detailSection: {
    marginTop: spacing.md,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  totalForDay: {
    fontSize: 15,
    color: colors.textOnDark,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  entryCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  entryProject: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  entryTime: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  locationRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
    backgroundColor: "rgba(224,103,55,0.2)",
  },
  locationBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.06)",
    opacity: 0.7,
  },
  locationBtnText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: "500",
  },
  locationBtnTextDisabled: {
    color: colors.textMuted,
  },
});
