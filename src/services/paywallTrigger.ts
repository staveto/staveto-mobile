/**
 * Paywall trigger – show paywall when user reaches usage thresholds without entitlement.
 * Uses server billing status (billing.isPro, billing.status).
 * Rule: billing.isPro => never show. billing.status==="expired" => show with 24h cooldown.
 *       billing.status==="trial" => engagement trigger (projects>=1 && tasks>=3) + 24h cooldown.
 * Uses navigationRef for Paywall navigation (root navigator has Paywall; nested screens may not).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NavigationProp } from "@react-navigation/native";
import type { BillingStatus } from "../helpers/freeTrial";
import { navigationRef } from "../components/PushNotificationHandler";

const STORAGE_KEY = "@staveto:paywall_trigger";
const LAST_PAYWALL_SHOWN_AT = "@staveto:lastPaywallShownAt";
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

type Counts = { projects: number; tasks: number; appOpened: number };

async function getCounts(): Promise<Counts> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: 0, tasks: 0, appOpened: 0 };
    return JSON.parse(raw) as Counts;
  } catch {
    return { projects: 0, tasks: 0, appOpened: 0 };
  }
}

async function setCounts(c: Counts): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

async function isWithinCooldown(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PAYWALL_SHOWN_AT);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (isNaN(ts)) return false;
    return Date.now() - ts < COOLDOWN_MS;
  } catch {
    return false;
  }
}

async function markPaywallShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PAYWALL_SHOWN_AT, String(Date.now()));
  } catch {
    // ignore
  }
}

export type PaywallEvent = "project_created" | "task_created" | "app_opened";

/**
 * Require Pro or valid trial before OCR/export/advanced actions.
 * Returns true if user can proceed, false if paywall should be shown.
 */
export function requireProOrTrialValid(billing: BillingStatus | null | undefined): boolean {
  if (!billing) return false;
  if (billing.isPro) return true;
  if (billing.status === "trial" && billing.remainingTrialDays > 0) return true;
  return false;
}

/**
 * Track a paywall-relevant event. Call from project/task creation or app open.
 */
export async function trackPaywallEvent(event: PaywallEvent): Promise<void> {
  const c = await getCounts();
  switch (event) {
    case "project_created":
      c.projects = Math.max(c.projects, 1);
      break;
    case "task_created":
      c.tasks += 1;
      break;
    case "app_opened":
      c.appOpened += 1;
      break;
  }
  await setCounts(c);
}

/**
 * Check if paywall should be shown and navigate if so.
 * billing.isPro => never show.
 * billing.status==="expired" => show with 24h cooldown.
 * billing.status==="trial" => engagement trigger (projects>=1 && tasks>=3) + 24h cooldown.
 */
export async function checkAndShowPaywall(
  billing: BillingStatus | null | undefined,
  navigation: NavigationProp<Record<string, object>>
): Promise<boolean> {
  if (billing?.isPro) return false;
  if (await isWithinCooldown()) return false;

  if (billing?.status === "expired") {
    await markPaywallShown();
    if (navigationRef.isReady()) {
      try {
        (navigationRef as any).navigate("Paywall");
      } catch (e) {
        if (__DEV__) console.warn("[paywall] Navigate to Paywall failed:", e);
      }
    } else if (__DEV__) {
      console.warn("[paywall] navigationRef not ready, Paywall not shown");
    }
    return true;
  }

  if (billing?.status === "trial") {
    const c = await getCounts();
    const shouldShow = c.projects >= 1 && c.tasks >= 3;
    if (!shouldShow) return false;
    await markPaywallShown();
    if (navigationRef.isReady()) {
      try {
        (navigationRef as any).navigate("Paywall");
      } catch (e) {
        if (__DEV__) console.warn("[paywall] Navigate to Paywall failed:", e);
      }
    } else if (__DEV__) {
      console.warn("[paywall] navigationRef not ready, Paywall not shown");
    }
    return true;
  }

  return false;
}
