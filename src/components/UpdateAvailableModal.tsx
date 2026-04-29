import React, { useEffect } from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable } from "react-native";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { openStoreUrl, recordSoftPromptShown } from "../services/appUpdateService";

type Props = {
  visible: boolean;
  storeUrl: string;
  /** Optional message from Firestore; falls back to localized default body. */
  remoteMessage?: string;
  onDismiss: () => void;
};

export function UpdateAvailableModal({ visible, storeUrl, remoteMessage, onDismiss }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (visible) {
      void recordSoftPromptShown();
    }
  }, [visible]);

  const bodyText =
    remoteMessage?.trim() || t("storeUpdate.updateAvailableBodyDefault");

  const handleUpdate = async () => {
    await openStoreUrl(storeUrl);
  };

  const handleLater = () => {
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleLater}>
      <Pressable style={styles.backdrop} onPress={handleLater}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t("storeUpdate.updateAvailableTitle")}</Text>
          <Text style={styles.body}>{bodyText}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} onPress={handleLater}>
              <Text style={styles.secondaryText}>{t("storeUpdate.later")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={handleUpdate}>
              <Text style={styles.primaryText}>{t("storeUpdate.updateNow")}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.lg,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: 15, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 22 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  primary: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
  },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  secondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  secondaryText: { color: colors.textMuted, fontWeight: "600", fontSize: 15 },
});
