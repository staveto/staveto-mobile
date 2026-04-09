/**
 * Single source of truth for env vars.
 * Primary: Constants.expoConfig.extra (from app.config.js at build / Metro manifest).
 * Fallback for EXPO_PUBLIC_*: process.env when extra is empty (e.g. after .env edit without full native rebuild).
 */

import Constants from "expo-constants";

function getExtra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra as Record<string, unknown>) ?? {};
}

/** Returns the value for key from extra, or undefined if missing/empty. Empty string counts as missing. */
export function getExtraEnv(key: string): string | undefined {
  const val = getExtra()[key];
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0) return trimmed;
  }
  // Fallback: Metro / Expo may expose EXPO_PUBLIC_* at runtime while extra is stale after .env changes without rebuild.
  if (key.startsWith("EXPO_PUBLIC_") && typeof process !== "undefined" && process.env?.[key]) {
    const p = String(process.env[key]).trim();
    if (p.length > 0) return p;
  }
  return undefined;
}

/** Returns true if key exists in extra and has non-empty value. */
export function hasExtraEnv(key: string): boolean {
  return getExtraEnv(key) !== undefined;
}

/** Returns raw string value for key (for display/debug). Empty/missing returns "". */
export function getExtraEnvRaw(key: string): string {
  const val = getExtra()[key];
  return typeof val === "string" ? val : "";
}
