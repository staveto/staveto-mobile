import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { colors } from "../theme";
import { navigationRef } from "./PushNotificationHandler";

/** Extra bottom padding for ScrollView content so it clears this dock (excluding safe area). */
export const APP_BOTTOM_MENU_BAR_HEIGHT = 52;

export type AppBottomMenuTabKey = "Home" | "Projects" | "Equipment" | "Notifications" | "Account";

const TAB_ICONS: Record<AppBottomMenuTabKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  Home: "home",
  Projects: "folder-open",
  Equipment: "construct-outline",
  Notifications: "notifications-outline",
  Account: "person",
};

function navigateToAppTab(target: AppBottomMenuTabKey) {
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

type Props = {
  /** Highlights the current main tab (e.g. Projects on project detail). */
  activeTab?: AppBottomMenuTabKey;
};

/**
 * In-app bottom dock matching main tab destinations when the native tab bar
 * is hidden (e.g. root stack screens above AppTabs).
 */
export function AppBottomMenu({ activeTab }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "ios" ? 10 : 6);

  const go = useCallback((key: AppBottomMenuTabKey) => {
    navigateToAppTab(key);
  }, []);

  const items: { key: AppBottomMenuTabKey; label: string }[] = [
    { key: "Home", label: t("tabs.home") },
    { key: "Projects", label: t("tabs.projects") },
    { key: "Equipment", label: t("tabs.equipment") },
    { key: "Notifications", label: t("tabs.notifications") },
    { key: "Account", label: t("tabs.account") },
  ];

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad }]}>
      <View style={styles.row}>
        {items.map((it) => {
          const active = activeTab === it.key;
          return (
            <TouchableOpacity
              key={it.key}
              style={styles.item}
              onPress={() => go(it.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={it.label}
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={TAB_ICONS[it.key]}
                size={22}
                color={active ? colors.primary : "rgba(255,255,255,0.85)"}
              />
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {it.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
    minHeight: 44,
  },
  label: {
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
  },
  labelActive: {
    color: colors.primary,
  },
});
