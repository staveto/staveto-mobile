/**
 * Project-scoped time history: entries grouped by local day (read-only).
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
  Linking,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import * as timeTracking from "../services/timeTracking";
import type { TimeEntryDoc } from "../services/timeTracking";
import { colors, radius, spacing } from "../theme";
import {
  formatGpsShort,
  groupTimeEntriesByDay,
  mapsUrlForPoint,
  sumMinutes,
} from "../utils/timeEntryDisplay";

const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  de: "de-DE",
  sk: "sk-SK",
  cs: "cs-CZ",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
};

type RouteParams = { projectId: string; projectName?: string };

export function ProjectTimeDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { projectId, projectName } = (route.params ?? {}) as RouteParams;

  const [entries, setEntries] = useState<TimeEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const toLocalYmd = useCallback((d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const todayYmd = useMemo(() => toLocalYmd(new Date()), [toLocalYmd]);
  const yesterdayYmd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalYmd(d);
  }, [toLocalYmd]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const now = new Date();
        const toYmd = toLocalYmd(now);
        const from = new Date(now);
        from.setMonth(from.getMonth() - 24);
        const fromYmd = toLocalYmd(from);
        const list = await timeTracking.listTimeEntriesByProject(projectId, fromYmd, toYmd, {
          forUserId: user?.id,
        });
        setEntries(list);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, toLocalYmd, user?.id]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const loc = LOCALE_MAP[locale] ?? "en-GB";

  const dayLabel = useCallback(
    (ymd: string): string => {
      if (ymd === todayYmd) return t("time.today");
      if (ymd === yesterdayYmd) return t("projectOverview.yesterday");
      const [y, m, d] = ymd.split("-").map(Number);
      if (!y || !m || !d) return ymd;
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
    },
    [todayYmd, yesterdayYmd, t, loc]
  );

  const formatClock = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return "—";
      return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    },
    [loc]
  );

  const formatDur = useCallback(
    (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}${t("time.hoursShort")} ${String(m).padStart(2, "0")}${t("time.minutesShort")}`;
    },
    [t]
  );

  const grouped = useMemo(() => groupTimeEntriesByDay(entries, toLocalYmd), [entries, toLocalYmd]);
  const grandTotal = useMemo(() => sumMinutes(entries), [entries]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t("projectOverview.timeDetailTitle")}
          </Text>
          {projectName ? (
            <Text style={styles.headerSub} numberOfLines={2}>
              {projectName}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>{t("time.total")}</Text>
            <Text style={styles.totalValue}>{formatDur(grandTotal)}</Text>
          </View>

          {grouped.length === 0 ? (
            <Text style={styles.empty}>{t("projectOverview.timeDetailEmpty")}</Text>
          ) : (
            grouped.map(({ dayKey, entries: dayEntries }) => (
              <View key={dayKey} style={styles.dayBlock}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayTitle}>{dayLabel(dayKey)}</Text>
                  <Text style={styles.dayTotal}>{formatDur(sumMinutes(dayEntries))}</Text>
                </View>
                {dayEntries.map((e) => (
                  <View key={e.id} style={styles.entryCard}>
                    <View style={styles.entryRow}>
                      <Text style={styles.entryTime}>
                        {formatClock(e.startedAt)} – {formatClock(e.endedAt)}
                      </Text>
                      <Text style={styles.entryDur}>{formatDur(e.durationMinutes ?? 0)}</Text>
                    </View>
                    <Text style={styles.entryMode}>
                      {e.mode === "manual" ? t("time.modeManual") : t("time.modeTimer")}
                    </Text>
                    {e.note ? <Text style={styles.entryNote}>{e.note}</Text> : null}
                    {formatGpsShort(e.gpsStart) ? (
                      <View style={styles.locRow}>
                        <Text style={styles.locLabel}>{t("time.dailyProtocol.startLocation")}</Text>
                        <Text style={styles.locText} selectable>
                          {formatGpsShort(e.gpsStart)}
                        </Text>
                        {mapsUrlForPoint(e.gpsStart) ? (
                          <TouchableOpacity onPress={() => Linking.openURL(mapsUrlForPoint(e.gpsStart)!)}>
                            <Text style={styles.mapLink}>{t("projectOverview.showOnMap")}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                    {formatGpsShort(e.gpsEnd) ? (
                      <View style={styles.locRow}>
                        <Text style={styles.locLabel}>{t("time.dailyProtocol.endLocation")}</Text>
                        <Text style={styles.locText} selectable>
                          {formatGpsShort(e.gpsEnd)}
                        </Text>
                        {mapsUrlForPoint(e.gpsEnd) ? (
                          <TouchableOpacity onPress={() => Linking.openURL(mapsUrlForPoint(e.gpsEnd)!)}>
                            <Text style={styles.mapLink}>{t("projectOverview.showOnMap")}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.sm },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  totalCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 14, color: colors.textMuted, fontWeight: "600" },
  totalValue: { fontSize: 16, fontWeight: "800", color: colors.text },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg },
  dayBlock: { marginBottom: spacing.lg },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  dayTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  dayTotal: { fontSize: 14, fontWeight: "600", color: colors.primary },
  entryCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  entryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryTime: { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1 },
  entryDur: { fontSize: 14, fontWeight: "700", color: colors.text },
  entryMode: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  entryNote: { fontSize: 13, color: colors.text, marginTop: spacing.sm },
  locRow: { marginTop: spacing.sm },
  locLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600", marginBottom: 2 },
  locText: { fontSize: 12, color: colors.text },
  mapLink: { fontSize: 13, color: colors.primary, fontWeight: "600", marginTop: 4 },
});
