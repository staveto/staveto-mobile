import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import type { ProblemDoc, ProblemStatus, ProblemPriority, ProblemCategory } from "../services/problems";
import { colors, radius, spacing } from "../theme";

const PRIORITY_COLORS: Record<ProblemPriority, string> = {
  low: "#2e7d32",
  medium: "#f57c00",
  high: "#c62828",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type RouteParams = {
  projectId: string;
  projectName?: string;
  projectType?: string;
};

export function ProblemsListScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { projectId, projectName, projectType } = (route.params ?? {}) as RouteParams;
  const access = useProjectAccess(projectId);
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProblemStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<ProblemPriority | "all">("all");

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const filters: Parameters<typeof problemsService.listProblems>[1] = {};
      if (statusFilter !== "all") filters.status = statusFilter;
      if (priorityFilter !== "all") filters.priority = priorityFilter;
      const list = await problemsService.listProblems(projectId, filters);
      setProblems(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chyba načítania.";
      Alert.alert(t("common.error"), msg);
      setProblems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, statusFilter, priorityFilter, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openDetail = (p: ProblemDoc) => {
    navigation.navigate("ProblemDetail", { projectId, problemId: p.id, projectName, projectType });
  };

  const openCreate = () => {
    navigation.navigate("CreateProblem", { projectId, projectName, projectType });
  };

  useEffect(() => {
    const title = projectType === "MAINTENANCE" ? t("problems.titlePoruchy") : projectType === "TRADE" ? t("problems.titleReklamacie") : t("problems.title");
    navigation.setOptions({ title });
  }, [navigation, projectType, t]);

  const renderItem = ({ item }: { item: ProblemDoc }) => (
    <TouchableOpacity style={styles.item} onPress={() => openDetail(item)} activeOpacity={0.7}>
      <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] }]} />
      <View style={styles.itemContent}>
        <Text style={styles.itemCategory}>{t(`problems.categories.${item.category}`)}</Text>
        <Text style={styles.itemDescription} numberOfLines={2}>{item.shortDescription}</Text>
        <View style={styles.itemMeta}>
          {item.assigneeName && (
            <Text style={styles.itemAssignee}>{item.assigneeName}</Text>
          )}
          <Text style={styles.itemStatus}>{t(`problems.statuses.${item.status}`)}</Text>
          <Text style={styles.itemDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );

  if (!projectId) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t("common.error")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <TouchableOpacity
          style={[styles.filterChip, statusFilter === "all" && styles.filterChipActive]}
          onPress={() => setStatusFilter("all")}
        >
          <Text style={[styles.filterText, statusFilter === "all" && styles.filterTextActive]}>{t("problems.filters.all")}</Text>
        </TouchableOpacity>
        {(["open", "in_progress", "fixed", "verified", "rejected"] as ProblemStatus[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>{t(`problems.statuses.${s}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.priorityFilters}>
        {(["all", "low", "medium", "high"] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.filterChip, priorityFilter === p && styles.filterChipActive]}
            onPress={() => setPriorityFilter(p)}
          >
            <Text style={[styles.filterText, priorityFilter === p && styles.filterTextActive]}>
              {p === "all" ? t("problems.filters.all") : t(`problems.priorities.${p}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : problems.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t("problems.empty")}</Text>
          {access.canWrite && (
            <TouchableOpacity style={styles.createButton} onPress={openCreate}>
              <Text style={styles.createButtonText}>{t("problems.new")}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={problems}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        />
      )}

      {access.canWrite && (
        <TouchableOpacity style={styles.fab} onPress={openCreate}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  filters: { flexDirection: "row", flexWrap: "wrap", padding: spacing.md, gap: spacing.sm },
  priorityFilters: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  filterChipActive: { backgroundColor: colors.primary },
  filterText: { color: colors.textOnDark, fontSize: 13 },
  filterTextActive: { color: "#fff", fontWeight: "600" },
  list: { padding: spacing.md, paddingBottom: 80 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  itemContent: { flex: 1 },
  itemCategory: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase", marginBottom: 2 },
  itemDescription: { fontSize: 15, color: colors.text, fontWeight: "500" },
  itemMeta: { flexDirection: "row", flexWrap: "wrap", marginTop: 4, gap: spacing.sm },
  itemAssignee: { fontSize: 12, color: colors.primary },
  itemStatus: { fontSize: 12, color: colors.textMuted },
  itemDate: { fontSize: 12, color: colors.textMuted },
  emptyText: { color: colors.textOnDark, fontSize: 16, marginTop: spacing.md, textAlign: "center" },
  createButton: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius },
  createButtonText: { color: "#fff", fontWeight: "600" },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  errorText: { color: colors.textOnDark },
});
