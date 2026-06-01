import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";

/**
 * Minimal banner shown at top when offline or on poor network.
 * Integrate into main app layout so it appears across screens.
 */
export function OfflineBanner() {
  const { isOffline, isPoorNetwork } = useOnlineStatus();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  if (!isOffline && !isPoorNetwork) return null;

  const message = isOffline
    ? (t("offline.bannerOffline") || "Offline – showing saved data")
    : (t("offline.bannerPoor") || "Weak signal – loading from cache");

  const bgColor = isOffline ? "#b45309" : "#6b7280";

  return (
    <View
      style={[
        styles.banner,
        { paddingTop: insets.top + spacing.xs, backgroundColor: bgColor },
      ]}
    >
      <Ionicons
        name={isOffline ? "cloud-offline" : "cellular-outline"}
        size={16}
        color="#fff"
        style={styles.icon}
      />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  icon: {
    marginRight: spacing.xs,
  },
  text: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "500",
  },
});
