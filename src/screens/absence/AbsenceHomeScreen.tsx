import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import { toYmd } from "../../utils/date";
import * as absences from "../../services/absences";
import type { AbsenceDoc } from "../../services/absences";
import { ABSENCE_COLOR, ABSENCE_STATUS_KEYS, ABSENCE_TYPE_KEYS } from "./absenceUi";

function formatRange(absence: AbsenceDoc): string {
  if (absence.startDate === absence.endDate) return absence.startDate;
  return `${absence.startDate} → ${absence.endDate}`;
}

function statusBadgeColor(status: AbsenceDoc["status"]): { bg: string; fg: string } {
  switch (status) {
    case "approved":
      return { bg: "rgba(34,197,94,0.15)", fg: "#22c55e" };
    case "pending":
      return { bg: "rgba(245,158,11,0.15)", fg: "#f59e0b" };
    case "rejected":
      return { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" };
    case "cancelled":
      return { bg: "rgba(148,163,184,0.18)", fg: "#94a3b8" };
  }
}

export function AbsenceHomeScreen() {
  const { user, orgId } = useAuth();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<AbsenceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isOwner = !!user?.id && !!orgId && absences.isSoloOwner(user.id, orgId);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - 12);
      const toDate = new Date();
      toDate.setMonth(toDate.getMonth() + 12);
      const list = await absences.listAbsencesForUser(user.id, toYmd(fromDate), toYmd(toDate));
      list.sort((a, b) => a.startDate.localeCompare(b.startDate));
      setItems(list);
    } catch (e) {
      if (__DEV__) console.warn("[AbsenceHomeScreen] load failed:", e);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const today = toYmd(new Date());
  const sections = useMemo(() => {
    const upcoming: AbsenceDoc[] = [];
    const pending: AbsenceDoc[] = [];
    const history: AbsenceDoc[] = [];
    for (const a of items) {
      if (a.status === "pending") {
        pending.push(a);
      } else if (a.status === "approved" && a.endDate >= today) {
        upcoming.push(a);
      } else {
        history.push(a);
      }
    }
    upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    pending.sort((a, b) => a.startDate.localeCompare(b.startDate));
    history.sort((a, b) => b.startDate.localeCompare(a.startDate));
    return { upcoming, pending, history };
  }, [items, today]);

  const goCreate = useCallback(() => {
    navigation.navigate("AbsenceRequest", {});
  }, [navigation]);

  const goDetail = useCallback(
    (absence: AbsenceDoc) => {
      navigation.navigate("AbsenceDetail", { absenceId: absence.id });
    },
    [navigation]
  );

  const renderRow = (a: AbsenceDoc) => {
    const colorBar = ABSENCE_COLOR[a.type];
    const status = statusBadgeColor(a.status);
    return (
      <TouchableOpacity
        key={a.id}
        style={styles.row}
        onPress={() => goDetail(a)}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[styles.colorBar, { backgroundColor: colorBar }]} />
        <View style={styles.rowBody}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowType} numberOfLines={1}>
              {t(ABSENCE_TYPE_KEYS[a.type])}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusText, { color: status.fg }]}>{t(ABSENCE_STATUS_KEYS[a.status])}</Text>
            </View>
          </View>
          <Text style={styles.rowDates}>{formatRange(a)}</Text>
          {a.note ? (
            <Text style={styles.rowNote} numberOfLines={2}>
              {a.note}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <TouchableOpacity style={styles.addBtn} onPress={goCreate} activeOpacity={0.85}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.addBtnText}>{isOwner ? t("absence.add") : t("absence.request")}</Text>
      </TouchableOpacity>

      {items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="umbrella-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t("absence.empty")}</Text>
          <Text style={styles.emptyHint}>{t("absence.emptyHint")}</Text>
        </View>
      ) : (
        <>
          {sections.upcoming.length > 0 && (
            <Section title={t("absence.upcoming")}>{sections.upcoming.map(renderRow)}</Section>
          )}
          {sections.pending.length > 0 && (
            <Section title={t("absence.pendingSection")}>{sections.pending.map(renderRow)}</Section>
          )}
          {sections.history.length > 0 && (
            <Section title={t("absence.history")}>{sections.history.map(renderRow)}</Section>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.labelMutedOnDark,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionBody: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  colorBar: { width: 6 },
  rowBody: { flex: 1, padding: spacing.md, gap: 4 },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowType: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1, marginRight: spacing.sm },
  rowDates: { fontSize: 14, color: colors.textMuted },
  rowNote: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 12, fontWeight: "700" },
  emptyCard: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyHint: { fontSize: 14, color: colors.textMuted, textAlign: "center" },
});
