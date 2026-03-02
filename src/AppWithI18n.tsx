/**
 * App shell with LazyAuthedApp.
 * I18nProvider is mounted in App.tsx so useI18n is available before lazy load.
 */
import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useI18n } from "./i18n/I18nContext";
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
  return <AppShell />;
}
