import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { colors } from "../theme";
import { navigationRef } from "./PushNotificationHandler";

/** Extra bottom padding for ScrollView content so it clears this dock (excluding safe area). */
export const APP_BOTTOM_MENU_BAR_HEIGHT = 52;

type TabKey = "Home" | "Projects" | "Equipment" | "Notifications" | "Account";

const TAB_ICONS: Record<TabKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  Home: "home",
  Projects: "folder-open",
  Equipment: "construct-outline",
  Notifications: "notifications-outline",
  Account: "person",
};

function navigateToAppTab(target: TabKey) {
  if (!navigationRef.isReady()) return;
  try {
    if (target === "Home") {
      (navigationRef as unknown as { navigate: (n: string, p?: object) => void }).navigate("AppTabs", {
        screen: "Main",
        params: {
          screen: "Home",
          params: { screen: "HomeMain" },
        },
      });
      return;
    }
    (navigationRef as unknown as { navigate: (n: string, p?: object) => void }).navigate("AppTabs", {
      screen: "Main",
      params: { screen: target },
    });
  } catch (e) {
    if (__DEV__) console.warn("[AppBottomMenu] navigate failed", e);
  }
}

export function getAppBottomMenuExtraPadding(insetsBottom: number): number {
  return APP_BOTTOM_MENU_BAR_HEIGHT + 8 + Math.max(insetsBottom, 0);
}

/**
 * In-app bottom dock matching main tab destinations when the native tab bar
 * is hidden (e.g. root stack or Business stack).
 */
export function AppBottomMenu() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "ios" ? 10 : 6);

  const go = useCallback((key: TabKey) => {
    navigateToAppTab(key);
  }, []);

  const items: { key: TabKey; label: string }[] = [
    { key: "Home", label: t("navigation.bottom.home") },
    { key: "Projects", label: t("navigation.bottom.projects") },
    { key: "Equipment", label: t("navigation.bottom.equipment") },
    { key: "Notifications", label: t("navigation.bottom.notifications") },
    { key: "Account", label: t("navigation.bottom.account") },
  ];

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad }]}>
      <View style={styles.row}>
        {items.map((it) => (
          <TouchableOpacity
            key={it.key}
            style={styles.item}
            onPress={() => go(it.key)}
            accessibilityRole="button"
            accessibilityLabel={it.label}
          >
            <Ionicons name={TAB_ICONS[it.key]} size={22} color="rgba(255,255,255,0.92)" />
            <Text style={styles.label} numberOfLines={1}>
              {it.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 6,
    minHeight: APP_BOTTOM_MENU_BAR_HEIGHT,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
  },
});
