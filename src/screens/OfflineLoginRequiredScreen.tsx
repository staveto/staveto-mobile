import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";

/**
 * Shown when the user is signed out and the device has no connectivity.
 * First login requires network; returning users with a persisted session bypass this screen.
 */
export function OfflineLoginRequiredScreen() {
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
      <Text style={styles.title}>{t("offline.loginRequiredTitle")}</Text>
      <Text style={styles.message}>{t("offline.loginRequired")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  title: {
    marginTop: spacing.lg,
    fontSize: 20,
    fontWeight: "600",
    color: colors.textOnDark,
    textAlign: "center",
  },
  message: {
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
  },
});
