/**
 * Billing abstraction for Staveto.
 * RevenueCat + Google Play Billing for native; Cloud Function fallback when API key not set.
 * Requires expo-dev-client / EAS build (not Expo Go).
 */

import { Platform } from "react-native";
import { getCallable } from "../firebase";

let Purchases: typeof import("react-native-purchases").default | null = null;
try {
  const mod = require("react-native-purchases");
  Purchases = mod?.default ?? mod;
  if (!Purchases || typeof (Purchases as any).configure !== "function") {
    Purchases = null;
    if (__DEV__) console.warn("[billing] RevenueCat SDK not properly loaded. Use dev-client/EAS build, not Expo Go.");
  }
} catch {
  if (__DEV__) console.warn("[billing] react-native-purchases not installed or failed to load");
}

export const PLAN_ID = "staveto_monthly_1499";
export const REVENUECAT_ENTITLEMENT_ID = "pro";
export const REVENUECAT_OFFERING_ID = "default";
export const REVENUECAT_PACKAGE_MONTHLY_TRIAL = "$rc_monthly";
export const REVENUECAT_PACKAGE_MONTHLY_NOTRIAL = "monthly_notrial";

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
    if (__DEV__) console.warn("[billing] react-native-purchases not installed or not available (use dev-client, not Expo Go)");
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
    const LOG_LEVEL = (Purchases as any).LOG_LEVEL;
    if (__DEV__ && typeof (Purchases as any).setLogLevel === "function" && LOG_LEVEL?.DEBUG != null) {
      (Purchases as any).setLogLevel(LOG_LEVEL.DEBUG);
    }
    await Purchases.configure({ apiKey, appUserID: userId ?? undefined });
    purchasesConfigured = true;
    if (__DEV__) console.log("[billing] RevenueCat configured");
  } catch (e) {
    if (__DEV__) console.error("[billing] configurePurchases error:", e);
    throw e;
  }
}

/** Safe wrapper for getCustomerInfo - returns null on failure with console error. */
export async function getCustomerInfoSafe(): Promise<{ entitlements: { active: Record<string, unknown> } } | null> {
  if (!Purchases || typeof (Purchases as any).getCustomerInfo !== "function") return null;
  try {
    const info = await (Purchases as any).getCustomerInfo();
    return info ?? null;
  } catch (e) {
    if (__DEV__) console.error("[billing] getCustomerInfo error:", e);
    return null;
  }
}

async function getEntitlementFromRevenueCat(): Promise<Entitlement | null> {
  if (!Purchases || !getApiKey()) return null;
  try {
    const customerInfo = await getCustomerInfoSafe();
    if (!customerInfo?.entitlements?.active) return null;
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID] as { periodType?: string; latestPurchaseDate?: string; expirationDate?: string } | undefined;
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
  if (!Purchases || !getApiKey() || typeof (Purchases as any).getOfferings !== "function") return null;
  try {
    const offerings = await (Purchases as any).getOfferings();
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

export async function purchaseMonthly(
  preferredPackageIds: string[] = []
): Promise<{ success: boolean }> {
  if (!Purchases || !getApiKey() || typeof (Purchases as any).getOfferings !== "function" || typeof (Purchases as any).purchasePackage !== "function") {
    if (__DEV__) console.warn("[billing] RevenueCat not configured or missing native methods (use dev-client build)");
    return { success: false };
  }
  try {
    const offerings = await (Purchases as any).getOfferings();
    const offering = offerings.current ?? offerings.all?.[REVENUECAT_OFFERING_ID];
    if (!offering?.availablePackages?.length) {
      if (__DEV__) console.warn("[billing] No packages available");
      return { success: false };
    }
    const pkg =
      offering.availablePackages.find((p: { identifier?: string }) =>
        preferredPackageIds.includes(String(p.identifier ?? ""))
      ) ??
      offering.availablePackages.find((p: { packageType: string }) => p.packageType === "MONTHLY") ??
      offering.availablePackages[0];
    const { customerInfo } = await (Purchases as any).purchasePackage(pkg);
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
    return { success: !!ent };
  } catch (e: unknown) {
    if (__DEV__) console.error("[billing] purchaseMonthly error:", e);
    throw e;
  }
}

export async function restorePurchases(): Promise<{ success: boolean }> {
  if (!Purchases || !getApiKey() || typeof (Purchases as any).restorePurchases !== "function") {
    if (__DEV__) console.warn("[billing] RevenueCat not configured");
    return { success: false };
  }
  try {
    const customerInfo = await (Purchases as any).restorePurchases();
    const ent = customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
    return { success: !!ent };
  } catch (e: unknown) {
    if (__DEV__) console.error("[billing] restorePurchases error:", e);
    throw e;
  }
}
