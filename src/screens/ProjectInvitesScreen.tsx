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
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { showToast } from "../helpers/toast";
import { colors, radius, spacing } from "../theme";
import * as invitesService from "../services/invites";
import type { PendingInvite } from "../services/invites";

function sharedItemsSummary(shared: Record<string, boolean> | undefined, t: (k: string) => string): string {
  if (!shared || typeof shared !== "object") return "";
  const parts: string[] = [];
  if (shared.tasks) parts.push(t("projectInvites.sharedTasks"));
  if (shared.phases) parts.push(t("projectInvites.sharedPhases"));
  if (shared.expenses) parts.push(t("projectInvites.sharedExpenses"));
  if (shared.diary) parts.push(t("projectInvites.sharedDiary"));
  if (shared.documents) parts.push(t("projectInvites.sharedDocuments"));
  return parts.length > 0 ? parts.join(", ") : "";
}

export function ProjectInvitesScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigation = useNavigation();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    const fbUser = auth()?.currentUser;
    if (__DEV__) {
      console.log("[invites] currentUser", fbUser?.uid ?? null, fbUser?.email ?? null);
    }
    if (!fbUser) {
      setLoading(true);
      setRefreshing(false);
      setInvites([]);
      return;
    }
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const list = await invitesService.listPendingInvites();
      setInvites(list);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Chyba";
      if (msg === "AUTH_NOT_READY") {
        setLoading(true);
        setInvites([]);
        return;
      }
      console.error("[ProjectInvitesScreen] Error loading invites:", error);
      setInvites([]);
      showToast(t("common.error") + ": " + msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (user?.id && auth()?.currentUser) {
      load();
    }
  }, [user?.id, load]);

  const onRefresh = useCallback(() => load(true), [load]);

  const handleAccept = useCallback(
    async (invite: PendingInvite) => {
      setActionProjectId(invite.projectId);
      try {
        const result = await invitesService.acceptProjectInvite(invite.projectId);
        if (result.ok) {
          setInvites((prev) => prev.filter((i) => i.projectId !== invite.projectId));
          showToast(t("projectInvites.acceptSuccess") || "Pozvánka prijatá");
          if (result.projectId && !result.already) {
            (navigation as { navigate: (name: string, params?: object) => void }).navigate(
              "ProjectOverview",
              { projectId: result.projectId, projectName: invite.projectName }
            );
          }
        } else {
          showToast(
            result.reason === "NOT_FOUND"
              ? (t("projectInvites.notFound") || "Pozvánka nebola nájdená")
              : (t("common.error") || "Chyba")
          );
        }
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string; details?: unknown };
        console.error("[ProjectInvitesScreen] Accept failed:", err?.code, err?.message, error);
        showToast(t("common.error") + ": " + (err?.message ?? "Chyba"));
      } finally {
        setActionProjectId(null);
      }
    },
    [navigation, t]
  );

  const handleDecline = useCallback(
    async (invite: PendingInvite) => {
      Alert.alert(
        t("projectInvites.declineConfirmTitle") || "Odmietnuť pozvánku",
        t("projectInvites.declineConfirmBody") || "Naozaj chcete odmietnuť túto pozvánku?",
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("projectInvites.decline") || "Odmietnuť",
            style: "destructive",
            onPress: async () => {
              setActionProjectId(invite.projectId);
              try {
                await invitesService.declineProjectInvite(invite.projectId);
                setInvites((prev) => prev.filter((i) => i.projectId !== invite.projectId));
                showToast(t("projectInvites.declineSuccess") || "Pozvánka odmietnutá");
              } catch (error: unknown) {
                console.error("[ProjectInvitesScreen] Decline failed:", error);
                showToast(t("common.error") + ": " + (error instanceof Error ? error.message : "Chyba"));
              } finally {
                setActionProjectId(null);
              }
            },
          },
        ]
      );
    },
    [t]
  );

  const renderItem = useCallback(
    ({ item }: { item: PendingInvite }) => {
      const summary = sharedItemsSummary(item.sharedItems, t);
      const isBusy = actionProjectId === item.projectId;

      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.projectName}>{item.projectName}</Text>
          </View>
          {summary ? (
            <Text style={styles.sharedSummary}>{summary}</Text>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.acceptBtn, isBusy && styles.btnDisabled]}
              onPress={() => handleAccept(item)}
              disabled={isBusy}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.acceptBtnText}>{t("projectInvites.accept") || "Prijať"}</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.declineBtn, isBusy && styles.btnDisabled]}
              onPress={() => handleDecline(item)}
              disabled={isBusy}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
              <Text style={styles.declineBtnText}>{t("projectInvites.decline") || "Odmietnuť"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [actionProjectId, handleAccept, handleDecline, t]
  );

  if (loading && invites.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t("loading.text")}</Text>
      </View>
    );
  }

  if (invites.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="mail-open-outline" size={64} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>{t("projectInvites.emptyTitle") || "Žiadne pozvánky"}</Text>
        <Text style={styles.emptySubtitle}>
          {t("projectInvites.emptySubtitle") || "Nemáte žiadne čakajúce pozvánky do projektov."}
        </Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={20} color={colors.primary} />
          <Text style={styles.refreshBtnText}>Obnoviť</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={invites}
      keyExtractor={(item) => `${item.projectId}-${item.memberId}`}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.lg * 3,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    marginBottom: spacing.sm,
  },
  projectName: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  sharedSummary: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  acceptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
  },
  acceptBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineBtnText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.md,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  refreshBtnText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 14,
  },
});
