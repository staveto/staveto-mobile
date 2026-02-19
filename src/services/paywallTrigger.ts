/**
 * Paywall trigger – show paywall when user reaches usage thresholds without entitlement.
 * Rule: projects >= 1 && tasks >= 3 -> show paywall once.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NavigationProp } from "@react-navigation/native";

const STORAGE_KEY = "@staveto:paywall_trigger";
const SHOWN_KEY = "@staveto:paywall_shown";

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

async function wasPaywallShown(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SHOWN_KEY)) === "1";
  } catch {
    return false;
  }
}

async function markPaywallShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // ignore
  }
}

export type PaywallEvent = "project_created" | "task_created" | "app_opened";

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
 * Call after tracking events, when user has no entitlement.
 * Rule: projects >= 1 && tasks >= 3 -> show once.
 */
export async function checkAndShowPaywall(
  hasEntitlement: boolean,
  navigation: NavigationProp<Record<string, object>>
): Promise<boolean> {
  if (hasEntitlement) return false;
  if (await wasPaywallShown()) return false;

  const c = await getCounts();
  const shouldShow = c.projects >= 1 && c.tasks >= 3;
  if (!shouldShow) return false;

  await markPaywallShown();
  (navigation as any).navigate("Paywall");
  return true;
}
