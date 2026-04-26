/**
 * Project-scoped time history: entries grouped by local day (read-only).
 * Includes a month dropdown filter and shows project name with each entry.
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
  Modal,
  Pressable,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { auth } from "../firebase";
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

/** "last12" = rolling 12 months, "all" = full available history (24 months), or "YYYY-MM" for a single calendar month. */
type RangeFilter = "last12" | "all" | string;

const MONTH_OPTIONS_COUNT = 24;

export function ProjectTimeDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const routeParams = (route.params ?? {}) as RouteParams;
  const projectId = (routeParams.projectId ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const projectName = routeParams.projectName;

  const [entries, setEntries] = useState<TimeEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeFilter>("last12");
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const loc = LOCALE_MAP[locale] ?? "en-GB";

  /** Build an inclusive [fromYmd, toYmd] window for the selected range. */
  const computeRangeYmd = useCallback(
    (sel: RangeFilter): { fromYmd: string; toYmd: string } => {
      const now = new Date();
      if (sel === "all") {
        const from = new Date(now);
        from.setMonth(from.getMonth() - MONTH_OPTIONS_COUNT);
        return { fromYmd: toLocalYmd(from), toYmd: toLocalYmd(now) };
      }
      if (sel === "last12") {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 12);
        return { fromYmd: toLocalYmd(from), toYmd: toLocalYmd(now) };
      }
      const [yStr, mStr] = sel.split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 12);
        return { fromYmd: toLocalYmd(from), toYmd: toLocalYmd(now) };
      }
      const first = new Date(y, m - 1, 1);
      const lastDay = new Date(y, m, 0).getDate();
      const last = new Date(y, m - 1, lastDay);
      return { fromYmd: toLocalYmd(first), toYmd: toLocalYmd(last) };
    },
    [toLocalYmd]
  );

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const { fromYmd, toYmd } = computeRangeYmd(range);
        const list = await timeTracking.listTimeEntriesByProject(projectId, fromYmd, toYmd, {
          forUserId: user?.id ?? auth.currentUser?.uid ?? undefined,
        });
        setEntries(list);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, range, computeRangeYmd, user?.id]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

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

  const formatMonthLabel = useCallback(
    (year: number, month: number): string => {
      const d = new Date(year, month - 1, 1);
      const formatted = d.toLocaleDateString(loc, { month: "long", year: "numeric" });
      return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    },
    [loc]
  );

  /** Generate 24 most-recent calendar months as picker options. */
  const monthChoices = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < MONTH_OPTIONS_COUNT; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      out.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: formatMonthLabel(y, m) });
    }
    return out;
  }, [formatMonthLabel]);

  const rangeLabel = useMemo(() => {
    if (range === "all") return t("projectOverview.timeFilterAll");
    if (range === "last12") return t("projectOverview.timeFilterLast12");
    const found = monthChoices.find((opt) => opt.key === range);
    if (found) return found.label;
    const [yStr, mStr] = range.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (Number.isFinite(y) && Number.isFinite(m)) return formatMonthLabel(y, m);
    return t("projectOverview.timeFilterLast12");
  }, [range, monthChoices, formatMonthLabel, t]);

  const grouped = useMemo(() => groupTimeEntriesByDay(entries, toLocalYmd), [entries, toLocalYmd]);
  const grandTotal = useMemo(() => sumMinutes(entries), [entries]);

  const renderRangeOption = (key: RangeFilter, label: string) => {
    const selected = range === key;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.pickerItem, selected && styles.pickerItemSelected]}
        onPress={() => {
          setRange(key);
          setPickerOpen(false);
        }}
      >
        <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]} numberOfLines={1}>
          {label}
        </Text>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
      </TouchableOpacity>
    );
  };

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

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={styles.filterChip}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.text} />
          <Text style={styles.filterChipText} numberOfLines={1}>
            {rangeLabel}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </TouchableOpacity>
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
                {dayEntries.map((e) => {
                  const entryProjectName = e.projectNameSnapshot?.trim() || projectName?.trim() || "";
                  return (
                    <View key={e.id} style={styles.entryCard}>
                      <View style={styles.entryRow}>
                        <Text style={styles.entryTime}>
                          {formatClock(e.startedAt)} – {formatClock(e.endedAt)}
                        </Text>
                        <Text style={styles.entryDur}>{formatDur(e.durationMinutes ?? 0)}</Text>
                      </View>
                      {entryProjectName ? (
                        <Text style={styles.entryProject} numberOfLines={1}>
                          {entryProjectName}
                        </Text>
                      ) : null}
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
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerOpen(false)}>
          <Pressable
            style={[styles.pickerCard, { paddingBottom: insets.bottom + spacing.md }]}
            onPress={(ev) => ev.stopPropagation()}
          >
            <Text style={styles.pickerTitle}>{t("projectOverview.timeFilterTitle")}</Text>
            <ScrollView style={styles.pickerScroll}>
              {renderRangeOption("last12", t("projectOverview.timeFilterLast12"))}
              {renderRangeOption("all", t("projectOverview.timeFilterAll"))}
              <View style={styles.pickerDivider} />
              {monthChoices.map((opt) => renderRangeOption(opt.key, opt.label))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
  },
  filterChipText: { fontSize: 14, color: colors.text, fontWeight: "600", maxWidth: 220 },
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
  entryProject: { fontSize: 13, color: colors.primary, fontWeight: "600", marginTop: 4 },
  entryMode: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  entryNote: { fontSize: 13, color: colors.text, marginTop: spacing.sm },
  locRow: { marginTop: spacing.sm },
  locLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600", marginBottom: 2 },
  locText: { fontSize: 12, color: colors.text },
  mapLink: { fontSize: 13, color: colors.primary, fontWeight: "600", marginTop: 4 },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  pickerCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    maxHeight: "75%",
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerScroll: { maxHeight: "100%" },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerItemSelected: {
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  pickerItemText: { fontSize: 14, color: colors.text, flex: 1 },
  pickerItemTextSelected: { color: colors.primary, fontWeight: "700" },
  pickerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
});
