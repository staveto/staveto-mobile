/**
 * iOS crash diagnostic – dočasne vypni podozrivé moduly na iOS.
 * Ak app po zapnutí týchto bypassov naštartuje, vieme ktorý modul spôsoboval crash.
 *
 * Production default: diagnostics OFF. Full app runs.
 * Diagnostics ON only when EXPO_PUBLIC_IOS_DIAGNOSTIC is explicitly "1", "true", "yes", "on".
 */
import { Platform } from "react-native";
import { getExtraEnvRaw } from "./env";
import { isDiagnosticOnValue } from "./iosDiagnosticHelpers";

const DIAGNOSTIC_ENV_KEY = "EXPO_PUBLIC_IOS_DIAGNOSTIC";

/** Re-export for consumers that need the parser. */
export { isDiagnosticOnValue } from "./iosDiagnosticHelpers";

/** Raw value for display (from extra; fallback to process.env in dev). */
export function getDiagnosticEnvRaw(): string {
  const fromExtra = getExtraEnvRaw(DIAGNOSTIC_ENV_KEY);
  if (fromExtra !== "") return fromExtra;
  return typeof process !== "undefined" && typeof process.env?.EXPO_PUBLIC_IOS_DIAGNOSTIC === "string"
    ? process.env.EXPO_PUBLIC_IOS_DIAGNOSTIC
    : "";
}

/** Diagnostics ON only when explicitly enabled. Default: OFF. */
export const IOS_DIAGNOSTIC = Platform.OS === "ios" && isDiagnosticOnValue(getDiagnosticEnvRaw());

/** Skip setupPushNotifications na iOS (Firebase Messaging) */
export const IOS_SKIP_PUSH = IOS_DIAGNOSTIC;

/** Skip GoogleSignin.configure na iOS */
export const IOS_SKIP_GOOGLE_SIGNIN = IOS_DIAGNOSTIC;

/** Skip BottomSheetModalProvider na iOS (Reanimated) */
export const IOS_SKIP_BOTTOMSHEET = IOS_DIAGNOSTIC;

/** Skip AuthProvider (Firebase Auth) na iOS – diagnostika, či crash je v Firebase */
export const IOS_SKIP_AUTH = IOS_DIAGNOSTIC;
