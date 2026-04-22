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
import { updateUserProfileFromOnboarding } from "../services/auth";
import type { PrimaryUsageMode } from "../lib/primaryUsageMode";
import { persistPrimaryUsageMode } from "../lib/primaryUsageMode";
import { COUNTRY_CODES, getCountryCallingCode, getDeviceTimezone, getDeviceRegionCode, getLocalizedCountryName } from "../utils/countries";
import { createProjectFromTemplate } from "../services/projectFactory";
import { shouldUseCountryCatalogTemplate } from "../lib/projectTypeModel";
import { resolveTemplateIdForCountry } from "../utils/templateResolver";
import * as userEquipmentService from "../services/userEquipment";
import type { EquipmentCategory } from "../services/equipment";
import { markFirstProjectPromptShown } from "../utils/firstProjectPrompt";

type Props = {
  onFinished: () => void;
  onBack?: () => void;
};

type Mode = PrimaryUsageMode;
const PENDING_ONBOARDING_KEY = "pending_onboarding";

/** Steps: 1=mode, 2=country, 3=name, 4=phone, 5=first project, 6=first equipment */
type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;

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

export function OnboardingMvpScreen({ onFinished, onBack }: Props) {
  const { t, locale } = useI18n();
  const { user, finishOnboarding } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<OnboardingStep>(1);
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

  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const createdProjectRef = useRef(false);

  const [eqName, setEqName] = useState("");
  const [eqCategory, setEqCategory] = useState<EquipmentCategory>("tool");
  const [eqKind, setEqKind] = useState("");
  const [eqCode, setEqCode] = useState("");
  const [eqLocation, setEqLocation] = useState("");
  const [creatingEquipment, setCreatingEquipment] = useState(false);
  const createdEquipmentRef = useRef(false);

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

  const completeActivation = useCallback(async () => {
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

  const onCreateProject = async () => {
    if (!mode || !user?.id) return;
    if (!projectName.trim()) {
      setError(t("createProject.nameRequired"));
      return;
    }
    setCreatingProject(true);
    setError("");
    try {
      const projectType = mode === "build" ? "BUILD" : "TRADE";
      const useTemplate = shouldUseCountryCatalogTemplate({ selectedType: projectType, creationMethod: "template" });
      const templateId = useTemplate ? resolveTemplateIdForCountry(primaryCountry) : "";

      const newProjectId = await createProjectFromTemplate({
        projectType,
        templateId,
        name: projectName.trim(),
        countryCode: primaryCountry.trim() || undefined,
        workType: projectType === "BUILD" ? "RENOVATION" : "INSTALLATION",
        businessMode: "DIRECT",
        creationMode: projectType === "BUILD" ? "TEMPLATE" : "MANUAL",
      });
      try {
        await AsyncStorage.setItem("@staveto:lastUsedProjectId", newProjectId);
      } catch {
        /* ignore */
      }
      createdProjectRef.current = true;
      await markFirstProjectPromptShown();
      setProjectName("");
      setStep(6);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert(t("common.error"), msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreatingProject(false);
    }
  };

  const onSkipEquipment = () => {
    void (async () => {
      await completeActivation();
    })();
  };

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
      await completeActivation();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert(t("common.error"), msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreatingEquipment(false);
    }
  };

  const projectTitle =
    mode === "trade" ? t("onboardingMvp.stepProjectTitleTrade") : t("onboardingMvp.stepProjectTitleBuild");
  const projectPrimaryLabel =
    mode === "trade" ? t("onboardingMvp.createJobCta") : t("onboardingMvp.createProjectCta");

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
      {step === 1 ? (
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
              {onBack ? (
                <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
                  <Text style={styles.secondaryText}>{t("onboardingMvp.back")}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.button, onBack ? { flex: 1 } : undefined]}
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
        wrap(
          <>
            <Text style={styles.title}>{projectTitle}</Text>
            <Text style={styles.subtitle}>{t("onboardingMvp.stepProjectSubtitle")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.projectNamePlaceholder")}
              placeholderTextColor={colors.textMuted}
              value={projectName}
              onChangeText={setProjectName}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, creatingProject && styles.buttonDisabled]}
              onPress={() => void onCreateProject()}
              disabled={creatingProject}
            >
              {creatingProject ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{projectPrimaryLabel}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryBtnFull, { marginTop: spacing.md }]} onPress={onSkipProject} disabled={creatingProject}>
              <Text style={styles.secondaryText}>{t("onboardingMvp.skipForNow")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.textLinkBtn, { marginTop: spacing.md }]} onPress={() => { setError(""); setStep(4); }} disabled={creatingProject}>
              <Text style={styles.textLink}>{t("onboardingMvp.back")}</Text>
            </TouchableOpacity>
          </>
        )
      ) : (
        wrap(
          <>
            <Text style={styles.title}>{t("onboardingMvp.stepEquipmentTitle")}</Text>
            <Text style={styles.subtitle}>{t("onboardingMvp.stepEquipmentSubtitle")}</Text>
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentNamePlaceholder")}
              placeholderTextColor={colors.textMuted}
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
              placeholderTextColor={colors.textMuted}
              value={eqKind}
              onChangeText={setEqKind}
            />
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentCodePlaceholder")}
              placeholderTextColor={colors.textMuted}
              value={eqCode}
              onChangeText={setEqCode}
            />
            <TextInput
              style={styles.input}
              placeholder={t("onboardingMvp.equipmentLocationPlaceholder")}
              placeholderTextColor={colors.textMuted}
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
      )}
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
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md, textAlign: "center", lineHeight: 20 },
  countryList: { maxHeight: 220, marginBottom: spacing.md },
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
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", flexWrap: "wrap" },
  secondaryBtn: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnFull: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    maxWidth: "48%",
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + "12" },
  chipText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  chipTextActive: { color: colors.primary, fontWeight: "600" },
  textLinkBtn: { alignItems: "center" },
  textLink: { color: colors.primary, fontSize: 15, fontWeight: "600" },
});
