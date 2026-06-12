import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc } from "../lib/rnFirestore";
import { getDocSmart } from "../services/firestoreSmartRead";
import { loadCachedUserSummary, saveCachedUserSummary } from "../services/appStateCache";
import { getAuth, db, getCallable } from "../firebase";
import { claimProjectInvites } from "../services/invites";
import { configureGoogleSignInAtStartup, disconnectGoogleSignInSession, logAuthSignInFailure } from "../services/auth";
import { configurePurchases } from "../services/billing";
import { getExtraEnv } from "../lib/env";
import { IOS_SKIP_GOOGLE_SIGNIN } from "../lib/iosDiagnostic";
import { bootStep, setLastBootStep } from "../lib/bootLogger";
import { normalizeLegacyUsageMode, persistPrimaryUsageMode } from "../lib/primaryUsageMode";
import { withTimeout } from "../utils/withTimeout";
import { hydrateProjectsFromDiskCache, invalidateProjectsSessionCache } from "../services/projects";
import { clearCachedProjectList } from "../services/appStateCache";

export type BillingStatus = {
  status: "trial" | "active" | "expired";
  isPro: boolean;
  trialEndsAt: string | null;
  remainingTrialDays: number;
  currentPeriodEndAt: string | null;
};

type User = {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  billing?: BillingStatus | null;
};

type AuthState = {
  token: string | null;
  user: User | null;
  orgId: string | null;
  loading: boolean;
  onboardingDone: boolean;
  onboardingLoaded: boolean;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
    options?: any
  ) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
  /** Vymaže lokálny „intro dokončený“ flag — pri odhlásení znova uvidíš OnboardingEvolution (karusel pred loginom). */
  resetIntroOnboarding: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ONBOARDING_KEY = "staveto_onboarding_done";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    bootStep("auth_provider_mount", "H6", {}).catch(() => {});
  }, []);
  const claimedInviteSessionsRef = useRef<Set<string>>(new Set());
  const lastAuthUidRef = useRef<string | null>(null);
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    orgId: null,
    loading: true,
    onboardingDone: true,
    onboardingLoaded: false,
  });

  const loadFromStorage = async () => {
    try {
      const ob = await AsyncStorage.getItem(ONBOARDING_KEY);
      setState((s) => ({ ...s, onboardingDone: ob === "1", onboardingLoaded: true }));
    } catch {
      setState((s) => ({ ...s, onboardingDone: false, onboardingLoaded: true }));
    }
  };

  const fetchBillingStatus = async (uid: string): Promise<BillingStatus | null> => {
    try {
      const res = await getCallable("getBillingStatus")({});
      const data = res?.data as BillingStatus | undefined;
      if (__DEV__ && data?.isPro) {
        console.log("[auth] Billing status: isPro=true, status=", data.status, "currentPeriodEndAt=", data.currentPeriodEndAt);
      }
      return data ?? null;
    } catch (e: unknown) {
      const code = String((e as { code?: string })?.code ?? "").toLowerCase();
      const msg = String((e as { message?: string })?.message ?? "");
      const isNotFound = code.includes("not-found") || msg.includes("NOT_FOUND");
      if (__DEV__ && !isNotFound) console.warn("[auth] getBillingStatus failed:", e);
      return null;
    }
  };

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (IOS_SKIP_GOOGLE_SIGNIN) return;
    configureGoogleSignInAtStartup();
  }, []);

  useEffect(() => {
    const fbAuth = getAuth();
    if (!fbAuth) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const unsubscribe = fbAuth.onAuthStateChanged(async (fbUser) => {
      setLastBootStep("auth_state_received");
      bootStep("auth_state_listener", "H6", { hasUser: !!fbUser }).catch(() => {});
      if (!fbUser) {
        if (getExtraEnv("EXPO_PUBLIC_DISABLE_PUSH") !== "1") {
          import("../services/pushNotifications").then((m) => m.removePushToken().catch(() => {})).catch(() => {});
        }
        invalidateProjectsSessionCache();
        void clearCachedProjectList();
        lastAuthUidRef.current = null;
        setState((s) => ({ ...s, token: null, user: null, orgId: null, loading: false }));
        return;
      }

      const nextUid = fbUser.uid;
      if (lastAuthUidRef.current !== nextUid) {
        invalidateProjectsSessionCache();
        if (lastAuthUidRef.current != null) {
          void clearCachedProjectList();
        }
        lastAuthUidRef.current = nextUid;
        void hydrateProjectsFromDiskCache(nextUid);
      }
      try {
        const token = await fbUser.getIdToken();
        let user: User = {
          id: fbUser.uid,
          email: fbUser.email ?? "",
          name: fbUser.displayName ?? undefined,
        };
        try {
          setLastBootStep("user_doc_loading");
          const snap = await getDocSmart(doc(db, "users", fbUser.uid));
          setLastBootStep("user_doc_loaded");
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            const fn = d.firstName as string | undefined;
            const ln = d.lastName as string | undefined;
            const dn = d.displayName as string | undefined;
            if (fn) user = { ...user, firstName: fn };
            if (ln) user = { ...user, lastName: ln };
            if (dn && !user.name) user = { ...user, name: dn };
            if (!user.name && fn && ln) user = { ...user, name: `${fn} ${ln}`.trim() };
            const rawUsage = d.primaryUsageMode as unknown;
            const usage = normalizeLegacyUsageMode(rawUsage);
            if (usage) {
              persistPrimaryUsageMode(usage).catch(() => {});
            }
            saveCachedUserSummary({
              id: user.id,
              email: user.email,
              name: user.name,
              firstName: user.firstName,
              lastName: user.lastName,
            }).catch(() => {});
          }
        } catch (e) {
          setLastBootStep("user_doc_error");
          if (__DEV__) console.warn("[auth] load user doc failed:", e);
          const cached = await loadCachedUserSummary(fbUser.uid);
          if (cached) {
            user = {
              ...user,
              name: cached.name ?? user.name,
              firstName: cached.firstName,
              lastName: cached.lastName,
            };
          }
        }
        bootStep("revenuecat_configure_before", "H6", {}).catch(() => {});
        try {
          await withTimeout(configurePurchases(fbUser.uid), 5000, "auth:configurePurchases");
          bootStep("revenuecat_configure_after", "H6", {}).catch(() => {});
        } catch (e) {
          if (__DEV__) console.warn("[auth] configurePurchases failed or timed out:", e);
        }
        setLastBootStep("billing_loading");
        let billing: Awaited<ReturnType<typeof fetchBillingStatus>> | null = null;
        try {
          billing = await fetchBillingStatus(fbUser.uid);
          setLastBootStep("billing_loaded");
        } catch (e) {
          if (__DEV__) console.warn("[auth] fetchBillingStatus failed:", e);
          setLastBootStep("billing_error");
        }
        user = { ...user, billing: billing ?? undefined };
        if (!claimedInviteSessionsRef.current.has(fbUser.uid)) {
          claimedInviteSessionsRef.current.add(fbUser.uid);
          setLastBootStep("invites_started");
          claimProjectInvites()
            .then((result) => {
              setLastBootStep("invites_done");
              if (result.claimedCount > 0 && __DEV__) {
                console.log("[auth] claimed project invites:", result.claimedCount, result.projectIds);
              }
            })
            .catch(() => {
              setLastBootStep("invites_failed");
            });
        }
        setLastBootStep("boot_done");
        setState((s) => ({
          ...s,
          token,
          user,
          orgId: fbUser.uid,
          loading: false,
        }));
      } catch (e) {
        if (__DEV__) console.warn("[auth] onAuthStateChanged error after sign-in:", e);
        setLastBootStep("auth_error");
        let token = "";
        try {
          token = await fbUser.getIdToken();
        } catch {
          /* ignore */
        }
        const fallbackUser: User = {
          id: fbUser.uid,
          email: fbUser.email ?? "",
          name: fbUser.displayName ?? undefined,
        };
        setState((s) => ({
          ...s,
          token: token || null,
          user: token ? fallbackUser : null,
          orgId: token ? fbUser.uid : null,
          loading: false,
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const fbAuth = getAuth();
    if (!fbAuth) throw new Error("FIREBASE_DISABLED");
    const trimEmail = email.trim().toLowerCase();
    try {
      await fbAuth.signInWithEmailAndPassword(trimEmail, password);
    } catch (e) {
      logAuthSignInFailure("email", e);
      throw e;
    }
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const fbAuth = getAuth();
    if (!fbAuth) throw new Error("FIREBASE_DISABLED");
    const trimEmail = email.trim().toLowerCase();
    const cred = await fbAuth.createUserWithEmailAndPassword(trimEmail, password);
    if (displayName?.trim()) {
      await cred.user.updateProfile({ displayName: displayName.trim() });
    }
  };

  const logout = async () => {
    invalidateProjectsSessionCache();
    await clearCachedProjectList();
    lastAuthUidRef.current = null;
    const fbAuth = getAuth();
    if (fbAuth) await fbAuth.signOut();
    await disconnectGoogleSignInSession({ revokeAccess: true });
  };

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
    setState((s) => ({ ...s, onboardingDone: true, onboardingLoaded: true }));
  };

  const resetIntroOnboarding = async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* ignore */
    }
    setState((s) => ({ ...s, onboardingDone: false, onboardingLoaded: true }));
  };

  const refreshUser = async () => {
    const fbUser = getAuth()?.currentUser ?? null;
    if (!fbUser) return;
    try {
      const token = await fbUser.getIdToken();
      let user: User = {
        id: fbUser.uid,
        email: fbUser.email ?? "",
        name: fbUser.displayName ?? undefined,
      };
      const snap = await getDocSmart(doc(db, "users", fbUser.uid));
      if (snap.exists()) {
        const d = snap.data() as Record<string, unknown>;
        const fn = d.firstName as string | undefined;
        const ln = d.lastName as string | undefined;
        const dn = d.displayName as string | undefined;
        if (fn) user = { ...user, firstName: fn };
        if (ln) user = { ...user, lastName: ln };
        if (dn && !user.name) user = { ...user, name: dn };
        if (!user.name && fn && ln) user = { ...user, name: `${fn} ${ln}`.trim() };
        saveCachedUserSummary({
          id: user.id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
        }).catch(() => {});
      }
      const billing = await fetchBillingStatus(fbUser.uid);
      user = { ...user, billing: billing ?? undefined };
      setState((s) => ({ ...s, token, user }));
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, logout, loadFromStorage, finishOnboarding, resetIntroOnboarding, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
