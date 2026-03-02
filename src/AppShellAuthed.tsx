import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "./context/AuthContext";
import { IOS_SKIP_BOTTOMSHEET } from "./lib/iosDiagnostic";
import { UnreadCountProvider } from "./context/UnreadCountContext";
import { RootNavigator } from "./navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./components/PushNotificationHandler";
import { configurePurchases } from "./services/billing";
import { useBootContext } from "./lib/bootContext";
import { bootStep } from "./lib/bootLogger";

export default function AppShellAuthed() {
  const [navReady, setNavReady] = useState(false);
  const bootCtx = useBootContext();

  try {
    bootStep("app_shell_mounted", "H6", {}).catch(() => {});
  } catch {}

  useEffect(() => {
    const t = setTimeout(() => {
      configurePurchases().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const linking = {
    prefixes: ["staveto://"],
    config: { screens: { EquipmentLinkHandler: "equipment/:qrToken" } },
  };

  const content = (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        bootStep("navigation_mounted", "H6", {}).catch(() => {});
        bootCtx?.onAppReady();
        setNavReady(true);
      }}
    >
      <AuthProvider>
        <UnreadCountProvider>
          <PushNotificationHandler />
          <StatusBar style="light" />
          <RootNavigator />
        </UnreadCountProvider>
      </AuthProvider>
    </NavigationContainer>
  );

  const shellContent = (
    <>
      {!navReady && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#112233",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16 }}>Booting...</Text>
        </View>
      )}
      {content}
    </>
  );

  if (IOS_SKIP_BOTTOMSHEET) {
    return <GestureHandlerRootView style={{ flex: 1 }}>{shellContent}</GestureHandlerRootView>;
  }
  const { BottomSheetModalProvider } = require("@gorhom/bottom-sheet");
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>{shellContent}</BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
