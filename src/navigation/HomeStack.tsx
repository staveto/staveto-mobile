import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { ExpensesKpiScreen } from "../screens/ExpensesKpiScreen";
import { AttendanceReportScreen } from "../screens/AttendanceReportScreen";
import { ProjectTimeDetailScreen } from "../screens/ProjectTimeDetailScreen";
import { TimeDailyProtocolScreen } from "../screens/TimeDailyProtocolScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectMaterialsScreen } from "../screens/project/ProjectMaterialsScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { QuickNotesInboxScreen } from "../screens/QuickNotesInboxScreen";
import { useI18n } from "../i18n/I18nContext";

const Stack = createNativeStackNavigator();

/** Home tab stack: HomeScreen → ExpensesKpiScreen → AttendanceReportScreen → ProjectOverview → ProjectMembers → Tasks → QuickNotesInbox. Tab bar stays visible. */
export function HomeStack() {
  const { t } = useI18n();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="ExpensesKpiScreen" component={ExpensesKpiScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AttendanceReportScreen" component={AttendanceReportScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProjectTimeDetail" component={ProjectTimeDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TimeDailyProtocolScreen" component={TimeDailyProtocolScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProjectOverview" component={ProjectOverviewScreen} />
      <Stack.Screen
        name="ProjectMaterials"
        component={ProjectMaterialsScreen}
        options={{ headerShown: true, title: t("projectMaterials.title") }}
      />
      <Stack.Screen name="ProjectMembers" component={ProjectMembersScreen} />
      <Stack.Screen name="Tasks" component={TasksScreen} options={{ headerShown: true, title: t("nav.tasks") }} />
      <Stack.Screen name="QuickNotesInbox" component={QuickNotesInboxScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
