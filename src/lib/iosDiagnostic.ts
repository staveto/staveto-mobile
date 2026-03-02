/**
 * iOS crash diagnostic – dočasne vypni podozrivé moduly na iOS.
 * Ak app po zapnutí týchto bypassov naštartuje, vieme ktorý modul spôsoboval crash.
 *
 * EXPO_PUBLIC_IOS_DIAGNOSTIC=0 vypne bypass (keď už vieme vinníka).
 * Default: všetky bypassy ZAPNUTÉ na iOS (aby app naštartovala).
 */
import { Platform } from "react-native";
import { getExtraEnv } from "./env";

function isDiagnosticOff(): boolean {
  const v = getExtraEnv("EXPO_PUBLIC_IOS_DIAGNOSTIC") ?? (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_IOS_DIAGNOSTIC : undefined);
  return v === "0" || v === "false";
}
export const IOS_DIAGNOSTIC = Platform.OS === "ios" && !isDiagnosticOff();

/** Skip setupPushNotifications na iOS (Firebase Messaging) */
export const IOS_SKIP_PUSH = IOS_DIAGNOSTIC;

/** Skip GoogleSignin.configure na iOS */
export const IOS_SKIP_GOOGLE_SIGNIN = IOS_DIAGNOSTIC;

/** Skip BottomSheetModalProvider na iOS (Reanimated) */
export const IOS_SKIP_BOTTOMSHEET = IOS_DIAGNOSTIC;

/** Skip AuthProvider (Firebase Auth) na iOS – diagnostika, či crash je v Firebase */
export const IOS_SKIP_AUTH = IOS_DIAGNOSTIC;
