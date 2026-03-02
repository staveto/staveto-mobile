/**
 * iOS Diagnostic Screen – shows boot steps and last error without loading heavy providers.
 * Shown when EXPO_PUBLIC_IOS_DIAGNOSTIC=1. No Firebase, Auth, RevenueCat, Reanimated.
 * "Continue (Normal Boot)" transitions to full app with skip flags respected.
 */
import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Platform, TouchableOpacity } from "react-native";
import { getBootLogEntries, getLastError, bootStep } from "../lib/bootLogger";
import {
  IOS_SKIP_AUTH,
  IOS_SKIP_PUSH,
  IOS_SKIP_GOOGLE_SIGNIN,
  IOS_SKIP_BOTTOMSHEET,
} from "../lib/iosDiagnostic";

const skipStates = {
  skipFirebase: IOS_SKIP_AUTH,
  skipAuth: IOS_SKIP_AUTH,
  skipGoogleSignIn: IOS_SKIP_GOOGLE_SIGNIN,
  skipRevenueCat: IOS_SKIP_AUTH,
  skipReanimated: IOS_SKIP_BOTTOMSHEET,
  skipPush: IOS_SKIP_PUSH,
};

export function DiagnosticScreen({ onContinue }: { onContinue?: () => void }) {
  const [bootSteps, setBootSteps] = useState<Array<{ step: string; ts: number }>>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    bootStep("diag_mounted", "H5", {}).catch(() => {});
    getBootLogEntries().then(setBootSteps).catch(() => setBootSteps([]));
    getLastError().then(setLastError).catch(() => setLastError(null));
  }, []);

  const handleContinue = () => {
    bootStep("boot_start", "H5", { from: "diagnostic" }).catch(() => {});
    onContinue?.();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Staveto</Text>
      <Text style={styles.subtitle}>iOS Diagnostic Mode</Text>

      <Text style={styles.sectionTitle}>Skipped modules</Text>
      <View style={styles.section}>
        {Object.entries(skipStates).map(([key, val]) => (
          <Text key={key} style={styles.row}>
            {key}: {val ? "YES" : "no"}
          </Text>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Last boot steps</Text>
      <View style={styles.section}>
        {bootSteps.length === 0 ? (
          <Text style={styles.muted}>No steps recorded yet</Text>
        ) : (
          bootSteps.slice(-15).map((e, i) => (
            <Text key={i} style={styles.step}>
              {new Date(e.ts).toISOString().slice(11, 23)} {e.step}
            </Text>
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>Last error</Text>
      <View style={styles.section}>
        <Text style={styles.error} selectable>
          {lastError ?? "None"}
        </Text>
      </View>

      {onContinue && (
        <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>Continue (Normal Boot)</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#1D376A" },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", color: "#fff", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.7)", marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#fff", marginTop: 16, marginBottom: 8 },
  section: { backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 8, padding: 12 },
  row: { fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  step: { fontSize: 11, color: "rgba(255,255,255,0.8)", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: 2 },
  error: { fontSize: 11, color: "#ff9", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  muted: { fontSize: 11, color: "rgba(255,255,255,0.5)" },
  continueButton: {
    marginTop: 24,
    backgroundColor: "#2e7d32",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  continueButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
