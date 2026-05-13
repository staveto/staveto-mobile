import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { LanguageSelectionScreen } from "../screens/LanguageSelectionScreen";
import { OnboardingEvolutionScreen } from "../screens/OnboardingEvolutionScreen";
import { ConsentRequiredScreen } from "../screens/ConsentRequiredScreen";
import { OnboardingMvpScreen } from "../screens/OnboardingMvpScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { CustomizeHomeScreen } from "../screens/CustomizeHomeScreen";
import { TaskDetailScreen } from "../screens/TaskDetailScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectOverviewDashboardScreen } from "../screens/ProjectOverviewDashboardScreen";
import { AttendanceReportScreen } from "../screens/AttendanceReportScreen";
import { ProjectTimeDetailScreen } from "../screens/ProjectTimeDetailScreen";
import { ProjectMilestonesOverviewScreen } from "../screens/ProjectMilestonesOverviewScreen";
import { ProjectDiaryOverviewScreen } from "../screens/ProjectDiaryOverviewScreen";
import { ProjectPhotosScreen } from "../screens/ProjectPhotosScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { PaywallScreen } from "../screens/PaywallScreen";
import { ExpenseReviewScreen } from "../screens/ExpenseReviewScreen";
import { EquipmentListScreen } from "../screens/equipment/EquipmentListScreen";
import { EquipmentDetailScreen } from "../screens/equipment/EquipmentDetailScreen";
import { EquipmentFormScreen } from "../screens/equipment/EquipmentFormScreen";
import { EquipmentQrScreen } from "../screens/equipment/EquipmentQrScreen";
import { ServiceRuleFormScreen } from "../screens/equipment/ServiceRuleFormScreen";
import { EquipmentLinkHandlerScreen } from "../screens/equipment/EquipmentLinkHandlerScreen";
import { QrScanScreen } from "../screens/equipment/QrScanScreen";
import { ContractorsListScreen } from "../screens/contractors/ContractorsListScreen";
import { ContractorFormScreen } from "../screens/contractors/ContractorFormScreen";
import { ContractorDetailScreen } from "../screens/contractors/ContractorDetailScreen";
import { ProjectSuppliersScreen } from "../screens/projects/ProjectSuppliersScreen";
import { UpdatesScreen } from "../screens/projects/UpdatesScreen";
import { ProjectTeamScreen } from "../screens/projects/ProjectTeamScreen";
import { ProjectInvitesScreen } from "../screens/ProjectInvitesScreen";
import { ProblemsListScreen } from "../screens/ProblemsListScreen";
import { CreateProblemScreen } from "../screens/CreateProblemScreen";
import { AbsenceHomeScreen } from "../screens/absence/AbsenceHomeScreen";
import { AbsenceRequestScreen } from "../screens/absence/AbsenceRequestScreen";
import { AbsenceDetailScreen } from "../screens/absence/AbsenceDetailScreen";
import { QuickActionsSetup } from "../components/QuickActionsSetup";

// Lazy-load ProblemDetailScreen (react-native-maps) – speeds up initial app load
const ProblemDetailScreenLazy = React.lazy(() =>
  import("../screens/ProblemDetailScreen").then((m) => ({ default: m.ProblemDetailScreen }))
);

function ProblemDetailScreenWithSuspense(props: object) {
  return (
    <React.Suspense fallback={<LoadingScreen />}>
      <ProblemDetailScreenLazy {...props} />
    </React.Suspense>
  );
}
import { AppDrawer } from "./AppDrawer";
import { BusinessStack } from "./BusinessStack";
import { OfflineBanner } from "../components/OfflineBanner";
import { StoreUpdateGate } from "../components/StoreUpdateGate";
import { colors, spacing } from "../theme";
import { getFirestore, db } from "../firebase";
import { doc, getDoc } from "../lib/rnFirestore";
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, PENDING_CONSENT_KEY } from "../constants/consent";
import { getExtraEnv } from "../lib/env";

const FIRST_LOGIN_TRIAL_POPUP_KEY = "first_login_trial_popup_shown";
const TRIAL_REMINDER_3D_LAST_SHOWN_KEY = "trial_reminder_3d_last_shown";
const LANGUAGE_SELECTION_DONE_KEY = "language_selection_done";

const Stack = createNativeStackNavigator();

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>{t("loading.text")}</Text>
    </View>
  );
}

/** Order: loading → (language/intro if new) → auth → Tabs. Home/Notifications are stack screens reachable from Account. */
export function RootNavigator() {
  // #region agent log
  useEffect(() => {
    try {
      require("../lib/bootLogger").bootStep("root_nav_ready", "H6", {}).catch(() => {});
    } catch {}
  }, []);
  // #endregion
  const { token, loading, onboardingDone, onboardingLoaded, user } = useAuth();
  const { t } = useI18n();
  const [gateLoading, setGateLoading] = useState(true);
  const [consentOk, setConsentOk] = useState(false);
  const [onboardingOk, setOnboardingOk] = useState(false);
  const [languageSelectionDone, setLanguageSelectionDone] = useState<boolean | null>(null);
  const [showConsentAgain, setShowConsentAgain] = useState(false);
  const hasShownTrialPopup = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_SELECTION_DONE_KEY).then((v) => {
      setLanguageSelectionDone(v === "1");
    });
  }, []);

  const checkGate = useCallback(async () => {
    if (!token || !user?.id) return;
    if (!getFirestore()) {
      setGateLoading(false);
      return;
    }
    setGateLoading(true);
    try {
      const pendingConsentRaw = await AsyncStorage.getItem(PENDING_CONSENT_KEY);
      let hasPendingConsent = false;
      if (pendingConsentRaw) {
        try {
          const pending = JSON.parse(pendingConsentRaw) as {
            termsAccepted?: boolean;
            privacyAccepted?: boolean;
            termsVersion?: string;
            privacyVersion?: string;
          };
          hasPendingConsent =
            !!pending?.termsAccepted &&
            !!pending?.privacyAccepted &&
            pending.termsVersion === CONSENT_TERMS_VERSION &&
            pending.privacyVersion === CONSENT_PRIVACY_VERSION;
        } catch {
          hasPendingConsent = false;
        }
      }
      const pendingOnboardingRaw = await AsyncStorage.getItem("pending_onboarding");
      const hasPendingOnboarding = !!pendingOnboardingRaw;
      const snap = await getDoc(doc(db, "users", user.id));
      if (snap.exists()) {
        const data = snap.data() as {
          termsAcceptedAt?: unknown;
          privacyAcceptedAt?: unknown;
          termsVersion?: string;
          privacyVersion?: string;
          onboardingCompletedAt?: unknown;
        };
        const termsOk = !!data.termsAcceptedAt && data.termsVersion === CONSENT_TERMS_VERSION;
        const privacyOk = !!data.privacyAcceptedAt && data.privacyVersion === CONSENT_PRIVACY_VERSION;
        setConsentOk((termsOk && privacyOk) || hasPendingConsent);
        setOnboardingOk(!!data.onboardingCompletedAt || hasPendingOnboarding);
      } else {
        setConsentOk(hasPendingConsent);
        setOnboardingOk(hasPendingOnboarding);
      }
    } catch {
      const pendingConsentRaw = await AsyncStorage.getItem(PENDING_CONSENT_KEY);
      const pendingOnboardingRaw = await AsyncStorage.getItem("pending_onboarding");
      setConsentOk(!!pendingConsentRaw);
      setOnboardingOk(!!pendingOnboardingRaw);
    } finally {
      setGateLoading(false);
    }
  }, [token, user?.id]);

  useEffect(() => {
    if (!token || !user?.id) {
      setGateLoading(false);
      return;
    }
    checkGate();
  }, [token, user?.id, checkGate]);

  // Show first-login trial popup once per device (must be before any conditional return)
  useEffect(() => {
    const shouldShow = token && user?.id && !gateLoading && consentOk && onboardingOk;
    if (!shouldShow || hasShownTrialPopup.current) return;
    let cancelled = false;
    (async () => {
      try {
        const shown = await AsyncStorage.getItem(FIRST_LOGIN_TRIAL_POPUP_KEY);
        if (shown === "1" || cancelled) return;
        hasShownTrialPopup.current = true;
        await AsyncStorage.setItem(FIRST_LOGIN_TRIAL_POPUP_KEY, "1");
        if (cancelled) return;
        Alert.alert(t("subscription.firstLoginTrialTitle"), t("subscription.firstLoginTrialMessage"));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.id, gateLoading, consentOk, onboardingOk, t]);

  // Request notification permission at first app entry (after consent + onboarding) – like camera/microphone
  useEffect(() => {
    if (getExtraEnv("EXPO_PUBLIC_DISABLE_PUSH") === "1") return;
    const shouldRequest = token && user?.id && !gateLoading && consentOk && onboardingOk;
    if (!shouldRequest) return;
    // Small delay so trial popup can show first; then native permission dialog
    const t = setTimeout(() => {
      import("../services/pushNotifications").then((m) =>
        m.registerForPushNotifications().catch((err) => console.warn("[RootNavigator] push register failed:", err))
      );
    }, 600);
    return () => clearTimeout(t);
  }, [token, user?.id, gateLoading, consentOk, onboardingOk]);

  // Show trial reminder 3 days before expiry (max once per day)
  useEffect(() => {
    const billing = user?.billing;
    const shouldShow =
      token &&
      user?.id &&
      !gateLoading &&
      consentOk &&
      onboardingOk &&
      billing?.status === "trial" &&
      billing.remainingTrialDays > 0 &&
      billing.remainingTrialDays <= 3;
    if (!shouldShow) return;
    let cancelled = false;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const lastShown = await AsyncStorage.getItem(TRIAL_REMINDER_3D_LAST_SHOWN_KEY);
        if (lastShown === today || cancelled) return;
        await AsyncStorage.setItem(TRIAL_REMINDER_3D_LAST_SHOWN_KEY, today);
        if (cancelled) return;
        Alert.alert(
          t("subscription.trialReminder3DaysTitle"),
          t("subscription.trialReminder3DaysMessage", { count: String(billing.remainingTrialDays) })
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.id, user?.billing, gateLoading, consentOk, onboardingOk, t]);

  // #region agent log
  useEffect(() => {
    if (!loading && onboardingLoaded) {
      try {
        require("../lib/bootLogger").bootStep("boot_complete", "H6", {}).catch(() => {});
      } catch {}
    }
  }, [loading, onboardingLoaded]);
  // #endregion

  if (loading || !onboardingLoaded) {
    return <LoadingScreen />;
  }
  if (!token) {
    return (
      <Stack.Navigator
        key={onboardingDone ? "signed-out-intro-done" : "signed-out-intro-pending"}
        screenOptions={{ headerShown: false }}
        initialRouteName={onboardingDone ? "Login" : "OnboardingIntro"}
      >
        <Stack.Screen name="LanguageSelect" component={LanguageSelectionScreen} />
        <Stack.Screen name="OnboardingIntro" component={OnboardingEvolutionScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    );
  }
  if (gateLoading || languageSelectionDone === null) {
    return <LoadingScreen />;
  }
  if (!languageSelectionDone) {
    return (
      <LanguageSelectionScreen
        onComplete={async () => {
          await AsyncStorage.setItem(LANGUAGE_SELECTION_DONE_KEY, "1");
          setLanguageSelectionDone(true);
        }}
      />
    );
  }
  if (!consentOk || showConsentAgain) {
    return (
      <ConsentRequiredScreen
        onAccepted={() => {
          setShowConsentAgain(false);
          checkGate();
        }}
        onBack={async () => {
          setShowConsentAgain(false);
          await AsyncStorage.setItem(LANGUAGE_SELECTION_DONE_KEY, "");
          setLanguageSelectionDone(false);
        }}
      />
    );
  }
  if (!onboardingOk) {
    return (
      <OnboardingMvpScreen
        onFinished={checkGate}
        onBack={() => setShowConsentAgain(true)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StoreUpdateGate enabled />
      <QuickActionsSetup />
      <OfflineBanner />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textOnDark,
        }}
      >
        <Stack.Screen name="AppTabs" component={AppDrawer} />
      <Stack.Screen
        name="BusinessStack"
        component={BusinessStack}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GlobalSearch"
        component={SearchScreen}
        options={{ headerShown: true, title: t("tabs.search") }}
      />
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: true, title: t("nav.home") }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: true, title: t("nav.notifications") }} />
      <Stack.Screen
        name="CustomizeHome"
        component={CustomizeHomeScreen}
        options={{ headerShown: true, title: t("nav.customizeHome") }}
      />
      <Stack.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        options={{ headerShown: true, title: t("nav.taskDetail") }}
      />
      <Stack.Screen
        name="ProjectOverview"
        component={ProjectOverviewScreen}
        options={{ headerShown: true, title: t("nav.projectOverview") || "Projekt" }}
      />
      <Stack.Screen
        name="ProjectOverviewDashboard"
        component={ProjectOverviewDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AttendanceReportScreen"
        component={AttendanceReportScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProjectTimeDetail"
        component={ProjectTimeDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProjectMilestonesOverview"
        component={ProjectMilestonesOverviewScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProjectDiaryOverview"
        component={ProjectDiaryOverviewScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProjectPhotos"
        component={ProjectPhotosScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProjectMembers"
        component={ProjectMembersScreen}
        options={{ headerShown: true, title: t("nav.projectMembers") || "Členovia projektu" }}
      />
      <Stack.Screen
        name="ProjectInvites"
        component={ProjectInvitesScreen}
        options={{ headerShown: true, title: t("projectInvites.title") || "Pozvánky do projektov" }}
      />
      <Stack.Screen
        name="ProblemsList"
        component={ProblemsListScreen}
        options={{ headerShown: true, title: t("problems.title") || "Problémy" }}
      />
      <Stack.Screen
        name="ProblemDetail"
        component={ProblemDetailScreenWithSuspense}
        options={{ headerShown: true, title: t("problems.detail") || "Detail problému" }}
      />
      <Stack.Screen
        name="CreateProblem"
        component={CreateProblemScreen}
        options={{ headerShown: true, title: t("problems.new") || "Nový problém" }}
      />
      <Stack.Screen
        name="Subscription"
        component={SubscriptionScreen}
        options={{ headerShown: true, title: t("nav.subscription") }}
      />
      <Stack.Screen
        name="Paywall"
        component={PaywallScreen}
        options={{ headerShown: true, title: t("paywall.title"), presentation: "modal" }}
      />
      <Stack.Screen
        name="ContractorsList"
        component={ContractorsListScreen}
        options={{ headerShown: true, title: t("nav.contractors") }}
      />
      <Stack.Screen
        name="ContractorForm"
        component={ContractorFormScreen}
        options={{ headerShown: true, title: t("nav.contractor") }}
      />
      <Stack.Screen
        name="ContractorDetail"
        component={ContractorDetailScreen}
        options={{ headerShown: true, title: t("nav.contractor") }}
      />
      <Stack.Screen
        name="ProjectSuppliers"
        component={ProjectSuppliersScreen}
        options={{ headerShown: true, title: t("nav.contractorsList") }}
      />
      <Stack.Screen
        name="ProjectTeam"
        component={ProjectTeamScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Updates"
        component={UpdatesScreen}
        options={{ headerShown: true, title: t("nav.updates") }}
      />
      <Stack.Screen
        name="ExpenseReview"
        component={ExpenseReviewScreen}
        options={{ headerShown: true, title: t("nav.invoiceReview") }}
      />
      <Stack.Screen
        name="AbsenceHome"
        component={AbsenceHomeScreen}
        options={{ headerShown: true, title: t("absence.title") }}
      />
      <Stack.Screen
        name="AbsenceRequest"
        component={AbsenceRequestScreen}
        options={{ headerShown: true, title: t("absence.add") }}
      />
      <Stack.Screen
        name="AbsenceDetail"
        component={AbsenceDetailScreen}
        options={{ headerShown: true, title: t("absence.title") }}
      />
      <Stack.Screen
        name="EquipmentList"
        component={EquipmentListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EquipmentDetail"
        component={EquipmentDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EquipmentForm"
        component={EquipmentFormScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EquipmentQr"
        component={EquipmentQrScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ServiceRuleForm"
        component={ServiceRuleFormScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EquipmentLinkHandler"
        component={EquipmentLinkHandlerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QrScan"
        component={QrScanScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: spacing.md, color: colors.textMuted },
});
