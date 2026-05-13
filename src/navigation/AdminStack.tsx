import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AdminHomeScreen } from "../screens/admin/AdminHomeScreen";
import { AdminOrganizationsScreen } from "../screens/admin/AdminOrganizationsScreen";

const Stack = createNativeStackNavigator();

export function AdminStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="AdminHome"
        component={AdminHomeScreen}
        options={{ title: "Staveto Admin" }}
      />
      <Stack.Screen
        name="AdminOrganizations"
        component={AdminOrganizationsScreen}
        options={{ title: "Firmy" }}
      />
    </Stack.Navigator>
  );
}

