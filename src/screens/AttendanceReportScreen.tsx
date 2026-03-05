/**
 * Attendance / Time tracking report screen.
 * Shows monthly hours with project breakdown and by-person breakdown.
 * Owner/editor: Me/Team filter to see team time. Member: Me only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as timeTracking from "../services/timeTracking";
import type { TimeEntryDoc } from "../services/timeTracking";
import { colors, spacing } from "../theme";

const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  de: "de-DE",
  sk: "sk-SK",
  cs: "cs-CZ",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
};

function formatMonthYear(year: number, month: number, locale: string): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString(LOCALE_MAP[locale] ?? "en-GB", { month: "long", year: "numeric" });
}

function formatMinutesWithUnits(minutes: number, hLabel: string, minLabel: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} ${hLabel} ${String(m).padStart(2, "0")} ${minLabel}`;
}

type ProjectSummary = {
  projectId: string;
  projectName: string;
  totalMinutes: number;
  meMinutes: number;
  teamMinutes: number;
};

type PersonSummary = {
  userId: string;
  userName: string;
  totalMinutes: number;
  byProject: { projectId: string; projectName: string; minutes: number }[];
};

export function AttendanceReportScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState<TimeEntryDoc[]>([]);
  const [teamEntries, setTeamEntries] = useState<TimeEntryDoc[]>([]);
  const [teamProjectIds, setTeamProjectIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"me" | "team">("me");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadIdRef = useRef(0);

  const fromYmd = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toYmd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const canSeeTeam = teamProjectIds.length > 0;

  const fmt = useCallback(
    (mins: number) => formatMinutesWithUnits(mins, t("time.hoursShort"), t("time.minutesShort")),
    [t]
  );

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      const loadId = ++loadIdRef.current;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const [myList, projectIds] = await Promise.all([
          timeTracking.listTimeEntries(user.id, fromYmd, toYmd),
          timeTracking.getProjectIdsWithTeamTimeAccess(user.id),
        ]);
        if (loadId !== loadIdRef.current) return;
        setEntries(myList);
        setTeamProjectIds(projectIds);

        if (projectIds.length > 0) {
          const allTeam = await timeTracking.listTimeEntriesForProjects(projectIds, fromYmd, toYmd);
          if (loadId !== loadIdRef.current) return;
          setTeamEntries(allTeam);
        } else {
          setTeamEntries([]);
        }
      } catch (err) {
        console.warn("[AttendanceReport] Load error:", err);
        if (loadId !== loadIdRef.current) return;
        setEntries([]);
        setTeamEntries([]);
      } finally {
        if (loadId !== loadIdRef.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id, fromYmd, toYmd]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const goPrevMonth = useCallback(() => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }, [month]);

  const goNextMonth = useCallback(() => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }, [month]);

  const userId = user?.id ?? "";
  const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const teamOnlyEntries = useMemo(
    () => teamEntries.filter((e) => e.userId !== userId),
    [teamEntries, userId]
  );
  const teamTotalMinutes = teamOnlyEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const grandTotalMinutes = totalMinutes + teamTotalMinutes;

  const projectSummaries: ProjectSummary[] = useMemo(() => {
    const map = new Map<
      string,
      { projectName: string; totalMinutes: number; meMinutes: number; teamMinutes: number }
    >();
    const source = canSeeTeam ? [...entries, ...teamOnlyEntries] : entries;
    for (const e of source) {
      const key = e.projectId;
      const mins = e.durationMinutes ?? 0;
      const isMe = e.userId === userId;
      const existing = map.get(key);
      if (existing) {
        existing.totalMinutes += mins;
        if (isMe) existing.meMinutes += mins;
        else existing.teamMinutes += mins;
      } else {
        map.set(key, {
          projectName: e.projectNameSnapshot || "Project",
          totalMinutes: mins,
          meMinutes: isMe ? mins : 0,
          teamMinutes: isMe ? 0 : mins,
        });
      }
    }
    return Array.from(map.entries())
      .map(([projectId, { projectName, totalMinutes: mins, meMinutes, teamMinutes }]) => ({
        projectId,
        projectName,
        totalMinutes: mins,
        meMinutes,
        teamMinutes,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [canSeeTeam, entries, teamOnlyEntries, userId]);

  const personSummaries: PersonSummary[] = useMemo(() => {
    const map = new Map<
      string,
      { userName: string; totalMinutes: number; byProject: Map<string, { projectName: string; minutes: number }> }
    >();
    const source = mode === "team" ? teamOnlyEntries : entries;
    for (const e of source) {
      const uid = e.userId || "unknown";
      const mins = e.durationMinutes ?? 0;
      const name = e.userNameSnapshot?.trim() || e.userId || "—";
      const existing = map.get(uid);
      if (existing) {
        existing.totalMinutes += mins;
        const proj = existing.byProject.get(e.projectId);
        if (proj) {
          proj.minutes += mins;
        } else {
          existing.byProject.set(e.projectId, {
            projectName: e.projectNameSnapshot || "Project",
            minutes: mins,
          });
        }
      } else {
        const byProject = new Map<string, { projectName: string; minutes: number }>();
        byProject.set(e.projectId, {
          projectName: e.projectNameSnapshot || "Project",
          minutes: mins,
        });
        map.set(uid, { userName: name, totalMinutes: mins, byProject });
      }
    }
    return Array.from(map.entries())
      .map(([userId, { userName, totalMinutes: mins, byProject }]) => ({
        userId,
        userName,
        totalMinutes: mins,
        byProject: Array.from(byProject.entries())
          .map(([projectId, { projectName, minutes }]) => ({ projectId, projectName, minutes }))
          .sort((a, b) => b.minutes - a.minutes),
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName, undefined, { sensitivity: "base" }));
  }, [mode, canSeeTeam, entries, teamOnlyEntries]);

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
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => stackNav.goBack()} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("attendance.reportTitle")}</Text>
          <TouchableOpacity
            onPress={() => (navigation as { navigate: (n: string) => void }).navigate("TimeDailyProtocolScreen")}
            style={styles.dailyProtocolButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={t("time.dailyProtocol.title")}
            accessibilityRole="button"
          >
            <Ionicons name="calendar-outline" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>

        <View style={styles.monthRow}>
          <TouchableOpacity onPress={goPrevMonth} style={styles.monthArrow} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={28} color={colors.textOnDark} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{formatMonthYear(year, month, locale)}</Text>
          <TouchableOpacity onPress={goNextMonth} style={styles.monthArrow} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={28} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t("attendance.totalSum")}</Text>
            <Text style={styles.kpiValue}>{fmt(grandTotalMinutes)}</Text>
            {canSeeTeam && (
              <Text style={styles.kpiSub}>
                {t("time.dailyProtocol.me")} {fmt(totalMinutes)} • {t("time.dailyProtocol.team")}{" "}
                {fmt(teamTotalMinutes)}
              </Text>
            )}
          </View>
        </View>

        {canSeeTeam && (
          <View style={styles.segmentedRow}>
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("attendance.byPerson")}</Text>
        </View>

        {personSummaries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("attendance.empty")}</Text>
          </View>
        ) : (
          personSummaries.map((person) => (
            <View key={person.userId} style={styles.personCard}>
              <View style={styles.personRow}>
                <Text style={styles.personName} numberOfLines={1}>
                  {person.userName}
                  {person.userId === userId && (
                    <Text style={styles.meBadge}> {t("time.dailyProtocol.meBadge")}</Text>
                  )}
                </Text>
                <Text style={styles.personTotal}>{fmt(person.totalMinutes)}</Text>
              </View>
              {person.byProject.map((proj) => (
                <View key={proj.projectId} style={styles.personProjectRow}>
                  <Text style={styles.personProjectName} numberOfLines={1}>
                    {proj.projectName}
                  </Text>
                  <Text style={styles.personProjectHours}>{fmt(proj.minutes)}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        <View style={[styles.sectionHeader, { marginTop: spacing.xl }]}>
          <Text style={styles.sectionTitle}>{t("attendance.byProject")}</Text>
          <Text style={styles.sectionHint}>{t("attendance.byProjectHint")}</Text>
        </View>

        {projectSummaries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("attendance.empty")}</Text>
          </View>
        ) : (
          projectSummaries.map((row) => (
            <View key={row.projectId} style={styles.projectRow}>
              <View style={styles.projectRowContent}>
                <Text style={styles.projectRowName} numberOfLines={1}>
                  {row.projectName}
                </Text>
                {canSeeTeam && (row.meMinutes > 0 || row.teamMinutes > 0) && (
                  <Text style={styles.projectRowSub}>
                    {t("time.dailyProtocol.me")} {fmt(row.meMinutes)} + {t("time.dailyProtocol.team")}{" "}
                    {fmt(row.teamMinutes)} = {fmt(row.totalMinutes)}
                  </Text>
                )}
              </View>
              <View style={styles.projectTotalCol}>
                <Text style={styles.projectTotalLabel}>{t("attendance.projectTotal")}</Text>
                <Text style={styles.projectRowHours}>{fmt(row.totalMinutes)}</Text>
              </View>
            </View>
          ))
        )}
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
  dailyProtocolButton: {
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
  segmentedRow: {
    flexDirection: "row",
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
  sectionHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.textOnDark,
    marginTop: spacing.xs,
  },
  personCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  personName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    flex: 1,
    marginRight: spacing.sm,
  },
  meBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  personTotal: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
  },
  personProjectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
  },
  personProjectName: {
    fontSize: 14,
    color: colors.textOnDark,
    flex: 1,
    marginRight: spacing.sm,
  },
  personProjectHours: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  projectRowContent: {
    flex: 1,
    marginRight: spacing.md,
  },
  projectRowName: {
    fontSize: 16,
    color: colors.textOnDark,
  },
  projectRowSub: {
    fontSize: 12,
    color: colors.textOnDark,
    marginTop: 2,
  },
  projectTotalCol: {
    alignItems: "flex-end",
  },
  projectTotalLabel: {
    fontSize: 11,
    color: colors.textOnDark,
    marginBottom: 2,
  },
  projectRowHours: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: colors.textOnDark,
    textAlign: "center",
  },
});
