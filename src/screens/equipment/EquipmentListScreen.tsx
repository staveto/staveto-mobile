import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../../theme";
import * as equipmentService from "../../services/equipment";
import type { EquipmentDoc } from "../../services/equipment";
import { useI18n } from "../../i18n/I18nContext";

export function EquipmentListScreen() {
  const { t } = useI18n();
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { projectId, projectName, openServiceRule } = (route.params as {
    projectId?: string;
    projectName?: string;
    openServiceRule?: boolean;
  }) ?? {};

  const [list, setList] = useState<EquipmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (!projectId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const eq = await equipmentService.listEquipment(projectId, { status: 'active' });
      setList(eq);
    } catch (e: any) {
      console.error("[EquipmentList] Error:", e);
      Alert.alert(t("common.error"), e.message || t("equipment.loadListFailed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Handle openServiceRule: when coming from ProjectOverview "Pridať servisný plán"
  useEffect(() => {
    if (!openServiceRule || !projectId || loading) return;
    (navigation as any).setParams?.({ openServiceRule: false });
    if (list.length === 0) {
      Alert.alert(
        t("equipment.noEquipment"),
        t("equipment.addEquipmentFirst"),
        [{ text: t("common.ok") }]
      );
      return;
    }
    if (list.length === 1) {
      (navigation as any).navigate("ServiceRuleForm", {
        projectId,
        projectName,
        equipmentId: list[0].id,
        equipmentName: list[0].name,
      });
      return;
    }
    // >1 equipment: show picker
    const options = list.map((eq) => eq.labelCode || eq.name);
    Alert.alert(
      t("equipment.selectEquipment"),
      t("equipment.selectEquipmentForPlan"),
      [
        { text: t("common.cancel"), style: "cancel" },
        ...options.map((label, idx) => ({
          text: label,
          onPress: () =>
            (navigation as any).navigate("ServiceRuleForm", {
              projectId,
              projectName,
              equipmentId: list[idx].id,
              equipmentName: list[idx].name,
            }),
        })),
      ]
    );
  }, [openServiceRule, projectId, list, loading, navigation, projectName]);

  const filtered = list.filter(
    (eq) =>
      !search.trim() ||
      eq.name.toLowerCase().includes(search.toLowerCase()) ||
      (eq.labelCode?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (eq.model?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (eq.serialNumber?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  const goBack = () => navigation.goBack();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{projectName || t("equipment.title")}</Text>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => (navigation as any).navigate("QrScan")}
        >
          <Ionicons name="scan-outline" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t("equipment.searchPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.lg }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t("equipment.noEquipment")}</Text>
              <Text style={styles.emptySubtext}>{t("equipment.emptySubtext")}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                (navigation as any).navigate("EquipmentDetail", {
                  projectId,
                  projectName,
                  equipmentId: item.id,
                })
              }
              onLongPress={() => {
                Alert.alert(
                  t("equipment.archiveEquipment"),
                  t("equipment.archiveConfirm", { name: item.name }),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("common.archive"),
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await equipmentService.archiveEquipment(projectId!, item.id);
                          load(true);
                        } catch (e: any) {
                          Alert.alert(t("common.error"), e.message || t("equipment.archiveFailedShort"));
                        }
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <View style={styles.cardContent}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.labelCode && (
                  <Text style={styles.cardLabel}>{item.labelCode}</Text>
                )}
                {item.model && (
                  <Text style={styles.cardModel}>{item.model}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={() =>
          (navigation as any).navigate("EquipmentForm", {
            projectId,
            projectName,
          })
        }
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { marginRight: spacing.sm },
  headerTitle: { flex: 1 },
  scanBtn: { padding: spacing.xs },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  list: { paddingHorizontal: spacing.md },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyText: { fontSize: 16, color: colors.textMuted },
  emptySubtext: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardContent: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardLabel: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  cardModel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
});
