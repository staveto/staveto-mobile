/**
 * Minimal shell for iOS crash diagnostic – no Firebase, no Auth, no BottomSheet.
 * Used when IOS_SKIP_AUTH to verify app starts without Firebase.
 */
import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useBootContext } from "./lib/bootContext";
import { bootStep } from "./lib/bootLogger";

export default function AppShellMinimal() {
  const bootCtx = useBootContext();

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
});
