import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { updateUserProfileFromOnboarding } from "../services/auth";

type Props = {
  onFinished: () => void;
};

type Mode = "build" | "trade" | "maintenance";
const PENDING_ONBOARDING_KEY = "pending_onboarding";

function normalizePhoneE164(input: string): string | null {
  const raw = input.trim().replace(/\s/g, "");
  if (!raw) return null;
  try {
    const { parsePhoneNumberFromString } = require("libphonenumber-js");
    const region = (Localization.region ?? "SK") as string;
    const parsed = parsePhoneNumberFromString(raw, region);
    if (parsed?.isValid()) return parsed.number;
  } catch {
    // fallback: keep digits and +
    const digits = raw.replace(/[^\d+]/g, "");
    if (digits.length >= 9) return digits.startsWith("+") ? digits : `+${digits}`;
  }
  return null;
}

export function OnboardingMvpScreen({ onFinished }: Props) {
  const { t } = useI18n();
  const { user, finishOnboarding } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveNameStep = () => {
    if (!firstName.trim()) {
      setError(t("onboardingMvp.errorEnterFirstName"));
      return;
    }
    if (!lastName.trim()) {
      setError(t("onboardingMvp.errorEnterLastName"));
      return;
    }
    setError("");
    setStep(3);
  };

  const savePhoneAndFinish = async (skipPhone: boolean) => {
    if (!mode || !firstName.trim() || !lastName.trim()) {
      setError(t("onboardingMvp.errorSaveFailed"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const phoneE164 = skipPhone ? null : normalizePhoneE164(phone);
      if (!skipPhone && phone.trim() && !phoneE164) {
        setError(t("onboardingMvp.errorPhoneInvalid"));
        setSaving(false);
        return;
      }

      const payload = {
        mode,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName,
        phoneE164: phoneE164 ?? undefined,
        completedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(payload));

      if (user?.id) {
        await updateUserProfileFromOnboarding(user.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName,
          phoneE164: phoneE164 ?? undefined,
        });
      }

      await finishOnboarding();
      onFinished();
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
          <TouchableOpacity style={styles.button} onPress={() => { setError(""); setStep(2); }}>
            <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
          </TouchableOpacity>
        </>
      ) : step === 2 ? (
        <>
          <Text style={styles.title}>{t("onboardingMvp.step2Title")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("onboardingMvp.placeholderFirstName")}
            placeholderTextColor={colors.textMuted}
            value={firstName}
            onChangeText={setFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder={t("onboardingMvp.placeholderLastName")}
            placeholderTextColor={colors.textMuted}
            value={lastName}
            onChangeText={setLastName}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(1); }}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={saveNameStep}>
              <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t("onboardingMvp.step3Title")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("onboardingMvp.placeholderPhone")}
            placeholderTextColor={colors.textMuted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => savePhoneAndFinish(true)} disabled={saving}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.step3Skip")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => savePhoneAndFinish(false)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("onboardingMvp.step3Continue")}</Text>}
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
