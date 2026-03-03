/**
 * Minimal shell for iOS crash diagnostic – no Firebase, no Auth, no BottomSheet.
 * Used when IOS_SKIP_AUTH to verify app starts without Firebase.
 */
import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useBootContext } from "./lib/bootContext";
import { bootStep } from "./lib/bootLogger";
import { IOS_DIAGNOSTIC, getDiagnosticEnvRaw } from "./lib/iosDiagnostic";

function getFirebaseStatus(): string {
  try {
    const { getApps, getApp } = require("@react-native-firebase/app");
    const apps = getApps();
    const count = apps?.length ?? 0;
    if (count === 0) return "apps=0";
    const projectId = getApp().options?.projectId ?? "?";
    return `apps=${count} projectId=${projectId}`;
  } catch (e: unknown) {
    return `ERR: ${(e as Error)?.message ?? String(e)}`;
  }
}

export default function AppShellMinimal() {
  const bootCtx = useBootContext();
  const diagRaw = useMemo(() => getDiagnosticEnvRaw(), []);
  const firebaseStatus = useMemo(() => getFirebaseStatus(), []);

  useEffect(() => {
    bootStep("navigation_mounted", "H6", { shell: "minimal" }).catch(() => {});
    bootCtx?.onAppReady();
  }, [bootCtx]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.title}>Staveto</Text>
        <Text style={styles.subtitle}>iOS diagnostic – Firebase disabled</Text>
        <Text style={styles.hint}>If you see this, the crash was in Firebase/Auth</Text>
        <Text style={styles.debugLine} selectable>
          IOS_DIAGNOSTIC={String(IOS_DIAGNOSTIC)} | EXPO_PUBLIC_IOS_DIAGNOSTIC="{diagRaw || "(empty)"}"
        </Text>
        <Text style={styles.debugLine} selectable>
          Firebase: {firebaseStatus}
        </Text>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1D376A" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "bold", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "rgba(255,255,255,0.8)", marginBottom: 16 },
  hint: { fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center" },
  debugLine: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 8, textAlign: "center" },
});
