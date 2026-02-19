/**
 * Billing abstraction for Staveto.
 * Single plan: 14-day trial, then €14.99/month (staveto_monthly_1499).
 * Stub implementation via Firestore/Cloud Functions. Swap for RevenueCat later.
 */

import { getFns } from "../firebase";

export const PLAN_ID = "staveto_monthly_1499";

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

/**
 * Get current entitlement and usage from backend.
 */
export async function getEntitlement(): Promise<Entitlement> {
  const result = await getFns().httpsCallable("checkEntitlement")();
  return result.data as Entitlement;
}

/**
 * Purchase monthly subscription. Stub: manual activation via Firestore.
 * TODO: Replace with RevenueCat purchaseMonthly().
 */
export async function purchaseMonthly(): Promise<{ success: boolean }> {
  // Stub: In production, this would call RevenueCat or Stripe.
  // For now, admin must manually set subscriptionStatus: "active" in Firestore.
  return { success: false };
}

/**
 * Restore purchases. Stub for RevenueCat.
 * TODO: Replace with RevenueCat restorePurchases().
 */
export async function restorePurchases(): Promise<{ success: boolean }> {
  return { success: false };
}
