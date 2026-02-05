import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEV_EXPO_GO_UID } from "../constants/devUid";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const devUser: User = { id: DEV_EXPO_GO_UID, email: "", name: "Expo Go User" };
  const [state, setState] = useState<AuthState>({
    token: null,
    user: devUser,
    orgId: DEV_EXPO_GO_UID,
    loading: false,
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
    setState((s) => ({
      ...s,
      token: null,
      user: devUser,
      orgId: DEV_EXPO_GO_UID,
      loading: false,
    }));
  }, []);

  const loadFromStorage = async () => {
    await loadOnboarding();
  };

  const finishOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
    setState((s) => ({ ...s, onboardingDone: true }));
  };

  const login = async (email: string, password: string) => {
    throw new Error("Auth disabled in Expo Go. Use dev build to enable.");
  };

  const register = async (email: string, password: string, displayName?: string) => {
    throw new Error("Auth disabled in Expo Go. Use dev build to enable.");
  };

  const logout = async () => {
    throw new Error("Auth disabled in Expo Go. Use dev build to enable.");
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
