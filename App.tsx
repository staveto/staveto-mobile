import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { I18nProvider, useI18n } from "./src/i18n/I18nContext";
import { AuthProvider } from "./src/context/AuthContext";
import { UnreadCountProvider } from "./src/context/UnreadCountContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { PushNotificationHandler, navigationRef } from "./src/components/PushNotificationHandler";
import { configurePurchases } from "./src/services/billing";
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity, Platform } from "react-native";
import { colors } from "./src/theme";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";

const BOOT_TIMEOUT_MS = 15_000;
const SPLASH_FALLBACK_MS = 5_000;

type BootState = "booting" | "ready" | "error";

type BootStep =
  | "envCheck"
  | "simulateFailure"
  | "setupHandlers"
  | "diagnostics"
  | "complete";

function runStep<T>(name: BootStep, fn: () => T): T {
  const start = Date.now();
  if (__DEV__) console.log(`[boot] step ${name} start`);
  try {
    const result = fn();
    if (__DEV__) console.log(`[boot] step ${name} done in ${Date.now() - start}ms`);
    return result;
  } catch (e) {
    if (__DEV__) console.error(`[boot] step ${name} failed in ${Date.now() - start}ms:`, e);
    throw e;
  }
}

function stepEnvCheck(): void {
  runStep("envCheck", () => {
    const missing: string[] = [];
    const v1 = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
    const v2 = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const v3 = Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
    if (!v1 || (typeof v1 === "string" && !v1.trim())) missing.push("EXPO_PUBLIC_FIREBASE_API_KEY");
    if (!v2 || (typeof v2 === "string" && !v2.trim())) missing.push("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
    if (!v3 || (typeof v3 === "string" && !v3.trim())) {
      missing.push(Platform.OS === "ios" ? "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY" : "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY");
    }
    if (missing.length > 0) {
      throw new Error(`Missing env: ${missing.join(", ")}`);
    }
  });
}

function stepSimulateFailure(): void {
  runStep("simulateFailure", () => {
    if (process.env.EXPO_PUBLIC_SIMULATE_BOOT_FAILURE === "1") {
      throw new Error("Simulated boot failure (EXPO_PUBLIC_SIMULATE_BOOT_FAILURE=1)");
    }
  });
}

function stepSetupHandlers(onBootRejection: (err: unknown) => void): void {
  runStep("setupHandlers", () => {
    const handler = (e: PromiseRejectionEvent) => {
      const err = e?.reason ?? e;
      console.error("[boot] Unhandled rejection:", err);
      onBootRejection(err);
    };
    if (typeof global !== "undefined" && "addEventListener" in global) {
      (global as any).addEventListener?.("unhandledrejection", handler);
    }
  });
}

function stepDiagnostics(): void {
  runStep("diagnostics", () => {
    const build = Constants.expoConfig?.version ?? "?";
    const platform = Platform.OS;
    const envChecks = {
      EXPO_PUBLIC_FIREBASE_API_KEY: !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: !!process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
      EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: !!process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    };
    if (__DEV__) {
      console.log("[boot] platform:", platform, "build:", build, "env:", envChecks);
    }
  });
}

function stepComplete(): void {
  runStep("complete", () => {});
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (err: Error) => void },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[App] ErrorBoundary caught:", error);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={[styles.loading, { padding: 24 }]}>
          <Text style={styles.errorTitle}>App Error</Text>
          <Text style={styles.errorMessage} selectable>
            {this.state.error.message}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function BootLoader({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BootState>("booting");
  const [error, setError] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const splashHiddenRef = useRef(false);
  const bootTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splashFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBootingRef = useRef(true);
  const failedRef = useRef(false);

  const hideSplash = useCallback(async (): Promise<boolean> => {
    if (splashHiddenRef.current) return true;
    try {
      await SplashScreen.hideAsync?.();
      splashHiddenRef.current = true;
      if (splashFallbackRef.current) {
        clearTimeout(splashFallbackRef.current);
        splashFallbackRef.current = null;
      }
      return true;
    } catch (e) {
      if (__DEV__) console.warn("[boot] SplashScreen.hideAsync failed:", e);
      return false;
    }
  }, []);

  useEffect(() => {
    isBootingRef.current = true;
    failedRef.current = false;
    splashHiddenRef.current = false;

    const cleanup = () => {
      isBootingRef.current = false;
      if (bootTimeoutRef.current) {
        clearTimeout(bootTimeoutRef.current);
        bootTimeoutRef.current = null;
      }
      if (splashFallbackRef.current) {
        clearTimeout(splashFallbackRef.current);
        splashFallbackRef.current = null;
      }
    };

    const onBootRejection = (err: unknown) => {
      if (!isBootingRef.current || failedRef.current) return;
      failedRef.current = true;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setErrorStep("unhandledRejection");
      setState("error");
      hideSplash();
    };

    const failBoot = (step: string, err: unknown) => {
      failedRef.current = true;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setErrorStep(step);
      setState("error");
      console.error("[boot] Init failed:", msg, "step:", step);
    };

    bootTimeoutRef.current = setTimeout(async () => {
      if (!isBootingRef.current) return;
      bootTimeoutRef.current = null;
      failBoot("timeout", new Error("Boot timeout"));
      await hideSplash();
    }, BOOT_TIMEOUT_MS);

    splashFallbackRef.current = setTimeout(async () => {
      const ok = await hideSplash();
      if (ok) splashFallbackRef.current = null;
    }, SPLASH_FALLBACK_MS);

    let cancelled = false;
    (async () => {
      try {
        stepEnvCheck();
        if (cancelled) return;
        stepSimulateFailure();
        if (cancelled) return;
        stepSetupHandlers(onBootRejection);
        if (cancelled) return;
        stepDiagnostics();
        if (cancelled) return;
        stepComplete();
        if (cancelled || failedRef.current) return;
        isBootingRef.current = false;
        if (bootTimeoutRef.current) {
          clearTimeout(bootTimeoutRef.current);
          bootTimeoutRef.current = null;
        }
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        isBootingRef.current = false;
        if (bootTimeoutRef.current) {
          clearTimeout(bootTimeoutRef.current);
          bootTimeoutRef.current = null;
        }
        failBoot(
          e instanceof Error && e.message.includes("Missing env") ? "envCheck" : "boot",
          e
        );
      } finally {
        await hideSplash();
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [retryCount, hideSplash]);

  const handleRetry = useCallback(() => {
    setState("booting");
    setError(null);
    setErrorStep(null);
    setRetryCount((c) => c + 1);
  }, []);

  if (state === "booting") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={[styles.loading, { padding: 24 }]}>
        <Text style={styles.errorTitle}>Startup Error</Text>
        {errorStep && (
          <Text style={[styles.errorMessage, { fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 8 }]}>
            Step: {errorStep}
          </Text>
        )}
        <Text style={styles.errorMessage} selectable>
          {error ?? "Unknown error"}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

function AppShell() {
  const { loaded } = useI18n();

  useEffect(() => {
    configurePurchases().catch(() => {});
  }, []);

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const linking = {
    prefixes: ["staveto://"],
    config: {
      screens: {
        EquipmentLinkHandler: "equipment/:qrToken",
      },
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <AuthProvider>
            <UnreadCountProvider>
              <PushNotificationHandler />
              <StatusBar style="light" />
              <RootNavigator />
            </UnreadCountProvider>
          </AuthProvider>
        </NavigationContainer>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  const handleError = useCallback((err: Error) => {
    console.error("[App] ErrorBoundary error:", err);
  }, []);

  return (
    <AppErrorBoundary onError={handleError}>
      <SafeAreaProvider>
        <BootLoader>
          <I18nProvider>
            <AppShell />
          </I18nProvider>
        </BootLoader>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  errorTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  errorMessage: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    marginBottom: 24,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
