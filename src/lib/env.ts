/**
 * Single source of truth for env vars.
 * EAS env vars are injected in app.config.js and read via Constants.expoConfig.extra.
 * Do not use process.env.EXPO_PUBLIC_* at runtime – it is undefined in production builds.
 */

import Constants from "expo-constants";

function getExtra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra as Record<string, unknown>) ?? {};
}

/** Returns the value for key from extra, or undefined if missing/empty. Empty string counts as missing. */
export function getExtraEnv(key: string): string | undefined {
  const val = getExtra()[key];
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
