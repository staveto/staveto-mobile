import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Image,
  Linking,
  RefreshControl,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import * as problemPhotosService from "../services/problemPhotos";
import type { ProblemDoc, ProblemStatus } from "../services/problems";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";

const PRIORITY_COLORS: Record<string, string> = {
  low: "#2e7d32",
  medium: "#f57c00",
  high: "#c62828",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type RouteParams = { projectId: string; problemId: string; projectName?: string; projectType?: string };

export function ProblemDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId, problemId } = (route.params ?? {}) as RouteParams;
  const access = useProjectAccess(projectId);
  const [problem, setProblem] = useState<ProblemDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());

  const canEdit =
    access.isOwner ||
    problem?.createdByUid === user?.id ||
    problem?.assigneeUid === user?.id;

  const load = useCallback(async () => {
    if (!projectId || !problemId) return;
    try {
      const p = await problemsService.getProblem(projectId, problemId);
      setProblem(p);
      if (p?.photos?.length) {
        const urls = new Map<string, string>();
        for (const ph of p.photos) {
          try {
            const url = ph.downloadURL ?? (await problemPhotosService.getProblemPhotoURL(ph.path));
            urls.set(ph.path, url);
          } catch (e) {
            console.warn("[ProblemDetail] Failed to load photo URL:", ph.path);
          }
        }
        setPhotoUrls(urls);
      }
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, problemId, navigation, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const updateStatus = async (newStatus: ProblemStatus) => {
    if (!projectId || !problemId || !canEdit) return;
    try {
      await problemsService.updateProblem(projectId, problemId, { status: newStatus });
      setProblem((p) => (p ? { ...p, status: newStatus } : null));
      showToast(t("problems.saved"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
    }
  };

  const deleteProblem = () => {
    if (!access.isOwner) return;
    Alert.alert(
      t("common.delete"),
      t("problems.deleteConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await problemsService.deleteProblem(projectId, problemId);
              showToast(t("problems.deleted"));
              navigation.goBack();
            } catch (e) {
              Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
            }
          },
        },
      ]
    );
  };

  const openPhoto = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  if (loading || !problem) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const statusFlow: ProblemStatus[] = ["open", "in_progress", "fixed", "verified"];
  const currentIndex = statusFlow.indexOf(problem.status);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[problem.priority] ?? "#888" }]} />
          <Text style={styles.category}>{t(`problems.categories.${problem.category}`)}</Text>
          <Text style={styles.priority}>{t(`problems.priorities.${problem.priority}`)}</Text>
        </View>

        <Text style={styles.description}>{problem.shortDescription}</Text>

        <View style={styles.meta}>
          <Text style={styles.metaLabel}>{t("problems.assignee")}</Text>
          <Text style={styles.metaValue}>{problem.assigneeName || problem.assigneeUid || "—"}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaLabel}>{t("problems.createdBy")}</Text>
          <Text style={styles.metaValue}>{problem.createdByName || problem.createdByUid || "—"}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaLabel}>{t("problems.createdAt")}</Text>
          <Text style={styles.metaValue}>{formatDate(problem.createdAt)}</Text>
        </View>
        {problem.dueDate && (
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>{t("problems.dueDate")}</Text>
            <Text style={styles.metaValue}>{formatDate(problem.dueDate)}</Text>
          </View>
        )}

        <View style={styles.statusSection}>
          <Text style={styles.metaLabel}>{t("problems.status")}</Text>
          <Text style={styles.statusValue}>{t(`problems.statuses.${problem.status}`)}</Text>
          {canEdit && problem.status !== "rejected" && (
            <View style={styles.statusButtons}>
              {currentIndex >= 0 && currentIndex < statusFlow.length - 1 && (
                <TouchableOpacity
                  style={styles.statusBtn}
                  onPress={() => updateStatus(statusFlow[currentIndex + 1])}
                >
                  <Text style={styles.statusBtnText}>
                    → {t(`problems.statuses.${statusFlow[currentIndex + 1]}`)}
                  </Text>
                </TouchableOpacity>
              )}
              {problem.status !== "rejected" && (
                <TouchableOpacity
                  style={[styles.statusBtn, styles.statusBtnReject]}
                  onPress={() => updateStatus("rejected")}
                >
                  <Text style={styles.statusBtnText}>{t("problems.statuses.rejected")}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {problem.photos && problem.photos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.metaLabel}>{t("problems.photos")}</Text>
            <View style={styles.photoGrid}>
              {problem.photos.map((ph) => {
                const url = photoUrls.get(ph.path) ?? ph.downloadURL;
                if (!url) return null;
                return (
                  <TouchableOpacity key={ph.path} onPress={() => openPhoto(url)}>
                    <Image source={{ uri: url }} style={styles.photoThumb} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {access.isOwner && (
        <TouchableOpacity style={styles.deleteBtn} onPress={deleteProblem}>
          <Ionicons name="trash-outline" size={20} color={colors.error} />
          <Text style={styles.deleteBtnText}>{t("common.delete")}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md, flexWrap: "wrap", gap: spacing.sm },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  category: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase" },
  priority: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  description: { fontSize: 18, color: colors.text, marginBottom: spacing.lg, lineHeight: 24 },
  meta: { marginBottom: spacing.sm },
  metaLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  metaValue: { fontSize: 15, color: colors.text },
  statusSection: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: "#eee" },
  statusValue: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 4 },
  statusButtons: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm },
  statusBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  statusBtnReject: { backgroundColor: colors.error },
  statusBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  photosSection: { marginTop: spacing.lg },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.sm },
  photoThumb: { width: 100, height: 100, borderRadius: 8 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    gap: spacing.sm,
  },
  deleteBtnText: { color: colors.error, fontSize: 16 },
});
