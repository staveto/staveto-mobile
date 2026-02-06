import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";

type Props = {
  onFinished: () => void;
};

type Mode = "build" | "trade" | "maintenance";
const PENDING_ONBOARDING_KEY = "pending_onboarding";

export function OnboardingMvpScreen({ onFinished }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!mode) {
      setError(t("onboardingMvp.errorSelectOption"));
      return;
    }
    if (!displayName.trim()) {
      setError(t("onboardingMvp.errorEnterName"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      console.log("ONBOARDING start");
      const payload = {
        mode,
        displayName: displayName.trim(),
        completedAt: new Date().toISOString(),
      };
      const savePromise = AsyncStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(payload));
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 1000)
      );
      const result = await Promise.race([savePromise.then(() => "saved" as const), timeoutPromise]);
      if (result === "saved") {
        console.log("ONBOARDING saved");
      } else {
        console.warn("ONBOARDING save timeout");
        savePromise.then(() => console.log("ONBOARDING saved"));
      }
      onFinished();
      console.log("ONBOARDING finished");
    } catch (e) {
      console.error("ONBOARDING error", e);
      setError(t("onboardingMvp.errorSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {step === 1 ? (
        <>
          <Text style={styles.title}>{t("onboardingMvp.step1Title")}</Text>
          <View style={styles.options}>
            <TouchableOpacity
              style={[styles.option, mode === "build" && styles.optionActive]}
              onPress={() => setMode("build")}
            >
              <Text style={[styles.optionText, mode === "build" && styles.optionTextActive]}>
                {t("onboardingMvp.optionBuild")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, mode === "trade" && styles.optionActive]}
              onPress={() => setMode("trade")}
            >
              <Text style={[styles.optionText, mode === "trade" && styles.optionTextActive]}>
                {t("onboardingMvp.optionTrade")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, mode === "maintenance" && styles.optionActive]}
              onPress={() => setMode("maintenance")}
            >
              <Text style={[styles.optionText, mode === "maintenance" && styles.optionTextActive]}>
                {t("onboardingMvp.optionMaintenance")}
              </Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.button} onPress={() => setStep(2)}>
            <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t("onboardingMvp.step2Title")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("onboardingMvp.placeholderName")}
            placeholderTextColor={colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("onboardingMvp.save")}</Text>}
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

