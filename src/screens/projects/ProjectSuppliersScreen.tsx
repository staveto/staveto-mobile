import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, ActivityIndicator, Alert } from "react-native";
import { useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { listProjectSuppliers, addSupplierToProject, type ProjectSupplierDoc } from "../../services/suppliers";
import { listContractors, type ContractorDoc } from "../../services/contractors";
import { isFeatureEnabled } from "../../services/features";
import { colors, radius, spacing } from "../../theme";

export function ProjectSuppliersScreen() {
  const route = useRoute();
  const { t } = useI18n();
  const { user } = useAuth();
  const projectId = (route.params as { projectId: string }).projectId;
  const [items, setItems] = useState<ProjectSupplierDoc[]>([]);
  const [contractors, setContractors] = useState<ContractorDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!user?.id) return;
      const ok = await isFeatureEnabled("contractors", user.id);
      setEnabled(ok);
      if (!ok) {
        setItems([]);
        return;
      }
      const list = await listProjectSuppliers(projectId);
      setItems(list);
      const all = await listContractors(user.id);
      setContractors(all);
    } catch (e) {
      Alert.alert(t("common.error"), t("common.unknown"));
    } finally {
      setLoading(false);
    }
  }, [projectId, user?.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onAdd = async (contractor: ContractorDoc) => {
    try {
      await addSupplierToProject(projectId, contractor);
      setPickerOpen(false);
      await load();
    } catch {
      Alert.alert(t("common.error"), t("common.unknown"));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t("suppliers.title")}</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setPickerOpen(true)}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>{t("suppliers.add")}</Text>
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
          ListEmptyComponent={<Text style={styles.muted}>{t("suppliers.empty")}</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.displayNameSnapshot}</Text>
              <Text style={styles.cardSub}>{item.phoneE164}</Text>
            </View>
          )}
        />
      )}

      <Modal visible={pickerOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("suppliers.pickFromDirectory")}</Text>
            <FlatList
              data={contractors}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.muted}>{t("suppliers.directoryEmpty")}</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => onAdd(item)}>
                  <Text style={styles.cardTitle}>{item.displayName}</Text>
                  <Text style={styles.cardSub}>{item.phoneE164}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={() => setPickerOpen(false)}>
              <Text style={styles.closeText}>{t("common.close")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted },
  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: "80%" },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  pickerItem: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { marginTop: spacing.md, alignItems: "center" },
  closeText: { color: colors.textMuted },
});
