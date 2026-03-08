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
  ScrollView,
  Image,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import type { ProblemDoc, ProblemStatus, ProblemPriority, ProblemPhoto } from "../services/problems";
import * as storageSmart from "../services/storageSmart";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { colors, radius, spacing } from "../theme";

function ProblemPhotoThumb({
  photo,
  onlineStatus,
}: {
  photo: ProblemPhoto;
  onlineStatus: { isOffline: boolean; isPoorNetwork: boolean };
}) {
  const [url, setUrl] = React.useState<string | null>(photo.downloadURL ?? null);
  React.useEffect(() => {
    if (!url && photo.path) {
      storageSmart
        .getDownloadUrlSmart(photo.path, onlineStatus)
        .then((u) => u && setUrl(u))
        .catch(() => {});
    }
  }, [photo.path, photo.downloadURL, onlineStatus.isOffline, onlineStatus.isPoorNetwork]);
  return url ? (
    <Image source={{ uri: url }} style={styles.itemPhoto} />
  ) : (
    <View style={styles.itemPhotoPlaceholder} />
  );
}

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
  const { isOffline, isPoorNetwork } = useOnlineStatus();
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProblemStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<ProblemPriority | null>(null);
  const [archivedFilter, setArchivedFilter] = useState<"active" | "archived">("active");

  const resetFilters = useCallback(() => {
    setArchivedFilter("active");
    setStatusFilter("all");
    setPriorityFilter(null);
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await problemsService.listProblems(projectId);
      let filtered = list;
      if (archivedFilter === "archived") {
        filtered = filtered.filter((p) => !!p.archivedAt);
      } else {
        filtered = filtered.filter((p) => !p.archivedAt);
      }
      if (statusFilter !== "all") filtered = filtered.filter((p) => p.status === statusFilter);
      if (priorityFilter !== null) filtered = filtered.filter((p) => p.priority === priorityFilter);
      setProblems(filtered);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chyba načítania.";
      Alert.alert(t("common.error"), msg);
      setProblems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, statusFilter, priorityFilter, archivedFilter, t]);

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
    const title = projectType === "MAINTENANCE" ? t("problems.titlePoruchy") : projectType === "TRADE" ? t("problems.titleReklamacie") : (projectType === "BUILD" || projectType === "MANAGEMENT") ? t("problems.titleDefekty") : projectType === "RESIDENTIAL" ? t("problems.titleProblemy") : t("problems.title");
    navigation.setOptions({ title });
  }, [navigation, projectType, t]);

  const renderItem = ({ item }: { item: ProblemDoc }) => (
    <TouchableOpacity style={styles.item} onPress={() => openDetail(item)} activeOpacity={0.7}>
      {item.photos?.length > 0 && (
                <ProblemPhotoThumb
                  photo={item.photos[0]}
                  onlineStatus={{ isOffline, isPoorNetwork }}
                />
              )}
      <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] }]} />
      <View style={styles.itemContent}>
        <Text style={styles.itemCategory}>{t(`problems.categories.${item.category}`)}</Text>
        <Text style={styles.itemDescription} numberOfLines={2}>{item.shortDescription}</Text>
        {!!item.equipmentName && (
          <Text style={styles.itemEquipment} numberOfLines={1}>
            {item.equipmentName}
          </Text>
        )}
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
      <View style={styles.filterSection}>
        {/* Primary: Project scope segmented control */}
        <View style={styles.scopeRow}>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segmentedSegment, archivedFilter === "active" && styles.segmentedSegmentActive]}
              onPress={() => setArchivedFilter("active")}
            >
              <Text style={[styles.segmentedText, archivedFilter === "active" && styles.segmentedTextActive]}>
                {t("problems.filters.active")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentedSegment, archivedFilter === "archived" && styles.segmentedSegmentActive]}
              onPress={() => setArchivedFilter("archived")}
            >
              <Text style={[styles.segmentedText, archivedFilter === "archived" && styles.segmentedTextActive]}>
                {t("problems.filters.archived")}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.resetButton} onPress={resetFilters}>
            <Text style={styles.resetButtonText}>{t("problems.filters.reset")}</Text>
          </TouchableOpacity>
        </View>
        {/* Secondary: Status chips (single horizontal scroll row) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusChipsRow}
          style={styles.statusChipsScroll}
        >
          <TouchableOpacity
            style={[styles.statusChip, statusFilter === "all" && styles.statusChipActive]}
            onPress={() => setStatusFilter("all")}
          >
            <Text style={[styles.statusChipText, statusFilter === "all" && styles.statusChipTextActive]}>
              {t("problems.filters.all")}
            </Text>
          </TouchableOpacity>
          {(["open", "in_progress", "fixed", "verified", "rejected"] as ProblemStatus[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.statusChip, statusFilter === s && styles.statusChipActive]}
              onPress={() => setStatusFilter(s)}
            >
              <Text style={[styles.statusChipText, statusFilter === s && styles.statusChipTextActive]}>
                {t(`problems.statuses.${s}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {/* Priority: smaller chips (no All; default = all) */}
        <View style={styles.priorityRow}>
          {(["low", "medium", "high"] as ProblemPriority[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.priorityChip, priorityFilter === p && styles.priorityChipActive]}
              onPress={() => setPriorityFilter(priorityFilter === p ? null : p)}
            >
              <Text style={[styles.priorityChipText, priorityFilter === p && styles.priorityChipTextActive]}>
                {t(`problems.priorities.${p}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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
  filterSection: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  scopeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius,
    padding: 2,
  },
  segmentedSegment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius - 2,
    minWidth: 72,
    alignItems: "center",
  },
  segmentedSegmentActive: { backgroundColor: colors.primary },
  segmentedText: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
  segmentedTextActive: { color: "#fff", fontWeight: "600" },
  resetButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  resetButtonText: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  statusChipsScroll: { maxHeight: 40, marginBottom: spacing.xs },
  statusChipsRow: { flexDirection: "row", gap: spacing.xs, paddingRight: spacing.md },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  statusChipActive: { backgroundColor: colors.primary },
  statusChipText: { color: "rgba(255,255,255,0.85)", fontSize: 12 },
  statusChipTextActive: { color: "#fff", fontWeight: "600" },
  priorityRow: { flexDirection: "row", gap: spacing.xs },
  priorityChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  priorityChipActive: { backgroundColor: colors.primary },
  priorityChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  priorityChipTextActive: { color: "#fff", fontWeight: "600" },
  list: { padding: spacing.md, paddingBottom: 80 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemPhoto: { width: 56, height: 56, borderRadius: 8, marginRight: spacing.sm },
  itemPhotoPlaceholder: { width: 56, height: 56, borderRadius: 8, marginRight: spacing.sm, backgroundColor: "#eee" },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  itemContent: { flex: 1 },
  itemCategory: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase", marginBottom: 2 },
  itemDescription: { fontSize: 15, color: colors.text, fontWeight: "500" },
  itemEquipment: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
