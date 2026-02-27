import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { AuthProvider } from "./context/AuthContext";
import { UnreadCountProvider } from "./context/UnreadCountContext";
import { RootNavigator } from "./navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./components/PushNotificationHandler";
import { configurePurchases } from "./services/billing";

export default function AppShellAuthed() {
  useEffect(() => {
    // Delay a bit to let UI mount first (optional but helps)
    const t = setTimeout(() => {
      configurePurchases().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const linking = {
    prefixes: ["staveto://"],
    config: { screens: { EquipmentLinkHandler: "equipment/:qrToken" } },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <AuthProvider>
            <UnreadCountProvider>
              <PushNotificationHandler />
              <StatusBar style="light" />
              <RootNavigator />
            </UnreadCountProvider>
          </AuthProvider>
        </NavigationContainer>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
