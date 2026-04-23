import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Share,
  Modal,
  Pressable,
  Linking,
  Image,
  TextInput,
  ActivityIndicator,
  FlatList,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { getBaseURL, api } from "../api/client";
import { IOS_DIAGNOSTIC, getDiagnosticEnvRaw } from "../lib/iosDiagnostic";
import { colors, radius, spacing } from "../theme";
import { DPA_URL, PRIVACY_URL, SUBPROCESSORS_URL, SUPPORT_EMAIL, TERMS_URL } from "../constants/consent";
import { requestAccountDeletion } from "../services/account";
import { isFeatureEnabled } from "../services/features";
import { db, getStorage, getCallable } from "../firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "../lib/rnFirestore";
import * as ImagePicker from "expo-image-picker";
import { getDeviceRegionCode } from "../utils/countries";
import { auth } from "../firebase";
import Constants from "expo-constants";
import { FeedbackModal } from "../components/FeedbackModal";
import {
  PROFESSION_CODES,
  mapExistingFreeTextToCodeForMigration,
  toSavePayload,
  type ProfessionCode,
} from "../lib/professions";

function Row({
  icon,
  label,
  onPress,
  right,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const content = (
    <>
      <Ionicons name={icon} size={22} color={colors.textMuted} style={rowStyles.icon} />
      <Text style={rowStyles.label}>{label}</Text>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null)}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={rowStyles.row} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={rowStyles.row}>{content}</View>;
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  icon: { marginRight: spacing.md, width: 28, textAlign: "center" },
  /** minWidth: 0 so long right-side text cannot squeeze label to one-character width (Android). */
  label: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 16, color: colors.text },
});

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const LOCALES = ["sk", "en", "de", "cs", "es", "it", "pl"] as const;
type Locale = (typeof LOCALES)[number];

function normalizePhoneE164(input: string): string | null {
  const raw = input.trim().replace(/\s/g, "");
  if (!raw) return null;
  try {
    const { parsePhoneNumberFromString } = require("libphonenumber-js");
    const region = getDeviceRegionCode();
    const parsed = parsePhoneNumberFromString(raw, region);
    if (parsed?.isValid()) return parsed.number;
  } catch {
    const digits = raw.replace(/[^\d+]/g, "");
    if (digits.length >= 9) return digits.startsWith("+") ? digits : `+${digits}`;
  }
  return null;
}

export function AccountScreen() {
  const navigation = useNavigation();
  const { t, locale, setLocale, localeNames } = useI18n();
  const { user, orgId, token, logout, refreshUser } = useAuth();
  const [showAway, setShowAway] = useState(false);
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugMessage, setDebugMessage] = useState("");
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileProfessionCode, setProfileProfessionCode] = useState<ProfessionCode | null>(null);
  const [profileProfessionOtherText, setProfileProfessionOtherText] = useState("");
  const [profileHourlyRate, setProfileHourlyRate] = useState("");
  const [profilePhotoURL, setProfilePhotoURL] = useState<string | null>(null);
  const [showProfessionModal, setShowProfessionModal] = useState(false);
  const [professionSearch, setProfessionSearch] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [contractorsEnabled, setContractorsEnabled] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [primaryUsageMode, setPrimaryUsageMode] = useState<"build" | "trade" | null>(null);
  const [showUsageModeModal, setShowUsageModeModal] = useState(false);

  const nav = navigation as { navigate: (name: string, params?: object) => void };

  const openTasksTab = useCallback(() => {
    // Tasks lives in HomeStack, not on the tab root — nest by tab name "Home".
    nav.navigate("Home", { screen: "Tasks" });
  }, [nav]);
  const displayName = user?.name ?? user?.email ?? "—";
  const initials = displayName !== "—" ? displayName.slice(0, 2).toUpperCase() : "?";

  const shareEmail = () => {
    const email = user?.email ?? "";
    if (email) Share.share({ message: email, title: t("account.email") });
  };

  const openUrl = useCallback(async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert(t("common.error"), t("account.linkOpenFailed"));
    }
  }, [t]);

  const handleCheckForExpoUpdate = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert(t("account.checkForUpdates"), t("account.expoUpdatesWebNotSupported"));
      return;
    }
    if (__DEV__) {
      Alert.alert(t("account.checkForUpdates"), t("account.expoUpdatesDevOnly"));
      return;
    }
    let Updates: typeof import("expo-updates");
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load so old dev clients without native ExpoUpdates still boot
      Updates = require("expo-updates");
    } catch {
      Alert.alert(t("account.checkForUpdates"), t("account.expoUpdatesRebuildRequired"));
      return;
    }
    if (!Updates.isEnabled) {
      Alert.alert(t("account.checkForUpdates"), t("account.expoUpdatesDisabled"));
      return;
    }
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        Alert.alert(t("account.expoUpdatesAvailableTitle"), t("account.expoUpdatesAvailableBody"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("account.expoUpdatesDownload"),
            style: "default",
            onPress: () => {
              void (async () => {
                try {
                  await Updates.fetchUpdateAsync();
                  await Updates.reloadAsync();
                } catch (e) {
                  Alert.alert(t("common.error"), e instanceof Error ? e.message : String(e));
                }
              })();
            },
          },
        ]);
      } else {
        Alert.alert(t("account.expoUpdatesUpToDateTitle"), t("account.expoUpdatesUpToDateBody"));
      }
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const openSupportEmail = useCallback(
    async (subject: string, body?: string) => {
      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}${
        body ? `&body=${encodeURIComponent(body)}` : ""
      }`;
      await openUrl(mailto);
    },
    [openUrl]
  );

  const runTest = async (name: string, fn: () => Promise<unknown>) => {
    setDebugMessage(`… ${name}`);
    try {
      const out = await fn();
      setDebugMessage(`${name}: OK\n${JSON.stringify(out, null, 2).slice(0, 400)}`);
    } catch (e) {
      setDebugMessage(`${name}: FAIL\n${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  const buildTimestamp = (Constants.expoConfig?.extra as { buildTimestamp?: string })?.buildTimestamp;
  const versionDisplay = buildTimestamp ? `${appVersion} (${buildTimestamp})` : appVersion;

  const loadProfile = useCallback(async () => {
    if (!user?.id) {
      setLoadingProfile(false);
      return;
    }
    try {
      const snap = await getDoc(doc(db, "users", user.id));
      if (snap.exists()) {
        const data = snap.data() as {
          primaryProfessionCode?: string | null;
          primaryProfessionOtherText?: string | null;
          profession?: string;
          primaryProfession?: string;
          photoURL?: string | null;
          firstName?: string;
          lastName?: string;
          phoneE164?: string | null;
          primaryUsageMode?: "build" | "trade" | "maintenance" | null;
          hourlyRateEur?: number | null;
        };
        setProfileFirstName(data.firstName ?? user.firstName ?? "");
        setProfileLastName(data.lastName ?? user.lastName ?? "");
        setProfilePhone(data.phoneE164 ?? "");
        const rawUsage = data.primaryUsageMode;
        if (rawUsage === "build" || rawUsage === "trade") {
          setPrimaryUsageMode(rawUsage);
        } else if (rawUsage === "maintenance") {
          setPrimaryUsageMode("trade");
        } else {
          const pending = await AsyncStorage.getItem("pending_onboarding");
          if (pending) {
            try {
              const parsed = JSON.parse(pending) as { mode?: string };
              if (parsed?.mode === "build" || parsed?.mode === "trade") {
                setPrimaryUsageMode(parsed.mode);
              } else if (parsed?.mode === "maintenance") {
                setPrimaryUsageMode("trade");
              }
            } catch {
              // ignore
            }
          }
        }
        if (data.primaryProfessionCode != null) {
          setProfileProfessionCode(data.primaryProfessionCode as ProfessionCode);
          setProfileProfessionOtherText(data.primaryProfessionOtherText ?? "");
        } else {
          const legacy = data.profession ?? data.primaryProfession ?? "";
          const migrated = mapExistingFreeTextToCodeForMigration(legacy);
          if (migrated) {
            setProfileProfessionCode(migrated.code);
            setProfileProfessionOtherText(migrated.otherText ?? "");
          } else {
            setProfileProfessionCode(null);
            setProfileProfessionOtherText("");
          }
        }
        setProfilePhotoURL(data.photoURL ?? null);
        setProfileHourlyRate(data.hourlyRateEur != null && data.hourlyRateEur > 0 ? String(data.hourlyRateEur) : "");
      } else {
        setProfileFirstName(user.firstName ?? "");
        setProfileLastName(user.lastName ?? "");
        setProfileHourlyRate("");
        const pending = await AsyncStorage.getItem("pending_onboarding");
        if (pending) {
          try {
            const parsed = JSON.parse(pending) as { mode?: string };
            if (parsed?.mode === "build" || parsed?.mode === "trade") {
              setPrimaryUsageMode(parsed.mode);
            } else if (parsed?.mode === "maintenance") {
              setPrimaryUsageMode("trade");
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      console.warn("[account] Failed to load profile data:", error);
    } finally {
      setLoadingProfile(false);
    }
  }, [user?.id, user?.firstName, user?.lastName]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!user?.id) return;
    isFeatureEnabled("contractors", user.id).then(setContractorsEnabled).catch(() => setContractorsEnabled(false));
  }, [user?.id]);

  const saveProfile = useCallback(async () => {
    if (!user?.id) return;
    if (!profileFirstName.trim()) {
      Alert.alert(t("common.error"), t("account.errorFirstNameRequired"));
      return;
    }
    if (!profileLastName.trim()) {
      Alert.alert(t("common.error"), t("account.errorLastNameRequired"));
      return;
    }
    if (profileProfessionCode === null) {
      Alert.alert(t("common.error"), t("profile.primaryProfession.required"));
      return;
    }
    if (profileProfessionCode === "OTHER" && profileProfessionOtherText.trim().length < 2) {
      Alert.alert(t("common.error"), t("profile.primaryProfession.otherRequired"));
      return;
    }
    const phoneE164 = profilePhone.trim() ? normalizePhoneE164(profilePhone) : null;
    if (profilePhone.trim() && !phoneE164) {
      Alert.alert(t("common.error"), t("account.errorPhoneInvalid"));
      return;
    }
    const professionPayload = toSavePayload(profileProfessionCode, profileProfessionOtherText);
    if (!professionPayload) return;
    setSavingProfile(true);
    try {
      const displayName = `${profileFirstName.trim()} ${profileLastName.trim()}`.trim();
      const hourlyRateNum = profileHourlyRate.trim() ? parseFloat(profileHourlyRate.trim()) : null;
      const hourlyRateEur = hourlyRateNum != null && !isNaN(hourlyRateNum) && hourlyRateNum > 0 ? hourlyRateNum : null;
      await updateDoc(doc(db, "users", user.id), {
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim(),
        displayName,
        phoneE164: phoneE164 ?? null,
        primaryProfessionCode: professionPayload.primaryProfessionCode,
        primaryProfessionOtherText: professionPayload.primaryProfessionOtherText,
        photoURL: profilePhotoURL ?? null,
        hourlyRateEur,
        updatedAt: serverTimestamp(),
      });
      const fbUser = auth()?.currentUser;
      if (fbUser?.uid === user.id && displayName) {
        await fbUser.updateProfile({ displayName });
      }
      await refreshUser();
      setShowProfileModal(false);
    } catch (error) {
      console.error("[account] Failed to save profile:", error);
      Alert.alert(t("common.error"), t("account.profileSaveFailed"));
    } finally {
      setSavingProfile(false);
    }
  }, [user?.id, profileFirstName, profileLastName, profilePhone, profileProfessionCode, profileProfessionOtherText, profilePhotoURL, profileHourlyRate, t]);

  const saveUsageMode = useCallback(
    async (mode: "build" | "trade") => {
      if (!user?.id) return;
      setPrimaryUsageMode(mode);
      setShowUsageModeModal(false);
      try {
        const { persistPrimaryUsageMode } = await import("../lib/primaryUsageMode");
        await persistPrimaryUsageMode(mode);
        await updateDoc(doc(db, "users", user.id), {
          primaryUsageMode: mode,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn("[account] Failed to save primaryUsageMode:", error);
      }
    },
    [user?.id]
  );

  const pickProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("account.permission"), t("account.galleryPermission"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (result?.canceled || !asset?.uri) return;

      setUploadingPhoto(true);
      const fileName = asset.fileName || `profile_${Date.now()}.jpg`;
      const storageInstance = getStorage();
      if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
      const storageRef = storageInstance.ref(`users/${user.id}/profile/${fileName}`);
      await storageRef.putFile(asset.uri);
      const url = await storageRef.getDownloadURL();
      setProfilePhotoURL(url);
    } catch (error) {
      console.error("[account] Failed to pick profile photo:", error);
      Alert.alert(t("common.error"), t("account.uploadPhotoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.id]);

  const takeProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("account.permission"), t("account.cameraPermission"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (result?.canceled || !asset?.uri) return;

      setUploadingPhoto(true);
      const fileName = asset.fileName || `profile_${Date.now()}.jpg`;
      const storageInstance = getStorage();
      if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
      const storageRef = storageInstance.ref(`users/${user.id}/profile/${fileName}`);
      await storageRef.putFile(asset.uri);
      const url = await storageRef.getDownloadURL();
      setProfilePhotoURL(url);
    } catch (error) {
      console.error("[account] Failed to take profile photo:", error);
      Alert.alert(t("common.error"), t("account.takePhotoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [user?.id]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profil: avatar + meno + rola/department + email */}
      <View style={styles.profileCard}>
        <TouchableOpacity style={styles.avatar} onPress={() => setShowProfileModal(true)} activeOpacity={0.7}>
          {profilePhotoURL ? (
            <Image source={{ uri: profilePhotoURL }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.profileName}>{displayName}</Text>
        {loadingProfile ? (
          <Text style={styles.profileHint}>Načítavam…</Text>
        ) : (
          <Text style={styles.profileHint}>
            {profileProfessionCode
              ? profileProfessionCode === "OTHER"
                ? profileProfessionOtherText || t("profile.primaryProfession.otherPlaceholder")
                : t(`professions.${profileProfessionCode}`)
              : t("profile.primaryProfession.placeholder")}
          </Text>
        )}
        <View style={styles.emailRow}>
          <Text style={styles.emailText} numberOfLines={1}>{user?.email ?? "—"}</Text>
          <TouchableOpacity onPress={shareEmail} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="copy-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.editProfileButton} onPress={() => setShowProfileModal(true)}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={styles.editProfileText}>Upraviť profil</Text>
        </TouchableOpacity>
      </View>

      {/* Rýchle akcie: Show away, Send message, View tasks */}
      <View style={styles.card}>
        <Row
          icon="car-outline"
          label={t("account.showAway")}
          right={
            <Switch
              value={showAway}
              onValueChange={setShowAway}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          }
        />
        <Row icon="chatbubble-outline" label={t("account.sendMessage")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="checkbox-outline" label={t("account.viewTasks")} onPress={openTasksTab} />
        <Row
          icon="construct-outline"
          label={t("account.usageModeRowLabel")}
          onPress={() => setShowUsageModeModal(true)}
          right={
            <View style={styles.usageModeValueWrap}>
              <Text style={styles.localeBadge} numberOfLines={1} ellipsizeMode="tail">
                {primaryUsageMode
                  ? t(`onboardingMvp.option${primaryUsageMode.charAt(0).toUpperCase() + primaryUsageMode.slice(1)}`)
                  : t("account.primaryUsageModeNotSet")}
              </Text>
            </View>
          }
        />
      </View>

      {/* Organizácie */}
      <SectionTitle title={t("account.organizations")} />
      <View style={styles.card}>
        <View style={styles.orgRow}>
          <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={{ marginRight: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>staveto.com</Text>
            <Text style={styles.orgEmail}>{user?.email ?? "—"}</Text>
          </View>
          <TouchableOpacity style={styles.inviteBtn} onPress={() => Alert.alert(t("account.comingSoon"))}>
            <Text style={styles.inviteBtnText}>{t("account.invite")}</Text>
          </TouchableOpacity>
        </View>
        <Row
          icon="mail-open-outline"
          label={t("projectInvites.title") || "Pozvánky do projektov"}
          onPress={() => nav.navigate("ProjectInvites")}
        />
      </View>

      {/* Plán / Billing banner */}
      <SectionTitle title={t("account.plan")} />
      {user?.billing && (
        <View style={[styles.card, styles.billingBanner]}>
          <View style={styles.billingBannerContent}>
            <Ionicons
              name={user.billing.isPro ? "checkmark-circle" : "time-outline"}
              size={24}
              color={user.billing.status === "expired" ? "#FF5722" : colors.primary}
            />
            <View style={styles.billingBannerText}>
              <Text style={styles.billingBannerTitle}>
                {user.billing.status === "trial"
                  ? t("subscription.statusTrial")
                  : user.billing.status === "active"
                    ? t("subscription.proActive")
                    : t("subscription.statusExpired")}
              </Text>
              {user.billing.status === "trial" && user.billing.remainingTrialDays > 0 && (
                <Text style={styles.billingBannerSub}>
                  {t("subscription.trialRemainingDays", { count: String(user.billing.remainingTrialDays) })}
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.billingBannerButton}
            onPress={() => nav.navigate("Subscription")}
          >
            <Text style={styles.billingBannerButtonText}>
              {user.billing.isPro ? t("account.subscription") : t("subscription.activatePro")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.card}>
        <Row
          icon="card-outline"
          label={t("account.subscription")}
          onPress={() => nav.navigate("Subscription")}
        />
      </View>

      {/* Notifikácie */}
      <SectionTitle title={t("account.settings")} />
      <View style={styles.card}>
        <Row
          icon="moon-outline"
          label={t("account.doNotDisturb")}
          right={
            <Switch
              value={doNotDisturb}
              onValueChange={setDoNotDisturb}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          }
        />
        <Row
          icon="notifications-outline"
          label={t("account.pushNotifications")}
          onPress={() => Alert.alert(t("account.manage"), t("account.comingSoon"))}
        />
      </View>

      {/* Údržba - obnovenie sharedWithCount pre existujúce projekty */}
      <SectionTitle title={t("account.maintenance")} />
      <View style={styles.card}>
        <Row
          icon="refresh-outline"
          label={t("account.refreshSharedCounts")}
          onPress={async () => {
            try {
              const res = await getCallable("backfillProjectSharedCounts")({});
              const data = res?.data as { ok?: boolean; updated?: number };
              Alert.alert(t("account.done"), t("account.refreshSuccess", { count: String(data?.updated ?? 0) }));
            } catch (e: any) {
              Alert.alert(t("common.error"), e?.message ?? t("account.refreshFailed"));
            }
          }}
        />
      </View>

      {/* Podpora */}
      <SectionTitle title={t("account.support")} />
      <View style={styles.card}>
        <Row icon="information-circle-outline" label={t("account.androidGuide")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row
          icon="chatbubble-ellipses-outline"
          label={t("account.sendFeedback") || "Send Feedback"}
          onPress={() => setShowFeedbackModal(true)}
        />
        <Row
          icon="help-circle-outline"
          label={t("account.contactSupport")}
          onPress={() =>
            openSupportEmail(
              t("account.contactSupportSubject"),
              `Používateľ: ${user?.email ?? "—"}\n\nPopis problému:\n`
            )
          }
        />
        <Row
          icon="download-outline"
          label={t("account.requestDataExport")}
          onPress={() =>
            openSupportEmail(
              t("account.requestDataExportSubject"),
              `Žiadosť o export údajov.\nPoužívateľ: ${user?.email ?? "—"}\n\nProsím o spracovanie žiadosti.`
            )
          }
        />
        <Row
          icon="trash-outline"
          label={t("account.deleteAccount")}
          onPress={() =>
            Alert.alert(
              t("account.deleteAccountConfirmTitle"),
              t("account.deleteAccountConfirmBody"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.continue"),
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await requestAccountDeletion("user_initiated");
                      Alert.alert(t("common.success"), t("account.deleteAccountSuccess"));
                      await logout();
                    } catch (error) {
                      console.error("[account] Failed to request deletion:", error);
                      Alert.alert(t("common.error"), t("account.deleteAccountFailed"));
                    }
                  },
                },
              ]
            )
          }
        />
      </View>

      {/* App */}
      <SectionTitle title={t("account.app")} />
      <View style={styles.card}>
        {contractorsEnabled ? (
          <Row
            icon="people-outline"
            label={t("account.contractors")}
            onPress={() => nav.navigate("ContractorsList")}
          />
        ) : null}
        <Row icon="moon-outline" label={t("account.displaySetting")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row
          icon="language-outline"
          label={t("account.language")}
          onPress={() => setShowLanguageModal(true)}
          right={<Text style={styles.localeBadge}>{localeNames[locale]}</Text>}
        />
        <Row icon="eye-outline" label={t("account.privacyPolicy")} onPress={() => openUrl(PRIVACY_URL)} />
        <Row icon="document-text-outline" label={t("account.termsOfService")} onPress={() => openUrl(TERMS_URL)} />
        <Row icon="people-outline" label={t("account.subprocessors")} onPress={() => openUrl(SUBPROCESSORS_URL)} />
        <Row icon="document-outline" label={t("account.privacyStatement")} onPress={() => openUrl(DPA_URL)} />
        <Row icon="list-outline" label={t("account.licenses")} onPress={() => Alert.alert(t("account.comingSoon"))} />
        <Row icon="cloud-download-outline" label={t("account.checkForUpdates")} onPress={handleCheckForExpoUpdate} />
        <View style={[rowStyles.row, { borderBottomWidth: 0 }]}>
          <Ionicons name="phone-portrait-outline" size={22} color={colors.textMuted} style={rowStyles.icon} />
          <Text style={rowStyles.label}>{t("account.appVersion")}</Text>
          <Text style={styles.versionNum}>{versionDisplay}</Text>
        </View>
      </View>

      {/* Debug (skrytý) */}
      <TouchableOpacity onPress={() => setShowDebug((v) => !v)} style={{ marginTop: spacing.sm, padding: spacing.sm }}>
        <Text style={styles.debugToggle}>{showDebug ? t("account.hideDebug") : t("account.debug")}</Text>
      </TouchableOpacity>
      {showDebug && (
        <View style={[styles.card, { borderColor: colors.primary, marginTop: spacing.sm }]}>
          <Text style={styles.debugLine}>baseURL: {getBaseURL()}</Text>
          <Text style={styles.debugLine}>IOS_DIAGNOSTIC: {String(IOS_DIAGNOSTIC)}</Text>
          <Text style={styles.debugLine}>EXPO_PUBLIC_IOS_DIAGNOSTIC: "{getDiagnosticEnvRaw() || "(empty)"}"</Text>
          <Text style={styles.debugLine}>Token: {token ? "áno" : "nie"}</Text>
          <Text style={styles.debugLine}>orgId: {orgId ?? "—"}</Text>
          <View style={styles.debugButtons}>
            <TouchableOpacity style={styles.debugBtn} onPress={() => runTest("/health", () => api.healthCheck())}>
              <Text style={styles.debugBtnText}>Test /health</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, !orgId && styles.debugBtnDisabled]}
              disabled={!orgId}
              onPress={() => runTest("/projects", () => api.getProjects(orgId!))}
            >
              <Text style={styles.debugBtnText}>Test /projects</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.debugBtn, !orgId && styles.debugBtnDisabled]}
              disabled={!orgId}
              onPress={() => runTest("/tasks", () => api.getTasks(orgId!, "today", 0))}
            >
              <Text style={styles.debugBtnText}>Test /tasks</Text>
            </TouchableOpacity>
          </View>
          {debugMessage ? <Text style={styles.debugOutput}>{debugMessage}</Text> : null}
        </View>
      )}

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutBtnText}>{t("account.logout")}</Text>
      </TouchableOpacity>

      <Modal visible={showProfileModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowProfileModal(false)} />
          <View style={styles.profileModal}>
            <Text style={styles.profileModalTitle}>{t("account.profile")}</Text>
            <View style={styles.profilePhotoRow}>
              <View style={styles.profilePhotoPreview}>
                {profilePhotoURL ? (
                  <Image source={{ uri: profilePhotoURL }} style={styles.profilePhotoImage} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
              </View>
              <View style={styles.profilePhotoActions}>
                <TouchableOpacity style={styles.profilePhotoButton} onPress={takeProfilePhoto}>
                  <Ionicons name="camera-outline" size={18} color={colors.primary} />
                  <Text style={styles.profilePhotoButtonText}>Odfotiť</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.profilePhotoButton} onPress={pickProfilePhoto}>
                  <Ionicons name="image-outline" size={18} color={colors.primary} />
                  <Text style={styles.profilePhotoButtonText}>Z galérie</Text>
                </TouchableOpacity>
                {profilePhotoURL ? (
                  <TouchableOpacity
                    style={styles.profilePhotoRemove}
                    onPress={() => setProfilePhotoURL(null)}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                    <Text style={styles.profilePhotoRemoveText}>Odstrániť</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            {uploadingPhoto && (
              <View style={styles.profileUploadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.profileUploadingText}>Nahrávam fotku…</Text>
              </View>
            )}
            <Text style={styles.profileFieldLabel}>{t("account.firstName")}</Text>
            <TextInput
              style={styles.profileInput}
              placeholder={t("account.placeholderFirstName")}
              placeholderTextColor={colors.textMuted}
              value={profileFirstName}
              onChangeText={setProfileFirstName}
            />
            <Text style={styles.profileFieldLabel}>{t("account.lastName")}</Text>
            <TextInput
              style={styles.profileInput}
              placeholder={t("account.placeholderLastName")}
              placeholderTextColor={colors.textMuted}
              value={profileLastName}
              onChangeText={setProfileLastName}
            />
            <Text style={styles.profileFieldLabel}>{t("account.phone")}</Text>
            <TextInput
              style={styles.profileInput}
              placeholder={t("account.placeholderPhone")}
              placeholderTextColor={colors.textMuted}
              value={profilePhone}
              onChangeText={setProfilePhone}
              keyboardType="phone-pad"
            />
            <Text style={styles.profileFieldLabel}>{t("profile.primaryProfession.label")}</Text>
            <TouchableOpacity
              style={[styles.profileInput, styles.profileInputRow]}
              onPress={() => setShowProfessionModal(true)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.profileInputText,
                  !profileProfessionCode && { color: colors.textMuted },
                ]}
              >
                {profileProfessionCode
                  ? profileProfessionCode === "OTHER"
                    ? profileProfessionOtherText || t("profile.primaryProfession.otherPlaceholder")
                    : t(`professions.${profileProfessionCode}`)
                  : t("profile.primaryProfession.placeholder")}
              </Text>
              <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            {profileProfessionCode === "OTHER" ? (
              <>
                <Text style={[styles.profileFieldLabel, { marginTop: spacing.sm }]}>
                  {t("profile.primaryProfession.otherPlaceholder")}
                </Text>
                <TextInput
                  style={styles.profileInput}
                  placeholder={t("profile.primaryProfession.otherPlaceholder")}
                  placeholderTextColor={colors.textMuted}
                  value={profileProfessionOtherText}
                  onChangeText={setProfileProfessionOtherText}
                />
              </>
            ) : null}
            <Text style={styles.profileFieldLabel}>{t("profile.hourlyRateLabel") || "Hodinová mzda (€)"}</Text>
            <TextInput
              style={styles.profileInput}
              placeholder={t("profile.hourlyRatePlaceholder") || "napr. 15"}
              placeholderTextColor={colors.textMuted}
              value={profileHourlyRate}
              onChangeText={setProfileHourlyRate}
              keyboardType="decimal-pad"
            />
            <Text style={[styles.profileFieldLabel, { color: colors.textMuted, fontSize: 12, marginTop: -spacing.sm }]}>
              {t("profile.hourlyRateHint") || "Voliteľné. Pre výpočet nákladov práce v reporte hodín."}
            </Text>
            <View style={styles.profileModalActions}>
              <TouchableOpacity style={styles.profileCancel} onPress={() => setShowProfileModal(false)}>
                <Text style={styles.profileCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.profileSave} onPress={saveProfile} disabled={savingProfile}>
                <Text style={styles.profileSaveText}>{savingProfile ? t("common.saving") : t("common.save")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showLanguageModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowLanguageModal(false)} />
          <View style={styles.languageModal}>
            <Text style={styles.languageModalTitle}>{t("account.language")}</Text>
            {LOCALES.map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.languageOption, locale === code && styles.languageOptionActive]}
                onPress={() => {
                  setLocale(code);
                  setShowLanguageModal(false);
                }}
              >
                <Text style={[styles.languageOptionText, locale === code && styles.languageOptionTextActive]}>
                  {localeNames[code]}
                </Text>
                {locale === code ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.languageCancel} onPress={() => setShowLanguageModal(false)}>
              <Text style={styles.languageCancelText}>{t("tasks.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showUsageModeModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowUsageModeModal(false)} />
          <View style={styles.languageModal}>
            <Text style={styles.languageModalTitle}>{t("onboardingMvp.step1Title")}</Text>
            {(["build", "trade"] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.languageOption, primaryUsageMode === mode && styles.languageOptionActive]}
                onPress={() => saveUsageMode(mode)}
              >
                <Text style={[styles.languageOptionText, primaryUsageMode === mode && styles.languageOptionTextActive]}>
                  {t(`onboardingMvp.option${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                </Text>
                {primaryUsageMode === mode ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.languageCancel} onPress={() => setShowUsageModeModal(false)}>
              <Text style={styles.languageCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showProfessionModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowProfessionModal(false)} />
          <View style={styles.languageModal}>
            <Text style={styles.languageModalTitle}>{t("profile.primaryProfession.label")}</Text>
            <TextInput
              style={styles.professionSearchInput}
              placeholder={t("search.placeholder")}
              placeholderTextColor={colors.textMuted}
              value={professionSearch}
              onChangeText={setProfessionSearch}
            />
            <FlatList
              data={PROFESSION_CODES.filter((code) => {
                const label = t(`professions.${code}`);
                return !professionSearch.trim() || label.toLowerCase().includes(professionSearch.trim().toLowerCase());
              })}
              keyExtractor={(item) => item}
              style={styles.professionList}
              renderItem={({ item: code }) => (
                <TouchableOpacity
                  style={[styles.languageOption, profileProfessionCode === code && styles.languageOptionActive]}
                  onPress={() => {
                    setProfileProfessionCode(code);
                    setShowProfessionModal(false);
                    setProfessionSearch("");
                  }}
                >
                  <Text style={[styles.languageOptionText, profileProfessionCode === code && styles.languageOptionTextActive]}>
                    {t(`professions.${code}`)}
                  </Text>
                  {profileProfessionCode === code ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.languageCancel} onPress={() => setShowProfessionModal(false)}>
              <Text style={styles.languageCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <FeedbackModal
        visible={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        source="account"
        userId={user?.id ?? ""}
        orgId={orgId}
        currentScreen="Account"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.lg * 3 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  profileCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E91E63",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarText: { fontSize: 22, fontWeight: "700", color: "#fff" },
  profileName: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: 4 },
  profileHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  emailText: { fontSize: 14, color: colors.textMuted, flex: 1 },
  editProfileButton: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  editProfileText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  billingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  billingBannerContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  billingBannerText: {
    marginLeft: spacing.md,
  },
  billingBannerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  billingBannerSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  billingBannerButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
  },
  billingBannerButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  orgName: { fontSize: 16, fontWeight: "600", color: colors.text },
  orgEmail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  inviteBtn: { backgroundColor: colors.primary, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  inviteBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  planSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  getInfoText: { fontSize: 14, color: colors.primary, fontWeight: "500" },
  versionNum: { fontSize: 14, color: colors.textMuted },
  debugToggle: { fontSize: 12, color: colors.primary },
  debugLine: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  debugButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm },
  debugBtn: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  debugBtnDisabled: { opacity: 0.5 },
  debugBtnText: { color: "#fff", fontSize: 12 },
  debugOutput: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.text,
    backgroundColor: colors.background,
    padding: 8,
    borderRadius: 8,
  },
  logoutBtn: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.accent,
    alignItems: "center",
  },
  logoutBtnText: { color: "#fff", fontWeight: "600" },
  localeBadge: { fontSize: 14, color: colors.textMuted },
  /** Keep long usage-mode option text from stealing all row width next to the label. */
  usageModeValueWrap: { maxWidth: "52%", flexShrink: 0, marginLeft: spacing.sm },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  profileModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  profilePhotoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  profilePhotoPreview: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  profilePhotoImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  profilePhotoActions: { flex: 1 },
  profilePhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  profilePhotoButtonText: { color: colors.text, fontSize: 14 },
  profilePhotoRemove: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  profilePhotoRemoveText: { color: colors.textMuted, fontSize: 13 },
  profileUploadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  profileUploadingText: { color: colors.textMuted, fontSize: 12 },
  profileFieldLabel: { color: colors.text, fontSize: 14, marginBottom: spacing.xs },
  profileInput: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  profileInputRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  profileInputText: { fontSize: 16, color: colors.text, flex: 1 },
  profileModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  profileCancel: { padding: spacing.sm },
  profileCancelText: { color: colors.textMuted, fontSize: 14 },
  profileSave: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
  },
  profileSaveText: { color: "#fff", fontWeight: "600" },
  languageModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  professionSearchInput: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  professionList: { maxHeight: 280, marginBottom: spacing.sm },
  languageOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    marginBottom: 4,
  },
  languageOptionActive: { backgroundColor: colors.background },
  languageOptionText: { fontSize: 16, color: colors.text },
  languageOptionTextActive: { fontWeight: "600", color: colors.primary },
  languageCancel: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  languageCancelText: { fontSize: 16, color: colors.textMuted },
});
