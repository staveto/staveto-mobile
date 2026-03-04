/**
 * Attendance / Time tracking report screen.
 * Shows monthly hours with project breakdown. Month navigation via arrows.
 */
import React, { useCallback, useEffect, useState } from "react";
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

function formatMinutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(h);
}

type ProjectSummary = {
  projectId: string;
  projectName: string;
  totalMinutes: number;
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fromYmd = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toYmd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const list = await timeTracking.listTimeEntries(user.id, fromYmd, toYmd);
        setEntries(list);
      } catch (err) {
        console.warn("[AttendanceReport] Load error:", err);
        setEntries([]);
      } finally {
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

  const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

  const projectSummaries: ProjectSummary[] = React.useMemo(() => {
    const map = new Map<string, { projectName: string; totalMinutes: number }>();
    for (const e of entries) {
      const key = e.projectId;
      const existing = map.get(key);
      const mins = e.durationMinutes ?? 0;
      if (existing) {
        existing.totalMinutes += mins;
      } else {
        map.set(key, { projectName: e.projectNameSnapshot || "Project", totalMinutes: mins });
      }
    }
    return Array.from(map.entries())
      .map(([projectId, { projectName, totalMinutes: mins }]) => ({
        projectId,
        projectName,
        totalMinutes: mins,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entries]);

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
            <Text style={styles.kpiLabel}>{t("attendance.totalHours")}</Text>
            <Text style={styles.kpiValue}>{formatMinutesToHours(totalMinutes)}</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("attendance.byProject")}</Text>
        </View>

        {projectSummaries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("attendance.empty")}</Text>
          </View>
        ) : (
          projectSummaries.map((row) => (
            <View key={row.projectId} style={styles.projectRow}>
              <Text style={styles.projectRowName} numberOfLines={1}>
                {row.projectName}
              </Text>
              <Text style={styles.projectRowHours}>{formatMinutesToHours(row.totalMinutes)}</Text>
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
  sectionHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
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
  projectRowName: {
    fontSize: 16,
    color: colors.textOnDark,
    flex: 1,
    marginRight: spacing.md,
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
    color: colors.textMuted,
    textAlign: "center",
  },
});
