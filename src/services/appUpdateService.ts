import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Application from "expo-application";
import { doc, getDoc } from "../lib/rnFirestore";
import { db, getFirestore } from "../firebase";
import { compareVersions } from "../utils/compareVersions";

/** Firestore document: collection `config`, id `appVersions` */
export const APP_VERSION_FIRESTORE_PATH = "config/appVersions";

const STORAGE_KEY_LAST_SOFT_PROMPT_AT = "@staveto:store_update_prompt_last_at";

const MIN_FIRESTORE_FETCH_INTERVAL_MS = 55_000;
let lastFirestoreFetchAt = 0;
let lastConfigCache: AppVersionsFirestoreDoc | null = null;

export type StoreUpdateKind = "none" | "soft" | "forced";

export type StoreUpdateCheckResult = {
  kind: StoreUpdateKind;
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion: string;
  storeUrl: string;
  message?: string;
};

type PlatformVersionConfig = {
  latestVersion: string;
  minSupportedVersion: string;
  storeUrl: string;
  message?: string;
};

type AppVersionsFirestoreDoc = {
  ios?: Partial<PlatformVersionConfig>;
  android?: Partial<PlatformVersionConfig>;
  updatedAt?: unknown;
};

export { compareVersions };

export function getCurrentAppVersion(): string {
  const native = Application.nativeApplicationVersion?.trim();
  if (native) return native;
  const fromConfig = Constants.expoConfig?.version?.trim();
  if (fromConfig) return fromConfig;
  return "0.0.0";
}

function pickPlatformSection(data: AppVersionsFirestoreDoc | undefined): PlatformVersionConfig | null {
  if (!data) return null;
  const raw = Platform.OS === "ios" ? data.ios : data.android;
  if (!raw || typeof raw !== "object") return null;
  const latestVersion = typeof raw.latestVersion === "string" ? raw.latestVersion.trim() : "";
  const minSupportedVersion = typeof raw.minSupportedVersion === "string" ? raw.minSupportedVersion.trim() : "";
  const storeUrl = typeof raw.storeUrl === "string" ? raw.storeUrl.trim() : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : undefined;
  if (!latestVersion || !minSupportedVersion || !storeUrl) return null;
  return { latestVersion, minSupportedVersion, storeUrl, message };
}

async function fetchAppVersionsFromFirestore(): Promise<AppVersionsFirestoreDoc | null> {
  const fs = getFirestore();
  if (!fs) return null;
  const now = Date.now();
  if (lastConfigCache && now - lastFirestoreFetchAt < MIN_FIRESTORE_FETCH_INTERVAL_MS) {
    return lastConfigCache;
  }
  try {
    const snap = await getDoc(doc(db, "config", "appVersions"));
    lastFirestoreFetchAt = Date.now();
    if (!snap.exists()) {
      lastConfigCache = null;
      return null;
    }
    const data = snap.data() as AppVersionsFirestoreDoc;
    lastConfigCache = data;
    return data;
  } catch (e) {
    console.warn("[appUpdateService] Firestore config read failed:", e);
    return null;
  }
}

async function isSoftPromptThrottled(): Promise<boolean> {
  try {
    const rawAt = await AsyncStorage.getItem(STORAGE_KEY_LAST_SOFT_PROMPT_AT);
    if (!rawAt) return false;
    const lastAt = parseInt(rawAt, 10);
    if (!Number.isFinite(lastAt)) return false;
    return Date.now() - lastAt < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Call when the soft-update modal is shown (24h throttle for subsequent soft prompts). */
export async function recordSoftPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_LAST_SOFT_PROMPT_AT, String(Date.now()));
  } catch {
    // ignore
  }
}

function emptyResult(currentVersion: string): StoreUpdateCheckResult {
  return {
    kind: "none",
    currentVersion,
    latestVersion: "",
    minSupportedVersion: "",
    storeUrl: "",
  };
}

/**
 * Evaluates whether a store update prompt should be shown.
 * OTA / expo-updates is unrelated — this is App Store / Play Store only.
 */
export async function evaluateStoreUpdate(options: {
  respectSoftThrottle: boolean;
}): Promise<StoreUpdateCheckResult> {
  const currentVersion = getCurrentAppVersion();
  const remote = await fetchAppVersionsFromFirestore();
  const platformCfg = pickPlatformSection(remote ?? undefined);
  if (!platformCfg) {
    return emptyResult(currentVersion);
  }

  const { latestVersion, minSupportedVersion, storeUrl, message } = platformCfg;

  if (compareVersions(currentVersion, minSupportedVersion) < 0) {
    return {
      kind: "forced",
      currentVersion,
      latestVersion,
      minSupportedVersion,
      storeUrl,
      message,
    };
  }

  if (compareVersions(currentVersion, latestVersion) < 0) {
    if (options.respectSoftThrottle && (await isSoftPromptThrottled())) {
      return emptyResult(currentVersion);
    }
    return {
      kind: "soft",
      currentVersion,
      latestVersion,
      minSupportedVersion,
      storeUrl,
      message,
    };
  }

  return emptyResult(currentVersion);
}

function playStoreHttpsFallback(): string {
  const pkg =
    (Constants.expoConfig?.android as { package?: string } | undefined)?.package?.trim() || "com.staveto.app";
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
}

/** Opens the store URL; on Android may fall back from market:// to HTTPS Play page. */
export async function openStoreUrl(storeUrl: string): Promise<boolean> {
  const trimmed = storeUrl?.trim();
  if (!trimmed) return false;

  try {
    await Linking.openURL(trimmed);
    return true;
  } catch (e) {
    console.warn("[appUpdateService] openStoreUrl primary failed:", e);
  }

  if (Platform.OS === "android" && trimmed.startsWith("market://")) {
    const https = playStoreHttpsFallback();
    try {
      await Linking.openURL(https);
      return true;
    } catch (e2) {
      console.warn("[appUpdateService] openStoreUrl Play HTTPS fallback failed:", e2);
    }
  }

  if (Platform.OS === "android" && !trimmed.startsWith("market://")) {
    try {
      await Linking.openURL(playStoreHttpsFallback());
      return true;
    } catch {
      // ignore
    }
  }

  return false;
}
