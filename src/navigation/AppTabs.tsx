import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { HomeStack } from "./HomeStack";
import { ProjectsScreen } from "../screens/ProjectsScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { AccountScreen } from "../screens/AccountScreen";
import { colors } from "../theme";

const Tab = createBottomTabNavigator();

const tabIcons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  Home: "home",
  Projects: "folder-open",
  Notifications: "notifications-outline",
  Search: "search",
  Account: "person",
};

/** Tabs: Home, Projects, Notifications, Search, Account. */
export function AppTabs() {
  const { t } = useI18n();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textOnDark,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "rgba(255,255,255,0.75)",
        tabBarShowIcon: true,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={tabIcons[route.name] ?? "ellipse"} size={size ?? 24} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} options={{ title: t("tabs.home"), headerShown: false }} />
      <Tab.Screen name="Projects" component={ProjectsScreen} options={{ title: t("tabs.projects") }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: t("tabs.notifications") || "Notifikácie" }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: t("tabs.search") }} />
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: t("tabs.account") }} />
    </Tab.Navigator>
  );
}
