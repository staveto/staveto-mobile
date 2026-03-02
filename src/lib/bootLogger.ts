/**
 * Boot-step logger for crash investigation.
 * Persists to AsyncStorage (works on TestFlight/physical device).
 * Also sends to debug ingest when reachable (emulator/simulator).
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BOOT_LOG_KEY = "staveto_boot_log";
const LAST_ERROR_KEY = "staveto_last_error";
const MAX_LOG_ENTRIES = 30;
const HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const ENDPOINT = `http://${HOST}:7242/ingest/0123687b-551a-46fb-a614-55cb13747844`;

export type BootStep =
  | "entry_start"
  | "entry_gesture_ok"
  | "entry_mounted"
  | "entry_app_loading"
  | "app_loaded"
  | "boot_env_ok"
  | "boot_ready"
  | "lazy_i18n_loading"
  | "lazy_i18n_loaded"
  | "lazy_authed_loading"
  | "lazy_authed_loaded"
  | "app_shell_mounted"
  | "auth_provider_mount"
  | "auth_state_listener"
  | "revenuecat_configure_before"
  | "revenuecat_configure_after"
  | "root_nav_ready"
  | "splash_hide_before"
  | "splash_hide_after"
  | "boot_complete";

export async function bootStep(
  step: BootStep | string,
  hypothesisId: string,
  data?: Record<string, unknown>
): Promise<void> {
  const ts = Date.now();
  const entry = { step, ts, hypothesisId, data: data ?? {} };
  try {
    const raw = await AsyncStorage.getItem(BOOT_LOG_KEY);
    const entries: Array<{ step: string; ts: number }> = raw ? JSON.parse(raw) : [];
    entries.push({ step: String(step), ts });
    const trimmed = entries.slice(-MAX_LOG_ENTRIES);
    await AsyncStorage.setItem(BOOT_LOG_KEY, JSON.stringify(trimmed));
  } catch {}
  try {
    await AsyncStorage.setItem(BOOT_LOG_KEY + "_last", JSON.stringify({ step: String(step), ts }));
  } catch {}
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: `boot:${step}`, message: step, data: entry, timestamp: ts, hypothesisId }),
  }).catch(() => {});
}

export async function bootFail(err: unknown): Promise<void> {
  const str = err instanceof Error ? err.stack ?? err.message : String(err);
  try {
    await AsyncStorage.setItem(LAST_ERROR_KEY, str);
  } catch {}
}

export async function getLastBootStep(): Promise<{ step: string; ts: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(BOOT_LOG_KEY + "_last");
    if (raw) {
      const obj = JSON.parse(raw) as { step?: string; ts?: number };
      return obj?.step ? { step: obj.step, ts: obj.ts ?? 0 } : null;
    }
    const logRaw = await AsyncStorage.getItem(BOOT_LOG_KEY);
    if (!logRaw) return null;
    const entries = JSON.parse(logRaw) as Array<{ step?: string; ts?: number }>;
    const last = entries[entries.length - 1];
    return last?.step ? { step: last.step, ts: last.ts ?? 0 } : null;
  } catch {
    return null;
  }
}

export async function getBootLogEntries(): Promise<Array<{ step: string; ts: number }>> {
  try {
    const raw = await AsyncStorage.getItem(BOOT_LOG_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as Array<{ step?: string; ts?: number }>;
    return entries.map((e) => ({ step: String(e?.step ?? "?"), ts: e?.ts ?? 0 }));
  } catch {
    return [];
  }
}

export async function getLastError(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_ERROR_KEY);
  } catch {
    return null;
  }
}
