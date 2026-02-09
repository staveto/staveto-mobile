import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { listContractors, type ContractorDoc } from "../../services/contractors";
import { isFeatureEnabled } from "../../services/features";
import { colors, radius, spacing } from "../../theme";

export function ContractorsListScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState<ContractorDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const ok = await isFeatureEnabled("contractors", user.id);
      setEnabled(ok);
      if (!ok) {
        setItems([]);
        return;
      }
      const list = await listContractors(user.id);
      setItems(list);
    } catch (e) {
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setLoading(false);
    }
  }, [user?.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openDetail = (item: ContractorDoc) => {
    (navigation as { navigate: (name: string, params?: unknown) => void }).navigate("ContractorDetail", {
      contractorId: item.id,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t("contractors.title")}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => (navigation as any).navigate("ContractorForm")}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>{t("contractors.add")}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !enabled ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>{t("features.disabled")}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
          ListEmptyComponent={<Text style={styles.muted}>{t("contractors.empty")}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openDetail(item)}>
              <View style={styles.cardLeft}>
                <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{item.displayName}</Text>
                <Text style={styles.cardSub}>{item.phoneE164}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
  },
  addBtnText: { color: "#fff", fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardLeft: { marginRight: spacing.sm },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted },
  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
});
