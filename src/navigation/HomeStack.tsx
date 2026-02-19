import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { ExpensesKpiScreen } from "../screens/ExpensesKpiScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { useI18n } from "../i18n/I18nContext";

const Stack = createNativeStackNavigator();

/** Home tab stack: HomeScreen → ExpensesKpiScreen → ProjectOverview → ProjectMembers → Tasks. Tab bar stays visible. */
export function HomeStack() {
  const { t } = useI18n();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="ExpensesKpiScreen" component={ExpensesKpiScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProjectOverview" component={ProjectOverviewScreen} />
      <Stack.Screen name="ProjectMembers" component={ProjectMembersScreen} />
      <Stack.Screen name="Tasks" component={TasksScreen} options={{ headerShown: true, title: t("nav.tasks") }} />
    </Stack.Navigator>
  );
}
