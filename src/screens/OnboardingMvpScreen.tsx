import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useBusinessContext } from "../hooks/useBusinessContext";
import { updateUserProfileFromOnboarding } from "../services/auth";
import { redeemBusinessInviteCode } from "../services/businessInvites";
import type { PrimaryUsageMode } from "../lib/primaryUsageMode";
import { persistPrimaryUsageMode } from "../lib/primaryUsageMode";
import { COUNTRY_CODES, getCountryCallingCode, getDeviceTimezone, getDeviceRegionCode, getLocalizedCountryName } from "../utils/countries";
import * as userEquipmentService from "../services/userEquipment";
import type { EquipmentCategory } from "../services/equipment";
import { markFirstProjectPromptShown } from "../utils/firstProjectPrompt";
import { UnifiedProjectCreationFlow } from "../components/UnifiedProjectCreationFlow";

type Props = {
  onFinished: () => void;
  onBack?: () => void;
  onBusinessFlowRequested?: () => void;
};

type Mode = PrimaryUsageMode;
const PENDING_ONBOARDING_KEY = "pending_onboarding";

/**
 * High-level branch the user picked on the very first onboarding screen.
 * - `join_company`: employee joining an existing org via invite code/QR
 * - `solo`: try Staveto as an individual (existing solo onboarding path)
 */
type UsageMode = "join_company" | "solo";

/**
 * Steps:
 *   0 = usage mode picker (NEW first step)
 *   1 = build/trade mode (solo only)
 *   2 = country (solo only)
 *   3 = name (solo only)
 *   4 = phone (solo only)
 *   5 = first project (solo only)
 *   6 = first equipment (solo only)
 *   8 = join by code (employee flow; reached directly from step 0)
 */
type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8;

const EQ_CATEGORIES: { value: EquipmentCategory; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { value: "tool", icon: "hammer-outline" },
  { value: "machine", icon: "cog-outline" },
  { value: "vehicle", icon: "car-outline" },
  { value: "building", icon: "business-outline" },
  { value: "other", icon: "ellipsis-horizontal-outline" },
];

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

function equipmentCategoryKey(c: EquipmentCategory): string {
  const m: Record<EquipmentCategory, string> = {
    machine: "equipment.categoryMachine",
    tool: "equipment.categoryTool",
    vehicle: "equipment.categoryVehicle",
    building: "equipment.categoryBuilding",
    other: "equipment.categoryOther",
  };
  return m[c];
}

export function OnboardingMvpScreen({ onFinished, onBack, onBusinessFlowRequested }: Props) {
  const { t, locale } = useI18n();
  const { user, finishOnboarding } = useAuth();
  const { setActiveBusinessOrgId, refreshActiveBusinessOrg } = useBusinessContext();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<OnboardingStep>(0);
  const [usageMode, setUsageMode] = useState<UsageMode | null>(null);
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

  const createdProjectRef = useRef(false);

  const [eqName, setEqName] = useState("");
  const [eqCategory, setEqCategory] = useState<EquipmentCategory>("tool");
  const [eqKind, setEqKind] = useState("");
  const [eqCode, setEqCode] = useState("");
  const [eqLocation, setEqLocation] = useState("");
  const [creatingEquipment, setCreatingEquipment] = useState(false);
  const createdEquipmentRef = useRef(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName((prev) => prev || (user.firstName ?? ""));
    setLastName((prev) => prev || (user.lastName ?? ""));
    if (!user.firstName && !user.lastName && user.name?.trim()) {
      const parts = user.name.trim().split(/\s+/);
      if (parts.length >= 2) {
        setFirstName((prev) => prev || (parts[0] ?? ""));
        setLastName((prev) => prev || (parts.slice(1).join(" ") ?? ""));
      } else {
        setFirstName((prev) => prev || (parts[0] ?? ""));
      }
    }
  }, [user?.id]);

  useEffect(() => {
    if (step === 4) setPhoneCountryCode(primaryCountry);
  }, [step, primaryCountry]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[OnboardingFlowDebug]", {
      step,
      selectedLanguage: locale,
      usageMode,
      authUid: user?.id ?? null,
      onboardingCompleted: false,
      inviteRedeemStatus: step === 8 ? (joinBusy ? "busy" : "idle") : "n/a",
    });
  }, [step, locale, usageMode, user?.id, joinBusy]);

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

  const skipNameStep = () => {
    setError("");
    setStep(4);
  };

  const persistModeAfterStep1 = useCallback(async () => {
    if (!mode) return;
    await persistPrimaryUsageMode(mode);
  }, [mode]);

  const goToProjectStep = async (skipPhone: boolean) => {
    if (!mode || !primaryCountry) {
      setError(t("onboardingMvp.errorSaveFailed"));
      return;
    }
    if (!skipPhone && phoneNational.trim()) {
      const phoneE164 = buildPhoneE164(phoneCountryCode, phoneNational);
      if (!phoneE164) {
        setError(t("onboardingMvp.errorPhoneInvalid"));
        return;
      }
    }
    setError("");
    await persistModeAfterStep1();
    setStep(5);
  };

  const completeActivation = useCallback(async (afterFinished?: () => void) => {
    if (!mode || !primaryCountry) {
      setError(t("onboardingMvp.errorSaveFailed"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const first = firstName.trim() || (user?.firstName ?? "");
      const last = lastName.trim() || (user?.lastName ?? "");
      const displayName =
        first && last ? `${first} ${last}`.trim() : (user?.name ?? "").trim() || "";
      const phoneE164 = phoneNational.trim() ? buildPhoneE164(phoneCountryCode, phoneNational) : null;
      if (phoneNational.trim() && !phoneE164) {
        setError(t("onboardingMvp.errorPhoneInvalid"));
        setSaving(false);
        return;
      }

      const payload = {
        mode,
        firstName: first,
        lastName: last,
        displayName,
        phoneE164: phoneE164 ?? undefined,
        completedAt: new Date().toISOString(),
        activationComplete: true,
        createdProject: createdProjectRef.current,
        createdEquipment: createdEquipmentRef.current,
      };

      await AsyncStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(payload));
      await persistPrimaryUsageMode(mode);

      if (user?.id) {
        try {
          await updateUserProfileFromOnboarding(user.id, {
            firstName: first,
            lastName: last,
            displayName,
            phoneE164: phoneE164 ?? undefined,
            primaryCountry,
            timezone: getDeviceTimezone(),
            primaryUsageMode: mode,
          });
        } catch (e) {
          console.warn("[OnboardingMvp] Firestore profile sync failed:", e);
        }
      }

      await finishOnboarding();
      onFinished();
      if (afterFinished) {
        setTimeout(afterFinished, 50);
      }
    } catch (e) {
      console.error("ONBOARDING activation error", e);
      setError(t("onboardingMvp.errorSaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [
    mode,
    primaryCountry,
    firstName,
    lastName,
    user?.firstName,
    user?.lastName,
    user?.name,
    user?.id,
    phoneNational,
    phoneCountryCode,
    finishOnboarding,
    onFinished,
  ]);

  const onSkipProject = () => {
    setError("");
    setStep(6);
  };

  const onSkipEquipment = () => {
    setError("");
    // Solo flow finishes here; the legacy step 7 (company choice) is no longer
    // shown after equipment because the choice is now the FIRST onboarding step.
    void completeActivation();
  };

  /**
   * Lightweight onboarding completion for flows that do NOT collect solo profiling
   * data (e.g. employee join via invite code).
   *
   * Unlike `completeActivation()`, this does NOT require `mode` or `primaryCountry`
   * and does NOT call `updateUserProfileFromOnboarding` when nothing was collected.
   * It only flips the AsyncStorage flags + `finishOnboarding()` so the gate can
   * route the user to Home / Business workspace.
   */
  const finishMinimalOnboarding = useCallback(
    async (afterFinished?: () => void) => {
      setSaving(true);
      setError("");
      try {
        const payload = {
          mode: null,
          firstName: (user?.firstName ?? "").trim(),
          lastName: (user?.lastName ?? "").trim(),
          displayName: (user?.name ?? "").trim(),
          phoneE164: undefined,
          completedAt: new Date().toISOString(),
          activationComplete: true,
          createdProject: false,
          createdEquipment: false,
          usageMode,
        };
        await AsyncStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(payload));

        if (user?.id) {
          try {
            // Only persist the timezone server-side and any name fields we may
            // already know (e.g. from Apple Sign-In). The Firestore helper
            // intentionally skips empty values so this is safe for employees
            // who haven't typed anything in the onboarding flow.
            await updateUserProfileFromOnboarding(user.id, {
              firstName: (user.firstName ?? "").trim(),
              lastName: (user.lastName ?? "").trim(),
              displayName: (user.name ?? "").trim(),
              timezone: getDeviceTimezone(),
            });
          } catch (e) {
            console.warn("[OnboardingMvp] minimal Firestore profile sync failed:", e);
          }
        }

        await finishOnboarding();
        if (afterFinished) {
          afterFinished();
        }
        onFinished();
      } catch (e) {
        console.error("ONBOARDING minimal activation error", e);
        setError(t("onboardingMvp.errorSaveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [user?.id, user?.firstName, user?.lastName, user?.name, usageMode, finishOnboarding, onFinished, t]
  );

  const redeemCodeAndFinish = async () => {
    const normalizedCode = joinCode.trim().toUpperCase();
    if (!normalizedCode) {
      setError(t("business.join.invalidCode"));
      return;
    }
    setJoinBusy(true);
    setError("");
    try {
      const result = await redeemBusinessInviteCode({ code: normalizedCode });
      if (__DEV__) {
        console.log("[OnboardingFlowDebug]", {
          step: 8,
          selectedLanguage: locale,
          usageMode,
          authUid: user?.id ?? null,
          onboardingCompleted: false,
          inviteRedeemStatus: result.status,
        });
      }
      if (result.status === "active") {
        setActiveBusinessOrgId(result.orgId);
        await refreshActiveBusinessOrg();
        Alert.alert(t("business.join.successActiveTitle"), t("business.join.successActiveBody"));
        // Employee never creates a personal first project. Land on the Business
        // workspace right away so the user sees the org they just joined.
        await finishMinimalOnboarding(() => {
          onBusinessFlowRequested?.();
        });
      } else {
        Alert.alert(t("business.join.pendingTitle"), t("business.join.pendingBody"));
        // Request pending approval -> finish onboarding silently and land on Home.
        await finishMinimalOnboarding();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`${t("business.join.invalidCode")}: ${message}`);
    } finally {
      setJoinBusy(false);
    }
  };

  /** Step 0: company join vs try Staveto solo (Business org creation is from Profile later). */
  const onSelectUsageMode = useCallback((selected: UsageMode) => {
    setError("");
    setUsageMode(selected);
    if (selected === "join_company") setStep(8);
    else setStep(1);
  }, []);

  // TODO(business-join-deeplink): keep deep-link handoff/prefill for a dedicated PR
  // that can safely update global linking setup in AppShell/RootNavigator.

  const onCreateEquipment = async () => {
    if (!user?.id) return;
    if (!eqName.trim()) {
      setError(t("onboardingMvp.equipmentNameRequired"));
      return;
    }
    setCreatingEquipment(true);
    setError("");
    try {
      await userEquipmentService.createUserEquipment(user.id, {
        name: eqName.trim(),
        category: eqCategory,
        kind: eqKind.trim() || undefined,
        internalCode: eqCode.trim() || undefined,
        locationText: eqLocation.trim() || undefined,
        status: "available",
      });
      createdEquipmentRef.current = true;
      // Solo flow finishes right after equipment now that the company-choice
      // step has moved to the very beginning of onboarding.
      await completeActivation();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert(t("common.error"), msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreatingEquipment(false);
    }
  };

  const wrap = (body: React.ReactNode) => (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 24}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      {step === 0 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("onboarding.usageMode.title")}</Text>
            <Text style={styles.subtitle}>{t("onboarding.usageMode.subtitle")}</Text>
            <View style={styles.usageModeOptions}>
              <TouchableOpacity
                style={styles.usageModeCard}
                onPress={() => onSelectUsageMode("join_company")}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t("onboarding.usageMode.joinCompany.title")}
              >
                <View style={styles.usageModeIconWrap}>
                  <Ionicons name="people-outline" size={26} color={colors.primary} />
                </View>
                <View style={styles.usageModeTextWrap}>
                  <Text style={styles.usageModeTitle}>
                    {t("onboarding.usageMode.joinCompany.title")}
                  </Text>
                  <Text style={styles.usageModeBody}>
                    {t("onboarding.usageMode.joinCompany.body")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.usageModeCard}
                onPress={() => onSelectUsageMode("solo")}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t("onboarding.usageMode.solo.title")}
              >
                <View style={styles.usageModeIconWrap}>
                  <Ionicons name="person-outline" size={26} color={colors.primary} />
                </View>
                <View style={styles.usageModeTextWrap}>
                  <Text style={styles.usageModeTitle}>
                    {t("onboarding.usageMode.solo.title")}
                  </Text>
                  <Text style={styles.usageModeBody}>
                    {t("onboarding.usageMode.solo.body")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {saving ? (
              <View style={{ marginTop: spacing.md, alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
            {onBack ? (
              <TouchableOpacity
                style={[styles.textLinkBtn, { marginTop: spacing.md }]}
                onPress={onBack}
                disabled={saving}
              >
                <Text style={styles.textLink}>{t("onboardingMvp.back")}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )
      ) : step === 1 ? (
        wrap(
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
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setError("");
                  setStep(0);
                }}
              >
                <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { flex: 1 }]}
                onPress={() => {
                  if (!mode) {
                    setError(t("onboardingMvp.errorSelectOption"));
                    return;
                  }
                  setError("");
                  void persistPrimaryUsageMode(mode).finally(() => setStep(2));
                }}
              >
                <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
              </TouchableOpacity>
            </View>
          </>
        )
      ) : step === 2 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("onboardingMvp.stepCountryTitle")}</Text>
            <Text style={styles.subtitle}>{t("onboardingMvp.stepCountrySubtitle")}</Text>
            <ScrollView style={styles.countryList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {COUNTRY_CODES.map((code) => (
                <TouchableOpacity
                  key={code}
                  style={[styles.countryOption, primaryCountry === code && styles.optionActive]}
                  onPress={() => setPrimaryCountry(code)}
                >
                  <Text style={[styles.countryOptionText, primaryCountry === code && styles.optionTextActive]}>
                    {getLocalizedCountryName(code, locale)}
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
        )
      ) : step === 3 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("onboardingMvp.step2Title")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.placeholderFirstName")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={firstName}
              onChangeText={setFirstName}
            />
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.placeholderLastName")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={lastName}
              onChangeText={setLastName}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(2); }}>
                <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={skipNameStep}>
                <Text style={styles.secondaryText}>{t("onboardingMvp.step3Skip")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveNameStep}>
                <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
              </TouchableOpacity>
            </View>
          </>
        )
      ) : step === 4 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("onboardingMvp.step3Title")}</Text>
            <View style={styles.phoneRow}>
              <TouchableOpacity style={styles.phoneCountryBtn} onPress={() => setShowPhoneCountryModal(true)}>
                <Text style={styles.phoneCountryText}>
                  {phoneCountryCode} +{getCountryCallingCode(phoneCountryCode)}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.text} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder={t("onboardingMvp.placeholderPhone")}
                placeholderTextColor={colors.inputPlaceholderOnLight}
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
                  <ScrollView style={styles.countryList} nestedScrollEnabled showsVerticalScrollIndicator>
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
                          {getLocalizedCountryName(code, locale)} (+{getCountryCallingCode(code)})
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
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setError(""); setStep(3); }}>
                <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void goToProjectStep(true)}>
                <Text style={styles.secondaryText}>{t("onboardingMvp.skipForNow")}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.button, { marginTop: spacing.sm }]} onPress={() => void goToProjectStep(false)}>
              <Text style={styles.buttonText}>{t("onboardingMvp.next")}</Text>
            </TouchableOpacity>
          </>
        )
      ) : step === 5 ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={insets.top + 24}
        >
          <View style={[styles.flex, { paddingHorizontal: spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.title}>{t("onboardingMvp.stepProjectTitleUnified")}</Text>
            <Text style={styles.subtitle}>{t("onboardingMvp.stepProjectSubtitle")}</Text>
            <View style={{ flex: 1, minHeight: 420 }}>
              <UnifiedProjectCreationFlow
                variant="onboarding"
                existingProjects={[]}
                internalHints={{ countryCode: primaryCountry, primaryUsageMode: mode }}
                onSuccess={async ({ projectId }) => {
                  try {
                    await AsyncStorage.setItem("@staveto:lastUsedProjectId", projectId);
                  } catch {
                    /* ignore */
                  }
                  createdProjectRef.current = true;
                  await markFirstProjectPromptShown();
                  setStep(6);
                }}
              />
            </View>
            <TouchableOpacity style={[styles.secondaryBtnFull, { marginTop: spacing.md }]} onPress={onSkipProject}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.skipForNow")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.textLinkBtn, { marginTop: spacing.md }]}
              onPress={() => {
                setError("");
                setStep(4);
              }}
            >
              <Text style={styles.textLink}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : step === 6 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("onboardingMvp.stepEquipmentTitle")}</Text>
            <Text style={styles.subtitle}>{t("onboardingMvp.stepEquipmentSubtitle")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentNamePlaceholder")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={eqName}
              onChangeText={setEqName}
            />
            <Text style={styles.fieldLabel}>{t("onboardingMvp.equipmentCategoryLabel")}</Text>
            <View style={styles.chipRow}>
              {EQ_CATEGORIES.map(({ value, icon }) => {
                const active = eqCategory === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setEqCategory(value)}
                  >
                    <Ionicons name={icon} size={18} color={active ? colors.primary : colors.textMuted} />
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                      {t(equipmentCategoryKey(value))}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentKindPlaceholder")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={eqKind}
              onChangeText={setEqKind}
            />
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentCodePlaceholder")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={eqCode}
              onChangeText={setEqCode}
            />
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentLocationPlaceholder")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={eqLocation}
              onChangeText={setEqLocation}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, (creatingEquipment || saving) && styles.buttonDisabled]}
              onPress={() => void onCreateEquipment()}
              disabled={creatingEquipment || saving}
            >
              {creatingEquipment || saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t("onboardingMvp.addEquipmentCta")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtnFull, { marginTop: spacing.md }]}
              onPress={onSkipEquipment}
              disabled={creatingEquipment || saving}
            >
              <Text style={styles.secondaryText}>{t("onboardingMvp.skipForNow")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.textLinkBtn, { marginTop: spacing.md }]} onPress={() => { setError(""); setStep(5); }} disabled={creatingEquipment || saving}>
              <Text style={styles.textLink}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
          </>
        )
      ) : step === 8 ? (
        wrap(
          <>
            <Text style={styles.title}>{t("business.join.haveCode")}</Text>
            <Text style={styles.subtitle}>{t("business.join.enterCode")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("business.join.codePlaceholder")}
              placeholderTextColor={colors.inputPlaceholderOnLight}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, (saving || joinBusy) && styles.buttonDisabled]}
              onPress={() => void redeemCodeAndFinish()}
              disabled={saving || joinBusy}
            >
              {joinBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t("business.join.submit")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.textLinkBtn, { marginTop: spacing.md }]}
              onPress={() => {
                setError("");
                // Always return to the mode picker; legacy step 7 is no longer
                // part of the main flow.
                setStep(0);
              }}
              disabled={saving || joinBusy}
            >
              <Text style={styles.textLink}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
          </>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: colors.onboardingHelperOnDark,
    marginBottom: spacing.md,
    textAlign: "center",
    lineHeight: 22,
  },
  countryList: { maxHeight: 220, marginBottom: spacing.md },
  countryOption: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    marginBottom: spacing.xs,
  },
  countryOptionText: { color: colors.text, fontSize: 15 },
  options: { gap: spacing.sm, marginBottom: spacing.md },
  option: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  optionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  optionText: { color: colors.text, fontSize: 15, textAlign: "center" },
  optionTextActive: { color: colors.primary, fontWeight: "600" },
  input: {
    backgroundColor: colors.formPanel,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
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
    backgroundColor: colors.formPanel,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
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
    color: colors.textOnDark,
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
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", flexWrap: "wrap" },
  secondaryBtn: {
    backgroundColor: colors.formPanel,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  secondaryBtnFull: {
    backgroundColor: colors.formPanel,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  secondaryText: { color: colors.text },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.labelOnDark, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    backgroundColor: colors.formPanel,
    maxWidth: "48%",
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "12" },
  chipText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  chipTextActive: { color: colors.primary, fontWeight: "600" },
  textLinkBtn: { alignItems: "center" },
  textLink: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  usageModeOptions: { gap: spacing.sm, marginBottom: spacing.md },
  usageModeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.formPanel,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  usageModeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary + "12",
    alignItems: "center",
    justifyContent: "center",
  },
  usageModeTextWrap: { flex: 1 },
  usageModeTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  usageModeBody: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
});
