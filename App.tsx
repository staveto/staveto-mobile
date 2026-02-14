import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { I18nProvider, useI18n } from "./src/i18n/I18nContext";
import { AuthProvider } from "./src/context/AuthContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./src/components/PushNotificationHandler";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { colors, spacing } from "./src/theme";

function AppContent() {
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
    <NavigationContainer ref={navigationRef} linking={linking}>
      <AuthProvider>
        <PushNotificationHandler />
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </SafeAreaProvider>
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
