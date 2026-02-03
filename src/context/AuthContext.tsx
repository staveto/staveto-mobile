import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import * as authService from "../services/auth";

const ONBOARDING_KEY = "staveto_onboarding_done";

type User = { id: string; email: string; name?: string };

type AuthState = {
  token: string | null;
  user: User | null;
  orgId: string | null;
  loading: boolean;
  onboardingDone: boolean;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function userToState(u: { id: string; email: string; name?: string }) {
  return { id: u.id, email: u.email, name: u.name };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    orgId: null,
    loading: true,
    onboardingDone: true,
  });

  const loadOnboarding = async () => {
    try {
      const ob = await AsyncStorage.getItem(ONBOARDING_KEY);
      setState((s) => ({ ...s, onboardingDone: ob === "1" }));
    } catch {
      setState((s) => ({ ...s, onboardingDone: true }));
    }
  };

  useEffect(() => {
    loadOnboarding();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState((s) => ({ ...s, token: null, user: null, orgId: null, loading: false }));
        return;
      }
      const token = await fbUser.getIdToken();
      const user = userToState({
        id: fbUser.uid,
        email: fbUser.email ?? "",
        name: fbUser.displayName ?? undefined,
      });
      setState((s) => ({
        ...s,
        token,
        user,
        orgId: fbUser.uid,
        loading: false,
      }));
    });
    return () => unsub();
  }, []);

  const loadFromStorage = async () => {
    await loadOnboarding();
  };

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
    setState((s) => ({ ...s, onboardingDone: true }));
  };

  const login = async (email: string, password: string) => {
    const { user, token } = await authService.login(email, password);
    setState((s) => ({
      ...s,
      token,
      user: userToState(user),
      orgId: user.id,
      loading: false,
    }));
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const { user, token } = await authService.register(email, password, displayName);
    setState((s) => ({
      ...s,
      token,
      user: userToState(user),
      orgId: user.id,
      loading: false,
    }));
  };

  const logout = async () => {
    await authService.logout();
    setState((s) => ({ ...s, token: null, user: null, orgId: null, loading: false }));
  };

  return (
    <AuthContext.Provider
      value={{ ...state, login, register, logout, loadFromStorage, finishOnboarding }}
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
