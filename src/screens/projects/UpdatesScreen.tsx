import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useI18n } from "../../i18n/I18nContext";
import { listUpdates, approveUpdate, ignoreUpdate, type ProjectUpdateDoc } from "../../services/updates";
import { isFeatureEnabled } from "../../services/features";
import { useAuth } from "../../context/AuthContext";
import { colors, radius, spacing } from "../../theme";

export function UpdatesScreen() {
  const route = useRoute();
  const { t } = useI18n();
  const { user } = useAuth();
  const projectId = (route.params as { projectId: string }).projectId;
  const [pending, setPending] = useState<ProjectUpdateDoc[]>([]);
  const [history, setHistory] = useState<ProjectUpdateDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!user?.id) return;
      const ok = await isFeatureEnabled("whatsappDiary", user.id);
      setEnabled(ok);
      if (!ok) {
        setPending([]);
        setHistory([]);
        return;
      }
      const [p, h1, h2] = await Promise.all([
        listUpdates(projectId, "pending"),
        listUpdates(projectId, "approved"),
        listUpdates(projectId, "ignored"),
      ]);
      setPending(p);
      const combined = [...h1, ...h2].sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime;
      });
      setHistory(combined);
    } catch (e) {
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setLoading(false);
    }
  }, [projectId, user?.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onApprove = async (id: string) => {
    await approveUpdate(projectId, id);
    await load();
  };
  const onIgnore = async (id: string) => {
    await ignoreUpdate(projectId, id);
    await load();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!enabled) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("features.disabled")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{t("updates.pending")}</Text>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        contentContainerStyle={pending.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.muted}>{t("updates.emptyPending")}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.messageText || "—"}</Text>
            <Text style={styles.cardSub}>{item.fromPhoneE164 || ""}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.approveBtn} onPress={() => onApprove(item.id)}>
                <Text style={styles.approveText}>{t("updates.approve")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ignoreBtn} onPress={() => onIgnore(item.id)}>
                <Text style={styles.ignoreText}>{t("updates.ignore")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>{t("updates.history")}</Text>
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        contentContainerStyle={history.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.muted}>{t("updates.emptyHistory")}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.messageText || "—"}</Text>
            <Text style={styles.cardSub}>{item.status}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  cardActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  approveBtn: { flex: 1, backgroundColor: colors.primary, padding: spacing.sm, borderRadius: radius, alignItems: "center" },
  approveText: { color: "#fff", fontWeight: "600" },
  ignoreBtn: { flex: 1, backgroundColor: colors.card, padding: spacing.sm, borderRadius: radius, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  ignoreText: { color: colors.textMuted, fontWeight: "600" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted },
  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
});
