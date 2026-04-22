import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ProjectEngineType } from "./projectTypeModel";

/** How the user primarily works — drives onboarding, defaults, and light copy. */
export type PrimaryUsageMode = "build" | "trade";

export const PRIMARY_USAGE_STORAGE_KEY = "primary_usage_mode_v1";

const PENDING_ONBOARDING_KEY = "pending_onboarding";

export function normalizeLegacyUsageMode(mode: unknown): PrimaryUsageMode | null {
  if (mode === "build" || mode === "trade") return mode;
  /** Legacy onboarding / profile value — treat as trade-style work. */
  if (mode === "maintenance") return "trade";
  return null;
}

export async function readStoredPrimaryUsageMode(): Promise<PrimaryUsageMode | null> {
  try {
    const direct = await AsyncStorage.getItem(PRIMARY_USAGE_STORAGE_KEY);
    if (direct === "build" || direct === "trade") return direct;
    const pending = await AsyncStorage.getItem(PENDING_ONBOARDING_KEY);
    if (pending) {
      const parsed = JSON.parse(pending) as { mode?: unknown };
      const m = normalizeLegacyUsageMode(parsed?.mode);
      if (m) return m;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function persistPrimaryUsageMode(mode: PrimaryUsageMode): Promise<void> {
  await AsyncStorage.setItem(PRIMARY_USAGE_STORAGE_KEY, mode);
}

export function primaryUsageToDefaultEngine(mode: PrimaryUsageMode | null): ProjectEngineType | null {
  if (mode === "build") return "BUILD";
  if (mode === "trade") return "TRADE";
  return null;
}
