import React, { useEffect, useState, useRef } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import type { NavigationState } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "./context/AuthContext";
import { QuickNoteProvider } from "./context/QuickNoteContext";
import { IOS_SKIP_BOTTOMSHEET } from "./lib/iosDiagnostic";
import { UnreadCountProvider } from "./context/UnreadCountContext";
import { RootNavigator } from "./navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./components/PushNotificationHandler";
import { configurePurchases } from "./services/billing";
import { useBootContext } from "./lib/bootContext";
import { bootStep } from "./lib/bootLogger";
import { logScreenSafe } from "./services/analytics";

function getActiveRouteName(state: NavigationState | undefined): string | null {
  if (!state) return null;
  const route = state.routes[state.index];
  if (route?.state && typeof (route.state as NavigationState).routes !== "undefined") {
    return getActiveRouteName(route.state as NavigationState);
  }
  return route?.name ?? null;
}

const NAV_READY_FALLBACK_MS = 3000;

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

  useEffect(() => {
    const fallback = setTimeout(() => {
      setNavReady((prev) => {
        if (!prev) {
          bootStep("navigation_fallback_ready", "H6", {}).catch(() => {});
          bootCtx?.onAppReady?.();
          return true;
        }
        return prev;
      });
    }, NAV_READY_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [bootCtx]);

  const linking = {
    prefixes: ["staveto://"],
    config: { screens: { EquipmentLinkHandler: "equipment/:qrToken" } },
  };

  const lastScreenRef = useRef<string | null>(null);

  const content = (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onReady={() => {
        bootStep("navigation_mounted", "H6", {}).catch(() => {});
        bootCtx?.onAppReady();
        setNavReady(true);
      }}
      onStateChange={(state) => {
        const name = getActiveRouteName(state);
        if (name && name !== lastScreenRef.current) {
          lastScreenRef.current = name;
          logScreenSafe(name);
        }
      }}
    >
      <AuthProvider>
        <QuickNoteProvider>
          <UnreadCountProvider>
            <PushNotificationHandler />
          <StatusBar style="light" />
            <RootNavigator />
          </UnreadCountProvider>
        </QuickNoteProvider>
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
            backgroundColor: "#1D376A",
            zIndex: 9999,
          }}
        />
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
