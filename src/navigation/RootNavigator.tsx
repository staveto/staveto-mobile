import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { CustomizeHomeScreen } from "../screens/CustomizeHomeScreen";
import { TaskDetailScreen } from "../screens/TaskDetailScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";
import { AppTabs } from "./AppTabs";
import { colors, spacing } from "../theme";

const Stack = createNativeStackNavigator();

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>{t("loading.text")}</Text>
    </View>
  );
}

/** Order: loading → onboarding → auth → Tabs. Home/Notifications are stack screens reachable from Account. */
export function RootNavigator() {
  const { token, loading, onboardingDone, finishOnboarding } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return <LoadingScreen />;
  }
  if (!onboardingDone) {
    return <OnboardingScreen onFinish={finishOnboarding} />;
  }
  if (!token) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="AppTabs" component={AppTabs} />
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: true, title: t("nav.home") }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: t("nav.notifications") }} />
      <Stack.Screen
        name="CustomizeHome"
        component={CustomizeHomeScreen}
        options={{ headerShown: true, title: t("nav.customizeHome") }}
      />
      <Stack.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        options={{ headerShown: true, title: t("nav.taskDetail") }}
      />
      <Stack.Screen
        name="ProjectOverview"
        component={ProjectOverviewScreen}
        options={{ headerShown: true, title: t("nav.projectOverview") || "Projekt" }}
      />
      <Stack.Screen
        name="ProjectMembers"
        component={ProjectMembersScreen}
        options={{ headerShown: true, title: t("nav.projectMembers") || "Členovia projektu" }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: spacing.md, color: colors.textMuted },
});
