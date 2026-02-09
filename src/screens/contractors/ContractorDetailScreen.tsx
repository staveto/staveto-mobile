import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { getContractor, deleteContractor, type ContractorDoc } from "../../services/contractors";
import { colors, radius, spacing } from "../../theme";

export function ContractorDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { user } = useAuth();
  const contractorId = (route.params as { contractorId: string }).contractorId;
  const [item, setItem] = useState<ContractorDoc | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      const data = await getContractor(user.id, contractorId);
      if (data) setItem(data);
    };
    load();
  }, [user?.id, contractorId]);

  const openUrl = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert(t("common.error"), t("account.linkOpenFailed"));
      return;
    }
    await Linking.openURL(url);
  };

  const onDelete = () => {
    Alert.alert(
      t("contractors.delete"),
      t("contractors.deleteConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await deleteContractor(contractorId);
            (navigation as { goBack: () => void }).goBack();
          },
        },
      ]
    );
  };

  if (!item) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t("loading.text")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{item.displayName}</Text>
      <Text style={styles.sub}>{item.phoneE164}</Text>
      {item.email ? <Text style={styles.sub}>{item.email}</Text> : null}
      {item.note ? <Text style={styles.note}>{item.note}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => openUrl(`tel:${item.phoneE164}`)}>
          <Ionicons name="call-outline" size={18} color={colors.primary} />
          <Text style={styles.actionText}>{t("contractors.call")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => openUrl(`https://wa.me/${item.phoneE164.replace("+", "")}`)}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.primary} />
          <Text style={styles.actionText}>{t("contractors.whatsapp")}</Text>
        </TouchableOpacity>
        {item.email ? (
          <TouchableOpacity style={styles.actionBtn} onPress={() => openUrl(`mailto:${item.email}`)}>
            <Ionicons name="mail-outline" size={18} color={colors.primary} />
            <Text style={styles.actionText}>{t("contractors.emailAction")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => (navigation as any).navigate("ContractorForm", { contractorId })}
        >
          <Text style={styles.editText}>{t("common.edit")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteText}>{t("common.delete")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  sub: { color: colors.textMuted, marginBottom: 4 },
  note: { color: colors.text, marginTop: spacing.md },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
  },
  actionText: { color: colors.text, fontWeight: "600" },
  footer: { marginTop: spacing.xl, flexDirection: "row", gap: spacing.md },
  editBtn: { flex: 1, backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius, alignItems: "center" },
  editText: { color: "#fff", fontWeight: "600" },
  deleteBtn: { flex: 1, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  deleteText: { color: colors.textMuted, fontWeight: "600" },
  muted: { color: colors.textMuted },
});
