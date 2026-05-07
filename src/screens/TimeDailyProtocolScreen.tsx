/**
 * Daily protocol (Tagesprotokoll) for Time Tracking.
 * Month calendar with markers on days that have entries.
 * Tap a day to see entries with Start/End location buttons.
 * Me/Team mode: members see only their time; owners/editors see Me + Team (grouped by person).
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
import * as absencesService from "../services/absences";
import type { AbsenceDoc } from "../services/absences";
import { ABSENCE_COLOR, ABSENCE_TYPE_KEYS } from "./absence/absenceUi";
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

type DaySummary = { meMinutes: number; teamMinutes: number; countEntries: number };

function formatMinutesWithUnits(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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

/** "12:10–12:40, 14:05–14:12" — joins all closed pause windows; open pauses are shown as "12:10–…". */
function formatPauseList(pauses: TimeEntryDoc["pauses"]): string {
  if (!pauses || pauses.length === 0) return "";
  const parts: string[] = [];
  for (const p of pauses) {
    if (!p?.startedAt) continue;
    try {
      const start = new Date(p.startedAt);
      const sh = String(start.getHours()).padStart(2, "0");
      const sm = String(start.getMinutes()).padStart(2, "0");
      if (p.endedAt) {
        const end = new Date(p.endedAt);
        const eh = String(end.getHours()).padStart(2, "0");
        const em = String(end.getMinutes()).padStart(2, "0");
        parts.push(`${sh}:${sm}–${eh}:${em}`);
      } else {
        parts.push(`${sh}:${sm}–…`);
      }
    } catch {
      /* ignore unparsable pause entry */
    }
  }
  return parts.join(", ");
}

function hasValidGps(gps: { lat?: number; lng?: number } | null | undefined): boolean {
  return !!gps && typeof gps.lat === "number" && typeof gps.lng === "number" && !isNaN(gps.lat) && !isNaN(gps.lng);
}

function EntryCard({
  entry,
  isMe,
  onLocationPress,
  t,
}: {
  entry: TimeEntryDoc;
  isMe: boolean;
  userId?: string;
  onLocationPress: (lat: number, lng: number) => void;
  t: (key: string) => string;
}) {
  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeaderRow}>
        <Text style={styles.entryPerson} numberOfLines={1}>
          {entry.userNameSnapshot?.trim() || entry.userId || "—"}
        </Text>
        {isMe && (
          <View style={styles.meBadge}>
            <Text style={styles.meBadgeText}>{t("time.dailyProtocol.meBadge")}</Text>
          </View>
        )}
      </View>
      <Text style={styles.entryProject} numberOfLines={1}>
        {entry.projectNameSnapshot || "Project"}
      </Text>
      {(entry.phaseNameSnapshot || entry.taskTitleSnapshot) && (
        <Text style={styles.entryPhaseTask} numberOfLines={1}>
          {[entry.phaseNameSnapshot, entry.taskTitleSnapshot].filter(Boolean).join(" › ")}
        </Text>
      )}
      <Text style={styles.entryTime}>
        {formatTimeRange(entry.startedAt, entry.endedAt)} • {formatMinutesWithUnits(entry.durationMinutes ?? 0)}
      </Text>
      {entry.pauses && entry.pauses.length > 0 ? (
        <Text style={styles.entryPauses} numberOfLines={2}>
          {t("time.dailyProtocol.pauses")}: {formatPauseList(entry.pauses)}
        </Text>
      ) : null}
      <View style={styles.locationRow}>
        <TouchableOpacity
          style={[styles.locationBtn, !hasValidGps(entry.gpsStart) && styles.locationBtnDisabled]}
          onPress={() =>
            hasValidGps(entry.gpsStart) &&
            entry.gpsStart &&
            onLocationPress(entry.gpsStart!.lat!, entry.gpsStart!.lng!)
          }
          disabled={!hasValidGps(entry.gpsStart)}
        >
          <Ionicons
            name="location"
            size={16}
            color={hasValidGps(entry.gpsStart) ? colors.primary : colors.textOnDark}
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
          style={[styles.locationBtn, !hasValidGps(entry.gpsEnd) && styles.locationBtnDisabled]}
          onPress={() =>
            hasValidGps(entry.gpsEnd) &&
            entry.gpsEnd &&
            onLocationPress(entry.gpsEnd!.lat!, entry.gpsEnd!.lng!)
          }
          disabled={!hasValidGps(entry.gpsEnd)}
        >
          <Ionicons
            name="location"
            size={16}
            color={hasValidGps(entry.gpsEnd) ? colors.primary : colors.textOnDark}
          />
          <Text
            style={[styles.locationBtnText, !hasValidGps(entry.gpsEnd) && styles.locationBtnTextDisabled]}
          >
            {hasValidGps(entry.gpsEnd)
              ? t("time.dailyProtocol.endLocation")
              : t("time.dailyProtocol.locationMissing")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
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
  const [mode, setMode] = useState<"all" | "me" | "team">("all");
  const [teamProjectIds, setTeamProjectIds] = useState<string[]>([]);
  const [teamEntriesForMonth, setTeamEntriesForMonth] = useState<TimeEntryDoc[]>([]);
  const [teamEntriesForDay, setTeamEntriesForDay] = useState<TimeEntryDoc[]>([]);
  const [teamDayLoading, setTeamDayLoading] = useState(false);
  const [expandedPersonIds, setExpandedPersonIds] = useState<Set<string>>(new Set());
  const [absencesByYmd, setAbsencesByYmd] = useState<Map<string, AbsenceDoc[]>>(new Map());

  const userId = user?.id ?? "";
  const canSeeTeam = teamProjectIds.length > 0;

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

  useEffect(() => {
    if (!userId) return;
    timeTracking.getProjectIdsWithTeamTimeAccess(userId).then(setTeamProjectIds);
  }, [userId]);

  const loadTeamEntriesForMonth = useCallback(async () => {
    if (!teamProjectIds.length) {
      setTeamEntriesForMonth([]);
      return;
    }
    const fromYmd = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const toYmd = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    try {
      const list = await timeTracking.listTimeEntriesForProjects(teamProjectIds, fromYmd, toYmd);
      setTeamEntriesForMonth(list);
    } catch (err) {
      console.warn("[TimeDailyProtocol] Team month load error:", err);
      setTeamEntriesForMonth([]);
    }
  }, [teamProjectIds, currentMonth]);

  useEffect(() => {
    if (teamProjectIds.length > 0) {
      loadTeamEntriesForMonth();
    } else {
      setTeamEntriesForMonth([]);
    }
  }, [teamProjectIds, currentMonth, loadTeamEntriesForMonth]);

  // Load absences for the visible month so we can render them in the calendar.
  useEffect(() => {
    if (!userId) {
      setAbsencesByYmd(new Map());
      return;
    }
    const fromYmd = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const toYmdStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    let cancelled = false;
    absencesService
      .listAbsencesForUser(userId, fromYmd, toYmdStr)
      .then((list) => {
        if (cancelled) return;
        setAbsencesByYmd(absencesService.getAbsencesMapByYmd(list));
      })
      .catch(() => {
        if (!cancelled) setAbsencesByYmd(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [userId, currentMonth]);

  const selectedYmd = selectedDate ? toYmd(selectedDate) : null;

  const loadTeamEntriesForDay = useCallback(
    async (ymd: string) => {
      if (!teamProjectIds.length) {
        setTeamEntriesForDay([]);
        return;
      }
      setTeamDayLoading(true);
      try {
        const list = await timeTracking.listTimeEntriesForProjects(teamProjectIds, ymd, ymd);
        setTeamEntriesForDay(list);
      } catch (err) {
        console.warn("[TimeDailyProtocol] Team load error:", err);
        setTeamEntriesForDay([]);
      } finally {
        setTeamDayLoading(false);
      }
    },
    [teamProjectIds]
  );

  useEffect(() => {
    if (selectedYmd && (mode === "all" || mode === "team")) {
      loadTeamEntriesForDay(selectedYmd);
    } else {
      setTeamEntriesForDay([]);
    }
  }, [selectedYmd, mode, loadTeamEntriesForDay]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const teamOnlyEntriesForMonth = useMemo(
    () => teamEntriesForMonth.filter((e) => e.userId !== userId),
    [teamEntriesForMonth, userId]
  );

  const daySummaries = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const e of entries) {
      const dayKey = toYmd(new Date(e.startedAt));
      const existing = map.get(dayKey);
      const mins = e.durationMinutes ?? 0;
      if (existing) {
        existing.meMinutes += mins;
        existing.countEntries += 1;
      } else {
        map.set(dayKey, { meMinutes: mins, teamMinutes: 0, countEntries: 1 });
      }
    }
    if (canSeeTeam) {
      for (const e of teamOnlyEntriesForMonth) {
        const dayKey = toYmd(new Date(e.startedAt));
        const existing = map.get(dayKey);
        const mins = e.durationMinutes ?? 0;
        if (existing) {
          existing.teamMinutes += mins;
        } else {
          map.set(dayKey, { meMinutes: 0, teamMinutes: mins, countEntries: 0 });
        }
      }
    }
    return map;
  }, [entries, teamOnlyEntriesForMonth, canSeeTeam, userId]);

  const entriesForDay = useMemo(() => {
    if (!selectedYmd) return [];
    return entries
      .filter((e) => toYmd(new Date(e.startedAt)) === selectedYmd)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }, [entries, selectedYmd]);

  const totalForDay = entriesForDay.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

  const teamOnlyEntriesForDay = useMemo(
    () => teamEntriesForDay.filter((e) => e.userId !== userId),
    [teamEntriesForDay, userId]
  );

  type PersonGroup = { userId: string; userName: string; totalMinutes: number; entries: TimeEntryDoc[] };
  const teamGroupedByPerson = useMemo(() => {
    const map = new Map<string, PersonGroup>();
    for (const e of teamOnlyEntriesForDay) {
      const uid = e.userId || "unknown";
      const existing = map.get(uid);
      const mins = e.durationMinutes ?? 0;
      const name = e.userNameSnapshot?.trim() || e.userId || "—";
      if (existing) {
        existing.totalMinutes += mins;
        existing.entries.push(e);
      } else {
        map.set(uid, { userId: uid, userName: name, totalMinutes: mins, entries: [e] });
      }
    }
    const groups = Array.from(map.values());
    for (const g of groups) {
      g.entries.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    }
    return groups.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [teamOnlyEntriesForDay]);

  const allGroupedByPerson = useMemo(() => {
    const combined = [...entriesForDay, ...teamOnlyEntriesForDay];
    const map = new Map<string, PersonGroup>();
    for (const e of combined) {
      const uid = e.userId || "unknown";
      const existing = map.get(uid);
      const mins = e.durationMinutes ?? 0;
      const name = e.userNameSnapshot?.trim() || e.userId || "—";
      if (existing) {
        existing.totalMinutes += mins;
        existing.entries.push(e);
      } else {
        map.set(uid, { userId: uid, userName: name, totalMinutes: mins, entries: [e] });
      }
    }
    const groups = Array.from(map.values());
    for (const g of groups) {
      g.entries.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    }
    return groups.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entriesForDay, teamOnlyEntriesForDay]);

  const teamTotalForDay = teamOnlyEntriesForDay.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

  const togglePersonExpand = useCallback((uid: string) => {
    setExpandedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

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
            <Text style={styles.kpiLabel}>
              {selectedYmd
                ? t("time.dailyProtocol.totalForDay")
                : t("time.dailyProtocol.totalHours")}
            </Text>
            {selectedYmd ? (
              <>
                <Text style={styles.kpiValue}>
                  {formatMinutesWithUnits(totalForDay + teamTotalForDay)}
                </Text>
                {canSeeTeam && (
                  <Text style={styles.kpiSub}>
                    {t("time.dailyProtocol.me")} {formatMinutesWithUnits(totalForDay)} • {t("time.dailyProtocol.team")}{" "}
                    {formatMinutesWithUnits(teamTotalForDay)}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.kpiValue}>{formatMinutesWithUnits(totalMinutes)}</Text>
            )}
          </View>
        </View>

        {canSeeTeam && selectedYmd && (
          <View style={styles.segmentedRow}>
            <TouchableOpacity
              style={[styles.segmentedBtn, mode === "all" && styles.segmentedBtnActive]}
              onPress={() => setMode("all")}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentedBtnText, mode === "all" && styles.segmentedBtnTextActive]}>
                {t("time.dailyProtocol.all")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentedBtn, mode === "me" && styles.segmentedBtnActive]}
              onPress={() => setMode("me")}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentedBtnText, mode === "me" && styles.segmentedBtnTextActive]}>
                {t("time.dailyProtocol.me")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentedBtn, mode === "team" && styles.segmentedBtnActive]}
              onPress={() => setMode("team")}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentedBtnText, mode === "team" && styles.segmentedBtnTextActive]}>
                {t("time.dailyProtocol.team")}
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
            const hasMeEntries = !!summary && summary.meMinutes > 0;
            const hasTeamEntries = !!summary && summary.teamMinutes > 0;
            const totalMinutes = summary ? summary.meMinutes + summary.teamMinutes : 0;
            const hasLongDay = totalMinutes > 480;
            const dayAbsences = absencesByYmd.get(dayKey);
            const dayAbsence = dayAbsences && dayAbsences.length > 0
              ? (dayAbsences.find((a) => a.status === "approved") ?? dayAbsences[0])
              : null;
            const absenceColor = dayAbsence ? ABSENCE_COLOR[dayAbsence.type] : null;
            const absenceIsPending = dayAbsence?.status === "pending";

            return (
              <TouchableOpacity
                key={day.toISOString()}
                style={[
                  styles.dayCell,
                  { width: DAY_CELL_SIZE, height: DAY_CELL_SIZE },
                  !inMonth && styles.dayCellDisabled,
                  absenceColor && !selected && {
                    backgroundColor: absenceIsPending ? `${absenceColor}33` : `${absenceColor}55`,
                    borderWidth: absenceIsPending ? 1 : 0,
                    borderStyle: "dashed",
                    borderColor: absenceColor,
                  },
                  selected && styles.dayCellSelected,
                  today && !selected && !absenceColor && styles.dayCellToday,
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
                {(hasMeEntries || hasTeamEntries) && (
                  <View style={styles.dotRow}>
                    {hasMeEntries && (
                      <View style={[styles.dot, styles.dotMe, hasLongDay && styles.dotThick]} />
                    )}
                    {hasTeamEntries && (
                      <View style={[styles.dot, styles.dotTeam, hasLongDay && styles.dotThick]} />
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {canSeeTeam && (
          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotMe]} />
              <Text style={styles.legendText}>{t("time.dailyProtocol.me")}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotTeam]} />
              <Text style={styles.legendText}>{t("time.dailyProtocol.team")}</Text>
            </View>
          </View>
        )}

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

          {selectedYmd && (() => {
            const dayAbsences = absencesByYmd.get(selectedYmd) ?? [];
            return dayAbsences.length > 0 ? (
              <View style={styles.absenceSection}>
                <Text style={styles.absenceSectionTitle}>{t("absence.section.calendar")}</Text>
                {dayAbsences.map((a) => (
                  <TouchableOpacity
                    key={`absence-${a.id}`}
                    style={[styles.absenceRow, { borderLeftColor: ABSENCE_COLOR[a.type] }]}
                    onPress={() => (navigation as any).navigate?.("AbsenceDetail", { absenceId: a.id })}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.absenceDot, { backgroundColor: ABSENCE_COLOR[a.type] }]} />
                    <Text style={styles.absenceRowTitle} numberOfLines={1}>
                      {t(ABSENCE_TYPE_KEYS[a.type])}
                    </Text>
                    <Text style={styles.absenceRowName} numberOfLines={1}>
                      {a.userNameSnapshot}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null;
          })()}

          {selectedYmd && (
            <>
              {mode === "me" ? (
                entriesForDay.length === 0 ? (
                  <Text style={styles.emptyText}>{t("time.dailyProtocol.emptyDay")}</Text>
                ) : (
                  entriesForDay.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isMe={entry.userId === userId}
                      userId={userId}
                      onLocationPress={handleLocationPress}
                      t={t}
                    />
                  ))
                )
              ) : mode === "all" ? (
                teamDayLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: spacing.md }} />
                ) : allGroupedByPerson.length === 0 ? (
                  <Text style={styles.emptyText}>{t("time.dailyProtocol.emptyDay")}</Text>
                ) : (
                  allGroupedByPerson.map((group) => (
                  <View key={group.userId} style={styles.personGroup}>
                    <TouchableOpacity
                      style={styles.personRow}
                      onPress={() => togglePersonExpand(group.userId)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.personName} numberOfLines={1}>
                        {group.userName}
                      </Text>
                      <View style={styles.personMeta}>
                        <Text style={styles.personTime}>{formatMinutesWithUnits(group.totalMinutes)}</Text>
                        <Text style={styles.personCount}>
                          ({group.entries.length} {group.entries.length === 1 ? t("time.dailyProtocol.entry") : t("time.dailyProtocol.entries")})
                        </Text>
                      </View>
                      <Ionicons
                        name={expandedPersonIds.has(group.userId) ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.textOnDark}
                      />
                    </TouchableOpacity>
                    {expandedPersonIds.has(group.userId) &&
                      group.entries.map((entry) => (
                        <View key={entry.id} style={styles.entryCardNested}>
                          <EntryCard
                            entry={entry}
                            isMe={entry.userId === userId}
                            userId={userId}
                            onLocationPress={handleLocationPress}
                            t={t}
                          />
                        </View>
                      ))}
                  </View>
                ))
              )
              ) : teamDayLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: spacing.md }} />
              ) : teamGroupedByPerson.length === 0 ? (
                <Text style={styles.emptyText}>{t("time.dailyProtocol.emptyDay")}</Text>
              ) : (
                teamGroupedByPerson.map((group) => (
                  <View key={group.userId} style={styles.personGroup}>
                    <TouchableOpacity
                      style={styles.personRow}
                      onPress={() => togglePersonExpand(group.userId)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.personName} numberOfLines={1}>
                        {group.userName}
                      </Text>
                      <View style={styles.personMeta}>
                        <Text style={styles.personTime}>{formatMinutesWithUnits(group.totalMinutes)}</Text>
                        <Text style={styles.personCount}>
                          ({group.entries.length} {group.entries.length === 1 ? t("time.dailyProtocol.entry") : t("time.dailyProtocol.entries")})
                        </Text>
                      </View>
                      <Ionicons
                        name={expandedPersonIds.has(group.userId) ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.textOnDark}
                      />
                    </TouchableOpacity>
                    {expandedPersonIds.has(group.userId) &&
                      group.entries.map((entry) => (
                        <View key={entry.id} style={styles.entryCardNested}>
                          <EntryCard
                            entry={entry}
                            isMe={entry.userId === userId}
                            userId={userId}
                            onLocationPress={handleLocationPress}
                            t={t}
                          />
                        </View>
                      ))}
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
  kpiSub: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  weekday: {
    width: DAY_CELL_SIZE,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textOnDark,
    textAlign: "center",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  calendarLegend: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.lg,
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
    color: colors.textOnDark,
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
    color: colors.textOnDark,
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
  },
  dotMe: {
    backgroundColor: colors.primary,
  },
  dotTeam: {
    backgroundColor: colors.teamAccent,
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
    color: colors.textOnDark,
    marginTop: spacing.sm,
  },
  segmentedRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: 2,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: 6,
  },
  segmentedBtnActive: {
    backgroundColor: colors.primary,
  },
  segmentedBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  segmentedBtnTextActive: {
    color: colors.textOnDark,
  },
  personGroup: {
    marginBottom: spacing.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
  },
  personName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginRight: spacing.sm,
  },
  personMeta: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  personTime: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.primary,
  },
  personCount: {
    fontSize: 12,
    color: colors.textOnDark,
  },
  entryCardNested: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  entryCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  entryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  entryPerson: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textOnDark,
    flex: 1,
  },
  meBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  meBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  entryProject: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  entryPhaseTask: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
    marginBottom: spacing.xs,
  },
  entryTime: {
    fontSize: 14,
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  entryPauses: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: -4,
    marginBottom: spacing.sm,
    fontStyle: "italic",
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
    backgroundColor: "rgba(224,103,55,0.35)",
  },
  locationBtnText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: "500",
  },
  locationBtnTextDisabled: {
    color: colors.textOnDark,
  },
  absenceSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  absenceSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  absenceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    marginBottom: spacing.xs,
    borderLeftWidth: 3,
    gap: spacing.sm,
  },
  absenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  absenceRowTitle: {
    flex: 1,
    fontSize: 14,
    color: colors.textOnDark,
    fontWeight: "600",
  },
  absenceRowName: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    maxWidth: 120,
  },
});
