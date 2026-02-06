import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { LoginScreen } from "../screens/LoginScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { LanguageSelectionScreen } from "../screens/LanguageSelectionScreen";
import { OnboardingIntroScreen } from "../screens/OnboardingIntroScreen";
import { ConsentRequiredScreen } from "../screens/ConsentRequiredScreen";
import { OnboardingMvpScreen } from "../screens/OnboardingMvpScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { CustomizeHomeScreen } from "../screens/CustomizeHomeScreen";
import { TaskDetailScreen } from "../screens/TaskDetailScreen";
import { ProjectOverviewScreen } from "../screens/ProjectOverviewScreen";
import { ProjectMembersScreen } from "../screens/ProjectMembersScreen";
import { SubscriptionScreen } from "../screens/SubscriptionScreen";
import { ExpenseReviewScreen } from "../screens/ExpenseReviewScreen";
import { AppTabs } from "./AppTabs";
import { colors, spacing } from "../theme";
import { db } from "../firebase";
import { doc, getDoc } from "../lib/rnFirestore";
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, PENDING_CONSENT_KEY } from "../constants/consent";

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
  const { token, loading, onboardingDone, onboardingLoaded, user } = useAuth();
  const { t } = useI18n();
  const [gateLoading, setGateLoading] = useState(true);
  const [consentOk, setConsentOk] = useState(false);
  const [onboardingOk, setOnboardingOk] = useState(false);

  const checkGate = useCallback(async () => {
    if (!token || !user?.id) return;
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

  if (loading || !onboardingLoaded) {
    return <LoadingScreen />;
  }
  if (!token) {
    return (
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={onboardingDone ? "Login" : "LanguageSelect"}
      >
        <Stack.Screen name="LanguageSelect" component={LanguageSelectionScreen} />
        <Stack.Screen name="OnboardingIntro" component={OnboardingIntroScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    );
  }
  if (gateLoading) {
    return <LoadingScreen />;
  }
  if (!consentOk) {
    return <ConsentRequiredScreen onAccepted={checkGate} />;
  }
  if (!onboardingOk) {
    return <OnboardingMvpScreen onFinished={checkGate} />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="AppTabs" component={AppTabs} />
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
        name="ProjectMembers"
        component={ProjectMembersScreen}
        options={{ headerShown: true, title: t("nav.projectMembers") || "Členovia projektu" }}
      />
      <Stack.Screen
        name="Subscription"
        component={SubscriptionScreen}
        options={{ headerShown: true, title: "Predplatné" }}
      />
      <Stack.Screen
        name="ExpenseReview"
        component={ExpenseReviewScreen}
        options={{ headerShown: true, title: "Kontrola faktúry" }}
      />
    </Stack.Navigator>
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
