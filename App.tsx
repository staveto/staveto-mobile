import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { I18nProvider, useI18n } from "./src/i18n/I18nContext";
import { AuthProvider } from "./src/context/AuthContext";
import { UnreadCountProvider } from "./src/context/UnreadCountContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./src/components/PushNotificationHandler";
import { configurePurchases } from "./src/services/billing";
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors } from "./src/theme";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.error("[App] ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (__DEV__) {
        return (
          <View style={[styles.loading, { padding: 24 }]}>
            <Text style={{ color: "#fff", fontSize: 16, marginBottom: 16 }}>Chyba aplikácie</Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, marginBottom: 24 }}>
              {this.state.error.message}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, padding: 12, borderRadius: 8 }}
              onPress={() => this.setState({ hasError: false, error: null })}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>Skúsiť znova</Text>
            </TouchableOpacity>
          </View>
        );
      }
    }
    return this.props.children;
  }
}

function AppContent() {
  React.useEffect(() => {
    configurePurchases().catch(() => {});
  }, []);
  const { loaded } = useI18n();

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const linking = {
    prefixes: ["staveto://"],
    config: {
      screens: {
        EquipmentLinkHandler: "equipment/:qrToken",
      },
    },
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

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <I18nProvider>
          <AppContent />
        </I18nProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
});
