import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";
// CRITICAL: Import firebase.ts FIRST to ensure Firebase Auth is registered
import { db } from "../firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";

type Props = {
  onFinished: () => void;
};

type Mode = "build" | "trade" | "maintenance";

export function OnboardingMvpScreen({ onFinished }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!user?.id) return;
    if (!mode) {
      setError("Vyberte možnosť.");
      return;
    }
    if (!displayName.trim()) {
      setError("Zadajte meno.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "users", user.id), {
        mode,
        displayName: displayName.trim(),
        onboardingCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // no-op in Expo Go
      onFinished();
    } catch (e) {
      setError("Nepodarilo sa uložiť onboarding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {step === 1 ? (
        <>
          <Text style={styles.title}>Na čo budeš Staveto používať?</Text>
          <View style={styles.options}>
            <TouchableOpacity
              style={[styles.option, mode === "build" && styles.optionActive]}
              onPress={() => setMode("build")}
            >
              <Text style={[styles.optionText, mode === "build" && styles.optionTextActive]}>
                Výstavba / rekonštrukcia
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, mode === "trade" && styles.optionActive]}
              onPress={() => setMode("trade")}
            >
              <Text style={[styles.optionText, mode === "trade" && styles.optionTextActive]}>
                Remeselné zákazky
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, mode === "maintenance" && styles.optionActive]}
              onPress={() => setMode("maintenance")}
            >
              <Text style={[styles.optionText, mode === "maintenance" && styles.optionTextActive]}>
                Údržba / servis
              </Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={() => setStep(2)}>
            <Text style={styles.buttonText}>Ďalej</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.title}>Ako ťa máme volať?</Text>
          <TextInput
            style={styles.input}
            placeholder="Zadaj meno"
            placeholderTextColor={colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)}>
              <Text style={styles.secondaryText}>Späť</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Uložiť</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  options: { gap: spacing.sm, marginBottom: spacing.md },
  option: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  optionText: { color: colors.text, fontSize: 15, textAlign: "center" },
  optionTextActive: { color: colors.primary, fontWeight: "600" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  error: { color: colors.accent, marginBottom: spacing.sm, textAlign: "center" },
  button: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  secondaryBtn: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text },
});

