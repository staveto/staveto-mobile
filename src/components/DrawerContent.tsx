import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Linking,
} from "react-native";
import { DrawerContentScrollView, DrawerContentComponentProps } from "@react-navigation/drawer";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";
import { db } from "../firebase";
import { doc, getDoc } from "../lib/rnFirestore";
import { getUserSubscription } from "../services/subscription";
import type { SubscriptionTier } from "../services/subscription";
import { SUPPORT_EMAIL } from "../constants/consent";

const DRAWER_WIDTH_RATIO = 0.86;

type NavItem = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  labelKey: string;
  action: () => void;
};

function getPlanLabel(tier: SubscriptionTier | undefined): string {
  if (!tier || tier === "FREE") return "Free";
  if (tier === "PRO" || tier === "BASIC") return tier;
  return tier;
}

export function DrawerContent(props: DrawerContentComponentProps) {
  const { navigation } = props;
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [planTier, setPlanTier] = useState<SubscriptionTier | undefined>(undefined);

  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, "users", user.id)).then((snap: { exists: () => boolean; data: () => Record<string, unknown> }) => {
      if (snap.exists()) {
        const d = snap.data() as { photoURL?: string | null };
        setPhotoURL(d.photoURL ?? null);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    getUserSubscription(user.id).then((sub) => {
      setPlanTier(sub?.tier);
    });
  }, [user?.id]);

  const closeDrawer = useCallback(() => {
    navigation.closeDrawer();
  }, [navigation]);

  const openSupportEmail = useCallback(async () => {
    const subject = encodeURIComponent("Staveto Support");
    const body = encodeURIComponent(`User: ${user?.email ?? "—"}\n\n`);
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  }, [user?.email]);

  const displayName = user?.name ?? user?.firstName ?? user?.email ?? "—";
  const initials = displayName !== "—" ? displayName.slice(0, 2).toUpperCase() : "?";

  const navItems: NavItem[] = [
    {
      id: "projects",
      icon: "folder-open-outline",
      labelKey: "tabs.projects",
      action: () => {
        closeDrawer();
        navigation.navigate("Main", { screen: "Projects" });
      },
    },
    {
      id: "tasks",
      icon: "checkbox-outline",
      labelKey: "home.myTasks",
      action: () => {
        closeDrawer();
        navigation.navigate("Main", { screen: "Home", params: { screen: "Tasks" } });
      },
    },
    {
      id: "expenses",
      icon: "cash-outline",
      labelKey: "home.expenses",
      action: () => {
        closeDrawer();
        navigation.navigate("Main", { screen: "Home", params: { screen: "ExpensesKpiScreen" } });
      },
    },
    {
      id: "notifications",
      icon: "notifications-outline",
      labelKey: "tabs.notifications",
      action: () => {
        closeDrawer();
        navigation.navigate("Main", { screen: "Notifications" });
      },
    },
    {
      id: "settings",
      icon: "settings-outline",
      labelKey: "account.settings",
      action: () => {
        closeDrawer();
        navigation.navigate("Main", { screen: "Account" });
      },
    },
    {
      id: "support",
      icon: "help-circle-outline",
      labelKey: "home.support",
      action: () => {
        closeDrawer();
        openSupportEmail();
      },
    },
  ];

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
      scrollEnabled={true}
    >
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
        </View>
        <Text style={styles.userName} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={styles.planBadge}>
          <Text style={styles.planText}>{getPlanLabel(planTier)}</Text>
        </View>
      </View>

      <View style={styles.navSection}>
        {navItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.navRow}
            onPress={item.action}
            activeOpacity={0.7}
          >
            <Ionicons name={item.icon} size={24} color={colors.textOnDark} style={styles.navIcon} />
            <Text style={styles.navLabel}>{t(item.labelKey)}</Text>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.logoutRow, { marginBottom: insets.bottom }]}
        onPress={() => {
          closeDrawer();
          logout();
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="log-out-outline" size={24} color={colors.error} style={styles.navIcon} />
        <Text style={[styles.navLabel, styles.logoutText]}>{t("account.logout")}</Text>
      </TouchableOpacity>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  userName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  planBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  planText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  navSection: {
    flex: 1,
    paddingTop: spacing.md,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  navIcon: {
    marginRight: spacing.md,
    width: 28,
  },
  navLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.textOnDark,
  },
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
  },
  logoutText: {
    color: colors.error,
    fontWeight: "600",
  },
});
