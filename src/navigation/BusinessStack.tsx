import React from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BusinessGate } from "../screens/business/BusinessGate";
import { BusinessDashboardScreen } from "../screens/business/BusinessDashboardScreen";
import { BusinessLandingScreen } from "../screens/business/BusinessLandingScreen";
import { BusinessPlanSelectionScreen } from "../screens/business/BusinessPlanSelectionScreen";
import { BusinessRegistrationScreen } from "../screens/business/BusinessRegistrationScreen";
import { BusinessOrderPendingScreen } from "../screens/business/BusinessOrderPendingScreen";
import { BusinessTeamManagementScreen } from "../screens/business/BusinessTeamManagementScreen";
import { BusinessMemberRoleScreen } from "../screens/business/BusinessMemberRoleScreen";
import { BusinessChatListScreen } from "../screens/business/BusinessChatListScreen";
import { BusinessChatRoomScreen } from "../screens/business/BusinessChatRoomScreen";
import { BusinessContactsListScreen } from "../screens/business/BusinessContactsListScreen";
import { BusinessContactDetailScreen } from "../screens/business/BusinessContactDetailScreen";
import { BusinessContactEditScreen } from "../screens/business/BusinessContactEditScreen";
import { BusinessMaterialsOverviewScreen } from "../screens/business/BusinessMaterialsOverviewScreen";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { colors } from "../theme";

const Stack = createNativeStackNavigator();

function BusinessDashboardWithGate() {
  return (
    <BusinessGate>
      <BusinessDashboardScreen />
    </BusinessGate>
  );
}

function BusinessChatListWithGate() {
  return (
    <BusinessGate>
      <BusinessChatListScreen />
    </BusinessGate>
  );
}

function BusinessChatRoomWithGate() {
  return (
    <BusinessGate>
      <BusinessChatRoomScreen />
    </BusinessGate>
  );
}

function BusinessContactsListWithGate() {
  return (
    <BusinessGate>
      <BusinessContactsListScreen />
    </BusinessGate>
  );
}

function BusinessContactDetailWithGate() {
  return (
    <BusinessGate>
      <BusinessContactDetailScreen />
    </BusinessGate>
  );
}

function BusinessContactEditWithGate() {
  return (
    <BusinessGate>
      <BusinessContactEditScreen />
    </BusinessGate>
  );
}

function BusinessMaterialsOverviewWithGate() {
  return (
    <BusinessGate>
      <BusinessMaterialsOverviewScreen />
    </BusinessGate>
  );
}

function BusinessEntryScreen() {
  const { activeBusinessOrgId, loading } = useActiveOrg();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!activeBusinessOrgId) {
    return <BusinessLandingScreen />;
  }

  return <BusinessDashboardWithGate />;
}

export function BusinessStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="BusinessEntry"
        component={BusinessEntryScreen}
        options={{ title: "Staveto Business" }}
      />
      <Stack.Screen
        name="BusinessLanding"
        component={BusinessLandingScreen}
        options={{ title: "Staveto Business" }}
      />
      <Stack.Screen
        name="BusinessRegistration"
        component={BusinessRegistrationScreen}
        options={{ title: "Registrácia firmy" }}
      />
      <Stack.Screen
        name="BusinessPlanSelection"
        component={BusinessPlanSelectionScreen}
        options={{ title: "Business plán" }}
      />
      <Stack.Screen
        name="BusinessOrderPending"
        component={BusinessOrderPendingScreen}
        options={{ title: "Čakáme na úhradu" }}
      />
      <Stack.Screen
        name="BusinessDashboard"
        component={BusinessDashboardWithGate}
        options={{ title: "Staveto Business" }}
      />
      <Stack.Screen
        name="BusinessTeamManagement"
        component={BusinessTeamManagementScreen}
        options={{ title: "Správa tímu" }}
      />
      <Stack.Screen
        name="BusinessMemberRole"
        component={BusinessMemberRoleScreen}
        options={{ title: "Rola člena" }}
      />
      <Stack.Screen
        name="BusinessChatList"
        component={BusinessChatListWithGate}
        options={{ title: "Správy" }}
      />
      <Stack.Screen
        name="BusinessChatRoom"
        component={BusinessChatRoomWithGate}
        options={{ title: "Chat" }}
      />
      <Stack.Screen
        name="BusinessContactsList"
        component={BusinessContactsListWithGate}
        options={{ title: "Kontakty" }}
      />
      <Stack.Screen
        name="BusinessContactDetail"
        component={BusinessContactDetailWithGate}
        options={{ title: "Kontakt" }}
      />
      <Stack.Screen
        name="BusinessContactEdit"
        component={BusinessContactEditWithGate}
        options={{ title: "Upraviť kontakt" }}
      />
      <Stack.Screen
        name="BusinessMaterialsOverview"
        component={BusinessMaterialsOverviewWithGate}
        options={{ title: "Materiál" }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});

