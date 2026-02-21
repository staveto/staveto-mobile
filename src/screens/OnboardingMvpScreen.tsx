import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, ScrollView, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { updateUserProfileFromOnboarding } from "../services/auth";
import { COUNTRY_CODES, COUNTRY_NAMES, getCountryCallingCode, getDeviceTimezone, getDeviceRegionCode } from "../utils/countries";

type Props = {
  onFinished: () => void;
};

type Mode = "build" | "trade" | "maintenance";
const PENDING_ONBOARDING_KEY = "pending_onboarding";

function buildPhoneE164(countryCode: string, nationalNumber: string): string | null {
  const raw = nationalNumber.trim().replace(/\s/g, "").replace(/[^\d]/g, "");
  if (!raw || raw.length < 6) return null;
  try {
    const { parsePhoneNumberFromString } = require("libphonenumber-js");
    const prefix = getCountryCallingCode(countryCode);
    const full = `+${prefix}${raw}`;
    const parsed = parsePhoneNumberFromString(full, countryCode as any);
    if (parsed?.isValid()) return parsed.number;
  } catch {
    const prefix = getCountryCallingCode(countryCode);
    if (prefix && raw.length >= 6) return `+${prefix}${raw}`;
  }
  return null;
}

const DEFAULT_COUNTRY = "SK";

export function OnboardingMvpScreen({ onFinished }: Props) {
  const { t } = useI18n();
  const { user, finishOnboarding } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const [primaryCountry, setPrimaryCountry] = useState<string>(() => {
    const region = getDeviceRegionCode();
    return region && COUNTRY_CODES.includes(region as any) ? region : DEFAULT_COUNTRY;
  });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(() => {
    const region = getDeviceRegionCode();
    return region && COUNTRY_CODES.includes(region as any) ? region : DEFAULT_COUNTRY;
  });
  const [phoneNational, setPhoneNational] = useState("");
  const [showPhoneCountryModal, setShowPhoneCountryModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step === 4) setPhoneCountryCode(primaryCountry);
  }, [step, primaryCountry]);

  const saveCountryStep = () => {
    if (!primaryCountry) return;
    setError("");
    setStep(3);
  };

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
    setStep(4);
  };

  const savePhoneAndFinish = async (skipPhone: boolean) => {
    if (!mode || !firstName.trim() || !lastName.trim() || !primaryCountry) {
      setError(t("onboardingMvp.errorSaveFailed"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const phoneE164 = skipPhone ? null : buildPhoneE164(phoneCountryCode, phoneNational);
      if (!skipPhone && phoneNational.trim() && !phoneE164) {
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

      // Complete onboarding first so user can proceed even if Firestore is temporarily unavailable
      await finishOnboarding();
      onFinished();

      // Sync to Firestore in background (non-blocking)
      if (user?.id) {
        updateUserProfileFromOnboarding(user.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          displayName,
          phoneE164: phoneE164 ?? undefined,
          primaryCountry,
          timezone: getDeviceTimezone(),
        }).catch((e) => {
          console.warn("[OnboardingMvp] Firestore sync failed, will retry on next app open:", e);
        });
      }
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
          <Text style={styles.title}>{t("onboardingMvp.stepCountryTitle")}</Text>
          <Text style={styles.subtitle}>{t("onboardingMvp.stepCountrySubtitle")}</Text>
          <ScrollView style={styles.countryList} showsVerticalScrollIndicator={false}>
            {COUNTRY_CODES.map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.countryOption, primaryCountry === code && styles.optionActive]}
                onPress={() => setPrimaryCountry(code)}
              >
                <Text style={[styles.countryOptionText, primaryCountry === code && styles.optionTextActive]}>
                  {COUNTRY_NAMES[code] ?? code}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(1); }}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={saveCountryStep}>
              <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : step === 3 ? (
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
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(2); }}>
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
          <View style={styles.phoneRow}>
            <TouchableOpacity
              style={styles.phoneCountryBtn}
              onPress={() => setShowPhoneCountryModal(true)}
            >
              <Text style={styles.phoneCountryText}>
                {phoneCountryCode} +{getCountryCallingCode(phoneCountryCode)}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.text} />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, styles.phoneInput]}
              placeholder={t("onboardingMvp.placeholderPhone")}
              placeholderTextColor={colors.textMuted}
              value={phoneNational}
              onChangeText={setPhoneNational}
              keyboardType="phone-pad"
            />
          </View>
          <Modal
            visible={showPhoneCountryModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowPhoneCountryModal(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setShowPhoneCountryModal(false)}>
              <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle}>{t("onboardingMvp.stepCountryTitle")}</Text>
                <ScrollView style={styles.countryList} showsVerticalScrollIndicator>
                  {COUNTRY_CODES.map((code) => (
                    <TouchableOpacity
                      key={code}
                      style={[styles.countryOption, phoneCountryCode === code && styles.optionActive]}
                      onPress={() => {
                        setPhoneCountryCode(code);
                        setShowPhoneCountryModal(false);
                      }}
                    >
                      <Text style={[styles.countryOptionText, phoneCountryCode === code && styles.optionTextActive]}>
                        {COUNTRY_NAMES[code] ?? code} (+{getCountryCallingCode(code)})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowPhoneCountryModal(false)}>
                  <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(3); }} disabled={saving}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => savePhoneAndFinish(true)} disabled={saving}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.step3Skip")}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.button, { marginTop: spacing.sm }]} onPress={() => savePhoneAndFinish(false)} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("onboardingMvp.step3Continue")}</Text>}
          </TouchableOpacity>
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
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md, textAlign: "center" },
  countryList: { maxHeight: 200, marginBottom: spacing.md },
  countryOption: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  countryOptionText: { color: colors.text, fontSize: 15 },
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
  phoneRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  phoneCountryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minWidth: 100,
  },
  phoneCountryText: { color: colors.text, fontSize: 16 },
  phoneInput: { flex: 1, marginBottom: 0 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.lg,
    maxHeight: "70%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
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
