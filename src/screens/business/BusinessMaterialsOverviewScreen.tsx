import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import {
  formatBusinessMaterialCurrencyTotals,
  getBusinessMaterialsOverview,
  type BusinessMaterialsOverview,
  type CurrencyTotal,
} from "../../services/businessMaterials";
import { colors, spacing } from "../../theme";

function categoryLabel(t: (k: string) => string, category: string): string {
  const key = `materialCategory.${category}`;
  const v = t(key);
  return v === key ? category : v;
}

function TotalsText({ groups }: { groups: CurrencyTotal[] }) {
  return <Text style={styles.rowValue}>{formatBusinessMaterialCurrencyTotals(groups)}</Text>;
}

export function BusinessMaterialsOverviewScreen() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { activeBusinessOrgId } = useActiveOrg();
  const { canViewBusinessDashboard } = useOrgAccess();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<BusinessMaterialsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusinessOrgId || !canViewBusinessDashboard) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const data = await getBusinessMaterialsOverview(activeBusinessOrgId);
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.unknown"));
      setOverview(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeBusinessOrgId, canViewBusinessDashboard, t]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const openProjectMaterials = (projectId: string, projectName: string) => {
    const rootNav = navigation.getParent() as { navigate?: (name: string, params?: object) => void } | null;
    rootNav?.navigate?.("ProjectMaterials", { projectId, projectName });
  };

  if (!canViewBusinessDashboard) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t("business.materials.noAccess")}</Text>
      </View>
    );
  }

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const emptyUsed = (overview?.usedItemCount ?? 0) === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={styles.screenTitle}>{t("business.materials.title")}</Text>
      <Text style={styles.screenSubtitle}>{t("business.materials.subtitle")}</Text>

      {error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>{t("business.contacts.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {overview ? (
        <>
          <View style={styles.kpiGrid}>
            <View style={[styles.card, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>{t("business.materials.materialTotal")}</Text>
              {overview.totalsByCurrency.length === 0 ? (
                <Text style={styles.kpiValue}>0.00 EUR</Text>
              ) : (
                overview.totalsByCurrency.map((g) => (
                  <Text key={g.currency} style={styles.kpiValue}>
                    {g.total.toFixed(2)} {g.currency}
                  </Text>
                ))
              )}
            </View>
            <View style={[styles.card, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>{t("business.materials.usedItems")}</Text>
              <Text style={styles.kpiValue}>{overview.usedItemCount}</Text>
            </View>
            <View style={[styles.card, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>{t("business.materials.suggestedItems")}</Text>
              <Text style={styles.kpiValue}>{overview.suggestedItemCount}</Text>
            </View>
            <View style={[styles.card, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>{t("business.materials.projectsWithMaterials")}</Text>
              <Text style={styles.kpiValue}>{overview.projectsWithMaterialsCount}</Text>
            </View>
          </View>

          {overview.totalsByCurrency.length > 1 ? (
            <Text style={styles.multiCurrencyHint}>{t("business.materials.multiCurrencyHint")}</Text>
          ) : null}

          {emptyUsed ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>{t("business.materials.emptyUsed")}</Text>
            </View>
          ) : null}

          {overview.projectSummaries.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("business.materials.topProjects")}</Text>
              {overview.projectSummaries.map((row) => (
                <TouchableOpacity
                  key={row.projectId}
                  style={styles.row}
                  onPress={() => openProjectMaterials(row.projectId, row.projectName)}
                  activeOpacity={0.85}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {row.projectName}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {t("business.materials.usedItems")}: {row.usedItemCount} ·{" "}
                      {t("business.materials.suggestedItems")}: {row.suggestedItemCount}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    <TotalsText groups={row.totalsByCurrency} />
                    <Text style={styles.openLink}>{t("business.materials.openProject")} ›</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {overview.categorySummaries.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("business.materials.categories")}</Text>
              {overview.categorySummaries.map((row) => (
                <View key={row.category} style={styles.rowStatic}>
                  <Text style={styles.rowTitle}>{categoryLabel(t, row.category)}</Text>
                  <TotalsText groups={row.totalsByCurrency} />
                </View>
              ))}
            </View>
          ) : null}

          {overview.supplierSummaries.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("business.materials.suppliers")}</Text>
              {overview.supplierSummaries.map((row) => (
                <View key={row.supplierName} style={styles.rowStatic}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.supplierName}
                  </Text>
                  <TotalsText groups={row.totalsByCurrency} />
                </View>
              ))}
            </View>
          ) : null}

          {overview.pendingSuggestedCount > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("business.materials.pendingSuggested")}</Text>
              <Text style={styles.pendingText}>
                {t("business.materials.pendingSuggestedCount", {
                  count: String(overview.pendingSuggestedCount),
                })}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0E1D3A" },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0E1D3A" },
  screenTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF" },
  screenSubtitle: { fontSize: 14, lineHeight: 20, color: "#CBD5E1", marginBottom: 4 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpiCard: { width: "48%", flexGrow: 1, minWidth: 150 },
  kpiLabel: { fontSize: 12, fontWeight: "600", color: "#64748B" },
  kpiValue: { fontSize: 20, fontWeight: "800", color: "#0F172A", marginTop: 4 },
  multiCurrencyHint: { fontSize: 12, color: "#94A3B8", lineHeight: 17 },
  emptyText: { fontSize: 14, lineHeight: 20, color: "#64748B" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E8F0",
  },
  rowStatic: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E8F0",
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#0F172A", flex: 1 },
  rowMeta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  rowValue: { fontSize: 14, fontWeight: "700", color: colors.primary, textAlign: "right" },
  openLink: { fontSize: 12, fontWeight: "600", color: "#1E3A8A" },
  pendingText: { fontSize: 14, color: "#475569", lineHeight: 20 },
  muted: { color: "#94A3B8", fontSize: 14 },
  errorText: { color: colors.error, fontSize: 14 },
  retryBtn: { alignSelf: "flex-start", paddingVertical: spacing.sm },
  retryText: { color: colors.primary, fontWeight: "600" },
});
