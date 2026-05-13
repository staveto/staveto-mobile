import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BusinessGate } from "../screens/business/BusinessGate";
import { BusinessDashboardScreen } from "../screens/business/BusinessDashboardScreen";

const Stack = createNativeStackNavigator();

function BusinessDashboardWithGate() {
  return (
    <BusinessGate>
      <BusinessDashboardScreen />
    </BusinessGate>
  );
}

export function BusinessStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="BusinessDashboard"
        component={BusinessDashboardWithGate}
        options={{ title: "Staveto Business" }}
      />
    </Stack.Navigator>
  );
}

