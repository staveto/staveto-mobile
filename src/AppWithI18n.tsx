/**
 * App shell with I18n + LazyAuthedApp.
 * Loaded lazily after boot to avoid blocking splash with translations/Firebase.
 */
import React from "react";
import { View, ActivityIndicator } from "react-native";
import { I18nProvider, useI18n } from "./i18n/I18nContext";
import { LazyAuthedApp } from "./components/LazyAuthedApp";
import { colors } from "./theme";

function AppShell() {
  const { loaded } = useI18n();

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <LazyAuthedApp enabled={true} />;
}

export default function AppWithI18n() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
