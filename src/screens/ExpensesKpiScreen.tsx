import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as expensesService from "../services/expenses";
import type { ProjectDoc } from "../services/projects";
import type { ExpenseDoc } from "../services/expenses";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import { buildExpensesKpiCsv, exportExpensesKpiToCsv, type ExpenseExportRow } from "../services/projectExport";
import { colors, radius, spacing } from "../theme";

type RangeKey = "today" | "7d" | "30d" | "month";
type ProjectFilter = "all" | "mine" | "shared";

type ProjectExpenseRow = {
  projectId: string;
  projectName: string;
  totalAmount: number;
  travelAmount: number;
  otherAmount: number;
  isShared: boolean;
};

type ProjectExpensesData = {
  projectId: string;
  projectName: string;
  isShared: boolean;
  expenses: ExpenseDoc[];
};

function getRangeBounds(rangeKey: RangeKey): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  let from: Date;

  switch (rangeKey) {
    case "today":
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      break;
    case "7d":
      from = new Date(now);
      from.setDate(from.getDate() - 7);
      from.setHours(0, 0, 0, 0);
      break;
    case "30d":
      from = new Date(now);
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      break;
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      from.setHours(0, 0, 0, 0);
      break;
    default:
      from = new Date(now);
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

function filterExpensesByRange(expenses: ExpenseDoc[], rangeKey: RangeKey): ExpenseDoc[] {
  const { from, to } = getRangeBounds(rangeKey);
  return expenses.filter((exp) => {
    if (!exp.date || exp.status !== "READY" || exp.amount == null) return false;
    const d = new Date(exp.date);
    return d >= from && d <= to;
  });
}

export function ExpensesKpiScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [projectExpensesData, setProjectExpensesData] = useState<ProjectExpensesData[]>([]);
  const [accessMap, setAccessMap] = useState<Map<string, { canReadExpenses: boolean; canWrite: boolean; sharedItemsExpenses: boolean; isShared: boolean }>>(new Map());

  const stackNav = navigation as { navigate: (name: string, params?: object) => void };

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (!user?.id || !orgId) {
        setLoading(false);
        return;
      }
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const allProjects = await projectsService.listMyProjects(orgId);
        const accessMapNew = new Map<string, { canReadExpenses: boolean; canWrite: boolean; sharedItemsExpenses: boolean; isShared: boolean }>();

        for (const p of allProjects) {
          const access = await fetchProjectAccess(p.id, user.id, p.ownerId);
          accessMapNew.set(p.id, {
            canReadExpenses: access.canReadExpenses,
            canWrite: access.canWrite,
            sharedItemsExpenses: access.sharedItems?.expenses === true,
            isShared: p.isSharedToMe === true,
          });
        }

        setAccessMap(accessMapNew);

        const projectsWithExpenses = allProjects.filter((p) => accessMapNew.get(p.id)?.canReadExpenses === true);

        const data: ProjectExpensesData[] = [];
        for (const project of projectsWithExpenses) {
          try {
            const expenses = await expensesService.listExpensesByProject(project.id);
            data.push({
              projectId: project.id,
              projectName: project.name,
              isShared: project.isSharedToMe === true,
              expenses,
            });
          } catch (err) {
            console.warn(`[ExpensesKpi] Failed to load expenses for ${project.id}:`, err);
          }
        }

        setProjects(allProjects);
        setProjectExpensesData(data);
      } catch (error) {
        console.error("[ExpensesKpi] Error loading:", error);
        setProjectExpensesData([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id, orgId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const projectRows = useMemo(() => {
    return projectExpensesData.map((d) => {
      const filtered = filterExpensesByRange(d.expenses, rangeKey);
      const totalAmount = filtered.reduce((sum, e) => sum + (e.amount ?? 0), 0);
      const travelAmount = filtered.filter((e) => e.category === "TRAVEL").reduce((sum, e) => sum + (e.amount ?? 0), 0);
      const otherAmount = totalAmount - travelAmount;
      return {
        projectId: d.projectId,
        projectName: d.projectName,
        totalAmount,
        travelAmount,
        otherAmount,
        isShared: d.isShared,
      };
    });
  }, [projectExpensesData, rangeKey]);

  const filteredRows = useMemo(() => {
    if (projectFilter === "mine") {
      return projectRows.filter((r) => !r.isShared);
    }
    if (projectFilter === "shared") {
      return projectRows.filter((r) => r.isShared);
    }
    return projectRows;
  }, [projectRows, projectFilter]);

  const totalSum = useMemo(() => filteredRows.reduce((s, r) => s + r.totalAmount, 0), [filteredRows]);
  const travelSum = useMemo(() => filteredRows.reduce((s, r) => s + r.travelAmount, 0), [filteredRows]);
  const otherSum = useMemo(() => totalSum - travelSum, [totalSum, travelSum]);

  const exportRows = useMemo((): ExpenseExportRow[] => {
    const rows: ExpenseExportRow[] = [];
    for (const d of projectExpensesData) {
      const passesFilter =
        projectFilter === "all" || (projectFilter === "mine" && !d.isShared) || (projectFilter === "shared" && d.isShared);
      if (!passesFilter) continue;
      const filtered = filterExpensesByRange(d.expenses, rangeKey);
      for (const e of filtered) {
        if (e.status !== "READY" || e.amount == null) continue;
        const dateStr = e.date ? new Date(e.date).toISOString().slice(0, 10) : "";
        rows.push({
          projectName: d.projectName,
          date: dateStr,
          title: e.title ?? "",
          amount: e.amount,
          currency: e.currency ?? "EUR",
          supplierName: e.supplierName,
          category: e.category,
          note: e.note,
        });
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName));
  }, [projectExpensesData, rangeKey, projectFilter]);

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (exportRows.length === 0) {
      Alert.alert(t("expensesKpi.export"), t("expensesKpi.noExpensesInPeriod"));
      return;
    }
    setExporting(true);
    try {
      const rangeLabel = rangeLabels.find((r) => r.key === rangeKey)?.label ?? t("expensesKpi.days30");
      const csv = buildExpensesKpiCsv(exportRows, rangeLabel);
      const fileName = `staveto_vydavky_${new Date().toISOString().slice(0, 10)}.csv`;
      const result = await exportExpensesKpiToCsv(csv, fileName);
      if (!result.ok) {
        Alert.alert(t("expensesKpi.export"), result.error ?? t("expensesKpi.exportFailed"));
      }
    } catch (err) {
      Alert.alert(t("expensesKpi.export"), err instanceof Error ? err.message : t("expensesKpi.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [exportRows, rangeKey]);

  const handleProjectRowPress = useCallback(
    (row: ProjectExpenseRow) => {
      stackNav.navigate("ProjectOverview", {
        projectId: row.projectId,
        projectName: row.projectName,
        expandExpensesSection: true,
      });
    },
    [stackNav]
  );

  const rangeLabels: { key: RangeKey; label: string }[] = [
    { key: "today", label: t("expensesKpi.today") },
    { key: "7d", label: t("expensesKpi.days7") },
    { key: "30d", label: t("expensesKpi.days30") },
    { key: "month", label: t("expensesKpi.thisMonth") },
  ];

  if (loading && !projectExpensesData.length) {
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
          <TouchableOpacity onPress={() => (navigation as { goBack: () => void }).goBack()} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t("projectOverview.expenses")}</Text>
          <TouchableOpacity
            onPress={handleExport}
            disabled={exporting || exportRows.length === 0}
            style={styles.exportButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.textOnDark} />
            ) : (
              <Ionicons name="download-outline" size={24} color={colors.textOnDark} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.rangeRow}>
          {rangeLabels.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.rangeChip, rangeKey === key && styles.rangeChipActive]}
              onPress={() => setRangeKey(key)}
            >
              <Text style={[styles.rangeChipText, rangeKey === key && styles.rangeChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterRow}>
          {(["all", "mine", "shared"] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, projectFilter === f && styles.filterChipActive]}
              onPress={() => setProjectFilter(f)}
            >
              <Text style={[styles.filterChipText, projectFilter === f && styles.filterChipTextActive]}>
                {f === "all" ? t("home.filterAll") : f === "mine" ? t("home.filterMine") : t("home.filterShared")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t("expenses.total")}</Text>
            <Text style={styles.kpiValue}>{totalSum.toFixed(2)}€</Text>
          </View>
          {travelSum > 0 || otherSum > 0 ? (
            <>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>{t("expenses.travel")}</Text>
                <Text style={styles.kpiValue}>{travelSum.toFixed(2)}€</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>{t("expenses.other")}</Text>
                <Text style={styles.kpiValue}>{otherSum.toFixed(2)}€</Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("expenses.byProjects")}</Text>
        </View>

        {filteredRows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("expenses.emptyPeriod")}</Text>
          </View>
        ) : (
          filteredRows.map((row) => (
            <TouchableOpacity
              key={row.projectId}
              style={styles.projectRow}
              onPress={() => handleProjectRowPress(row)}
              activeOpacity={0.8}
            >
              <View style={styles.projectRowLeft}>
                <Text style={styles.projectRowName} numberOfLines={1}>
                  {row.projectName}
                </Text>
                {row.isShared && (
                  <View style={styles.sharedBadge}>
                    <Text style={styles.sharedBadgeText}>👥 {t("home.sharedBadge")}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.projectRowAmount}>{row.totalAmount.toFixed(2)}€</Text>
            </TouchableOpacity>
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
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  exportButton: {
    padding: spacing.xs,
    minWidth: 44,
    alignItems: "center",
  },
  rangeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rangeChip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rangeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rangeChipText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "600",
  },
  rangeChipTextActive: {
    color: "#fff",
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  kpiCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
  },
  sectionHeader: {
    marginBottom: spacing.sm,
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
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  projectRowName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  projectRowAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  sharedBadge: {
    backgroundColor: "rgba(255,159,67,0.25)",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sharedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ff9f43",
  },
  emptyContainer: {
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
