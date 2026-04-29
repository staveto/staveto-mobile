import React, { useEffect } from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, BackHandler, Platform } from "react-native";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { openStoreUrl } from "../services/appUpdateService";

type Props = {
  visible: boolean;
  storeUrl: string;
  /** Optional extra line from Firestore (shown under required body). */
  remoteMessage?: string;
};

export function ForceUpdateModal({ visible, storeUrl, remoteMessage }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [visible]);

  const handleUpdate = () => {
    void openStoreUrl(storeUrl);
  };

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={() => {}}>
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("storeUpdate.updateRequiredTitle")}</Text>
          <Text style={styles.body}>{t("storeUpdate.updateRequiredBody")}</Text>
          {remoteMessage?.trim() ? <Text style={styles.hint}>{remoteMessage.trim()}</Text> : null}
          <TouchableOpacity style={styles.primary} onPress={handleUpdate}>
            <Text style={styles.primaryText}>{t("storeUpdate.updateNow")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.xl,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  body: { fontSize: 16, color: colors.textMuted, lineHeight: 24, marginBottom: spacing.md },
  hint: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  primary: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
