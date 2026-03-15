console.log("[App] App.tsx module load");
import React, { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { bootStep, bootFail } from "./src/lib/bootLogger";
import { DiagnosticScreen } from "./src/screens/DiagnosticScreen";
import { LazyAppWithI18n } from "./src/components/LazyAppWithI18n";
import { View, StyleSheet, Text, TouchableOpacity, Platform, Pressable } from "react-native";
import { colors } from "./src/theme";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import { getExtraEnv, hasExtraEnv } from "./src/lib/env";

const BOOT_TIMEOUT_MS = 8_000;

import { BootContext } from "./src/lib/bootContext";

function DiagnosticScreenWithSplashHide({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    SplashScreen.hideAsync?.().catch(() => {});
  }, []);
  return <DiagnosticScreen onContinue={onContinue} />;
}

/** Build info for diagnostics – always logged at startup (prod + dev). */
function logBuildInfo(): void {
  const info = getBuildInfoForDisplay();
  console.log("[boot] BuildInfo:", info);
}

const SPLASH_FALLBACK_MS = 5_000;

/** Required env keys per platform – must be set via EAS env vars/secrets for production builds. */
const REQUIRED_ENV_KEYS: readonly string[] =
  Platform.OS === "ios"
    ? [
        "EXPO_PUBLIC_FIREBASE_API_KEY",
        "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
        "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
      ]
    : [
        "EXPO_PUBLIC_FIREBASE_API_KEY",
        "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
        "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY",
      ];

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

const ENV_ERROR_CODE = Platform.OS === "ios" ? "ENV_MISSING_IOS" : "ENV_MISSING_ANDROID";

function getBuildInfoForDisplay(): { version: string; buildNumber: string | number; executionEnv: string; easProjectId: string } {
  const version = Constants.expoConfig?.version ?? "?";
  const plat = Constants.platform as { android?: { versionCode?: number }; ios?: { buildNumber?: string | null } } | undefined;
  const iosConfig = Constants.expoConfig?.ios as { buildNumber?: string } | undefined;
  const androidConfig = Constants.expoConfig?.android as { versionCode?: number } | undefined;
  const buildNum = Platform.OS === "ios"
    ? (plat?.ios?.buildNumber ?? iosConfig?.buildNumber ?? "?")
    : (plat?.android?.versionCode ?? androidConfig?.versionCode ?? "?");
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return { version, buildNumber: buildNum ?? "?", executionEnv: String(Constants.executionEnvironment ?? "?"), easProjectId: extra?.eas?.projectId ?? "none" };
}

function getEnvPresence(): Record<string, boolean> {
  const presence: Record<string, boolean> = {};
  for (const key of REQUIRED_ENV_KEYS) {
    presence[key] = hasExtraEnv(key);
  }
  return presence;
}

/** Validates env – DO NOT throw. Returns missing keys; caller shows fallback UI. */
function validateEnv(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    if (!hasExtraEnv(key)) missing.push(key);
  }
  console.log("[boot] env check:", missing.length === 0 ? "ok" : "missing", missing);
  return { ok: missing.length === 0, missing };
}

function stepSimulateFailure(): void {
  runStep("simulateFailure", () => {
    if (getExtraEnv("EXPO_PUBLIC_SIMULATE_BOOT_FAILURE") === "1") {
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
    const envChecks: Record<string, boolean> = {};
    for (const key of REQUIRED_ENV_KEYS) {
      envChecks[key] = hasExtraEnv(key);
    }
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
    require("./src/lib/bootLogger").bootFail(error).catch(() => {});
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

const DEBUG_TAP_COUNT = 5;
const DEBUG_TAP_WINDOW_MS = 2000;

function BootLoader({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BootState>("booting");
  const [error, setError] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [bootExceeded6s, setBootExceeded6s] = useState(false);
  const [lastBootStep, setLastBootStep] = useState<{ step: string; ts: number } | null>(null);
  const [timeoutState, setTimeoutState] = useState<"none" | "timeout">("none");
  const lastStepRef = useRef<string>("boot_start");
  const debugTapCountRef = useRef(0);
  const debugTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splashHiddenRef = useRef(false);
  const bootTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boot6sRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splashFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBootingRef = useRef(true);
  const failedRef = useRef(false);

  useEffect(() => {
    require("./src/lib/bootLogger").getLastBootStep().then((s) => {
      if (s && s.step !== "boot_complete") setLastBootStep(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (showDebugOverlay && bootExceeded6s) {
      require("./src/lib/bootLogger").getLastBootStep().then((s) => {
        if (s) setLastBootStep(s);
      }).catch(() => {});
    }
  }, [showDebugOverlay, bootExceeded6s]);

  const onAppReady = useCallback(() => {
    if (bootTimeoutRef.current) {
      clearTimeout(bootTimeoutRef.current);
      bootTimeoutRef.current = null;
    }
    lastStepRef.current = "app_ready";
    bootStep("app_ready", "H4", {}).catch(() => {});
  }, []);

  const hideSplash = useCallback(async (): Promise<boolean> => {
    if (splashHiddenRef.current) return true;
    try {
      await SplashScreen.hideAsync?.();
      splashHiddenRef.current = true;
      bootStep("splash_hidden", "H7", {}).catch(() => {});
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
    logBuildInfo();
    isBootingRef.current = true;
    failedRef.current = false;
    splashHiddenRef.current = false;

    const cleanup = () => {
      isBootingRef.current = false;
      if (bootTimeoutRef.current) {
        clearTimeout(bootTimeoutRef.current);
        bootTimeoutRef.current = null;
      }
      if (boot6sRef.current) {
        clearTimeout(boot6sRef.current);
        boot6sRef.current = null;
      }
      if (splashFallbackRef.current) {
        clearTimeout(splashFallbackRef.current);
        splashFallbackRef.current = null;
      }
    };

    boot6sRef.current = setTimeout(() => {
      if (isBootingRef.current) setBootExceeded6s(true);
      boot6sRef.current = null;
    }, 6000);

    const onBootRejection = (err: unknown) => {
      if (!isBootingRef.current || failedRef.current) return;
      failedRef.current = true;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setErrorStep("unhandledRejection");
      setState("error");
      hideSplash();
    };

    const failBoot = async (step: string, err: unknown) => {
      failedRef.current = true;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setErrorStep(step);
      setState("error");
      console.error("[boot] Init failed:", msg, "step:", step);
      try {
        await bootFail(err);
      } catch {}
      await hideSplash();
    };

    bootTimeoutRef.current = setTimeout(async () => {
      if (!isBootingRef.current) return;
      bootTimeoutRef.current = null;
      const lastStep = lastStepRef.current;
      bootFail(`BOOT_TIMEOUT at ${lastStep}`).catch(() => {});
      setTimeoutState("timeout");
      setLastBootStep({ step: lastStep, ts: Date.now() });
      setError("Boot timeout");
      setErrorStep("timeout");
      setState("error");
      await hideSplash();
    }, BOOT_TIMEOUT_MS);

    splashFallbackRef.current = setTimeout(async () => {
      const ok = await hideSplash();
      if (ok) splashFallbackRef.current = null;
    }, SPLASH_FALLBACK_MS);

    let cancelled = false;
    (async () => {
      try {
        lastStepRef.current = "boot_start";
        bootStep("boot_start", "H4", {}).catch(() => {});
        const envResult = validateEnv();
        if (!envResult.ok) {
          await failBoot("envCheck", new Error(`${ENV_ERROR_CODE} Missing: ${envResult.missing.join(", ")}`));
          return;
        }
        lastStepRef.current = "env_validated";
        bootStep("env_validated", "H4", {}).catch(() => {});
        if (cancelled) return;
        stepSimulateFailure();
        if (cancelled) return;
        stepSetupHandlers(onBootRejection);
        if (cancelled) return;
        stepDiagnostics();
        if (cancelled) return;
        stepComplete();
        if (cancelled || failedRef.current) return;
        lastStepRef.current = "providers_mounted";
        bootStep("providers_mounted", "H4", {}).catch(() => {});
        isBootingRef.current = false;
        if (bootTimeoutRef.current) {
          clearTimeout(bootTimeoutRef.current);
          bootTimeoutRef.current = null;
        }
        bootStep("boot_ready", "H4", {}).catch(() => {});
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        isBootingRef.current = false;
        if (bootTimeoutRef.current) {
          clearTimeout(bootTimeoutRef.current);
          bootTimeoutRef.current = null;
        }
        try {
          await bootFail(e);
        } catch {}
        const isEnvErr = e instanceof Error && (e.message.includes("Missing") || e.message.startsWith("ENV_MISSING_"));
        await failBoot(isEnvErr ? "envCheck" : "boot", e);
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
    setShowDebugOverlay(false);
    setBootExceeded6s(false);
    setRetryCount((c) => c + 1);
  }, []);

  const handleDebugTap = useCallback(() => {
    if (debugTapTimerRef.current) clearTimeout(debugTapTimerRef.current);
    debugTapCountRef.current += 1;
    if (debugTapCountRef.current >= DEBUG_TAP_COUNT) {
      debugTapCountRef.current = 0;
      setShowDebugOverlay(true);
    } else {
      debugTapTimerRef.current = setTimeout(() => { debugTapCountRef.current = 0; }, DEBUG_TAP_WINDOW_MS);
    }
  }, []);

  if (state === "booting") {
    const showLastStep = (showDebugOverlay && bootExceeded6s) && lastBootStep;
    return (
      <Pressable onPress={handleDebugTap} style={[styles.loading, styles.bootingScreen]}>
        {showLastStep && (
          <View style={[styles.debugOverlay, { position: "absolute", bottom: 24 }]}>
            <Text style={[styles.debugText, { color: "#ff9" }]}>
              Last step: {lastBootStep.step}
            </Text>
          </View>
        )}
      </Pressable>
    );
  }

  if (state === "error") {
    const isTimeout = errorStep === "timeout";
    const isEnvError = errorStep === "envCheck" && (error?.includes("Missing") || error?.startsWith("ENV_MISSING_"));
    const userMessage = isTimeout
      ? "Boot timeout"
      : !__DEV__ && isEnvError
        ? "Technická chyba. Prosím kontaktujte podporu."
        : (error ?? "Unknown error");
    const errorCode = !__DEV__ && isEnvError ? ENV_ERROR_CODE : null;
    const buildInfo = getBuildInfoForDisplay();
    const envPresence = getEnvPresence();
    return (
      <View style={[styles.loading, { padding: 24 }]}>
        <Pressable onPress={handleDebugTap} style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={styles.errorTitle}>Startup Error</Text>
          {__DEV__ && errorStep && (
            <Text style={[styles.errorMessage, { fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 8 }]}>
              Step: {errorStep}
            </Text>
          )}
          <Text style={styles.errorMessage} selectable>
            {userMessage}
          </Text>
          {errorCode && (
            <Text style={[styles.errorMessage, { fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: -16, marginBottom: 24 }]} selectable>
              {errorCode}
            </Text>
          )}
          {(showDebugOverlay || __DEV__ || isTimeout) && (
            <View style={styles.debugOverlay}>
              {isTimeout && lastBootStep && (
                <Text style={[styles.debugText, { color: "#ff9", marginBottom: 8 }]}>
                  Last step: {lastBootStep.step}
                </Text>
              )}
              <Text style={styles.debugText}>version: {buildInfo.version} | build: {String(buildInfo.buildNumber)}</Text>
              <Text style={styles.debugText}>env: {JSON.stringify(envPresence)}</Text>
              {lastBootStep && !isTimeout && (
                <Text style={[styles.debugText, { color: "#ff9", marginTop: 8 }]}>
                  Previous run stopped at: {lastBootStep.step}
                </Text>
              )}
            </View>
          )}
        </Pressable>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <BootContext.Provider value={{ onAppReady }}>
      {children}
    </BootContext.Provider>
  );
}

export default function App() {
  useEffect(() => {
    bootStep("app_loaded", "H3", {}).catch(() => {});
  }, []);
  const handleError = useCallback((err: Error) => {
    console.error("[App] ErrorBoundary error:", err);
  }, []);

  const isDiagnosticMode = getExtraEnv("EXPO_PUBLIC_IOS_DIAGNOSTIC") === "1";
  const [diagnosticActive, setDiagnosticActive] = useState(isDiagnosticMode);

  return (
    <AppErrorBoundary onError={handleError}>
      <SafeAreaProvider>
        {isDiagnosticMode && diagnosticActive ? (
          <DiagnosticScreenWithSplashHide onContinue={() => setDiagnosticActive(false)} />
        ) : (
          <BootLoader>
            <LazyAppWithI18n enabled={true} />
          </BootLoader>
        )}
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
  debugOverlay: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    maxWidth: "100%",
  },
  debugText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.8)",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  /** Matches splash backgroundColor – seamless transition, no "Booting..." text */
  bootingScreen: { backgroundColor: "#1D376A" },
});
