import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";

const Stack = createNativeStackNavigator();

/** Home tab stack: HomeScreen → ProjectOverview → ProjectMembers. Tab bar stays visible. */
export function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="ProjectOverview" component={ProjectOverviewScreen} />
      <Stack.Screen name="ProjectMembers" component={ProjectMembersScreen} />
    </Stack.Navigator>
  );
}
