import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import auth from "@react-native-firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { doc, getDoc } from "../lib/rnFirestore";
import { db } from "../firebase";
import { claimProjectInvites } from "../services/invites";
import { configurePurchases } from "../services/billing";
import { registerForPushNotifications, setupPushNotifications, removePushToken } from "../services/pushNotifications";

type User = { id: string; email: string; name?: string; firstName?: string; lastName?: string };

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
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ONBOARDING_KEY = "staveto_onboarding_done";
const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  "255961550157-gaueraial600f02qa3qadki41fhvabit.apps.googleusercontent.com";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const claimedInviteSessionsRef = useRef<Set<string>>(new Set());
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
      setState((s) => ({ ...s, onboardingDone: true, onboardingLoaded: true }));
    }
  };

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (!GOOGLE_WEB_CLIENT_ID) {
      console.warn("[auth] Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
      return;
    }
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  }, []);

  useEffect(() => {
    const unsubscribe = auth().onAuthStateChanged(async (fbUser) => {
      if (!fbUser) {
        removePushToken().catch(() => {});
        setState((s) => ({ ...s, token: null, user: null, orgId: null, loading: false }));
        return;
      }
      const token = await fbUser.getIdToken();
      let user: User = {
        id: fbUser.uid,
        email: fbUser.email ?? "",
        name: fbUser.displayName ?? undefined,
      };
      try {
        const snap = await getDoc(doc(db, "users", fbUser.uid));
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          const fn = d.firstName as string | undefined;
          const ln = d.lastName as string | undefined;
          const dn = d.displayName as string | undefined;
          if (fn) user = { ...user, firstName: fn };
          if (ln) user = { ...user, lastName: ln };
          if (dn && !user.name) user = { ...user, name: dn };
          if (!user.name && fn && ln) user = { ...user, name: `${fn} ${ln}`.trim() };
        }
      } catch {
        // ignore profile fetch errors
      }
      registerForPushNotifications().catch((err) => console.warn("[auth] push register failed:", err));
      configurePurchases(fbUser.uid).catch(() => {});
      if (!claimedInviteSessionsRef.current.has(fbUser.uid)) {
        claimedInviteSessionsRef.current.add(fbUser.uid);
        claimProjectInvites()
          .then((result) => {
            if (result.claimedCount > 0) {
              console.log("[auth] claimed project invites:", result.claimedCount, result.projectIds);
            }
          })
          .catch((error) => {
            console.warn("[auth] claimProjectInvites failed:", error);
          });
      }
      setState((s) => ({
        ...s,
        token,
        user,
        orgId: fbUser.uid,
        loading: false,
      }));
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    await auth().signInWithEmailAndPassword(email, password);
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const cred = await auth().createUserWithEmailAndPassword(email, password);
    if (displayName?.trim()) {
      await cred.user.updateProfile({ displayName: displayName.trim() });
    }
  };

  const logout = async () => {
    await auth().signOut();
  };

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
    setState((s) => ({ ...s, onboardingDone: true, onboardingLoaded: true }));
  };

  const refreshUser = async () => {
    const fbUser = auth().currentUser;
    if (!fbUser) return;
    try {
      const token = await fbUser.getIdToken();
      let user: User = {
        id: fbUser.uid,
        email: fbUser.email ?? "",
        name: fbUser.displayName ?? undefined,
      };
      const snap = await getDoc(doc(db, "users", fbUser.uid));
      if (snap.exists()) {
        const d = snap.data() as Record<string, unknown>;
        const fn = d.firstName as string | undefined;
        const ln = d.lastName as string | undefined;
        const dn = d.displayName as string | undefined;
        if (fn) user = { ...user, firstName: fn };
        if (ln) user = { ...user, lastName: ln };
        if (dn && !user.name) user = { ...user, name: dn };
        if (!user.name && fn && ln) user = { ...user, name: `${fn} ${ln}`.trim() };
      }
      setState((s) => ({ ...s, token, user }));
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, logout, loadFromStorage, finishOnboarding, refreshUser }}
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
