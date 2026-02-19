/**
 * Billing abstraction for Staveto.
 * RevenueCat + Google Play Billing for native; Cloud Function fallback when API key not set.
 */

import { Platform } from "react-native";
import { getCallable } from "../firebase";

let Purchases: typeof import("react-native-purchases") | null = null;
try {
  Purchases = require("react-native-purchases");
} catch {
  // react-native-purchases not installed
}

export const PLAN_ID = "staveto_monthly_1499";
export const REVENUECAT_ENTITLEMENT_ID = "pro";
export const REVENUECAT_OFFERING_ID = "default";

export type SubscriptionStatus = "trial" | "active" | "expired" | "none";

export interface Entitlement {
  entitlement: boolean;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStartAt: string | null;
  currentPeriodEndAt: string | null;
  planId: string;
  ocrUsed: number;
  ocrLimit: number;
  ocrCooldownSeconds: number;
  isTrial: boolean;
}

export const DEFAULT_ENTITLEMENT: Entitlement = {
  entitlement: false,
  status: "expired",
  trialStartAt: null,
  trialEndAt: null,
  currentPeriodStartAt: null,
  currentPeriodEndAt: null,
  planId: PLAN_ID,
  ocrUsed: 0,
  ocrLimit: 0,
  ocrCooldownSeconds: 0,
  isTrial: false,
};

let purchasesConfigured = false;

function getApiKey(): string | null {
  const key =
    Platform.OS === "android"
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim()
      : process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  return key || null;
}

export async function configurePurchases(userId?: string | null): Promise<void> {
  if (!Purchases) {
    if (__DEV__) console.warn("[billing] react-native-purchases not installed");
    return;
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    if (__DEV__) console.warn("[billing] RevenueCat API key not set (EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY)");
    return;
  }
  if (purchasesConfigured) {
    if (userId) {
      try {
        await Purchases.logIn(userId);
        if (__DEV__) console.log("[billing] RevenueCat logIn:", userId);
      } catch (e) {
        if (__DEV__) console.error("[billing] logIn error:", e);
      }
    }
    return;
  }
  try {
    if (__DEV__) Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    await Purchases.configure({ apiKey });
    if (userId) await Purchases.logIn(userId);
    purchasesConfigured = true;
    if (__DEV__) console.log("[billing] RevenueCat configured");
  } catch (e) {
    if (__DEV__) console.error("[billing] configurePurchases error:", e);
    throw e;
  }
}

async function getEntitlementFromRevenueCat(): Promise<Entitlement | null> {
  if (!Purchases || !getApiKey()) return null;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
    if (__DEV__) {
      console.log("[billing] customerInfo entitlements:", Object.keys(customerInfo.entitlements.active));
    }
    if (ent) {
      return {
        entitlement: true,
        status: ent.periodType === "trial" ? "trial" : "active",
        trialStartAt: null,
        trialEndAt: null,
        currentPeriodStartAt: ent.latestPurchaseDate ?? null,
        currentPeriodEndAt: ent.expirationDate ?? null,
        planId: PLAN_ID,
        ocrUsed: 0,
        ocrLimit: 0,
        ocrCooldownSeconds: 0,
        isTrial: ent.periodType === "trial",
      };
    }
    return null;
  } catch (e) {
    if (__DEV__) console.error("[billing] getEntitlementFromRevenueCat error:", e);
    return null;
  }
}

async function getEntitlementFromCloudFunction(): Promise<Entitlement> {
  try {
    const result = await getCallable("checkEntitlement")();
    return result.data as Entitlement;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    const message = String((error as { message?: string })?.message ?? "");
    if (code === "functions/not-found" || code === "not-found" || message.includes("NOT_FOUND")) {
      return DEFAULT_ENTITLEMENT;
    }
    throw error;
  }
}

/**
 * Get entitlement: prefer RevenueCat, fallback to Cloud Function when API key not set.
 */
export async function getEntitlement(): Promise<Entitlement> {
  const rc = await getEntitlementFromRevenueCat();
  if (rc) return rc;
  return getEntitlementFromCloudFunction();
}

export async function getOfferings(): Promise<{
  current: { availablePackages: Array<{ packageType: string; identifier: string }> } | null;
  all: Record<string, { availablePackages: Array<unknown> }>;
} | null> {
  if (!Purchases || !getApiKey()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    if (__DEV__) {
      console.log("[billing] offerings.current:", offerings.current?.identifier);
      console.log("[billing] availablePackages count:", offerings.current?.availablePackages?.length ?? 0);
    }
    return offerings as unknown as {
      current: { availablePackages: Array<{ packageType: string; identifier: string }> } | null;
      all: Record<string, { availablePackages: Array<unknown> }>;
    };
  } catch (e) {
    if (__DEV__) console.error("[billing] getOfferings error:", e);
    return null;
  }
}

export async function purchaseMonthly(): Promise<{ success: boolean }> {
  if (!Purchases || !getApiKey()) {
    if (__DEV__) console.warn("[billing] RevenueCat not configured");
    return { success: false };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const offering = offerings.current ?? offerings.all[REVENUECAT_OFFERING_ID];
    if (!offering?.availablePackages?.length) {
      if (__DEV__) console.warn("[billing] No packages available");
      return { success: false };
    }
    const pkg =
      offering.availablePackages.find((p: { packageType: string }) => p.packageType === "MONTHLY") ??
      offering.availablePackages[0];
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
    return { success: !!ent };
  } catch (e: unknown) {
    if (__DEV__) console.error("[billing] purchaseMonthly error:", e);
    throw e;
  }
}

export async function restorePurchases(): Promise<{ success: boolean }> {
  if (!Purchases || !getApiKey()) {
    if (__DEV__) console.warn("[billing] RevenueCat not configured");
    return { success: false };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
    return { success: !!ent };
  } catch (e: unknown) {
    if (__DEV__) console.error("[billing] restorePurchases error:", e);
    throw e;
  }
}
